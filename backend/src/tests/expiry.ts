import { buildApp } from '../server.js';
import { initDb, applySchemaAndSeed, query } from '../db/client.js';
import { initRedis as initRedisClient } from '../redis/client.js';
import { createHold, expireHold } from '../redis/holdManager.js';
import crypto from 'crypto';

async function runExpiryTests() {
  console.log('================================================================');
  console.log('  BOOKGUARD SPRINT 3: DURABLE EXPIRY TESTS');
  console.log('================================================================');

  await initDb();
  await initRedisClient();
  // Do not start hold sweeper in background to avoid race conditions with our manual assertions
  await applySchemaAndSeed(true);

  const inventoryId = 'flt_blr_goi_ix6534';
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${message}`);
      failed++;
    }
  }

  // Initial state
  const initRes = await query<{ available_quantity: number, held_quantity: number }>(`SELECT available_quantity, held_quantity FROM inventory WHERE id = $1`, [inventoryId]);
  const initialAvailable = initRes.rows[0].available_quantity;
  const initialHeld = initRes.rows[0].held_quantity;

  // Test 1: Hold expires and inventory returns exactly to previous state
  const hold1 = await createHold({ travellerId: 'traveller_priya', inventoryId, quantity: 2, ttlSeconds: -10 }); // -10 forces immediate expiry mathematically
  assert(hold1.quantity === 2, 'Hold created successfully');
  
  const expireRes1 = await expireHold(hold1.holdId);
  assert(expireRes1 === true, 'Hold expired successfully');

  const afterExpireRes = await query<{ available_quantity: number, held_quantity: number, status: string }>(`SELECT i.available_quantity, i.held_quantity, h.status FROM inventory i JOIN holds h ON i.id = h.inventory_id WHERE h.id = $1`, [hold1.holdId]);
  assert(
    afterExpireRes.rows[0].available_quantity === initialAvailable && 
    afterExpireRes.rows[0].held_quantity === initialHeld &&
    afterExpireRes.rows[0].status === 'EXPIRED',
    'Inventory returns exactly to previous state and hold status is EXPIRED'
  );

  // Check booking state and booking events
  const bookingRes = await query<{ status: string }>(`SELECT status FROM bookings WHERE id = $1`, [hold1.bookingId]);
  assert(bookingRes.rows[0].status === 'EXPIRED', 'Booking state transitioned to EXPIRED');

  const eventsRes = await query<{ from_state: string, to_state: string }>(`SELECT from_state, to_state FROM booking_events WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1`, [hold1.bookingId]);
  assert(eventsRes.rows[0].from_state === 'HELD' && eventsRes.rows[0].to_state === 'EXPIRED', 'booking_events written correctly through state machine');

  // Test 2: Repeated/concurrent expiry attempts release only once
  const hold2 = await createHold({ travellerId: 'traveller_priya', inventoryId, quantity: 1, ttlSeconds: -10 });
  const concurrentExpires = await Promise.all([
    expireHold(hold2.holdId),
    expireHold(hold2.holdId),
    expireHold(hold2.holdId)
  ]);
  const successCount = concurrentExpires.filter(res => res === true).length;
  assert(successCount === 1, 'Concurrent expiry attempts release exactly once');

  // Test 3: Non-expired hold is not expired
  const hold3 = await createHold({ travellerId: 'traveller_priya', inventoryId, quantity: 1, ttlSeconds: 3600 });
  const expireRes3 = await expireHold(hold3.holdId);
  assert(expireRes3 === false, 'Non-expired hold is correctly rejected by expireHold');

  // Test 4: Confirmed hold is not expired
  // Force hold3 to CONFIRMED manually to test rejection
  await query(`UPDATE holds SET status = 'CONFIRMED', expires_at = CURRENT_TIMESTAMP - interval '1 hour' WHERE id = $1`, [hold3.holdId]);
  const expireRes4 = await expireHold(hold3.holdId);
  assert(expireRes4 === false, 'Confirmed hold is not expired, even if its TTL has passed');

  // Test 5: Inventory invariant remains valid
  const finalRes = await query<{
    available_quantity: number;
    held_quantity: number;
    confirmed_quantity: number;
    total_quantity: number;
  }>(`SELECT available_quantity, held_quantity, confirmed_quantity, total_quantity FROM inventory WHERE id = $1`, [inventoryId]);
  
  const row = finalRes.rows[0];
  const invariantCheck = (row.available_quantity + row.held_quantity + row.confirmed_quantity === row.total_quantity);
  assert(invariantCheck, `Inventory invariant preserved: ${row.available_quantity} + ${row.held_quantity} + ${row.confirmed_quantity} = ${row.total_quantity}`);

  // Test 6: Final Integration Test (Redis-expiry path vs PostgreSQL sweeper path)
  // Create an ACTIVE hold with an already-expired PostgreSQL expires_at
  const hold6 = await createHold({ travellerId: 'traveller_priya', inventoryId, quantity: 1, ttlSeconds: 1000 });
  await query(`UPDATE holds SET expires_at = CURRENT_TIMESTAMP - interval '1 hour' WHERE id = $1`, [hold6.holdId]);

  // Simulate Redis path
  const redisPath = async () => {
    return await expireHold(hold6.holdId);
  };

  // Simulate PostgreSQL sweeper path
  const pgSweeperPath = async () => {
    const expiredDbHolds = await query<{ id: string }>(
      `SELECT id FROM holds WHERE status = 'ACTIVE' AND expires_at <= CURRENT_TIMESTAMP LIMIT 10`
    );
    const holdIds = expiredDbHolds.rows.map(r => r.id);
    if (holdIds.includes(hold6.holdId)) {
      return await expireHold(hold6.holdId);
    }
    return false;
  };

  // Run them concurrently
  const [redisRes, pgSweeperRes] = await Promise.all([redisPath(), pgSweeperPath()]);
  
  // Verify exactly one release occurs
  const successCount6 = (redisRes === true ? 1 : 0) + (pgSweeperRes === true ? 1 : 0);
  assert(successCount6 === 1, 'Exactly one expiry path succeeds when racing');

  // Verify hold = EXPIRED
  const holdRes6 = await query<{ status: string }>(`SELECT status FROM holds WHERE id = $1`, [hold6.holdId]);
  assert(holdRes6.rows[0].status === 'EXPIRED', 'Racing hold = EXPIRED');

  // Verify booking = EXPIRED
  const bookingRes6 = await query<{ status: string }>(`SELECT status FROM bookings WHERE id = $1`, [hold6.bookingId]);
  assert(bookingRes6.rows[0].status === 'EXPIRED', 'Racing booking = EXPIRED');

  // Verify no duplicate booking_event/release occurs
  const eventsRes6 = await query<{ id: string }>(`SELECT id FROM booking_events WHERE booking_id = $1 AND to_state = 'EXPIRED'`, [hold6.bookingId]);
  assert(eventsRes6.rowCount === 1, 'Exactly one EXPIRED booking_event was written');

  // Verify inventory is restored exactly once (inventory should match previous test since hold6 was created and then expired)
  const finalRes6 = await query<{
    available_quantity: number;
    held_quantity: number;
    confirmed_quantity: number;
    total_quantity: number;
  }>(`SELECT available_quantity, held_quantity, confirmed_quantity, total_quantity FROM inventory WHERE id = $1`, [inventoryId]);
  const row6 = finalRes6.rows[0];
  assert(
    row6.available_quantity === row.available_quantity && 
    row6.held_quantity === row.held_quantity &&
    row6.confirmed_quantity === row.confirmed_quantity,
    'Inventory is restored exactly once'
  );
  assert(row6.available_quantity + row6.held_quantity + row6.confirmed_quantity === row6.total_quantity, 'Inventory invariant still preserved after race');

  console.log('================================================================');
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log('================================================================');
  
  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runExpiryTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

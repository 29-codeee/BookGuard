import assert from 'assert';
import { query, initDb } from '../db/client.js';
import { getRedis, initRedis } from '../redis/client.js';
import { mockAirlineProvider } from '../providers/mockProvider.js';
import { createHold, expireHold } from '../redis/holdManager.js';
import { providerAdapter } from '../providers/adapter.js';
import Fastify from 'fastify';
import bookingRoutes from '../routes/bookings.js';
import crypto from 'crypto';

const fastify = Fastify();
fastify.register(bookingRoutes);

async function runTests() {
  console.log('================================================================');
  console.log('  BOOKGUARD SPRINT 4: CONFIRMATION TESTS');
  console.log('================================================================');

  let passed = 0;
  let failed = 0;

  await initDb();
  await initRedis();

  function runAssert(condition: boolean, message: string) {
    try {
      assert(condition, message);
      console.log(`✅ PASS: ${message}`);
      passed++;
    } catch (err: any) {
      console.error(`❌ FAIL: ${message}`);
      console.error(`   ${err.message}`);
      failed++;
    }
  }

  try {
    const inventoryId = 'flt_blr_goi_ix6534'; // total = 3

    // Clear db for clean test
    await query(`UPDATE inventory SET available_quantity = total_quantity, held_quantity = 0, confirmed_quantity = 0 WHERE id = $1`, [inventoryId]);
    await query(`DELETE FROM provider_reservations`);
    await query(`DELETE FROM booking_items`);
    await query(`DELETE FROM holds`);
    await query(`DELETE FROM booking_events`);
    await query(`DELETE FROM bookings`);
    await query(`DELETE FROM idempotency_keys`);

    const invInit = await query<{ total_quantity: number }>(`SELECT total_quantity FROM inventory WHERE id = $1`, [inventoryId]);
    const totalQty = invInit.rows[0].total_quantity;

    // Helper to call confirm endpoint
    const confirmBooking = async (bookingId: string, idempotencyKey: string) => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/bookings/confirm',
        headers: { 'idempotency-key': idempotencyKey },
        payload: {
          bookingId,
          travellerName: 'Priya Sharma',
        }
      });
      return { statusCode: response.statusCode, payload: JSON.parse(response.payload) };
    };

    // --- TEST 1: normal HELD -> CONFIRMED, inventory moved exactly once, invariant preserved ---
    const hold1 = await createHold({ travellerId: 'traveller_priya', inventoryId, quantity: 1, ttlSeconds: 1000 });
    const res1 = await confirmBooking(hold1.bookingId, crypto.randomUUID());
    
    runAssert(res1.statusCode === 200, 'Normal HELD -> CONFIRMED returns 200');
    runAssert(res1.payload.status === 'CONFIRMED', 'Payload status is CONFIRMED');
    
    const bRes1 = await query<{ status: string }>(`SELECT status FROM bookings WHERE id = $1`, [hold1.bookingId]);
    runAssert(bRes1.rows[0].status === 'CONFIRMED', 'Booking status in DB is CONFIRMED');
    
    const hRes1 = await query<{ status: string }>(`SELECT status FROM holds WHERE id = $1`, [hold1.holdId]);
    runAssert(hRes1.rows[0].status === 'CONFIRMED', 'Hold status in DB is CONFIRMED');

    const invRes1 = await query<{ available_quantity: number, held_quantity: number, confirmed_quantity: number, total_quantity: number }>(
      `SELECT available_quantity, held_quantity, confirmed_quantity, total_quantity FROM inventory WHERE id = $1`, [inventoryId]
    );
    runAssert(invRes1.rows[0].available_quantity === totalQty - 1, `Inventory available_quantity is ${totalQty - 1}`);
    runAssert(invRes1.rows[0].held_quantity === 0, 'Inventory held_quantity is 0');
    runAssert(invRes1.rows[0].confirmed_quantity === 1, 'Inventory confirmed_quantity is 1');
    runAssert(invRes1.rows[0].available_quantity + invRes1.rows[0].held_quantity + invRes1.rows[0].confirmed_quantity === invRes1.rows[0].total_quantity, 'Inventory invariant preserved: available + held + confirmed = total');

    const events1 = await query(`SELECT to_state FROM booking_events WHERE booking_id = $1`, [hold1.bookingId]);
    runAssert(events1.rows.length === 2 && events1.rows[0].to_state === 'HELD' && events1.rows[1].to_state === 'CONFIRMED', 'Correct booking_events created');

    // --- TEST 2: confirmation idempotency ---
    const idemKey = crypto.randomUUID();
    const hold2 = await createHold({ travellerId: 'traveller_priya', inventoryId, quantity: 1, ttlSeconds: 1000 });
    
    const res2a = await confirmBooking(hold2.bookingId, idemKey);
    const res2b = await confirmBooking(hold2.bookingId, idemKey);
    runAssert(res2a.statusCode === 200 && res2b.statusCode === 200, 'Confirmation idempotency returns 200');
    runAssert(res2a.payload.pnr === res2b.payload.pnr, 'Confirmation idempotency returns same PNR');

    // --- TEST 3: already EXPIRED -> confirmation rejected ---
    const hold3 = await createHold({ travellerId: 'traveller_priya', inventoryId, quantity: 1, ttlSeconds: 1000 });
    await query(`UPDATE holds SET expires_at = CURRENT_TIMESTAMP - interval '1 hour' WHERE id = $1`, [hold3.holdId]);
    await expireHold(hold3.holdId);
    
    const res3 = await confirmBooking(hold3.bookingId, crypto.randomUUID());
    runAssert(res3.statusCode === 410, 'Already EXPIRED hold rejects confirmation with 410');
    runAssert(res3.payload.error === 'HOLD_EXPIRED', 'Already EXPIRED hold returns HOLD_EXPIRED');

    // --- TEST 4: expiry racing with confirmation of a hold whose TTL already passed ---
    // The engine re-checks the DB-clock TTL before calling the provider, so the confirm itself
    // expires the hold and never creates a (phantom) provider reservation. Whichever of
    // confirm/expire gets the booking lock first performs the expiry; exactly one does.
    const hold4 = await createHold({ travellerId: 'traveller_priya', inventoryId, quantity: 1, ttlSeconds: 1000 });
    await query(`UPDATE holds SET expires_at = CURRENT_TIMESTAMP - interval '1 hour' WHERE id = $1`, [hold4.holdId]); // force it to be expirable
    mockAirlineProvider.setMode('DELAY');

    const pConfirm = confirmBooking(hold4.bookingId, crypto.randomUUID());
    await new Promise(r => setTimeout(r, 50));
    const pExpire = expireHold(hold4.holdId);

    const [resConfirm] = await Promise.all([pConfirm, pExpire]);
    mockAirlineProvider.setMode('SUCCESS');

    const bRes4 = await query<{ status: string }>(`SELECT status FROM bookings WHERE id = $1`, [hold4.bookingId]);
    const expiredEvents4 = await query(`SELECT id FROM booking_events WHERE booking_id = $1 AND to_state = 'EXPIRED'`, [hold4.bookingId]);
    const prv4 = await query(`SELECT id FROM provider_reservations WHERE booking_id = $1`, [hold4.bookingId]);
    runAssert(resConfirm.statusCode === 410 && resConfirm.payload.error === 'HOLD_EXPIRED', 'Confirmation of an expired hold aborts with 410 HOLD_EXPIRED');
    runAssert(bRes4.rows[0].status === 'EXPIRED' && expiredEvents4.rowCount === 1, 'Hold expired exactly once (single EXPIRED booking_event)');
    runAssert(prv4.rowCount === 0, 'No phantom provider reservation was created');

    // --- TEST 5: Confirmed hold cannot be expired ---
    // If confirmation finishes first, expiry should be rejected.
    const hold5 = await createHold({ travellerId: 'traveller_priya', inventoryId, quantity: 1, ttlSeconds: 1000 });
    const res5Conf = await confirmBooking(hold5.bookingId, crypto.randomUUID());
    runAssert(res5Conf.statusCode === 200, 'Hold confirmed successfully');
    
    // Now try to expire it
    await query(`UPDATE holds SET expires_at = CURRENT_TIMESTAMP - interval '1 hour' WHERE id = $1`, [hold5.holdId]);
    const res5Exp = await expireHold(hold5.holdId);
    runAssert(res5Exp === false, 'Confirmed hold cannot be expired');

    // --- TEST 6: Provider cancellation failure while compensating an orphan reservation ---
    // The provider confirms, but the confirmation claim was lost mid-call (simulated takeover),
    // so the engine must not apply the result and must cancel the provider PNR. The cancel
    // fails (CANCEL_FAILURE); the booking must stay untouched and the client must not see success.
    const hold6 = await createHold({ travellerId: 'traveller_priya', inventoryId, quantity: 1, ttlSeconds: 1000 });
    mockAirlineProvider.setMode('CANCEL_FAILURE');

    const pConfirm6 = confirmBooking(hold6.bookingId, crypto.randomUUID());
    await new Promise(r => setTimeout(r, 50));
    await query(`UPDATE bookings SET confirm_token = 'stolen-claim' WHERE id = $1`, [hold6.bookingId]);
    const resConfirm6 = await pConfirm6;
    mockAirlineProvider.setMode('SUCCESS');

    runAssert(resConfirm6.statusCode === 409 && resConfirm6.payload.error === 'CONFIRM_CLAIM_LOST', 'Confirmation with a lost claim is rejected (409 CONFIRM_CLAIM_LOST)');
    const bRes6held = await query<{ status: string }>(`SELECT status FROM bookings WHERE id = $1`, [hold6.bookingId]);
    const prv6 = await query(`SELECT id FROM provider_reservations WHERE booking_id = $1`, [hold6.bookingId]);
    runAssert(bRes6held.rows[0].status === 'HELD' && prv6.rowCount === 0, 'Booking is not confirmed despite provider cancel failure');

    // The stale claim times out and the hold then expires normally.
    await query(
      `UPDATE bookings SET confirm_started_at = CURRENT_TIMESTAMP - interval '1 hour' WHERE id = $1`,
      [hold6.bookingId]
    );
    await query(`UPDATE holds SET expires_at = CURRENT_TIMESTAMP - interval '1 hour' WHERE id = $1`, [hold6.holdId]);
    const resExpire6 = await expireHold(hold6.holdId);
    runAssert(resExpire6 === true, 'Hold with an abandoned confirmation claim expires');

    // Verify booking is EXPIRED
    const bRes6 = await query<{ status: string }>(`SELECT status FROM bookings WHERE id = $1`, [hold6.bookingId]);
    runAssert(bRes6.rows[0].status === 'EXPIRED', 'Booking ends EXPIRED after provider cancel failure');

    // Verify final inventory state (started with 3)
    // hold1 (CONFIRMED) -> 1
    // hold2 (CONFIRMED) -> 1
    // hold3 (EXPIRED) -> 0
    // hold4 (EXPIRED) -> 0
    // hold5 (CONFIRMED) -> 1
    // hold6 (EXPIRED) -> 0
    // Total Confirmed = 3. Available = totalQty - 3. Held = 0.
    const invResFinal = await query<{ available_quantity: number, held_quantity: number, confirmed_quantity: number, total_quantity: number }>(
      `SELECT available_quantity, held_quantity, confirmed_quantity, total_quantity FROM inventory WHERE id = $1`, [inventoryId]
    );
    runAssert(invResFinal.rows[0].available_quantity === totalQty - 3, `Final Inventory available_quantity is ${totalQty - 3}`);
    runAssert(invResFinal.rows[0].held_quantity === 0, 'Final Inventory held_quantity is 0');
    runAssert(invResFinal.rows[0].confirmed_quantity === 3, 'Final Inventory confirmed_quantity is 3');
    runAssert(invResFinal.rows[0].available_quantity + invResFinal.rows[0].held_quantity + invResFinal.rows[0].confirmed_quantity === invResFinal.rows[0].total_quantity, 'Final Inventory invariant preserved');

    console.log('================================================================');
    console.log(`Results: ${passed} passed, ${failed} failed.`);
    console.log('================================================================');

    process.exit(failed > 0 ? 1 : 0);
  } catch (err: any) {
    console.error('Fatal Error:', err);
    process.exit(1);
  }
}

runTests();

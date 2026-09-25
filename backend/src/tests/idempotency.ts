import { buildApp } from '../server.js';
import { initDb, applySchemaAndSeed, query } from '../db/client.js';
import { initRedis as initRedisClient } from '../redis/client.js';
import { startHoldSweeper } from '../redis/holdManager.js';
import crypto from 'crypto';

async function runIdempotencyTests() {
  console.log('================================================================');
  console.log('  BOOKGUARD SPRINT 2: DURABLE IDEMPOTENCY TESTS');
  console.log('================================================================');

  await initDb();
  await initRedisClient();
  startHoldSweeper();
  await applySchemaAndSeed(true);

  const app = await buildApp();
  await app.ready();

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

  // Test 1: Missing Idempotency Key -> processed without replay protection (key is optional).
  // Release the hold afterwards so the remaining tests start from full inventory.
  const res1 = await app.inject({
    method: 'POST',
    url: '/api/bookings/hold',
    payload: { inventoryId, quantity: 1 }
  });

  assert(
    res1.statusCode === 201 &&
    res1.headers['x-cache-idempotent'] === undefined,
    'Missing idempotency key creates a hold without replay'
  );

  const release1 = await app.inject({
    method: 'POST',
    url: `/api/bookings/${res1.json().hold?.bookingId}/release`,
    payload: {}
  });

  assert(release1.statusCode === 200, 'Key-less hold released back to inventory');

  // Test 2: Same key + Same Request -> Cached response
  const idempKey1 = crypto.randomUUID();

  const res2 = await app.inject({
    method: 'POST',
    url: '/api/bookings/hold',
    headers: { 'Idempotency-Key': idempKey1 },
    payload: { inventoryId, quantity: 1 }
  });

  assert(
    res2.statusCode === 201,
    'Initial hold succeeds'
  );

  const holdId1 = res2.json().hold.holdId;

  const res3 = await app.inject({
    method: 'POST',
    url: '/api/bookings/hold',
    headers: { 'Idempotency-Key': idempKey1 },
    payload: { inventoryId, quantity: 1 }
  });

  assert(
    res3.statusCode === 201 &&
    res3.json().hold.holdId === holdId1 &&
    res3.headers['x-cache-idempotent'] === 'HIT',
    'Same key + same request returns cached response'
  );

  // Test 3: Same key + Different Request -> 422
  const res4 = await app.inject({
    method: 'POST',
    url: '/api/bookings/hold',
    headers: { 'Idempotency-Key': idempKey1 },
    payload: { inventoryId, quantity: 2 }
  });

  assert(
    res4.statusCode === 422 &&
    res4.json().error === 'IDEMPOTENCY_KEY_REUSED',
    'Same key + different request returns 422'
  );

  // Test 4: Concurrent Same-Key Requests
  const idempKey2 = crypto.randomUUID();

  const concurrentRes = await Promise.all([
    app.inject({
      method: 'POST',
      url: '/api/bookings/hold',
      headers: { 'Idempotency-Key': idempKey2 },
      payload: { inventoryId, quantity: 1 }
    }),
    app.inject({
      method: 'POST',
      url: '/api/bookings/hold',
      headers: { 'Idempotency-Key': idempKey2 },
      payload: { inventoryId, quantity: 1 }
    }),
    app.inject({
      method: 'POST',
      url: '/api/bookings/hold',
      headers: { 'Idempotency-Key': idempKey2 },
      payload: { inventoryId, quantity: 1 }
    })
  ]);

  const successCodes = concurrentRes.map(r => r.statusCode);
  const cacheHits = concurrentRes.map(
    r => r.headers['x-cache-idempotent']
  );

  const sameBody =
    new Set(
      concurrentRes.map(r => r.json().hold?.holdId)
    ).size === 1;

  assert(
    successCodes.every(c => c === 201) &&
    cacheHits.filter(h => h === 'HIT').length === 2 &&
    sameBody,
    'Concurrent same-key requests are serialized and return the exact same hold ID'
  );

  // Test 5: Concurrent Different-Key Requests
  const idempKey3 = crypto.randomUUID();
  const idempKey4 = crypto.randomUUID();

  const concurrentDiffRes = await Promise.all([
    app.inject({
      method: 'POST',
      url: '/api/bookings/hold',
      headers: { 'Idempotency-Key': idempKey3 },
      payload: { inventoryId, quantity: 1 }
    }),
    app.inject({
      method: 'POST',
      url: '/api/bookings/hold',
      headers: { 'Idempotency-Key': idempKey4 },
      payload: { inventoryId, quantity: 1 }
    })
  ]);

  const diffSuccessCodes = concurrentDiffRes.map(r => r.statusCode);

  const diffHoldIds = new Set(
    concurrentDiffRes.map(r => r.json().hold?.holdId)
  );

  assert(
    diffSuccessCodes.every(c => c === 201) &&
    diffHoldIds.size === 2,
    'Concurrent different-key requests succeed with distinct holds'
  );

  // Test 6: Insufficient Inventory with Idempotency.
  // All 4 seats are held by now, so a single-seat request cannot be satisfied.
  const idempKey6 = crypto.randomUUID();

  const resOversell1 = await app.inject({
    method: 'POST',
    url: '/api/bookings/hold',
    headers: { 'Idempotency-Key': idempKey6 },
    payload: {
      inventoryId,
      quantity: 1
    }
  });

  assert(
    resOversell1.statusCode === 409 &&
    resOversell1.json().error === 'INSUFFICIENT_INVENTORY',
    'Insufficient inventory returns 409'
  );

  const resOversell2 = await app.inject({
    method: 'POST',
    url: '/api/bookings/hold',
    headers: { 'Idempotency-Key': idempKey6 },
    payload: {
      inventoryId,
      quantity: 1
    }
  });

  // A failed hold allocated nothing, so its key is released rather than cached:
  // a retry is re-evaluated against live inventory (and still rejected here).
  const cachedFailure = await query(`SELECT 1 FROM idempotency_keys WHERE key = $1`, [idempKey6]);

  assert(
    resOversell2.statusCode === 409 &&
    resOversell2.headers['x-cache-idempotent'] === undefined &&
    resOversell2.json().error === 'INSUFFICIENT_INVENTORY' &&
    cachedFailure.rowCount === 0,
    'Insufficient inventory retry is re-evaluated, not replayed from cache'
  );

  // Test 7: Inventory Invariant After All Cases
  const finalRes = await query<{
    available_quantity: number;
    held_quantity: number;
    confirmed_quantity: number;
    total_quantity: number;
  }>(
    `
      SELECT
        available_quantity,
        held_quantity,
        confirmed_quantity,
        total_quantity
      FROM inventory
      WHERE id = $1
    `,
    [inventoryId]
  );

  const row = finalRes.rows[0];

  const invariantCheck =
    row.available_quantity +
    row.held_quantity +
    row.confirmed_quantity ===
    row.total_quantity;

  assert(
    invariantCheck,
    `Inventory invariant preserved: ${row.available_quantity} + ${row.held_quantity} + ${row.confirmed_quantity} = ${row.total_quantity}`
  );

  console.log('================================================================');
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log('================================================================');

  await app.close();

  if (failed > 0) {
    process.exit(1);
  }

  process.exit(0);
}

runIdempotencyTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
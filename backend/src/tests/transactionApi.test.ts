/**
 * BookGuard Phase 5 API Integration, Idempotency, Payment Compensation & Recovery Tests.
 *
 * Runs against isolated embedded PostgreSQL with genuine ACID and row-locking constraints.
 * Exercises all 14 required API-level test cases including payment lifecycle,
 * database-backed idempotency replay/conflict detection, and safe cancellation.
 */
import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { initDb, query } from '../db/client.js';
import { buildApp } from '../server.js';

let app: FastifyInstance;

before(async () => {
  // Isolate in-process PGlite WASM engine
  config.databaseUrl = '';
  await initDb();

  // Create isolated dataset rows for API tests
  await query(`CREATE TABLE dataset_customers (customer_id VARCHAR(32) PRIMARY KEY)`);
  await query(`INSERT INTO dataset_customers VALUES ('api-customer')`);

  await query(`CREATE TABLE dataset_flights (flight_id VARCHAR(32) PRIMARY KEY, available_seats INT, price NUMERIC(12,2), currency VARCHAR(8), airline VARCHAR(128))`);
  await query(`INSERT INTO dataset_flights VALUES ('flight-api', 5, 100, 'INR', 'Air Test')`);
  await query(`INSERT INTO dataset_flights VALUES ('flight-api-single', 1, 100, 'INR', 'Air Single')`);

  await query(`CREATE TABLE dataset_hotels (hotel_id VARCHAR(32) PRIMARY KEY, name VARCHAR(255))`);
  await query(`CREATE TABLE dataset_room_inventory (room_inventory_id VARCHAR(32) PRIMARY KEY, hotel_id VARCHAR(32), available_rooms INT, price_per_night NUMERIC(12,2), currency VARCHAR(8))`);
  await query(`INSERT INTO dataset_hotels VALUES ('hotel-api', 'Grand Test Hotel')`);
  await query(`INSERT INTO dataset_room_inventory VALUES ('room-api', 'hotel-api', 5, 200, 'INR')`);

  await query(`CREATE TABLE dataset_vehicles (vehicle_id VARCHAR(32) PRIMARY KEY, provider VARCHAR(128), currency VARCHAR(8))`);
  await query(`CREATE TABLE dataset_transport_inventory (transport_inventory_id VARCHAR(32) PRIMARY KEY, vehicle_id VARCHAR(32), available_units INT, price NUMERIC(12,2))`);
  await query(`INSERT INTO dataset_vehicles VALUES ('vehicle-api', 'Goa Transit', 'INR')`);
  await query(`INSERT INTO dataset_transport_inventory VALUES ('transport-api', 'vehicle-api', 5, 300)`);

  await query(`CREATE TABLE dataset_activities (activity_id VARCHAR(32) PRIMARY KEY, provider VARCHAR(128), currency VARCHAR(8))`);
  await query(`CREATE TABLE dataset_activity_inventory (activity_inventory_id VARCHAR(32) PRIMARY KEY, activity_id VARCHAR(32), available_slots INT, price_per_person NUMERIC(12,2))`);
  await query(`INSERT INTO dataset_activities VALUES ('activity-api', 'Scuba Test', 'INR')`);
  await query(`INSERT INTO dataset_activity_inventory VALUES ('slot-api', 'activity-api', 5, 50)`);

  app = await buildApp();
});

beforeEach(async () => {
  await query('DELETE FROM booking_transactions');
  await query('DELETE FROM idempotency_keys');
});

after(async () => {
  await app?.close();
});

async function api(
  method: 'GET' | 'POST',
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {}
) {
  const res = await app.inject({
    method,
    url,
    payload: payload as any,
    headers
  });
  return {
    status: res.statusCode,
    body: res.json() as any,
    headers: res.headers
  };
}

describe('Phase 5 API Integration & Validation Tests (1 - 14)', () => {
  // 1. successful booking
  test('1. successful booking creates transaction, charges payment, and confirms all items', async () => {
    const res = await api(
      'POST',
      '/api/transactions',
      {
        customerId: 'api-customer',
        items: [
          { type: 'hotel', resourceId: 'room-api', quantity: 1 },
          { type: 'flight', resourceId: 'flight-api', quantity: 1 }
        ],
        paymentMethod: 'card_visa'
      },
      { 'Idempotency-Key': 'key-success-1' }
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.state, 'COMPLETED');
    assert.ok(res.body.transactionId);
    assert.equal(res.body.items.length, 2);
    assert.ok(res.body.items.every((i: any) => i.status === 'COMPLETED'));
    assert.equal(res.body.payment.status, 'CAPTURED');
    assert.equal(res.body.recoveryRequired.length, 0);
  });

  // 2. duplicate identical idempotency request
  test('2. duplicate identical idempotency request returns exact cached result without re-executing', async () => {
    const payload = {
      customerId: 'api-customer',
      items: [{ type: 'hotel', resourceId: 'room-api', quantity: 1 }]
    };
    const first = await api('POST', '/api/transactions', payload, { 'Idempotency-Key': 'key-idempotent-2' });
    assert.equal(first.status, 201);

    const second = await api('POST', '/api/transactions', payload, { 'Idempotency-Key': 'key-idempotent-2' });
    assert.equal(second.status, 201);
    assert.equal(second.body.transactionId, first.body.transactionId);
    assert.equal(second.body.state, 'COMPLETED');
  });

  // 3. conflicting idempotency request
  test('3. conflicting idempotency request with modified payload is rejected with 422', async () => {
    const initial = await api(
      'POST',
      '/api/transactions',
      { customerId: 'api-customer', items: [{ type: 'hotel', resourceId: 'room-api', quantity: 1 }] },
      { 'Idempotency-Key': 'key-conflict-3' }
    );
    assert.equal(initial.status, 201);

    const conflict = await api(
      'POST',
      '/api/transactions',
      { customerId: 'api-customer', items: [{ type: 'flight', resourceId: 'flight-api', quantity: 2 }] },
      { 'Idempotency-Key': 'key-conflict-3' }
    );
    assert.equal(conflict.status, 422);
    assert.equal(conflict.body.error, 'IDEMPOTENCY_KEY_REUSED');
  });

  // 4. missing idempotency key
  test('4. missing idempotency key header returns structured 400 error', async () => {
    const res = await api('POST', '/api/transactions', {
      customerId: 'api-customer',
      items: [{ type: 'hotel', resourceId: 'room-api', quantity: 1 }]
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'MISSING_IDEMPOTENCY_KEY');
    assert.match(res.body.message, /Idempotency-Key header is required/);
  });

  // 5. provider failure -> rollback
  test('5. provider failure triggers reverse compensation and returns ROLLED_BACK', async () => {
    const res = await api(
      'POST',
      '/api/transactions',
      {
        customerId: 'api-customer',
        items: [
          { type: 'hotel', resourceId: 'room-api', quantity: 1 },
          { type: 'flight', resourceId: 'flight-api', quantity: 1 }
        ],
        failureSimulation: { reserve: { flight: 'flight connection failure' } }
      },
      { 'Idempotency-Key': 'key-fail-5' }
    );

    assert.equal(res.status, 409);
    assert.equal(res.body.success, false);
    assert.equal(res.body.state, 'ROLLED_BACK');
    assert.equal(res.body.compensationResults.length, 1);
    assert.equal(res.body.compensationResults[0].status, 'CANCELLED');
    assert.equal(res.body.recoveryRequired.length, 0);
  });

  // 6. payment failure
  test('6. payment authorization failure halts booking and releases locks', async () => {
    const res = await api(
      'POST',
      '/api/transactions',
      {
        customerId: 'api-customer',
        items: [{ type: 'hotel', resourceId: 'room-api', quantity: 1 }],
        paymentFailureSimulation: { authorize: 'Insufficient funds' }
      },
      { 'Idempotency-Key': 'key-payfail-6' }
    );

    assert.equal(res.status, 409);
    assert.equal(res.body.state, 'ROLLED_BACK');
    assert.equal(res.body.payment.status, 'FAILED');
    assert.match(res.body.failure.message, /Insufficient funds/);
  });

  // 7. payment refund after rollback
  test('7. payment refund after rollback voids/refunds payment when provider fails', async () => {
    const res = await api(
      'POST',
      '/api/transactions',
      {
        customerId: 'api-customer',
        items: [
          { type: 'hotel', resourceId: 'room-api', quantity: 1 },
          { type: 'flight', resourceId: 'flight-api', quantity: 1 }
        ],
        failureSimulation: { reserve: { flight: 'seats exhausted' } }
      },
      { 'Idempotency-Key': 'key-refund-7' }
    );

    assert.equal(res.status, 409);
    assert.equal(res.body.state, 'ROLLED_BACK');
    assert.ok(['VOIDED', 'REFUNDED'].includes(res.body.payment.status));
  });

  // 8. compensation failure -> ROLLBACK_FAILED
  test('8. compensation failure results in ROLLBACK_FAILED and preserves recoveryRequired', async () => {
    const res = await api(
      'POST',
      '/api/transactions',
      {
        customerId: 'api-customer',
        items: [
          { type: 'hotel', resourceId: 'room-api', quantity: 1 },
          { type: 'flight', resourceId: 'flight-api', quantity: 1 }
        ],
        failureSimulation: {
          reserve: { flight: 'flight failed' },
          cancel: { hotel: 'hotel cancellation endpoint 503' }
        }
      },
      { 'Idempotency-Key': 'key-compfail-8' }
    );

    assert.equal(res.status, 409);
    assert.equal(res.body.state, 'ROLLBACK_FAILED');
    assert.equal(res.body.recoveryRequired.length, 1);
    assert.equal(res.body.recoveryRequired[0].provider, 'Grand Test Hotel');
    assert.match(res.body.recoveryRequired[0].error, /hotel cancellation endpoint 503/);
  });

  // 9. GET transaction state
  test('9. GET transaction state returns complete details, items, providers, and events', async () => {
    const create = await api(
      'POST',
      '/api/transactions',
      { customerId: 'api-customer', items: [{ type: 'hotel', resourceId: 'room-api', quantity: 1 }] },
      { 'Idempotency-Key': 'key-get-9' }
    );
    const txId = create.body.transactionId;

    const res = await api('GET', `/api/transactions/${txId}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.transactionId, txId);
    assert.equal(res.body.state, 'COMPLETED');
    assert.equal(res.body.items.length, 1);
    assert.ok(res.body.providers.length > 0);
    assert.ok(res.body.events.length > 0);
  });

  // 10. cancel completed transaction
  test('10. cancel completed transaction safely compensates providers and refunds payment', async () => {
    const create = await api(
      'POST',
      '/api/transactions',
      { customerId: 'api-customer', items: [{ type: 'hotel', resourceId: 'room-api', quantity: 1 }] },
      { 'Idempotency-Key': 'key-cancel-10' }
    );
    const txId = create.body.transactionId;

    const cancel = await api('POST', `/api/transactions/${txId}/cancel`, {}, { 'Idempotency-Key': 'cancel-key-10' });
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.state, 'ROLLED_BACK');
    assert.equal(cancel.body.payment.status, 'REFUNDED');

    const verify = await api('GET', `/api/transactions/${txId}`);
    assert.equal(verify.body.state, 'ROLLED_BACK');
  });

  // 11. repeated cancellation
  test('11. repeated cancellation is idempotent and does not repeat compensation', async () => {
    const create = await api(
      'POST',
      '/api/transactions',
      { customerId: 'api-customer', items: [{ type: 'hotel', resourceId: 'room-api', quantity: 1 }] },
      { 'Idempotency-Key': 'key-cancel-11' }
    );
    const txId = create.body.transactionId;

    const firstCancel = await api('POST', `/api/transactions/${txId}/cancel`);
    assert.equal(firstCancel.status, 200);
    assert.equal(firstCancel.body.state, 'ROLLED_BACK');

    const secondCancel = await api('POST', `/api/transactions/${txId}/cancel`);
    assert.equal(secondCancel.status, 200);
    assert.equal(secondCancel.body.alreadyCancelled, true);
    assert.equal(secondCancel.body.state, 'ROLLED_BACK');
  });

  // 12. no duplicate provider operations
  test('12. no duplicate provider operations on idempotent request replays', async () => {
    const payload = {
      customerId: 'api-customer',
      items: [{ type: 'hotel', resourceId: 'room-api', quantity: 1 }]
    };
    const first = await api('POST', '/api/transactions', payload, { 'Idempotency-Key': 'key-no-dup-12' });
    assert.equal(first.status, 201);

    const initialProviderCount = (await query('SELECT count(*) FROM booking_transaction_providers WHERE transaction_id=$1', [first.body.transactionId])).rows[0].count;

    // Replay
    const second = await api('POST', '/api/transactions', payload, { 'Idempotency-Key': 'key-no-dup-12' });
    assert.equal(second.status, 201);

    const finalProviderCount = (await query('SELECT count(*) FROM booking_transaction_providers WHERE transaction_id=$1', [first.body.transactionId])).rows[0].count;
    assert.equal(finalProviderCount, initialProviderCount, 'Provider records must not be duplicated');
  });

  // 13. no leaked locks
  test('13. no leaked locks: capacity is immediately reusable after rollback', async () => {
    // 'flight-api-single' has capacity = 1
    const first = await api(
      'POST',
      '/api/transactions',
      {
        customerId: 'api-customer',
        items: [
          { type: 'flight', resourceId: 'flight-api-single', quantity: 1 },
          { type: 'transport', resourceId: 'transport-api', quantity: 1 }
        ],
        failureSimulation: { reserve: { transport: 'transport failure' } }
      },
      { 'Idempotency-Key': 'key-lock-13a' }
    );
    assert.equal(first.status, 409);
    assert.equal(first.body.state, 'ROLLED_BACK');

    // Immediately re-book the SAME flight-api-single seat
    const second = await api(
      'POST',
      '/api/transactions',
      {
        customerId: 'api-customer',
        items: [{ type: 'flight', resourceId: 'flight-api-single', quantity: 1 }]
      },
      { 'Idempotency-Key': 'key-lock-13b' }
    );
    assert.equal(second.status, 201);
    assert.equal(second.body.state, 'COMPLETED');
  });

  // 14. transaction events remain auditable
  test('14. transaction events remain auditable across forward, payment, and compensation phases', async () => {
    const res = await api(
      'POST',
      '/api/transactions',
      {
        customerId: 'api-customer',
        items: [
          { type: 'hotel', resourceId: 'room-api', quantity: 1 },
          { type: 'flight', resourceId: 'flight-api', quantity: 1 }
        ],
        failureSimulation: { reserve: { flight: 'flight failure' } }
      },
      { 'Idempotency-Key': 'key-audit-14' }
    );
    const txId = res.body.transactionId;

    const eventsRes = await query<{ to_state: string; detail: any }>(
      'SELECT to_state, detail FROM booking_transaction_events WHERE transaction_id=$1 ORDER BY id ASC',
      [txId]
    );

    const toStates = eventsRes.rows.map(r => r.to_state);
    const detailEvents = eventsRes.rows.map(r => r.detail?.event).filter(Boolean);

    assert.ok(toStates.includes('PENDING'));
    assert.ok(toStates.includes('LOCK_ACQUIRED'));
    assert.ok(toStates.includes('RESERVING'));
    assert.ok(detailEvents.includes('PAYMENT_AUTHORIZED'));
    assert.ok(detailEvents.includes('PROVIDER_RESERVED'));
    assert.ok(detailEvents.includes('PROVIDER_RESERVE_FAILED'));
    assert.ok(detailEvents.includes('SAGA_ROLLBACK_STARTED'));
    assert.ok(detailEvents.includes('COMPENSATION_STARTED'));
    assert.ok(detailEvents.includes('COMPENSATION_SUCCEEDED'));
    assert.ok(detailEvents.includes('PAYMENT_REFUNDED'));
    assert.ok(toStates.includes('ROLLED_BACK'));
  });

  // Additional API validation checks
  test('validates malformed bodies and duplicate items', async () => {
    // Malformed body (items not an array)
    const malformed = await api(
      'POST',
      '/api/transactions',
      { customerId: 'api-customer', items: 'invalid-items-type' },
      { 'Idempotency-Key': 'bad-1' }
    );
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.error, 'MALFORMED_REQUEST');

    // Empty items
    const emptyItems = await api('POST', '/api/transactions', { customerId: 'api-customer', items: [] }, { 'Idempotency-Key': 'bad-2' });
    assert.equal(emptyItems.status, 400);
    assert.equal(emptyItems.body.error, 'EMPTY_ITEMS_LIST');

    // Duplicate item
    const duplicate = await api(
      'POST',
      '/api/transactions',
      {
        customerId: 'api-customer',
        items: [
          { type: 'hotel', resourceId: 'room-api', quantity: 1 },
          { type: 'hotel', resourceId: 'room-api', quantity: 1 }
        ]
      },
      { 'Idempotency-Key': 'bad-3' }
    );
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.error, 'DUPLICATE_RESOURCE_ITEM');
  });
});

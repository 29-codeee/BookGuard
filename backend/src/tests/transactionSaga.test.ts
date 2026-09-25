/**
 * BookGuard Phase 4 Saga Orchestration and Automatic Compensation Tests.
 *
 * Runs against isolated embedded PostgreSQL with real ACID & row-locking constraints.
 * Exercises multi-provider coordination across hotel, flight, transport, and activity,
 * including deterministic failure simulations A-E and required test cases 1-11.
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.js';
import { initDb, query } from '../db/client.js';
import {
  createMockProviderRegistry,
  FailureScenarios,
  type DatasetProviderAdapter,
  type InjectedFailures,
  type ProviderRegistry
} from '../providers/datasetAdapters.js';
import {
  compensateSagaItem,
  executeBookingSaga,
  type SagaOperation
} from '../transactions/saga.js';
import type { ResourceType } from '../transactions/types.js';

const TYPES: ResourceType[] = ['hotel', 'flight', 'transport', 'activity'];
const RESOURCE: Record<ResourceType, string> = {
  hotel: 'room-saga',
  flight: 'flight-saga',
  transport: 'transport-saga',
  activity: 'activity-saga'
};
const PRICE: Record<ResourceType, number> = {
  hotel: 200,
  flight: 100,
  transport: 300,
  activity: 50
};

function items(types: ResourceType[]) {
  return types.map(type => ({ type, resourceId: RESOURCE[type], quantity: 1 }));
}

async function tableRows<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  return (await query<T>(sql, params)).rows;
}

before(async () => {
  config.databaseUrl = '';
  await initDb();
  await query(`CREATE TABLE dataset_customers (customer_id VARCHAR(32) PRIMARY KEY)`);
  await query(`INSERT INTO dataset_customers VALUES ('saga-customer')`);

  await query(`CREATE TABLE dataset_flights (flight_id VARCHAR(32) PRIMARY KEY, available_seats INT, price NUMERIC(12,2), currency VARCHAR(8), airline VARCHAR(128))`);
  await query(`INSERT INTO dataset_flights VALUES ('flight-saga', 3, 100, 'INR', 'Flight provider')`);
  await query(`INSERT INTO dataset_flights VALUES ('flight-single', 1, 100, 'INR', 'Flight provider')`);

  await query(`CREATE TABLE dataset_hotels (hotel_id VARCHAR(32) PRIMARY KEY, name VARCHAR(255))`);
  await query(`CREATE TABLE dataset_room_inventory (room_inventory_id VARCHAR(32) PRIMARY KEY, hotel_id VARCHAR(32), available_rooms INT, price_per_night NUMERIC(12,2), currency VARCHAR(8))`);
  await query(`INSERT INTO dataset_hotels VALUES ('hotel-saga', 'Hotel provider')`);
  await query(`INSERT INTO dataset_room_inventory VALUES ('room-saga', 'hotel-saga', 3, 200, 'INR')`);

  await query(`CREATE TABLE dataset_vehicles (vehicle_id VARCHAR(32) PRIMARY KEY, provider VARCHAR(128), currency VARCHAR(8))`);
  await query(`CREATE TABLE dataset_transport_inventory (transport_inventory_id VARCHAR(32) PRIMARY KEY, vehicle_id VARCHAR(32), available_units INT, price NUMERIC(12,2))`);
  await query(`INSERT INTO dataset_vehicles VALUES ('vehicle-saga', 'Transport provider', 'INR')`);
  await query(`INSERT INTO dataset_transport_inventory VALUES ('transport-saga', 'vehicle-saga', 3, 300)`);

  await query(`CREATE TABLE dataset_activities (activity_id VARCHAR(32) PRIMARY KEY, provider VARCHAR(128), currency VARCHAR(8))`);
  await query(`CREATE TABLE dataset_activity_inventory (activity_inventory_id VARCHAR(32) PRIMARY KEY, activity_id VARCHAR(32), available_slots INT, price_per_person NUMERIC(12,2))`);
  await query(`INSERT INTO dataset_activities VALUES ('activity-saga', 'Activity provider', 'INR')`);
  await query(`INSERT INTO dataset_activity_inventory VALUES ('activity-saga', 'activity-saga', 3, 50)`);
});

beforeEach(async () => {
  await query('DELETE FROM booking_transactions');
});

// ============================================================================
// FAILURE SIMULATION SCENARIOS (A - E)
// ============================================================================
describe('Deterministic Failure Simulation Scenarios (A - E)', () => {
  test('Scenario A: Hotel succeeds, flight succeeds, transport fails', async () => {
    const calls: string[] = [];
    const providers = FailureScenarios.scenarioA(calls);
    const result = await executeBookingSaga(
      { customerId: 'saga-customer', items: items(['hotel', 'flight', 'transport']) },
      { providers }
    );

    assert.equal(result.state, 'ROLLED_BACK');
    assert.deepEqual(calls, [
      'reserve:hotel',
      'reserve:flight',
      'reserve:transport',
      'cancel:flight',
      'cancel:hotel'
    ]);
    assert.equal(result.compensationResults.length, 2);
    assert.ok(result.compensationResults.every(r => r.status === 'CANCELLED'));
    assert.equal(result.recoveryRequired.length, 0);

    const locks = await tableRows<{ status: string }>(
      'SELECT status FROM booking_resource_locks WHERE transaction_id=$1',
      [result.transactionId]
    );
    assert.ok(locks.every(l => l.status === 'RELEASED'));
  });

  test('Scenario B: Hotel succeeds, flight fails immediately', async () => {
    const calls: string[] = [];
    const providers = FailureScenarios.scenarioB(calls);
    const result = await executeBookingSaga(
      { customerId: 'saga-customer', items: items(['hotel', 'flight']) },
      { providers }
    );

    assert.equal(result.state, 'ROLLED_BACK');
    assert.deepEqual(calls, ['reserve:hotel', 'reserve:flight', 'cancel:hotel']);
    assert.equal(result.compensationResults.length, 1);
    assert.equal(result.compensationResults[0].status, 'CANCELLED');
    assert.equal(result.compensationResults[0].provider, 'Hotel provider');
    assert.equal(result.recoveryRequired.length, 0);

    const locks = await tableRows<{ status: string }>(
      'SELECT status FROM booking_resource_locks WHERE transaction_id=$1',
      [result.transactionId]
    );
    assert.ok(locks.every(l => l.status === 'RELEASED'));
  });

  test('Scenario C: All providers succeed', async () => {
    const calls: string[] = [];
    const providers = FailureScenarios.scenarioC(calls);
    const result = await executeBookingSaga(
      { customerId: 'saga-customer', items: items(TYPES) },
      { providers }
    );

    assert.equal(result.state, 'COMPLETED');
    assert.equal(result.items.length, 4);
    assert.ok(result.items.every(i => i.status === 'COMPLETED'));
    assert.deepEqual(calls, [
      'reserve:hotel',
      'reserve:flight',
      'reserve:transport',
      'reserve:activity',
      'confirm:hotel',
      'confirm:flight',
      'confirm:transport',
      'confirm:activity'
    ]);
    assert.equal(result.compensationResults.length, 0);
    assert.equal(result.recoveryRequired.length, 0);

    const locks = await tableRows<{ status: string }>(
      'SELECT status FROM booking_resource_locks WHERE transaction_id=$1',
      [result.transactionId]
    );
    assert.ok(locks.every(l => l.status === 'CONFIRMED'));
  });

  test('Scenario D: Forward operation fails and compensation succeeds', async () => {
    const calls: string[] = [];
    const providers = FailureScenarios.scenarioD(calls);
    const result = await executeBookingSaga(
      { customerId: 'saga-customer', items: items(['hotel', 'flight', 'transport']) },
      { providers }
    );

    assert.equal(result.state, 'ROLLED_BACK');
    assert.ok(result.failure);
    assert.equal(result.failure?.phase, 'PROVIDER_RESERVE');
    assert.match(result.failure?.message ?? '', /injected transport reserve failure/);
    assert.equal(result.compensationResults.length, 2);
    assert.ok(result.compensationResults.every(c => c.status === 'CANCELLED'));
    assert.equal(result.recoveryRequired.length, 0);
  });

  test('Scenario E: Forward operation fails and one compensation fails', async () => {
    const calls: string[] = [];
    const providers = FailureScenarios.scenarioE(calls);
    const result = await executeBookingSaga(
      { customerId: 'saga-customer', items: items(['hotel', 'flight', 'transport']) },
      { providers }
    );

    assert.equal(result.state, 'ROLLBACK_FAILED');
    assert.deepEqual(calls, [
      'reserve:hotel',
      'reserve:flight',
      'reserve:transport',
      'cancel:flight',
      'cancel:hotel'
    ]);
    assert.equal(result.recoveryRequired.length, 1);
    assert.equal(result.recoveryRequired[0].provider, 'Flight provider');
    assert.match(result.recoveryRequired[0].error ?? '', /injected flight cancellation failure/);

    const locks = await tableRows<{ resource_id: string; status: string }>(
      'SELECT resource_id, status FROM booking_resource_locks WHERE transaction_id=$1 ORDER BY resource_id',
      [result.transactionId]
    );
    assert.equal(locks.find(l => l.resource_id === 'flight-saga')?.status, 'CONFIRMED');
    assert.equal(locks.find(l => l.resource_id === 'room-saga')?.status, 'RELEASED');
    assert.equal(locks.find(l => l.resource_id === 'transport-saga')?.status, 'RELEASED');
  });
});

// ============================================================================
// REQUIRED TESTS (1 - 11)
// ============================================================================
describe('Phase 4 Required Tests (1 - 11)', () => {
  // 1. All-provider success
  test('1. All-provider success confirms every item, provider, and persistent lock', async () => {
    const calls: string[] = [];
    const result = await executeBookingSaga(
      { customerId: 'saga-customer', items: items(TYPES) },
      { providers: createMockProviderRegistry({ calls }) }
    );

    assert.equal(result.state, 'COMPLETED');
    assert.equal(result.items.length, 4);
    assert.ok(result.items.every(item => item.status === 'COMPLETED'));
    assert.equal(result.providerOperationResults.filter(r => r.operation === 'RESERVE' && r.status === 'RESERVED').length, 4);
    assert.equal(result.providerOperationResults.filter(r => r.operation === 'CONFIRM' && r.status === 'CONFIRMED').length, 4);

    const providers = await tableRows<{ status: string }>(
      'SELECT status FROM booking_transaction_providers WHERE transaction_id=$1',
      [result.transactionId]
    );
    assert.equal(providers.length, 4);
    assert.ok(providers.every(row => row.status === 'CONFIRMED'));

    const locks = await tableRows<{ status: string }>(
      'SELECT status FROM booking_resource_locks WHERE transaction_id=$1',
      [result.transactionId]
    );
    assert.equal(locks.length, 4);
    assert.ok(locks.every(row => row.status === 'CONFIRMED'));
  });

  // 2. Failure on the first provider
  test('2. Failure on the first provider stops forward work and releases all locks', async () => {
    const calls: string[] = [];
    const providers = createMockProviderRegistry({
      calls,
      failures: { reserve: { hotel: 'hotel failure' } }
    });
    const result = await executeBookingSaga(
      { customerId: 'saga-customer', items: items(['hotel', 'flight']) },
      { providers }
    );

    assert.equal(result.state, 'ROLLED_BACK');
    assert.deepEqual(calls, ['reserve:hotel']);
    assert.equal(result.compensationResults.length, 0);

    const locks = await tableRows<{ status: string }>(
      'SELECT status FROM booking_resource_locks WHERE transaction_id=$1',
      [result.transactionId]
    );
    assert.equal(locks.length, 2);
    assert.ok(locks.every(row => row.status === 'RELEASED'));

    const provRows = await tableRows<{ resource_type: string; status: string; operation_type: string }>(
      `SELECT i.resource_type, p.status, p.operation_type FROM booking_transaction_providers p
       JOIN booking_transaction_items i ON i.id = p.item_id WHERE p.transaction_id=$1`,
      [result.transactionId]
    );
    const hotelProv = provRows.find(p => p.resource_type === 'hotel');
    assert.equal(hotelProv?.status, 'FAILED');
    assert.equal(hotelProv?.operation_type, 'RESERVE');
  });

  // 3. Failure after two successful providers
  test('3. Failure after two successful providers halts forward execution and initiates rollback', async () => {
    const calls: string[] = [];
    const providers = createMockProviderRegistry({
      calls,
      failures: { reserve: { transport: 'transport failure' } }
    });
    const result = await executeBookingSaga(
      { customerId: 'saga-customer', items: items(['hotel', 'flight', 'transport']) },
      { providers }
    );

    assert.equal(result.state, 'ROLLED_BACK');
    assert.ok(calls.includes('reserve:hotel'));
    assert.ok(calls.includes('reserve:flight'));
    assert.ok(calls.includes('reserve:transport'));
    assert.ok(!calls.includes('confirm:hotel'));
    assert.ok(!calls.includes('confirm:flight'));
    assert.equal(result.compensationResults.length, 2);
  });

  // 4. Reverse-order compensation
  test('4. Reverse-order compensation cancels previously reserved providers in strict LIFO order', async () => {
    const calls: string[] = [];
    const providers = createMockProviderRegistry({
      calls,
      failures: { reserve: { transport: 'transport exploded' } }
    });
    const result = await executeBookingSaga(
      { customerId: 'saga-customer', items: items(['hotel', 'flight', 'transport']) },
      { providers }
    );

    assert.equal(result.state, 'ROLLED_BACK');
    assert.deepEqual(calls, [
      'reserve:hotel',
      'reserve:flight',
      'reserve:transport',
      'cancel:flight',
      'cancel:hotel'
    ]);
    assert.equal(result.compensationResults[0].provider, 'Flight provider');
    assert.equal(result.compensationResults[1].provider, 'Hotel provider');
  });

  // 5. Successful compensation resulting in ROLLED_BACK
  test('5. Successful compensation resulting in ROLLED_BACK with all items released', async () => {
    const calls: string[] = [];
    const providers = createMockProviderRegistry({
      calls,
      failures: { reserve: { flight: 'flight unavailable' } }
    });
    const result = await executeBookingSaga(
      { customerId: 'saga-customer', items: items(['hotel', 'flight', 'transport']) },
      { providers }
    );

    assert.equal(result.state, 'ROLLED_BACK');
    assert.equal(result.compensationResults.length, 1);
    assert.equal(result.compensationResults[0].status, 'CANCELLED');
    assert.equal(result.recoveryRequired.length, 0);

    const tx = await tableRows<{ status: string }>('SELECT status FROM booking_transactions WHERE id=$1', [result.transactionId]);
    assert.equal(tx[0].status, 'ROLLED_BACK');

    const itemRows = await tableRows<{ resource_type: string; status: string }>(
      'SELECT resource_type, status FROM booking_transaction_items WHERE transaction_id=$1',
      [result.transactionId]
    );
    assert.equal(itemRows.find(i => i.resource_type === 'hotel')?.status, 'RELEASED');
    assert.equal(itemRows.find(i => i.resource_type === 'flight')?.status, 'FAILED');
    assert.equal(itemRows.find(i => i.resource_type === 'transport')?.status, 'RELEASED');
  });

  // 6. Failed compensation resulting in ROLLBACK_FAILED
  test('6. Failed compensation results in ROLLBACK_FAILED and identifies required recovery', async () => {
    const calls: string[] = [];
    const providers = createMockProviderRegistry({
      calls,
      failures: {
        reserve: { transport: 'transport failure' },
        cancel: { flight: 'flight cancel connection refused' }
      }
    });
    const result = await executeBookingSaga(
      { customerId: 'saga-customer', items: items(['hotel', 'flight', 'transport']) },
      { providers }
    );

    assert.equal(result.state, 'ROLLBACK_FAILED');
    assert.equal(result.recoveryRequired.length, 1);
    assert.equal(result.recoveryRequired[0].provider, 'Flight provider');
    assert.match(result.recoveryRequired[0].error ?? '', /flight cancel connection refused/);

    const flightItem = result.items.find(i => i.type === 'flight');
    assert.equal(result.recoveryRequired[0].itemId, flightItem?.id);

    const locks = await tableRows<{ resource_id: string; status: string }>(
      'SELECT resource_id, status FROM booking_resource_locks WHERE transaction_id=$1',
      [result.transactionId]
    );
    assert.equal(locks.find(l => l.resource_id === 'flight-saga')?.status, 'CONFIRMED');
    assert.equal(locks.find(l => l.resource_id === 'room-saga')?.status, 'RELEASED');

    const txEvents = await tableRows<{ to_state: string; detail: any }>(
      'SELECT to_state, detail FROM booking_transaction_events WHERE transaction_id=$1',
      [result.transactionId]
    );
    assert.ok(txEvents.some(e => e.detail.event === 'COMPENSATION_FAILED'));
    assert.ok(txEvents.some(e => e.to_state === 'ROLLBACK_FAILED'));
  });

  // 7. Resource locks released after rollback
  test('7. Resource locks released after rollback are all marked RELEASED in database', async () => {
    const calls: string[] = [];
    const providers = createMockProviderRegistry({
      calls,
      failures: { reserve: { activity: 'activity provider offline' } }
    });
    const result = await executeBookingSaga(
      { customerId: 'saga-customer', items: items(TYPES) },
      { providers }
    );

    assert.equal(result.state, 'ROLLED_BACK');
    const locks = await tableRows<{ resource_type: string; status: string }>(
      'SELECT resource_type, status FROM booking_resource_locks WHERE transaction_id=$1',
      [result.transactionId]
    );
    assert.equal(locks.length, 4);
    assert.ok(locks.every(l => l.status === 'RELEASED'), 'Every lock must be RELEASED');
  });

  // 8. Transaction events correctly record forward and compensation operations
  test('8. Transaction events correctly record forward and compensation operations', async () => {
    const calls: string[] = [];
    const providers = createMockProviderRegistry({
      calls,
      failures: { reserve: { transport: 'transport timed out' } }
    });
    const result = await executeBookingSaga(
      { customerId: 'saga-customer', items: items(['hotel', 'flight', 'transport']) },
      { providers }
    );

    assert.equal(result.state, 'ROLLED_BACK');
    const events = await tableRows<{ from_state: string; to_state: string; detail: any }>(
      'SELECT from_state, to_state, detail FROM booking_transaction_events WHERE transaction_id=$1 ORDER BY id ASC',
      [result.transactionId]
    );

    const eventNames = events.map(e => e.detail?.event).filter(Boolean);
    assert.ok(eventNames.includes('PROVIDER_RESERVED'));
    assert.ok(eventNames.includes('PROVIDER_RESERVE_FAILED'));
    assert.ok(eventNames.includes('SAGA_ROLLBACK_STARTED'));
    assert.ok(eventNames.includes('COMPENSATION_STARTED'));
    assert.ok(eventNames.includes('COMPENSATION_SUCCEEDED'));
    assert.ok(eventNames.includes('RESOURCE_LOCK_RELEASED'));
    assert.ok(eventNames.includes('SAGA_ROLLED_BACK'));

    for (const e of events) {
      assert.ok(e.to_state, 'Event must have to_state');
      assert.ok(typeof e.detail === 'object', 'Event detail must be JSON object');
    }
  });

  // 9. Provider operation states are persisted correctly
  test('9. Provider operation states are persisted correctly throughout lifecycle', async () => {
    const calls: string[] = [];
    const providers = createMockProviderRegistry({
      calls,
      failures: { reserve: { transport: 'transport failed' } }
    });
    const result = await executeBookingSaga(
      { customerId: 'saga-customer', items: items(['hotel', 'flight', 'transport']) },
      { providers }
    );

    const providerRows = await tableRows<{
      resource_type: string;
      status: string;
      operation_type: string;
      provider_name: string;
      provider_reference: string | null;
      error_message: string | null;
    }>(
      `SELECT i.resource_type, p.status, p.operation_type, p.provider_name, p.provider_reference, p.error_message
       FROM booking_transaction_providers p
       JOIN booking_transaction_items i ON i.id = p.item_id
       WHERE p.transaction_id=$1
       ORDER BY i.position ASC`,
      [result.transactionId]
    );

    assert.equal(providerRows.length, 3);
    // Hotel: reserved then cancelled
    assert.equal(providerRows[0].resource_type, 'hotel');
    assert.equal(providerRows[0].status, 'CANCELLED');
    assert.equal(providerRows[0].operation_type, 'CANCEL');
    assert.ok(providerRows[0].provider_reference);

    // Flight: reserved then cancelled
    assert.equal(providerRows[1].resource_type, 'flight');
    assert.equal(providerRows[1].status, 'CANCELLED');
    assert.equal(providerRows[1].operation_type, 'CANCEL');
    assert.ok(providerRows[1].provider_reference);

    // Transport: failed reserve
    assert.equal(providerRows[2].resource_type, 'transport');
    assert.equal(providerRows[2].status, 'FAILED');
    assert.equal(providerRows[2].operation_type, 'RESERVE');
    assert.match(providerRows[2].error_message ?? '', /transport failed/);
  });

  // 10. No leaked locks after successful rollback
  test('10. No leaked locks after successful rollback: capacity is immediately reclaimable', async () => {
    // 'flight-single' has exactly 1 available seat in seed.
    const calls: string[] = [];
    const providers = createMockProviderRegistry({
      calls,
      failures: { reserve: { transport: 'transport fails' } }
    });

    // First saga requests flight-single and transport. It reserves flight-single, then transport fails.
    const firstResult = await executeBookingSaga(
      {
        customerId: 'saga-customer',
        items: [
          { type: 'flight', resourceId: 'flight-single', quantity: 1 },
          { type: 'transport', resourceId: 'transport-saga', quantity: 1 }
        ]
      },
      { providers }
    );
    assert.equal(firstResult.state, 'ROLLED_BACK');

    // Verify first saga's lock is RELEASED
    const firstLocks = await tableRows<{ status: string }>(
      `SELECT status FROM booking_resource_locks WHERE transaction_id=$1 AND resource_id='flight-single'`,
      [firstResult.transactionId]
    );
    assert.equal(firstLocks[0].status, 'RELEASED');

    // Second saga immediately requests the SAME flight-single seat.
    // If there was a leaked lock, this would throw INSUFFICIENT_AVAILABILITY because total capacity is 1!
    const calls2: string[] = [];
    const secondResult = await executeBookingSaga(
      {
        customerId: 'saga-customer',
        items: [{ type: 'flight', resourceId: 'flight-single', quantity: 1 }]
      },
      { providers: createMockProviderRegistry({ calls: calls2 }) }
    );

    assert.equal(secondResult.state, 'COMPLETED');
    assert.equal(secondResult.items[0].status, 'COMPLETED');
    assert.deepEqual(calls2, ['reserve:flight', 'confirm:flight']);
  });

  // 11. No duplicate compensation for an already-compensated item
  test('11. No duplicate compensation for an already-compensated item', async () => {
    const calls: string[] = [];
    const providers = createMockProviderRegistry({
      calls,
      failures: { reserve: { flight: 'flight reserve failed' } }
    });
    const result = await executeBookingSaga(
      { customerId: 'saga-customer', items: items(['hotel', 'flight']) },
      { providers }
    );

    assert.equal(result.state, 'ROLLED_BACK');
    const hotelCancelCountBefore = calls.filter(c => c === 'cancel:hotel').length;
    assert.equal(hotelCancelCountBefore, 1);

    const hotelItem = result.items.find(i => i.type === 'hotel')!;
    const reference = result.compensationResults[0].reference!;
    const operation: SagaOperation = {
      item: { id: hotelItem.id, resourceId: hotelItem.resourceId, type: 'hotel', quantity: 1 },
      type: 'hotel',
      provider: 'Hotel provider',
      context: { provider: 'Hotel provider', unitPrice: PRICE.hotel, currency: 'INR' },
      adapter: providers.hotel,
      reference
    };

    const duplicate = await compensateSagaItem(result.transactionId, operation);
    assert.equal(duplicate.status, 'SKIPPED');
    assert.equal(duplicate.error, 'already_compensated');

    const hotelCancelCountAfter = calls.filter(c => c === 'cancel:hotel').length;
    assert.equal(hotelCancelCountAfter, hotelCancelCountBefore, 'Provider cancel must NOT be called again');
  });
});

// ============================================================================
// IDEMPOTENCY PREPARATION AND STRUCTURED RESULT VERIFICATION
// ============================================================================
describe('Saga Idempotency Preparation and Structured Service Contract', () => {
  test('executeBookingSaga returns structured result ready for idempotent API integration', async () => {
    const result = await executeBookingSaga(
      { customerId: 'saga-customer', items: items(['hotel', 'flight']) },
      { failureSimulation: { reserve: { flight: 'rate limit' } } }
    );

    assert.ok(result.transactionId, 'Must have transactionId');
    assert.equal(result.state, 'ROLLED_BACK', 'Must have final transaction state');
    assert.ok(Array.isArray(result.items), 'Must have items array');
    assert.ok(result.itemStates, 'Must have itemStates map');
    assert.ok(Array.isArray(result.providerOperationResults), 'Must have providerOperationResults');
    assert.ok(Array.isArray(result.compensationResults), 'Must have compensationResults');
    assert.ok(Array.isArray(result.recoveryRequired), 'Must have recoveryRequired');
    assert.ok(result.failure, 'Must have failure information');

    for (const item of result.items) {
      assert.equal(result.itemStates[item.id], item.status, 'itemStates lookup must match item.status');
    }
  });
});

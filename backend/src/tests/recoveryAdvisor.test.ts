import { strict as assert } from 'node:assert';
import { before, beforeEach, describe, it } from 'node:test';
import Fastify, { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { initDb, query } from '../db/client.js';
import {
  generateRecoveryAdvisory,
  persistRecoveryAdvisory,
  getRecoveryAdvisoryByTransactionId
} from '../ai/recoveryAdvisor.js';
import { executeBookingSaga } from '../transactions/saga.js';
import { createMockProviderRegistry } from '../providers/datasetAdapters.js';
import { MockPaymentService } from '../transactions/payment.js';
import transactionRoutes from '../routes/transactions.js';
import type { ResourceType } from '../transactions/types.js';

let app: FastifyInstance;

before(async () => {
  config.databaseUrl = '';
  await initDb();

  // 1. Seed dataset customers
  await query('CREATE TABLE IF NOT EXISTS dataset_customers (customer_id VARCHAR(32) PRIMARY KEY)');
  await query("INSERT INTO dataset_customers VALUES ('rec-customer') ON CONFLICT DO NOTHING");

  // 2. Seed resource tables
  await query('CREATE TABLE IF NOT EXISTS dataset_flights (flight_id VARCHAR(32) PRIMARY KEY, available_seats INT, price NUMERIC(12,2), currency VARCHAR(8), airline VARCHAR(128))');
  await query("INSERT INTO dataset_flights VALUES ('flt-rec-1', 10, 4000, 'INR', 'SkyConnect') ON CONFLICT DO NOTHING");

  await query('CREATE TABLE IF NOT EXISTS dataset_hotels (hotel_id VARCHAR(32) PRIMARY KEY, name VARCHAR(255))');
  await query('CREATE TABLE IF NOT EXISTS dataset_room_inventory (room_inventory_id VARCHAR(32) PRIMARY KEY, hotel_id VARCHAR(32), available_rooms INT, price_per_night NUMERIC(12,2), currency VARCHAR(8))');
  await query("INSERT INTO dataset_hotels VALUES ('htl-rec-1', 'CityStay') ON CONFLICT DO NOTHING");
  await query("INSERT INTO dataset_hotels VALUES ('htl-rec-2', 'GrandResort') ON CONFLICT DO NOTHING");
  await query("INSERT INTO dataset_room_inventory VALUES ('room-rec-1', 'htl-rec-1', 10, 3000, 'INR') ON CONFLICT DO NOTHING");
  await query("INSERT INTO dataset_room_inventory VALUES ('room-rec-2', 'htl-rec-2', 10, 3500, 'INR') ON CONFLICT DO NOTHING");

  await query('CREATE TABLE IF NOT EXISTS dataset_vehicles (vehicle_id VARCHAR(32) PRIMARY KEY, provider VARCHAR(128), currency VARCHAR(8))');
  await query('CREATE TABLE IF NOT EXISTS dataset_transport_inventory (transport_inventory_id VARCHAR(32) PRIMARY KEY, vehicle_id VARCHAR(32), available_units INT, price NUMERIC(12,2))');
  await query("INSERT INTO dataset_vehicles VALUES ('veh-rec-1', 'UrbanMove', 'INR') ON CONFLICT DO NOTHING");
  await query("INSERT INTO dataset_transport_inventory VALUES ('trn-rec-1', 'veh-rec-1', 10, 1500) ON CONFLICT DO NOTHING");

  await query('CREATE TABLE IF NOT EXISTS dataset_activities (activity_id VARCHAR(32) PRIMARY KEY, provider VARCHAR(128), currency VARCHAR(8))');
  await query('CREATE TABLE IF NOT EXISTS dataset_activity_inventory (activity_inventory_id VARCHAR(32) PRIMARY KEY, activity_id VARCHAR(32), available_slots INT, price_per_person NUMERIC(12,2))');
  await query("INSERT INTO dataset_activities VALUES ('act-rec-1', 'HolidayHub', 'INR') ON CONFLICT DO NOTHING");
  await query("INSERT INTO dataset_activity_inventory VALUES ('act-rec-1', 'act-rec-1', 10, 800) ON CONFLICT DO NOTHING");

  // 3. Seed dataset_providers
  await query(`
    CREATE TABLE IF NOT EXISTS dataset_providers (
      provider_id VARCHAR(32) PRIMARY KEY,
      provider_name VARCHAR(255),
      provider_type VARCHAR(32),
      reliability_score NUMERIC(4,3),
      response_time_ms INT,
      supports_rollback BOOLEAN,
      supports_idempotency BOOLEAN,
      status VARCHAR(24)
    )
  `);
  await query("INSERT INTO dataset_providers VALUES ('PROV_FLT_RETRY', 'SkyConnect', 'flight', 0.990, 400, true, true, 'active') ON CONFLICT DO NOTHING");
  await query("INSERT INTO dataset_providers VALUES ('PROV_HTL_MAINT', 'CityStay', 'hotel', 0.920, 1200, true, true, 'maintenance') ON CONFLICT DO NOTHING");
  await query("INSERT INTO dataset_providers VALUES ('PROV_HTL_ACTIVE', 'GrandResort', 'hotel', 0.985, 500, true, true, 'active') ON CONFLICT DO NOTHING");
  await query("INSERT INTO dataset_providers VALUES ('PROV_TRN_UNSUPP', 'UrbanMove', 'transport', 0.880, 1800, false, false, 'active') ON CONFLICT DO NOTHING");
  await query("INSERT INTO dataset_providers VALUES ('PROV_ACT_REPEATED', 'HolidayHub', 'activity', 0.910, 900, true, true, 'active') ON CONFLICT DO NOTHING");
  await query("INSERT INTO dataset_providers VALUES ('PROV_ACT_ALT', 'OutdoorJoy', 'activity', 0.960, 450, true, true, 'active') ON CONFLICT DO NOTHING");

  // 4. Seed dataset_event_logs with historical failures
  await query(`
    CREATE TABLE IF NOT EXISTS dataset_event_logs (
      event_id VARCHAR(32) PRIMARY KEY,
      transaction_id VARCHAR(32),
      booking_id VARCHAR(32),
      provider_id VARCHAR(32),
      event_type VARCHAR(64),
      resource_type VARCHAR(32),
      status VARCHAR(24),
      message TEXT,
      timestamp TIMESTAMP
    )
  `);
  await query("INSERT INTO dataset_event_logs VALUES ('EVT_REC_1', 'TX1', 'BK1', 'PROV_ACT_REPEATED', 'provider_failure', 'activity_slot', 'failure', 'error 1', CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING");
  await query("INSERT INTO dataset_event_logs VALUES ('EVT_REC_2', 'TX2', 'BK2', 'PROV_ACT_REPEATED', 'provider_failure', 'activity_slot', 'failure', 'error 2', CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING");

  // 5. Build Fastify app
  app = Fastify();
  await app.register(transactionRoutes);
  await app.ready();
});

beforeEach(async () => {
  await query('DELETE FROM booking_transactions');
  await query('DELETE FROM booking_transaction_risk_assessments');
  await query('DELETE FROM booking_transaction_recovery_advisories');
  await query('DELETE FROM idempotency_keys');
});

describe('Phase 6B: Recovery Intelligence / Recovery Advisor Service', () => {
  it('1. Transient network error produces AUTOMATIC_RETRY advisory', async () => {
    // Failure simulation with network error on flight provider
    const providers = createMockProviderRegistry({
      failures: {
        reserve: { flight: 'network connection reset ECONNRESET' }
      }
    });

    const result = await executeBookingSaga(
      {
        customerId: 'rec-customer',
        items: [{ type: 'flight', resourceId: 'flt-rec-1', quantity: 1 }]
      },
      { providers }
    );

    assert.equal(result.state, 'ROLLED_BACK');
    // Generate advisory on failed transaction
    const advisory = await generateRecoveryAdvisory(result.transactionId);
    assert.ok(advisory, 'Expected advisory to be generated');
    assert.equal(advisory.recommendation, 'AUTOMATIC_RETRY');
    assert.equal(advisory.severity, 'LOW');
    assert.ok(advisory.confidence >= 80);
    assert.ok(advisory.reasons.some(r => r.code === 'TRANSIENT_FAILURE_DETECTED'));
    assert.ok(advisory.suggestedActions.some(a => /retry/i.test(a)));
  });

  it('2. Provider timeout with rollback/idempotency support produces AUTOMATIC_RETRY', async () => {
    const providers = createMockProviderRegistry({
      failures: {
        reserve: { flight: 'ETIMEDOUT: Supplier gateway response timeout after 10000ms' }
      }
    });

    const result = await executeBookingSaga(
      {
        customerId: 'rec-customer',
        items: [{ type: 'flight', resourceId: 'flt-rec-1', quantity: 1 }]
      },
      { providers }
    );

    const advisory = await generateRecoveryAdvisory(result.transactionId);
    assert.ok(advisory);
    assert.equal(advisory.recommendation, 'AUTOMATIC_RETRY');
    assert.equal(advisory.severity, 'LOW');
    assert.ok(advisory.reasons.some(r => r.code === 'TRANSIENT_FAILURE_DETECTED'));
  });

  it('3. Provider maintenance with alternative provider available produces ALTERNATIVE_PROVIDER', async () => {
    // CityStay is in maintenance in dataset_providers; GrandResort is active alternative
    const providers = createMockProviderRegistry({
      failures: {
        reserve: { hotel: 'Provider endpoint under scheduled maintenance' }
      }
    });

    const result = await executeBookingSaga(
      {
        customerId: 'rec-customer',
        items: [{ type: 'hotel', resourceId: 'room-rec-1', quantity: 1 }]
      },
      { providers }
    );

    const advisory = await generateRecoveryAdvisory(result.transactionId);
    assert.ok(advisory);
    assert.equal(advisory.recommendation, 'ALTERNATIVE_PROVIDER');
    assert.equal(advisory.severity, 'MEDIUM');
    assert.ok(advisory.reasons.some(r => r.code === 'PROVIDER_MAINTENANCE'));
    assert.ok(advisory.suggestedActions.some(a => /alternative/i.test(a)));
  });

  it('4. Repeated historical provider failures produces ALTERNATIVE_PROVIDER', async () => {
    // HolidayHub has 2 recorded historical failures in event logs
    const providers = createMockProviderRegistry({
      failures: {
        reserve: { activity: 'Activity allocation temporarily refused' }
      }
    });

    const result = await executeBookingSaga(
      {
        customerId: 'rec-customer',
        items: [{ type: 'activity', resourceId: 'act-rec-1', quantity: 1 }]
      },
      { providers }
    );

    const advisory = await generateRecoveryAdvisory(result.transactionId);
    assert.ok(advisory);
    assert.equal(advisory.recommendation, 'ALTERNATIVE_PROVIDER');
    assert.ok(advisory.reasons.some(r => r.code === 'REPEATED_HISTORICAL_FAILURES'));
  });

  it('5. Compensation failure produces MANUAL_OPERATOR_REVIEW and HIGH severity', async () => {
    const providers = createMockProviderRegistry({
      failures: {
        reserve: { flight: 'flight forward failed' },
        cancel: { hotel: 'hotel cancel API failure' }
      }
    });

    const result = await executeBookingSaga(
      {
        customerId: 'rec-customer',
        items: [
          { type: 'hotel', resourceId: 'room-rec-1', quantity: 1 },
          { type: 'flight', resourceId: 'flt-rec-1', quantity: 1 }
        ]
      },
      { providers }
    );

    assert.equal(result.state, 'ROLLBACK_FAILED');
    assert.ok(result.recoveryRequired.length > 0);

    const advisory = await getRecoveryAdvisoryByTransactionId(result.transactionId);
    assert.ok(advisory);
    assert.equal(advisory.recommendation, 'MANUAL_OPERATOR_REVIEW');
    assert.equal(advisory.severity, 'HIGH');
    assert.ok(advisory.confidence >= 90);
    assert.ok(advisory.reasons.some(r => r.code === 'COMPENSATION_FAILED'));
  });

  it('6. Unresolved CONFIRMED lock produces MANUAL_OPERATOR_REVIEW', async () => {
    // When compensation fails on a reserved item, its lock remains CONFIRMED
    const providers = createMockProviderRegistry({
      failures: {
        reserve: { flight: 'flight failed' },
        cancel: { hotel: 'hotel compensation failed' }
      }
    });

    const result = await executeBookingSaga(
      {
        customerId: 'rec-customer',
        items: [
          { type: 'hotel', resourceId: 'room-rec-1', quantity: 1 },
          { type: 'flight', resourceId: 'flt-rec-1', quantity: 1 }
        ]
      },
      { providers }
    );

    // Verify database lock remains CONFIRMED
    const locks = await query<{ status: string }>('SELECT status FROM booking_resource_locks WHERE transaction_id = $1 AND status = \'CONFIRMED\'', [result.transactionId]);
    assert.ok(locks.rowCount > 0, 'Resource lock must remain CONFIRMED on compensation failure');

    const advisory = await generateRecoveryAdvisory(result.transactionId);
    assert.ok(advisory);
    assert.equal(advisory.recommendation, 'MANUAL_OPERATOR_REVIEW');
    assert.equal(advisory.severity, 'HIGH');
    assert.ok(advisory.reasons.some(r => r.code === 'UNRESOLVED_RESOURCE_LOCK'));
  });

  it('7. Unsupported rollback produces MANUAL_OPERATOR_REVIEW', async () => {
    // UrbanMove has supportsRollback = false
    const providers = createMockProviderRegistry({
      failures: {
        reserve: { transport: 'transport reservation error' }
      }
    });

    const result = await executeBookingSaga(
      {
        customerId: 'rec-customer',
        items: [{ type: 'transport', resourceId: 'trn-rec-1', quantity: 1 }]
      },
      { providers }
    );

    const advisory = await generateRecoveryAdvisory(result.transactionId);
    assert.ok(advisory);
    assert.equal(advisory.recommendation, 'MANUAL_OPERATOR_REVIEW');
    assert.equal(advisory.severity, 'HIGH');
    assert.ok(advisory.reasons.some(r => r.code === 'UNSUPPORTED_ROLLBACK'));
  });

  it('8. Ambiguous error produces MANUAL_OPERATOR_REVIEW', async () => {
    const providers = createMockProviderRegistry({
      failures: {
        reserve: { flight: 'Internal schema parsing violation 0x9F' }
      }
    });

    const result = await executeBookingSaga(
      {
        customerId: 'rec-customer',
        items: [{ type: 'flight', resourceId: 'flt-rec-1', quantity: 1 }]
      },
      { providers }
    );

    const advisory = await generateRecoveryAdvisory(result.transactionId);
    assert.ok(advisory);
    assert.equal(advisory.recommendation, 'MANUAL_OPERATOR_REVIEW');
    assert.ok(advisory.reasons.some(r => r.code === 'AMBIGUOUS_ERROR_CONDITION'));
  });

  it('9. All reasons include non-empty evidenceIds', async () => {
    const providers = createMockProviderRegistry({
      failures: {
        reserve: { transport: 'transport failed' }
      }
    });

    const result = await executeBookingSaga(
      {
        customerId: 'rec-customer',
        items: [{ type: 'transport', resourceId: 'trn-rec-1', quantity: 1 }]
      },
      { providers }
    );

    const advisory = await generateRecoveryAdvisory(result.transactionId);
    assert.ok(advisory);
    assert.ok(advisory.reasons.length > 0);
    for (const reason of advisory.reasons) {
      assert.ok(Array.isArray(reason.evidenceIds) && reason.evidenceIds.length > 0, `Reason ${reason.code} must have evidenceIds`);
    }
  });

  it('10. Identical inputs produce identical recommendation and confidence', async () => {
    const providers = createMockProviderRegistry({
      failures: {
        reserve: { flight: 'network connection timeout' }
      }
    });

    const result = await executeBookingSaga(
      {
        customerId: 'rec-customer',
        items: [{ type: 'flight', resourceId: 'flt-rec-1', quantity: 1 }]
      },
      { providers }
    );

    const run1 = await generateRecoveryAdvisory(result.transactionId);
    const run2 = await generateRecoveryAdvisory(result.transactionId);

    assert.equal(run1?.recommendation, run2?.recommendation);
    assert.equal(run1?.severity, run2?.severity);
    assert.equal(run1?.confidence, run2?.confidence);
    assert.deepEqual(run1?.reasons.map(r => r.code), run2?.reasons.map(r => r.code));
  });

  it('11. Advisory calculation does not modify inventory', async () => {
    const flightBefore = (await query<any>('SELECT available_seats FROM dataset_flights WHERE flight_id = $1', ['flt-rec-1'])).rows[0].available_seats;

    const providers = createMockProviderRegistry({
      failures: { reserve: { flight: 'network timeout' } }
    });
    const result = await executeBookingSaga(
      {
        customerId: 'rec-customer',
        items: [{ type: 'flight', resourceId: 'flt-rec-1', quantity: 1 }]
      },
      { providers }
    );

    await generateRecoveryAdvisory(result.transactionId);

    const flightAfter = (await query<any>('SELECT available_seats FROM dataset_flights WHERE flight_id = $1', ['flt-rec-1'])).rows[0].available_seats;
    assert.equal(flightAfter, flightBefore, 'Inventory seats must not change during recovery advisory generation');
  });

  it('12. Advisory calculation does not release locks', async () => {
    const providers = createMockProviderRegistry({
      failures: {
        reserve: { flight: 'flight failed' },
        cancel: { hotel: 'hotel cancel failed' }
      }
    });

    const result = await executeBookingSaga(
      {
        customerId: 'rec-customer',
        items: [
          { type: 'hotel', resourceId: 'room-rec-1', quantity: 1 },
          { type: 'flight', resourceId: 'flt-rec-1', quantity: 1 }
        ]
      },
      { providers }
    );

    const confirmedLocksBefore = (await query('SELECT COUNT(*) as count FROM booking_resource_locks WHERE transaction_id = $1 AND status = \'CONFIRMED\'', [result.transactionId])).rows[0].count;
    assert.equal(Number(confirmedLocksBefore), 1);

    await generateRecoveryAdvisory(result.transactionId);

    const confirmedLocksAfter = (await query('SELECT COUNT(*) as count FROM booking_resource_locks WHERE transaction_id = $1 AND status = \'CONFIRMED\'', [result.transactionId])).rows[0].count;
    assert.equal(Number(confirmedLocksAfter), 1, 'Confirmed locks must remain unreleased by advisory generation');
  });

  it('13. Advisory calculation does not make provider calls', async () => {
    const calls: string[] = [];
    const providers = createMockProviderRegistry({
      calls,
      failures: { reserve: { flight: 'network timeout' } }
    });

    const result = await executeBookingSaga(
      {
        customerId: 'rec-customer',
        items: [{ type: 'flight', resourceId: 'flt-rec-1', quantity: 1 }]
      },
      { providers }
    );

    const callCountAfterSaga = calls.length;
    await generateRecoveryAdvisory(result.transactionId);
    assert.equal(calls.length, callCountAfterSaga, 'generateRecoveryAdvisory must make 0 provider calls');
  });

  it('14. Advisor failure does not fail the transaction', async () => {
    const providers = createMockProviderRegistry({
      failures: {
        reserve: { flight: 'flight failed' },
        cancel: { hotel: 'compensation failed' }
      }
    });

    // When simulateRecoveryError is true, executeBookingSaga catches and continues safely
    const result = await executeBookingSaga(
      {
        customerId: 'rec-customer',
        items: [
          { type: 'hotel', resourceId: 'room-rec-1', quantity: 1 },
          { type: 'flight', resourceId: 'flt-rec-1', quantity: 1 }
        ]
      },
      {
        providers,
        simulateRecoveryError: true
      }
    );

    assert.equal(result.state, 'ROLLBACK_FAILED');
    assert.equal(result.recoveryRequired.length, 1);
  });

  it('15. GET /api/transactions/:id exposes recoveryAdvisory for ROLLBACK_FAILED', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: { 'Idempotency-Key': 'idem-test-rec-15' },
      payload: {
        customerId: 'rec-customer',
        items: [
          { type: 'hotel', resourceId: 'room-rec-1', quantity: 1 },
          { type: 'flight', resourceId: 'flt-rec-1', quantity: 1 }
        ],
        failureSimulation: {
          reserve: { flight: 'flight forward failed' },
          cancel: { hotel: 'hotel compensation failed' }
        }
      }
    });

    assert.equal(response.statusCode, 409);
    const postBody = response.json();
    assert.equal(postBody.state, 'ROLLBACK_FAILED');

    // Query GET
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/transactions/${postBody.transactionId}`
    });

    assert.equal(getRes.statusCode, 200);
    const getBody = getRes.json();
    assert.ok(getBody.recoveryAdvisory, 'GET must return recoveryAdvisory');
    assert.equal(getBody.recoveryAdvisory.recommendation, 'MANUAL_OPERATOR_REVIEW');
    assert.equal(getBody.recoveryAdvisory.severity, 'HIGH');
    assert.ok(Array.isArray(getBody.recoveryAdvisory.suggestedActions));
    assert.ok(Array.isArray(getBody.recoveryAdvisory.affectedItems));
  });

  it('16. Successful COMPLETED transaction does not generate unnecessary recovery advisory', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: { 'Idempotency-Key': 'idem-test-rec-16' },
      payload: {
        customerId: 'rec-customer',
        items: [{ type: 'flight', resourceId: 'flt-rec-1', quantity: 1 }]
      }
    });

    assert.equal(response.statusCode, 201);
    const postBody = response.json();
    assert.equal(postBody.state, 'COMPLETED');

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/transactions/${postBody.transactionId}`
    });

    assert.equal(getRes.statusCode, 200);
    const getBody = getRes.json();
    assert.equal(getBody.recoveryAdvisory, null, 'Normal COMPLETED transaction must have null recoveryAdvisory');
  });

  it('17. Section 12 explicit failure scenario verification', async () => {
    // Provider A (hotel) -> SUCCESS
    // Provider B (flight) -> SUCCESS
    // Provider C (transport) -> FAILURE
    // Rollback:
    // Provider B (flight) -> compensation SUCCESS
    // Provider A (hotel) -> compensation FAILURE
    const providers = createMockProviderRegistry({
      failures: {
        reserve: { transport: 'Provider C transport failure' },
        cancel: { hotel: 'Provider A hotel compensation failure' }
      }
    });

    const result = await executeBookingSaga(
      {
        customerId: 'rec-customer',
        items: [
          { type: 'hotel', resourceId: 'room-rec-1', quantity: 1 },
          { type: 'flight', resourceId: 'flt-rec-1', quantity: 1 },
          { type: 'transport', resourceId: 'trn-rec-1', quantity: 1 }
        ]
      },
      { providers }
    );

    // 1. Transaction state is ROLLBACK_FAILED
    assert.equal(result.state, 'ROLLBACK_FAILED');

    // 2. recoveryRequired contains Provider A (hotel)
    assert.ok(result.recoveryRequired.some(r => r.provider === 'CityStay'));

    // 3. Resource lock for Provider A remains CONFIRMED
    const hotelLock = (await query<any>(
      "SELECT status FROM booking_resource_locks WHERE transaction_id = $1 AND resource_type = 'hotel'",
      [result.transactionId]
    )).rows[0];
    assert.equal(hotelLock.status, 'CONFIRMED', 'Provider A lock must remain CONFIRMED');

    // 4. recoveryAdvisory recommendation = MANUAL_OPERATOR_REVIEW, severity = HIGH
    const advisory = result.recoveryAdvisory;
    assert.ok(advisory, 'Expected advisory in result');
    assert.equal(advisory?.recommendation, 'MANUAL_OPERATOR_REVIEW');
    assert.equal(advisory?.severity, 'HIGH');

    // 5. The advisor must NOT release the unresolved lock
    const hotelLockAfter = (await query<any>(
      "SELECT status FROM booking_resource_locks WHERE transaction_id = $1 AND resource_type = 'hotel'",
      [result.transactionId]
    )).rows[0];
    assert.equal(hotelLockAfter.status, 'CONFIRMED', 'Advisor must not release the unresolved lock');
  });
});

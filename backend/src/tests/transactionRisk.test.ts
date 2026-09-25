import { strict as assert } from 'node:assert';
import { before, beforeEach, describe, it } from 'node:test';
import Fastify, { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { initDb, query } from '../db/client.js';
import {
  assessTransactionRisk,
  persistRiskAssessment,
  getRiskAssessmentByTransactionId
} from '../ai/transactionRisk.js';
import { executeBookingSaga } from '../transactions/saga.js';
import { createMockProviderRegistry } from '../providers/datasetAdapters.js';
import { MockPaymentService } from '../transactions/payment.js';
import transactionRoutes from '../routes/transactions.js';
import type { ResourceType } from '../transactions/types.js';

const RESOURCE: Record<ResourceType, string> = {
  flight: 'flight-risk-1',
  hotel: 'room-risk-1',
  transport: 'transport-risk-1',
  activity: 'activity-risk-1'
};

async function tableRows<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  return (await query<T>(sql, params)).rows;
}

let app: FastifyInstance;

before(async () => {
  config.databaseUrl = '';
  await initDb();

  // 1. Seed dataset customers
  await query('CREATE TABLE IF NOT EXISTS dataset_customers (customer_id VARCHAR(32) PRIMARY KEY)');
  await query("INSERT INTO dataset_customers VALUES ('risk-customer') ON CONFLICT DO NOTHING");

  // 2. Seed resource tables
  await query('CREATE TABLE IF NOT EXISTS dataset_flights (flight_id VARCHAR(32) PRIMARY KEY, available_seats INT, price NUMERIC(12,2), currency VARCHAR(8), airline VARCHAR(128))');
  await query("INSERT INTO dataset_flights VALUES ('flight-risk-1', 10, 5000, 'INR', 'SkyConnect') ON CONFLICT DO NOTHING");
  await query("INSERT INTO dataset_flights VALUES ('flight-risk-lowcap', 1, 5000, 'INR', 'SkyConnect') ON CONFLICT DO NOTHING");

  await query('CREATE TABLE IF NOT EXISTS dataset_hotels (hotel_id VARCHAR(32) PRIMARY KEY, name VARCHAR(255))');
  await query('CREATE TABLE IF NOT EXISTS dataset_room_inventory (room_inventory_id VARCHAR(32) PRIMARY KEY, hotel_id VARCHAR(32), available_rooms INT, price_per_night NUMERIC(12,2), currency VARCHAR(8))');
  await query("INSERT INTO dataset_hotels VALUES ('hotel-risk-1', 'CityStay') ON CONFLICT DO NOTHING");
  await query("INSERT INTO dataset_room_inventory VALUES ('room-risk-1', 'hotel-risk-1', 10, 3000, 'INR') ON CONFLICT DO NOTHING");

  await query('CREATE TABLE IF NOT EXISTS dataset_vehicles (vehicle_id VARCHAR(32) PRIMARY KEY, provider VARCHAR(128), currency VARCHAR(8))');
  await query('CREATE TABLE IF NOT EXISTS dataset_transport_inventory (transport_inventory_id VARCHAR(32) PRIMARY KEY, vehicle_id VARCHAR(32), available_units INT, price NUMERIC(12,2))');
  await query("INSERT INTO dataset_vehicles VALUES ('vehicle-risk-1', 'UrbanMove', 'INR') ON CONFLICT DO NOTHING");
  await query("INSERT INTO dataset_transport_inventory VALUES ('transport-risk-1', 'vehicle-risk-1', 10, 1500) ON CONFLICT DO NOTHING");

  await query('CREATE TABLE IF NOT EXISTS dataset_activities (activity_id VARCHAR(32) PRIMARY KEY, provider VARCHAR(128), currency VARCHAR(8))');
  await query('CREATE TABLE IF NOT EXISTS dataset_activity_inventory (activity_inventory_id VARCHAR(32) PRIMARY KEY, activity_id VARCHAR(32), available_slots INT, price_per_person NUMERIC(12,2))');
  await query("INSERT INTO dataset_activities VALUES ('activity-risk-1', 'HolidayHub', 'INR') ON CONFLICT DO NOTHING");
  await query("INSERT INTO dataset_activity_inventory VALUES ('activity-risk-1', 'activity-risk-1', 10, 800) ON CONFLICT DO NOTHING");

  // 3. Seed dataset_providers with explicit test telemetry
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
  await query("INSERT INTO dataset_providers VALUES ('PROV_FLT_1', 'SkyConnect', 'flight', 0.990, 450, true, true, 'active') ON CONFLICT DO NOTHING");
  await query("INSERT INTO dataset_providers VALUES ('PROV_HTL_1', 'CityStay', 'hotel', 0.930, 1500, true, true, 'active') ON CONFLICT DO NOTHING");
  await query("INSERT INTO dataset_providers VALUES ('PROV_TRN_1', 'UrbanMove', 'transport', 0.860, 2200, false, true, 'maintenance') ON CONFLICT DO NOTHING");
  await query("INSERT INTO dataset_providers VALUES ('PROV_ACT_1', 'HolidayHub', 'activity', 0.940, 600, true, true, 'active') ON CONFLICT DO NOTHING");

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
  await query("INSERT INTO dataset_event_logs VALUES ('EVT_1', 'TX1', 'BK1', 'PROV_TRN_1', 'rollback_failure', 'transport', 'failure', 'rollback failed', CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING");
  await query("INSERT INTO dataset_event_logs VALUES ('EVT_2', 'TX2', 'BK2', 'PROV_ACT_1', 'provider_called', 'activity_slot', 'failure', 'timeout', CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING");
  await query("INSERT INTO dataset_event_logs VALUES ('EVT_3', 'TX3', 'BK3', 'PROV_ACT_1', 'provider_called', 'activity_slot', 'failure', 'rejected', CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING");

  // 5. Initialize Fastify app
  app = Fastify();
  await app.register(transactionRoutes);
  await app.ready();
});

beforeEach(async () => {
  await query('DELETE FROM booking_transactions');
  await query('DELETE FROM booking_transaction_risk_assessments');
  await query('DELETE FROM idempotency_keys');
});

describe('Phase 6A: Transaction Risk Assessment Service', () => {
  it('1. Low-risk transaction scores in LOW band and advises PROCEED', async () => {
    const input = {
      customerId: 'risk-customer',
      items: [{ type: 'flight' as ResourceType, resourceId: RESOURCE.flight, quantity: 1 }]
    };

    const assessment = await assessTransactionRisk(input);
    assert.ok(assessment.riskScore < 40, `Expected low risk score < 40, got ${assessment.riskScore}`);
    assert.equal(assessment.riskLevel, 'LOW');
    assert.equal(assessment.decision, 'PROCEED');
    assert.equal(assessment.providerAssessments.length, 1);
    assert.equal(assessment.providerAssessments[0].provider, 'SkyConnect');
  });

  it('2. Medium-risk transaction scores in MEDIUM band and advises PROCEED', async () => {
    // Hotel provider has moderate reliability (0.930 < 0.950) + moderate latency (1500ms > 1000ms)
    const input = {
      customerId: 'risk-customer',
      items: [
        { type: 'hotel' as ResourceType, resourceId: RESOURCE.hotel, quantity: 1 },
        { type: 'flight' as ResourceType, resourceId: RESOURCE.flight, quantity: 1 }
      ]
    };

    const assessment = await assessTransactionRisk(input);
    assert.ok(
      assessment.riskScore >= 40 && assessment.riskScore < 70,
      `Expected medium risk score 40..69, got ${assessment.riskScore}`
    );
    assert.equal(assessment.riskLevel, 'MEDIUM');
    assert.equal(assessment.decision, 'PROCEED');
  });

  it('3. High-risk transaction scores in HIGH band and advises REVIEW', async () => {
    // UrbanMove has: maintenance (+30), reliability 0.86 (<0.90 -> +25), supportsRollback=false (+20), latency 2200ms (+10), rollback failures (+20)
    const input = {
      customerId: 'risk-customer',
      items: [{ type: 'transport' as ResourceType, resourceId: RESOURCE.transport, quantity: 1 }]
    };

    const assessment = await assessTransactionRisk(input);
    assert.ok(assessment.riskScore >= 70, `Expected high risk score >= 70, got ${assessment.riskScore}`);
    assert.equal(assessment.riskLevel, 'HIGH');
    assert.equal(assessment.decision, 'REVIEW');
    assert.ok(assessment.factors.some(f => f.code === 'PROVIDER_MAINTENANCE'));
    assert.ok(assessment.factors.some(f => f.code === 'UNSUPPORTED_ROLLBACK'));
    assert.ok(assessment.factors.some(f => f.code === 'LOW_PROVIDER_RELIABILITY'));
  });

  it('4. Low provider reliability increases risk score and records factor', async () => {
    const input = {
      customerId: 'risk-customer',
      items: [{ type: 'flight' as ResourceType, resourceId: RESOURCE.flight, quantity: 1 }]
    };

    const highRel = await assessTransactionRisk(input, {
      providerOverrides: { SkyConnect: { reliabilityScore: 0.99 } }
    });
    const lowRel = await assessTransactionRisk(input, {
      providerOverrides: { SkyConnect: { reliabilityScore: 0.85 } }
    });

    assert.ok(
      lowRel.riskScore > highRel.riskScore,
      `Expected low reliability score (${lowRel.riskScore}) > high reliability score (${highRel.riskScore})`
    );
    assert.ok(lowRel.factors.some(f => f.code === 'LOW_PROVIDER_RELIABILITY'));
  });

  it('5. Provider maintenance increases risk score and records HIGH severity factor', async () => {
    const input = {
      customerId: 'risk-customer',
      items: [{ type: 'flight' as ResourceType, resourceId: RESOURCE.flight, quantity: 1 }]
    };

    const active = await assessTransactionRisk(input, {
      providerOverrides: { SkyConnect: { status: 'active' } }
    });
    const maint = await assessTransactionRisk(input, {
      providerOverrides: { SkyConnect: { status: 'maintenance' } }
    });

    assert.ok(
      maint.riskScore > active.riskScore,
      `Expected maintenance score (${maint.riskScore}) > active score (${active.riskScore})`
    );
    const maintFactor = maint.factors.find(f => f.code === 'PROVIDER_MAINTENANCE');
    assert.ok(maintFactor, 'Expected PROVIDER_MAINTENANCE factor');
    assert.equal(maintFactor?.severity, 'HIGH');
  });

  it('6. Unsupported rollback increases risk score', async () => {
    const input = {
      customerId: 'risk-customer',
      items: [{ type: 'flight' as ResourceType, resourceId: RESOURCE.flight, quantity: 1 }]
    };

    const supported = await assessTransactionRisk(input, {
      providerOverrides: { SkyConnect: { supportsRollback: true } }
    });
    const unsupported = await assessTransactionRisk(input, {
      providerOverrides: { SkyConnect: { supportsRollback: false } }
    });

    assert.ok(unsupported.riskScore > supported.riskScore);
    assert.ok(unsupported.factors.some(f => f.code === 'UNSUPPORTED_ROLLBACK'));
  });

  it('7. Multiple independent providers increase risk monotonically', async () => {
    const single = await assessTransactionRisk({
      customerId: 'risk-customer',
      items: [{ type: 'flight', resourceId: RESOURCE.flight, quantity: 1 }]
    }, {
      providerOverrides: {
        SkyConnect: { reliabilityScore: 0.99, status: 'active', supportsRollback: true },
        CityStay: { reliabilityScore: 0.99, status: 'active', supportsRollback: true },
        UrbanMove: { reliabilityScore: 0.99, status: 'active', supportsRollback: true },
        HolidayHub: { reliabilityScore: 0.99, status: 'active', supportsRollback: true }
      }
    });

    const twoProv = await assessTransactionRisk({
      customerId: 'risk-customer',
      items: [
        { type: 'flight', resourceId: RESOURCE.flight, quantity: 1 },
        { type: 'hotel', resourceId: RESOURCE.hotel, quantity: 1 }
      ]
    }, {
      providerOverrides: {
        SkyConnect: { reliabilityScore: 0.99, status: 'active', supportsRollback: true },
        CityStay: { reliabilityScore: 0.99, status: 'active', supportsRollback: true }
      }
    });

    const threeProv = await assessTransactionRisk({
      customerId: 'risk-customer',
      items: [
        { type: 'flight', resourceId: RESOURCE.flight, quantity: 1 },
        { type: 'hotel', resourceId: RESOURCE.hotel, quantity: 1 },
        { type: 'transport', resourceId: RESOURCE.transport, quantity: 1 }
      ]
    }, {
      providerOverrides: {
        SkyConnect: { reliabilityScore: 0.99, status: 'active', supportsRollback: true },
        CityStay: { reliabilityScore: 0.99, status: 'active', supportsRollback: true },
        UrbanMove: { reliabilityScore: 0.99, status: 'active', supportsRollback: true }
      }
    });

    assert.ok(twoProv.riskScore > single.riskScore, '2 providers must score higher than 1 provider');
    assert.ok(threeProv.riskScore > twoProv.riskScore, '3 providers must score higher than 2 providers');
  });

  it('8. Historical provider failures increase risk score', async () => {
    const input = {
      customerId: 'risk-customer',
      items: [{ type: 'flight' as ResourceType, resourceId: RESOURCE.flight, quantity: 1 }]
    };

    const clean = await assessTransactionRisk(input, {
      providerOverrides: { SkyConnect: { historicalFailures: 0, historicalRollbackFailures: 0 } }
    });
    const withFailures = await assessTransactionRisk(input, {
      providerOverrides: { SkyConnect: { historicalFailures: 3, historicalRollbackFailures: 1 } }
    });

    assert.ok(withFailures.riskScore > clean.riskScore);
    assert.ok(withFailures.factors.some(f => f.code === 'HIGH_HISTORICAL_FAILURES'));
    assert.ok(withFailures.factors.some(f => f.code === 'HISTORICAL_ROLLBACK_FAILURES'));
  });

  it('9. Risk assessment is strictly deterministic for identical inputs', async () => {
    const input = {
      customerId: 'risk-customer',
      items: [
        { type: 'flight' as ResourceType, resourceId: RESOURCE.flight, quantity: 1 },
        { type: 'hotel' as ResourceType, resourceId: RESOURCE.hotel, quantity: 1 }
      ]
    };

    const run1 = await assessTransactionRisk(input);
    const run2 = await assessTransactionRisk(input);

    assert.equal(run1.riskScore, run2.riskScore);
    assert.equal(run1.riskLevel, run2.riskLevel);
    assert.equal(run1.decision, run2.decision);
    assert.equal(run1.factors.length, run2.factors.length);
    assert.deepEqual(
      run1.factors.map(f => f.code),
      run2.factors.map(f => f.code)
    );
  });

  it('10. Risk assessment does not mutate inventory records', async () => {
    const flightBefore = (await query<any>('SELECT available_seats FROM dataset_flights WHERE flight_id=$1', [RESOURCE.flight])).rows[0].available_seats;
    const hotelBefore = (await query<any>('SELECT available_rooms FROM dataset_room_inventory WHERE room_inventory_id=$1', [RESOURCE.hotel])).rows[0].available_rooms;

    await assessTransactionRisk({
      customerId: 'risk-customer',
      items: [
        { type: 'flight', resourceId: RESOURCE.flight, quantity: 3 },
        { type: 'hotel', resourceId: RESOURCE.hotel, quantity: 2 }
      ]
    });

    const flightAfter = (await query<any>('SELECT available_seats FROM dataset_flights WHERE flight_id=$1', [RESOURCE.flight])).rows[0].available_seats;
    const hotelAfter = (await query<any>('SELECT available_rooms FROM dataset_room_inventory WHERE room_inventory_id=$1', [RESOURCE.hotel])).rows[0].available_rooms;

    assert.equal(flightAfter, flightBefore, 'Flight available_seats must not change');
    assert.equal(hotelAfter, hotelBefore, 'Hotel available_rooms must not change');
  });

  it('11. Risk assessment does not acquire booking locks', async () => {
    const locksBefore = (await tableRows('SELECT COUNT(*) as count FROM booking_resource_locks'))[0].count;

    await assessTransactionRisk({
      customerId: 'risk-customer',
      items: [
        { type: 'flight', resourceId: RESOURCE.flight, quantity: 2 },
        { type: 'transport', resourceId: RESOURCE.transport, quantity: 1 }
      ]
    });

    const locksAfter = (await tableRows('SELECT COUNT(*) as count FROM booking_resource_locks'))[0].count;
    assert.equal(locksAfter, locksBefore, 'No booking_resource_locks should be acquired by risk assessment');
  });

  it('12. Risk assessment failure does not fail the booking transaction', async () => {
    const paymentService = new MockPaymentService();
    const providers = createMockProviderRegistry();

    // Even when simulateRiskError is true, executeBookingSaga must catch and continue
    const result = await executeBookingSaga(
      {
        customerId: 'risk-customer',
        items: [{ type: 'flight', resourceId: RESOURCE.flight, quantity: 1 }]
      },
      {
        providers,
        paymentService,
        simulateRiskError: true
      }
    );

    assert.equal(result.state, 'COMPLETED');
    assert.equal(result.items[0].status, 'COMPLETED');
    assert.equal(result.payment?.status, 'CAPTURED');
  });

  it('13. POST /api/transactions exposes structured riskAssessment in response', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: {
        'Idempotency-Key': 'idem-test-risk-post-1'
      },
      payload: {
        customerId: 'risk-customer',
        items: [{ type: 'flight', resourceId: RESOURCE.flight, quantity: 1 }]
      }
    });

    assert.equal(response.statusCode, 201);
    const body = response.json();
    assert.equal(body.success, true);
    assert.ok(body.riskAssessment, 'Response must expose riskAssessment');
    assert.equal(typeof body.riskAssessment.riskScore, 'number');
    assert.ok(['LOW', 'MEDIUM', 'HIGH'].includes(body.riskAssessment.riskLevel));
    assert.ok(['PROCEED', 'REVIEW'].includes(body.riskAssessment.decision));
    assert.ok(Array.isArray(body.riskAssessment.factors));
    assert.ok(Array.isArray(body.riskAssessment.providerAssessments));
  });

  it('14. GET /api/transactions/:id exposes persisted riskAssessment', async () => {
    // 1. Create transaction via API
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: {
        'Idempotency-Key': 'idem-test-risk-get-1'
      },
      payload: {
        customerId: 'risk-customer',
        items: [
          { type: 'flight', resourceId: RESOURCE.flight, quantity: 1 },
          { type: 'hotel', resourceId: RESOURCE.hotel, quantity: 1 }
        ]
      }
    });
    assert.equal(postRes.statusCode, 201);
    const postBody = postRes.json();
    const txId = postBody.transactionId;

    // 2. Query persisted assessment via GET
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/transactions/${txId}`
    });

    assert.equal(getRes.statusCode, 200);
    const getBody = getRes.json();
    assert.equal(getBody.success, true);
    assert.ok(getBody.riskAssessment, 'GET details must return riskAssessment');
    assert.equal(getBody.riskAssessment.riskScore, postBody.riskAssessment.riskScore);
    assert.equal(getBody.riskAssessment.riskLevel, postBody.riskAssessment.riskLevel);
    assert.equal(getBody.riskAssessment.decision, postBody.riskAssessment.decision);

    // 3. Verify database row directly in booking_transaction_risk_assessments
    const dbAssessment = await getRiskAssessmentByTransactionId(txId);
    assert.ok(dbAssessment, 'Database must contain persisted risk assessment');
    assert.equal(dbAssessment?.riskScore, postBody.riskAssessment.riskScore);
  });
});

/**
 * BookGuard Phase 7 Operations Dashboard read-only API tests.
 *
 * Covers the additive endpoints the dashboard depends on: health probes, paginated
 * transaction summaries, lock visibility in transaction details, and the demo
 * scenario catalog. Runs against isolated embedded PostgreSQL (PGlite).
 */
import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { initDb, query } from '../db/client.js';
import { buildApp } from '../server.js';

let app: FastifyInstance;

before(async () => {
  config.databaseUrl = '';
  await initDb();

  await query(`CREATE TABLE dataset_customers (customer_id VARCHAR(32) PRIMARY KEY)`);
  await query(`INSERT INTO dataset_customers VALUES ('ops-customer')`);

  await query(`CREATE TABLE dataset_flights (flight_id VARCHAR(32) PRIMARY KEY, available_seats INT, price NUMERIC(12,2), currency VARCHAR(8), airline VARCHAR(128))`);
  await query(`INSERT INTO dataset_flights VALUES ('flight-ops', 5, 100, 'INR', 'Air Ops')`);

  await query(`CREATE TABLE dataset_hotels (hotel_id VARCHAR(32) PRIMARY KEY, name VARCHAR(255))`);
  await query(`CREATE TABLE dataset_room_inventory (room_inventory_id VARCHAR(32) PRIMARY KEY, hotel_id VARCHAR(32), available_rooms INT, price_per_night NUMERIC(12,2), currency VARCHAR(8))`);
  await query(`INSERT INTO dataset_hotels VALUES ('hotel-ops', 'Ops Hotel')`);
  await query(`INSERT INTO dataset_room_inventory VALUES ('room-ops', 'hotel-ops', 5, 200, 'INR')`);

  await query(`CREATE TABLE dataset_vehicles (vehicle_id VARCHAR(32) PRIMARY KEY, provider VARCHAR(128), currency VARCHAR(8))`);
  await query(`CREATE TABLE dataset_transport_inventory (transport_inventory_id VARCHAR(32) PRIMARY KEY, vehicle_id VARCHAR(32), available_units INT, price NUMERIC(12,2))`);
  await query(`INSERT INTO dataset_vehicles VALUES ('vehicle-ops', 'Ops Transit', 'INR')`);
  await query(`INSERT INTO dataset_transport_inventory VALUES ('transport-ops', 'vehicle-ops', 5, 300)`);

  await query(`CREATE TABLE dataset_activities (activity_id VARCHAR(32) PRIMARY KEY, provider VARCHAR(128), currency VARCHAR(8))`);
  await query(`CREATE TABLE dataset_activity_inventory (activity_inventory_id VARCHAR(32) PRIMARY KEY, activity_id VARCHAR(32), available_slots INT, price_per_person NUMERIC(12,2))`);

  app = await buildApp();
});

beforeEach(async () => {
  await query('DELETE FROM booking_transactions');
  await query('DELETE FROM idempotency_keys');
});

after(async () => {
  await app?.close();
});

async function api(method: 'GET' | 'POST', url: string, payload?: unknown, headers: Record<string, string> = {}) {
  const res = await app.inject({ method, url, payload: payload as any, headers });
  return { status: res.statusCode, body: res.json() as any };
}

async function datasetFingerprint(): Promise<string> {
  const tables = ['dataset_customers', 'dataset_flights', 'dataset_room_inventory', 'dataset_transport_inventory', 'dataset_vehicles', 'dataset_hotels'];
  const parts: string[] = [];
  for (const t of tables) {
    const r = await query<{ h: string }>(`SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM ${t} x`);
    parts.push(`${t}:${r.rows[0].h}`);
  }
  return parts.join(',');
}

async function runScenario(id: string) {
  const catalog = await api('GET', '/api/transactions/demo-scenarios');
  const scenario = catalog.body.scenarios.find((s: any) => s.id === id);
  assert.ok(scenario, `scenario ${id} should exist`);
  const res = await api('POST', '/api/transactions', scenario.request, { 'Idempotency-Key': `ops-${id}-${Date.now()}` });
  return { scenario, res };
}

describe('Phase 7 Operations Dashboard API', () => {
  test('1. health reports real database and engine table probes', async () => {
    const res = await api('GET', '/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'healthy');
    assert.deepEqual(res.body.checks, {
      database: 'CONNECTED',
      transactionEngine: 'READY',
      riskEngine: 'READY',
      recoveryEngine: 'READY'
    });
  });

  test('2. transaction list is empty and paginated when no transactions exist', async () => {
    const res = await api('GET', '/api/transactions');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.total, 0);
    assert.equal(res.body.limit, 20);
    assert.equal(res.body.offset, 0);
    assert.deepEqual(res.body.transactions, []);
  });

  test('3. transaction list rejects invalid pagination', async () => {
    for (const qs of ['limit=0', 'limit=101', 'limit=abc', 'offset=-1', 'offset=1.5']) {
      const res = await api('GET', `/api/transactions?${qs}`);
      assert.equal(res.status, 400, qs);
      assert.equal(res.body.error, 'INVALID_PAGINATION');
    }
  });

  test('4. demo scenario catalog is read-only and resolves real dataset resources', async () => {
    const before = await datasetFingerprint();
    const res = await api('GET', '/api/transactions/demo-scenarios');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.scenarios.map((s: any) => s.id), [
      'SUCCESSFUL_BOOKING', 'PROVIDER_FAILURE_ROLLBACK', 'PAYMENT_FAILURE', 'ROLLBACK_FAILURE'
    ]);
    const request = res.body.scenarios[0].request;
    assert.equal(request.customerId, 'ops-customer');
    assert.deepEqual(request.items.map((i: any) => i.resourceId), ['room-ops', 'flight-ops', 'transport-ops']);

    const count = await query<{ n: number }>('SELECT count(*)::int AS n FROM booking_transactions');
    assert.equal(count.rows[0].n, 0, 'reading the catalog must not create transactions');
    assert.equal(await datasetFingerprint(), before, 'reading the catalog must not modify dataset tables');
  });

  test('5. each demo scenario produces its expected state through the real saga', async () => {
    const before = await datasetFingerprint();
    for (const id of ['SUCCESSFUL_BOOKING', 'PROVIDER_FAILURE_ROLLBACK', 'PAYMENT_FAILURE', 'ROLLBACK_FAILURE']) {
      const { scenario, res } = await runScenario(id);
      assert.equal(res.body.state, scenario.expectedState, id);
    }
    assert.equal(await datasetFingerprint(), before, 'saga execution must not modify dataset tables');
  });

  test('6. transaction details expose resource locks, including unresolved CONFIRMED locks', async () => {
    const { res } = await runScenario('ROLLBACK_FAILURE');
    assert.equal(res.body.state, 'ROLLBACK_FAILED');

    const details = await api('GET', `/api/transactions/${res.body.transactionId}`);
    assert.equal(details.status, 200);
    assert.ok(Array.isArray(details.body.locks));
    assert.equal(details.body.locks.length, 3);
    const byType = Object.fromEntries(details.body.locks.map((l: any) => [l.resourceType, l]));
    assert.equal(byType.flight.status, 'CONFIRMED', 'failed compensation keeps the flight lock protected');
    assert.equal(byType.hotel.status, 'RELEASED');
    assert.equal(byType.transport.status, 'RELEASED');
    for (const lock of details.body.locks) {
      assert.ok(lock.itemId && lock.resourceId && lock.expiresAt, 'lock fields are present');
    }
    assert.equal(details.body.recoveryAdvisory.recommendation, 'MANUAL_OPERATOR_REVIEW');
  });

  test('7. transaction details retain persisted payment events for the dashboard', async () => {
    const { res } = await runScenario('PROVIDER_FAILURE_ROLLBACK');
    const details = await api('GET', `/api/transactions/${res.body.transactionId}`);
    const paymentEvents = details.body.events.map((e: any) => e.detail?.event).filter((e: string) => e?.startsWith('PAYMENT_'));
    assert.deepEqual(paymentEvents, ['PAYMENT_AUTHORIZED', 'PAYMENT_REFUNDED']);
  });

  test('8. list returns newest-first summaries without customer identifiers', async () => {
    await runScenario('SUCCESSFUL_BOOKING');
    const failed = await runScenario('ROLLBACK_FAILURE');

    const res = await api('GET', '/api/transactions?limit=1');
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 2);
    assert.equal(res.body.transactions.length, 1);
    const summary = res.body.transactions[0];
    assert.equal(summary.transactionId, failed.res.body.transactionId);
    assert.equal(summary.state, 'ROLLBACK_FAILED');
    assert.equal(summary.currency, 'INR');
    assert.equal(summary.totalAmount, 600);
    assert.equal(summary.itemCount, 3);
    assert.equal(typeof summary.riskScore, 'number');
    assert.ok(['LOW', 'MEDIUM', 'HIGH'].includes(summary.riskLevel));
    assert.equal(summary.recoveryRecommendation, 'MANUAL_OPERATOR_REVIEW');
    assert.equal('customerId' in summary, false);
    assert.equal(JSON.stringify(res.body).includes('ops-customer'), false);

    const page2 = await api('GET', '/api/transactions?limit=1&offset=1');
    assert.equal(page2.body.transactions[0].state, 'COMPLETED');
    assert.equal(page2.body.transactions[0].recoveryRecommendation, null);
  });

  test('9. existing transaction detail contract is preserved', async () => {
    const { res } = await runScenario('SUCCESSFUL_BOOKING');
    const details = await api('GET', `/api/transactions/${res.body.transactionId}`);
    for (const key of ['success', 'transactionId', 'state', 'currency', 'totalAmount', 'createdAt', 'updatedAt', 'items', 'itemStates', 'providers', 'events', 'recoveryRequired', 'riskAssessment', 'recoveryAdvisory']) {
      assert.ok(key in details.body, `detail response keeps ${key}`);
    }
    assert.ok(details.body.locks.every((l: any) => l.status === 'CONFIRMED'), 'completed bookings retain their locks');
  });
});

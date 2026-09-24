/**
 * Phase 10 customer resolution: eligibility, real-dataset alternatives, and replacement bookings that
 * go through the normal idempotent Saga path. Runs against isolated embedded PostgreSQL (PGlite).
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
  const sql = [
    `CREATE TABLE dataset_customers (customer_id VARCHAR(32) PRIMARY KEY)`,
    `INSERT INTO dataset_customers VALUES ('res-customer')`,
    `CREATE TABLE dataset_hotels (hotel_id VARCHAR(32) PRIMARY KEY, name VARCHAR(255), city VARCHAR(64))`,
    `CREATE TABLE dataset_room_inventory (room_inventory_id VARCHAR(32) PRIMARY KEY, hotel_id VARCHAR(32), room_type VARCHAR(32), check_in DATE, check_out DATE, available_rooms INT, price_per_night NUMERIC(12,2), currency VARCHAR(8), status VARCHAR(16))`,
    `INSERT INTO dataset_hotels VALUES ('H1', 'Sea View Hotel', 'Goa')`,
    `INSERT INTO dataset_room_inventory VALUES ('ROOM-1', 'H1', 'Deluxe', '2027-01-10', '2027-01-12', 5, 3000, 'INR', 'available')`,
    `CREATE TABLE dataset_flights (flight_id VARCHAR(32) PRIMARY KEY, airline VARCHAR(128), flight_number VARCHAR(16), origin_airport VARCHAR(8), origin_city VARCHAR(64), destination_airport VARCHAR(8), destination_city VARCHAR(64), departure_date DATE, departure_time VARCHAR(8), available_seats INT, price NUMERIC(12,2), currency VARCHAR(8))`,
    `INSERT INTO dataset_flights VALUES ('FLT-1', 'Air One', 'AO101', 'BLR', 'Bengaluru', 'GOI', 'Goa', '2027-01-10', '06:10', 5, 4500, 'INR')`,
    `CREATE TABLE dataset_vehicles (vehicle_id VARCHAR(32) PRIMARY KEY, provider VARCHAR(128), vehicle_type VARCHAR(32), city VARCHAR(64), currency VARCHAR(8))`,
    `CREATE TABLE dataset_transport_inventory (transport_inventory_id VARCHAR(32) PRIMARY KEY, vehicle_id VARCHAR(32), date DATE, time_slot VARCHAR(16), available_units INT, price NUMERIC(12,2), status VARCHAR(16))`,
    `INSERT INTO dataset_vehicles VALUES ('V-ORIG', 'GoaCabs', 'Sedan', 'Goa', 'INR'), ('V-B', 'CityRide', 'Sedan', 'Goa', 'INR'), ('V-C', 'MetroCab', 'SUV', 'Goa', 'INR'), ('V-X', 'MumbaiMove', 'Sedan', 'Mumbai', 'INR'), ('V-S', 'SoldCo', 'Sedan', 'Goa', 'INR'), ('V-Z', 'ZeroCo', 'Sedan', 'Goa', 'INR'), ('V-L', 'LastSeat', 'Sedan', 'Goa', 'INR')`,
    `INSERT INTO dataset_transport_inventory VALUES
       ('TR-ORIG', 'V-ORIG', '2027-01-10', '09:00-12:00', 5, 900, 'available'),
       ('TR-SAMEPROV', 'V-ORIG', '2027-01-10', '12:00-15:00', 5, 700, 'available'),
       ('TR-B', 'V-B', '2027-01-10', '09:00-12:00', 5, 480, 'available'),
       ('TR-C', 'V-C', '2027-01-12', '09:00-12:00', 5, 520, 'limited'),
       ('TR-X', 'V-X', '2027-01-10', '09:00-12:00', 5, 300, 'available'),
       ('TR-S', 'V-S', '2027-01-10', '09:00-12:00', 5, 200, 'sold_out'),
       ('TR-Z', 'V-Z', '2027-01-10', '09:00-12:00', 0, 250, 'available'),
       ('TR-L', 'V-L', '2027-01-10', '09:00-12:00', 1, 260, 'available')`,
    `CREATE TABLE dataset_activities (activity_id VARCHAR(32) PRIMARY KEY, provider VARCHAR(128), activity_name VARCHAR(128), city VARCHAR(64), currency VARCHAR(8))`,
    `CREATE TABLE dataset_activity_inventory (activity_inventory_id VARCHAR(32) PRIMARY KEY, activity_id VARCHAR(32), date DATE, start_time VARCHAR(8), available_slots INT, price_per_person NUMERIC(12,2), status VARCHAR(16))`
  ];
  for (const s of sql) await query(s);
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

const TRIP = [
  { type: 'hotel', resourceId: 'ROOM-1', quantity: 1 },
  { type: 'flight', resourceId: 'FLT-1', quantity: 1 },
  { type: 'transport', resourceId: 'TR-ORIG', quantity: 1 }
];

async function book(key: string, extra: Record<string, unknown> = {}, items = TRIP) {
  return api('POST', '/api/transactions', { customerId: 'res-customer', items, paymentMethod: 'card_mock', ...extra }, { 'Idempotency-Key': key });
}

const transportFails = { failureSimulation: { reserve: { transport: 'Transport provider unavailable' } } };

async function counts() {
  const r = await query<{ tx: number; locks: number; keys: number }>(
    `SELECT (SELECT count(*) FROM booking_transactions)::int AS tx, (SELECT count(*) FROM booking_resource_locks)::int AS locks, (SELECT count(*) FROM idempotency_keys)::int AS keys`
  );
  return r.rows[0];
}

describe('Phase 10 customer resolution', () => {
  test('1. rolled-back transaction offers customer options with real, correctly filtered alternatives', async () => {
    // Exhaust TR-L's single unit with a real completed booking so live capacity accounting excludes it.
    const filler = await book('res-filler', {}, [{ type: 'transport', resourceId: 'TR-L', quantity: 1 }]);
    assert.equal(filler.body.state, 'COMPLETED');

    const failed = await book('res-1', transportFails);
    assert.equal(failed.body.state, 'ROLLED_BACK');

    const before = await counts();
    const res = await api('GET', `/api/transactions/${failed.body.transactionId}/resolution`);
    assert.equal(res.status, 200);
    assert.equal(res.body.mode, 'CUSTOMER_OPTIONS');
    assert.equal(res.body.failedService.type, 'transport');
    assert.equal(res.body.failedService.resourceId, 'TR-ORIG');
    assert.equal(res.body.failedService.error, 'Transport provider unavailable');
    assert.equal(res.body.replacementSupported, true);
    assert.deepEqual(res.body.alternatives.map((a: any) => [a.resourceId, a.provider, a.match, a.unitPrice, a.date]), [
      ['TR-B', 'CityRide', 'SAME_DATE', 480, '2027-01-10'],
      ['TR-C', 'MetroCab', 'NEAREST_DATE', 520, '2027-01-12']
    ]);
    assert.deepEqual(await counts(), before, 'resolution lookup is read-only');
  });

  test('2. completed transactions need no resolution', async () => {
    const ok = await book('res-2');
    const res = await api('GET', `/api/transactions/${ok.body.transactionId}/resolution`);
    assert.equal(res.body.mode, 'NOT_APPLICABLE');
    assert.deepEqual(res.body.alternatives, []);
  });

  test('3. ROLLBACK_FAILED is routed to operator review and cannot be replaced', async () => {
    const failed = await book('res-3', {
      failureSimulation: { reserve: { transport: 'Transport provider unavailable' }, cancel: { flight: 'flight cancellation failure' } }
    });
    assert.equal(failed.body.state, 'ROLLBACK_FAILED');
    const res = await api('GET', `/api/transactions/${failed.body.transactionId}/resolution`);
    assert.equal(res.body.mode, 'OPERATOR_REVIEW');
    assert.deepEqual(res.body.alternatives, []);
    assert.equal(res.body.replacementSupported, false);

    const rep = await api('POST', `/api/transactions/${failed.body.transactionId}/replacement`, { alternativeResourceId: 'TR-B' }, { 'Idempotency-Key': 'rep-3' });
    assert.equal(rep.status, 409);
    assert.equal(rep.body.error, 'REPLACEMENT_NOT_ELIGIBLE');
  });

  test('4. payment-authorization failure offers options but no alternatives (no service failed)', async () => {
    const failed = await book('res-4', { paymentFailureSimulation: { authorize: 'declined' } });
    assert.equal(failed.body.state, 'ROLLED_BACK');
    const res = await api('GET', `/api/transactions/${failed.body.transactionId}/resolution`);
    assert.equal(res.body.mode, 'CUSTOMER_OPTIONS');
    assert.equal(res.body.failedService, null);
    assert.deepEqual(res.body.alternatives, []);
    assert.equal(res.body.replacementSupported, false);
  });

  test('5. replacement booking runs the normal saga with the swapped item and is idempotent', async () => {
    const failed = await book('res-5', transportFails);
    const before = await counts();

    const rep = await api('POST', `/api/transactions/${failed.body.transactionId}/replacement`, { alternativeResourceId: 'TR-B' }, { 'Idempotency-Key': 'rep-5' });
    assert.equal(rep.status, 201);
    assert.equal(rep.body.state, 'COMPLETED');
    assert.equal(rep.body.replacementFor, failed.body.transactionId);
    assert.notEqual(rep.body.transactionId, failed.body.transactionId);
    assert.deepEqual(rep.body.items.map((i: any) => [i.type, i.resourceId]), [['hotel', 'ROOM-1'], ['flight', 'FLT-1'], ['transport', 'TR-B']]);
    assert.ok(rep.body.riskAssessment, 'risk assessment ran for the replacement');

    const details = await api('GET', `/api/transactions/${rep.body.transactionId}`);
    assert.deepEqual(details.body.locks.map((l: any) => l.status), ['CONFIRMED', 'CONFIRMED', 'CONFIRMED']);
    assert.ok(details.body.events.some((e: any) => e.detail?.event === 'PAYMENT_CAPTURED'));

    const replay = await api('POST', `/api/transactions/${failed.body.transactionId}/replacement`, { alternativeResourceId: 'TR-B' }, { 'Idempotency-Key': 'rep-5' });
    assert.equal(replay.body.transactionId, rep.body.transactionId, 'duplicate click replays the stored response');
    const after = await counts();
    assert.equal(after.tx, before.tx + 1, 'exactly one new transaction');

    // The original rolled-back transaction is untouched.
    const original = await api('GET', `/api/transactions/${failed.body.transactionId}`);
    assert.equal(original.body.state, 'ROLLED_BACK');
  });

  test('6. replacement rejects unavailable or non-listed alternatives and missing keys', async () => {
    const failed = await book('res-6', transportFails);
    const id = failed.body.transactionId;
    for (const alt of ['TR-X', 'TR-S', 'TR-Z', 'TR-SAMEPROV', 'NOPE']) {
      const r = await api('POST', `/api/transactions/${id}/replacement`, { alternativeResourceId: alt }, { 'Idempotency-Key': `rep-6-${alt}` });
      assert.equal(r.status, 409, alt);
      assert.equal(r.body.error, 'ALTERNATIVE_NOT_AVAILABLE', alt);
    }
    const noKey = await api('POST', `/api/transactions/${id}/replacement`, { alternativeResourceId: 'TR-B' });
    assert.equal(noKey.status, 400);
    assert.equal(noKey.body.error, 'MISSING_IDEMPOTENCY_KEY');
    const noAlt = await api('POST', `/api/transactions/${id}/replacement`, {}, { 'Idempotency-Key': 'rep-6-none' });
    assert.equal(noAlt.status, 400);
    assert.equal((await counts()).tx, 1, 'no replacement transaction was created');
  });

  test('7. unknown transaction returns 404', async () => {
    const res = await api('GET', '/api/transactions/does-not-exist/resolution');
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'TRANSACTION_NOT_FOUND');
  });
});

/**
 * Captures real Operations Dashboard API responses as frontend test fixtures.
 *
 * Boots the Fastify app on an isolated in-memory PGlite database (never the configured
 * PostgreSQL), creates a tiny synthetic dataset, runs each demo scenario through
 * POST /api/transactions, and writes the GET responses the dashboard consumes.
 *
 * Usage (from backend/): npx tsx src/scripts/exportDashboardFixtures.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from '../config.js';
import { initDb, query } from '../db/client.js';
import { buildApp } from '../server.js';

// Resolved from the working directory; run this script from backend/.
const outDir = resolve(process.cwd(), '../frontend/src/components/TransactionOps/__fixtures__');

async function main() {
  config.databaseUrl = '';
  await initDb();

  // Same names and prices as earlier fixtures; city/date columns let the Phase 10 resolution endpoint
  // match alternatives. Alternative ids sort after the originals so the demo catalog still picks the originals.
  const statements = [
    `CREATE TABLE dataset_customers (customer_id VARCHAR(32) PRIMARY KEY)`,
    `INSERT INTO dataset_customers VALUES ('fixture-customer')`,
    `CREATE TABLE dataset_flights (flight_id VARCHAR(32) PRIMARY KEY, airline VARCHAR(128), flight_number VARCHAR(16), origin_airport VARCHAR(8), origin_city VARCHAR(64), destination_airport VARCHAR(8), destination_city VARCHAR(64), departure_date DATE, departure_time VARCHAR(8), available_seats INT, price NUMERIC(12,2), currency VARCHAR(8))`,
    `INSERT INTO dataset_flights VALUES ('FL-FIXTURE', 'Fixture Air', 'FX101', 'BLR', 'Bengaluru', 'GOI', 'Goa', '2027-01-10', '06:10', 5, 4200, 'INR')`,
    `CREATE TABLE dataset_hotels (hotel_id VARCHAR(32) PRIMARY KEY, name VARCHAR(255), city VARCHAR(64))`,
    `CREATE TABLE dataset_room_inventory (room_inventory_id VARCHAR(32) PRIMARY KEY, hotel_id VARCHAR(32), room_type VARCHAR(32), check_in DATE, check_out DATE, available_rooms INT, price_per_night NUMERIC(12,2), currency VARCHAR(8), status VARCHAR(16))`,
    `INSERT INTO dataset_hotels VALUES ('HT-FIXTURE', 'Fixture Grand Hotel', 'Goa')`,
    `INSERT INTO dataset_room_inventory VALUES ('RM-FIXTURE', 'HT-FIXTURE', 'Deluxe', '2027-01-10', '2027-01-12', 5, 3500, 'INR', 'available')`,
    `CREATE TABLE dataset_vehicles (vehicle_id VARCHAR(32) PRIMARY KEY, provider VARCHAR(128), vehicle_type VARCHAR(32), city VARCHAR(64), currency VARCHAR(8))`,
    `CREATE TABLE dataset_transport_inventory (transport_inventory_id VARCHAR(32) PRIMARY KEY, vehicle_id VARCHAR(32), date DATE, time_slot VARCHAR(16), available_units INT, price NUMERIC(12,2), status VARCHAR(16))`,
    `INSERT INTO dataset_vehicles VALUES ('VH-FIXTURE', 'Fixture Transit', 'Sedan', 'Goa', 'INR'), ('VHZ-1', 'Fixture CityRide', 'Sedan', 'Goa', 'INR'), ('VHZ-2', 'Fixture MetroCab', 'SUV', 'Goa', 'INR')`,
    `INSERT INTO dataset_transport_inventory VALUES
       ('TR-FIXTURE', 'VH-FIXTURE', '2027-01-10', '09:00-12:00', 5, 900, 'available'),
       ('TRZ-1', 'VHZ-1', '2027-01-10', '09:00-12:00', 4, 450, 'available'),
       ('TRZ-2', 'VHZ-2', '2027-01-11', '10:00-13:00', 2, 520, 'limited')`,
    `CREATE TABLE dataset_activities (activity_id VARCHAR(32) PRIMARY KEY, provider VARCHAR(128), activity_name VARCHAR(128), city VARCHAR(64), currency VARCHAR(8))`,
    `CREATE TABLE dataset_activity_inventory (activity_inventory_id VARCHAR(32) PRIMARY KEY, activity_id VARCHAR(32), date DATE, start_time VARCHAR(8), available_slots INT, price_per_person NUMERIC(12,2), status VARCHAR(16))`
  ];
  for (const sql of statements) await query(sql);

  const app = await buildApp();
  const get = async (url: string) => (await app.inject({ method: 'GET', url })).json();
  mkdirSync(outDir, { recursive: true });
  const write = (name: string, body: unknown) => writeFileSync(join(outDir, `${name}.json`), JSON.stringify(body, null, 2) + '\n');

  write('health', await get('/api/health'));
  const catalog = await get('/api/transactions/demo-scenarios');
  write('demoScenarios', catalog);

  const names: Record<string, string> = {
    SUCCESSFUL_BOOKING: 'completed',
    PROVIDER_FAILURE_ROLLBACK: 'rolledBack',
    PAYMENT_FAILURE: 'paymentFailed',
    ROLLBACK_FAILURE: 'rollbackFailed'
  };
  const ids: Record<string, string> = {};
  for (const scenario of catalog.scenarios) {
    const created = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      payload: scenario.request,
      headers: { 'Idempotency-Key': `fixture-${scenario.id}` }
    });
    const id = created.json().transactionId;
    ids[scenario.id] = id;
    write(names[scenario.id], await get(`/api/transactions/${id}`));
    write(`resolution_${names[scenario.id]}`, await get(`/api/transactions/${id}/resolution`));
  }
  write('list', await get('/api/transactions?limit=20&offset=0'));

  // Phase 10: replacement booking for the rolled-back trip, using the first real alternative.
  const resolution = await get(`/api/transactions/${ids.PROVIDER_FAILURE_ROLLBACK}/resolution`);
  const replacement = await app.inject({
    method: 'POST',
    url: `/api/transactions/${ids.PROVIDER_FAILURE_ROLLBACK}/replacement`,
    payload: { alternativeResourceId: resolution.alternatives[0].resourceId },
    headers: { 'Idempotency-Key': 'fixture-replacement' }
  });
  write('replacement', replacement.json());
  write('replacementDetails', await get(`/api/transactions/${replacement.json().transactionId}`));

  await app.close();
  console.log(`Fixtures written to ${outDir}`);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

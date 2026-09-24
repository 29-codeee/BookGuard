/** Isolated Phase 1-3 tests. The fixture forces an in-memory PGlite connection so project credentials cannot reach the live database. */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.js';
import { initDb, query } from '../db/client.js';
import { createBookingTransaction, getBookingTransaction } from '../transactions/store.js';
import { expireTransactionResourceLocks, reserveTransactionResources } from '../transactions/reservationLocks.js';
import { canTransitionTransaction } from '../transactions/stateMachine.js';
import { getDatasetProviderAdapter } from '../providers/datasetAdapters.js';
import type { ResourceType } from '../transactions/types.js';

before(async () => {
  // Override dotenv-loaded project credentials in-process so tests cannot contact the live Docker database.
  config.databaseUrl = '';
  await initDb();
  await query(`CREATE TABLE dataset_customers (customer_id VARCHAR(32) PRIMARY KEY)`);
  await query(`INSERT INTO dataset_customers VALUES ('test-customer')`);
  await query(`CREATE TABLE dataset_flights (flight_id VARCHAR(32) PRIMARY KEY, available_seats INT, price NUMERIC(12,2), currency VARCHAR(8), airline VARCHAR(128))`);
  await query(`INSERT INTO dataset_flights VALUES ('flight-low', 2, 100.00, 'INR', 'Research Air')`);
  await query(`CREATE TABLE dataset_hotels (hotel_id VARCHAR(32) PRIMARY KEY, name VARCHAR(255))`);
  await query(`CREATE TABLE dataset_room_inventory (room_inventory_id VARCHAR(32) PRIMARY KEY, hotel_id VARCHAR(32), available_rooms INT, price_per_night NUMERIC(12,2), currency VARCHAR(8))`);
  await query(`INSERT INTO dataset_hotels VALUES ('hotel-1','Research Hotel')`);
  await query(`INSERT INTO dataset_room_inventory VALUES ('room-1','hotel-1',2,200.00,'INR')`);
  await query(`CREATE TABLE dataset_vehicles (vehicle_id VARCHAR(32) PRIMARY KEY, provider VARCHAR(128), currency VARCHAR(8))`);
  await query(`CREATE TABLE dataset_transport_inventory (transport_inventory_id VARCHAR(32) PRIMARY KEY, vehicle_id VARCHAR(32), available_units INT, price NUMERIC(12,2))`);
  await query(`INSERT INTO dataset_vehicles VALUES ('vehicle-1','Research Transit','INR')`);
  await query(`INSERT INTO dataset_transport_inventory VALUES ('transport-1','vehicle-1',2,300.00)`);
  await query(`CREATE TABLE dataset_activities (activity_id VARCHAR(32) PRIMARY KEY, provider VARCHAR(128), currency VARCHAR(8))`);
  await query(`CREATE TABLE dataset_activity_inventory (activity_inventory_id VARCHAR(32) PRIMARY KEY, activity_id VARCHAR(32), available_slots INT, price_per_person NUMERIC(12,2))`);
  await query(`INSERT INTO dataset_activities VALUES ('activity-1','Research Tours','INR')`);
  await query(`INSERT INTO dataset_activity_inventory VALUES ('slot-1','activity-1',2,50.00)`);
});

beforeEach(async () => { await query('DELETE FROM booking_transactions'); });

test('transaction state machine permits only declared transitions', () => {
  assert.equal(canTransitionTransaction('PENDING','RESERVING'), true);
  assert.equal(canTransitionTransaction('COMPLETED','ROLLING_BACK'), true);
  assert.equal(canTransitionTransaction('COMPLETED','FAILED'), false);
});

test('resource reservation uses database locks and rejects capacity overcommit', async () => {
  const item = { type: 'flight' as const, resourceId: 'flight-low', quantity: 2 };
  const first = await createBookingTransaction({ customerId: 'test-customer', items: [item] });
  const reserved = await reserveTransactionResources(first.id, [item], 600);
  assert.equal(reserved.amount, 200);
  assert.equal(reserved.items[0].provider, 'Research Air');
  const txRow = await getBookingTransaction(first.id) as any;
  assert.equal(txRow.status, 'RESERVING');
  assert.equal(txRow.items[0].status, 'RESERVED');

  const second = await createBookingTransaction({ customerId: 'test-customer', items: [item] });
  await assert.rejects(() => reserveTransactionResources(second.id, [item]), /Insufficient availability/);
});

test('expired locks are released and transaction marked failed', async () => {
  const item = { type: 'flight' as const, resourceId: 'flight-low', quantity: 1 };
  const tx = await createBookingTransaction({ customerId: 'test-customer', items: [item] });
  await reserveTransactionResources(tx.id, [item], 600);
  await query(`UPDATE booking_resource_locks SET expires_at=CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE transaction_id=$1`, [tx.id]);
  assert.equal(await expireTransactionResourceLocks(), 1);
  assert.equal((await getBookingTransaction(tx.id) as any).status, 'FAILED');
});

test('all resource types resolve to the reusable mock provider contract', async () => {
  for (const type of ['hotel','flight','transport','activity'] as ResourceType[]) {
    const adapter = getDatasetProviderAdapter(type);
    const item = { id: `${type}-item`, type, resourceId: `${type}-resource`, quantity: 1 };
    const context = { provider: 'Research Provider', unitPrice: 10, currency: 'INR' };
    const reservation = await adapter.reserve(item, context);
    assert.equal(reservation.status, 'RESERVED');
    assert.equal((await adapter.confirm(item, context, reservation.reference)).status, 'CONFIRMED');
    assert.equal((await adapter.cancel(item, context, reservation.reference)).status, 'CANCELLED');
  }
});

test('hotel, transport, and activity inventory locks resolve seeded provider metadata', async () => {
  const cases = [
    {type:'hotel' as const, resourceId:'room-1', quantity:1, provider:'Research Hotel', amount:200},
    {type:'transport' as const, resourceId:'transport-1', quantity:1, provider:'Research Transit', amount:300},
    {type:'activity' as const, resourceId:'slot-1', quantity:1, provider:'Research Tours', amount:50}
  ];
  for (const item of cases) {
    const tx = await createBookingTransaction({customerId:'test-customer',items:[item]});
    const reservation = await reserveTransactionResources(tx.id,[item]);
    assert.equal(reservation.items[0].provider,item.provider);
    assert.equal(reservation.amount,item.amount);
  }
});

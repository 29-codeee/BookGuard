import { randomUUID } from 'node:crypto';
import { withTransaction } from '../db/client.js';
import { TransactionEngineError } from './errors.js';
import { type RequestedItem, type ResourceType, type ReservationResult } from './types.js';

type CatalogRow = { capacity: number; unit_price: string | number; currency: string; provider_name: string };
const lookup: Record<ResourceType, string> = {
  flight: `SELECT available_seats AS capacity, price AS unit_price, currency, airline AS provider_name FROM dataset_flights WHERE flight_id=$1 FOR UPDATE`,
  hotel: `SELECT i.available_rooms AS capacity, i.price_per_night AS unit_price, i.currency, h.name AS provider_name FROM dataset_room_inventory i JOIN dataset_hotels h ON h.hotel_id=i.hotel_id WHERE i.room_inventory_id=$1 FOR UPDATE OF i`,
  transport: `SELECT i.available_units AS capacity, i.price AS unit_price, v.currency, v.provider AS provider_name FROM dataset_transport_inventory i JOIN dataset_vehicles v ON v.vehicle_id=i.vehicle_id WHERE i.transport_inventory_id=$1 FOR UPDATE OF i`,
  activity: `SELECT i.available_slots AS capacity, i.price_per_person AS unit_price, a.currency, a.provider AS provider_name FROM dataset_activity_inventory i JOIN dataset_activities a ON a.activity_id=i.activity_id WHERE i.activity_inventory_id=$1 FOR UPDATE OF i`
};

/** Locks each source inventory row, then accounts for live locks without mutating seeded research data. */
export async function reserveTransactionResources(transactionId: string, items: RequestedItem[], ttlSeconds = 600): Promise<ReservationResult> {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 3600) throw new TransactionEngineError('Reservation expiry must be 1 to 3600 seconds', 'INVALID_TTL');
  return withTransaction(async tx => {
    const transaction = await tx.query<{status:string}>('SELECT status FROM booking_transactions WHERE id=$1 FOR UPDATE', [transactionId]);
    if (transaction.rows[0]?.status !== 'PENDING') throw new TransactionEngineError('Transaction must be PENDING before reserving resources', 'INVALID_TRANSACTION_STATE', 409);
    const stored = await tx.query<{id:string;resource_type:ResourceType;resource_id:string;quantity:number}>('SELECT id,resource_type,resource_id,quantity FROM booking_transaction_items WHERE transaction_id=$1 ORDER BY position FOR UPDATE', [transactionId]);
    if (!stored.rowCount || stored.rowCount !== items.length) throw new TransactionEngineError('Item list does not match the transaction', 'ITEM_MISMATCH', 409);
    const ordered = stored.rows.map((row, i) => ({...row, requested:items[i]}));
    for (const row of ordered) if (row.resource_type !== row.requested.type || row.resource_id !== row.requested.resourceId || row.quantity !== row.requested.quantity) throw new TransactionEngineError('Item list does not match the transaction', 'ITEM_MISMATCH', 409);
    // Fixed sort order limits deadlock risk when transactions share multiple resources.
    ordered.sort((a,b) => `${a.resource_type}:${a.resource_id}`.localeCompare(`${b.resource_type}:${b.resource_id}`));
    const resultItems: ReservationResult['items'] = [];
    let total = 0;
    let currency: string | null = null;
    const expiryResult = await tx.query<{expires_at: Date}>("SELECT CURRENT_TIMESTAMP + ($1 * INTERVAL '1 second') AS expires_at", [ttlSeconds]);
    const expires = new Date(expiryResult.rows[0].expires_at);
    for (const item of ordered) {
      const source = await tx.query<CatalogRow>(lookup[item.resource_type], [item.resource_id]);
      const row = source.rows[0];
      if (!row) throw new TransactionEngineError(`Resource ${item.resource_id} was not found`, 'RESOURCE_NOT_FOUND', 404);
      const active = await tx.query<{quantity:number}>("SELECT COALESCE(SUM(quantity),0)::int AS quantity FROM booking_resource_locks WHERE resource_type=$1 AND resource_id=$2 AND (status='CONFIRMED' OR (status='ACTIVE' AND expires_at>CURRENT_TIMESTAMP))", [item.resource_type,item.resource_id]);
      const available = Number(row.capacity) - Number(active.rows[0]?.quantity ?? 0);
      if (available < item.quantity) throw new TransactionEngineError(`Insufficient availability for ${item.resource_id}`, 'INSUFFICIENT_AVAILABILITY', 409);
      const itemCurrency = row.currency || 'INR';
      if (currency && currency !== itemCurrency) throw new TransactionEngineError('Items with different currencies cannot share one transaction total', 'MIXED_CURRENCY');
      currency = itemCurrency;
      const lockId = randomUUID();
      const unitPrice = Number(row.unit_price);
      total += unitPrice * item.quantity;
      await tx.query(`INSERT INTO booking_resource_locks (id,transaction_id,item_id,resource_type,resource_id,quantity,status,expires_at) VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7)`, [lockId,transactionId,item.id,item.resource_type,item.resource_id,item.quantity,expires]);
      await tx.query(`UPDATE booking_transaction_items SET status='RESERVED',provider_name=$2,unit_price=$3,currency=$4 WHERE id=$1`, [item.id,row.provider_name,unitPrice,currency]);
      await tx.query(`INSERT INTO booking_transaction_providers (id,transaction_id,item_id,provider_name,status) VALUES ($1,$2,$3,$4,'PENDING')`, [randomUUID(),transactionId,item.id,row.provider_name]);
      await tx.query(`INSERT INTO booking_transaction_events (transaction_id,item_id,to_state,detail) VALUES ($1,$2,'LOCK_ACQUIRED',$3::jsonb)`, [transactionId,item.id,JSON.stringify({resourceType:item.resource_type,quantity:item.quantity,expiresAt:expires.toISOString()})]);
      resultItems.push({itemId:item.id,type:item.resource_type,resourceId:item.resource_id,provider:row.provider_name,unitPrice});
    }
    const from = transaction.rows[0].status;
    await tx.query(`UPDATE booking_transactions SET status='RESERVING',total_amount=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [transactionId,total]);
    await tx.query(`INSERT INTO booking_transaction_events (transaction_id,from_state,to_state,detail) VALUES ($1,$2,'RESERVING',$3::jsonb)`, [transactionId,from,JSON.stringify({expiresInSeconds:ttlSeconds})]);
    return {transactionId,expiresAt:expires,amount:total,currency:currency ?? 'INR',items:resultItems};
  });
}

/** Expires stale locks atomically; callers may run this from a scheduler in a later phase. */
export async function expireTransactionResourceLocks(): Promise<number> {
  return withTransaction(async tx => {
    const expired = await tx.query<{transaction_id:string;item_id:string}>("UPDATE booking_resource_locks SET status='EXPIRED' WHERE status='ACTIVE' AND expires_at<=CURRENT_TIMESTAMP RETURNING transaction_id,item_id");
    for (const lock of expired.rows) {
      await tx.query(`UPDATE booking_transaction_items SET status='EXPIRED' WHERE id=$1 AND status='RESERVED'`, [lock.item_id]);
      const state = await tx.query<{status:string}>('SELECT status FROM booking_transactions WHERE id=$1 FOR UPDATE', [lock.transaction_id]);
      if (state.rows[0]?.status === 'RESERVING') {
        await tx.query(`UPDATE booking_transactions SET status='FAILED',updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [lock.transaction_id]);
        await tx.query(`INSERT INTO booking_transaction_events (transaction_id,item_id,from_state,to_state,detail) VALUES ($1,$2,'RESERVING','FAILED','{"reason":"reservation_expired"}'::jsonb)`, [lock.transaction_id,lock.item_id]);
      }
    }
    return expired.rowCount;
  });
}

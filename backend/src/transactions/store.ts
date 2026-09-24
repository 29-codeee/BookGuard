import { randomUUID } from 'node:crypto';
import { query, withTransaction } from '../db/client.js';
import { TransactionEngineError } from './errors.js';
import { canTransitionTransaction, type TransactionState } from './stateMachine.js';
import type { CreateTransactionInput, RequestedItem } from './types.js';

const validType = (type: string): type is RequestedItem['type'] => ['hotel','flight','transport','activity'].includes(type);

export async function createBookingTransaction(input: CreateTransactionInput): Promise<{ id: string; status: TransactionState; itemIds: string[] }> {
  if (!input.customerId || !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 20) throw new TransactionEngineError('Provide a customer and 1 to 20 items', 'INVALID_REQUEST');
  for (const item of input.items) {
    if (!validType(item.type) || !item.resourceId || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 50) throw new TransactionEngineError('Each item needs a supported type, resourceId, and quantity from 1 to 50', 'INVALID_ITEM');
  }
  const transactionId = randomUUID();
  const itemIds = input.items.map(() => randomUUID());
  return withTransaction(async tx => {
    const customer = await tx.query('SELECT customer_id FROM dataset_customers WHERE customer_id = $1', [input.customerId]);
    if (!customer.rowCount) throw new TransactionEngineError('Research customer was not found', 'CUSTOMER_NOT_FOUND', 404);
    await tx.query(`INSERT INTO booking_transactions (id, customer_id, status) VALUES ($1,$2,'PENDING')`, [transactionId, input.customerId]);
    for (let i = 0; i < input.items.length; i++) {
      const item = input.items[i];
      await tx.query(`INSERT INTO booking_transaction_items (id,transaction_id,position,resource_type,resource_id,quantity,status) VALUES ($1,$2,$3,$4,$5,$6,'PENDING')`, [itemIds[i],transactionId,i,item.type,item.resourceId,item.quantity]);
    }
    await tx.query(`INSERT INTO booking_transaction_events (transaction_id,to_state,detail) VALUES ($1,'PENDING',$2::jsonb)`, [transactionId, JSON.stringify({ event: 'TRANSACTION_CREATED', itemCount: input.items.length })]);
    return { id: transactionId, status: 'PENDING' as const, itemIds };
  });
}

export async function transitionBookingTransaction(id: string, to: TransactionState, detail: Record<string, unknown> = {}): Promise<void> {
  await withTransaction(async tx => {
    const result = await tx.query<{status: TransactionState}>('SELECT status FROM booking_transactions WHERE id = $1 FOR UPDATE', [id]);
    const from = result.rows[0]?.status;
    if (!from) throw new TransactionEngineError('Transaction was not found', 'TRANSACTION_NOT_FOUND', 404);
    if (!canTransitionTransaction(from, to)) throw new TransactionEngineError(`Invalid transaction transition ${from} -> ${to}`, 'INVALID_TRANSITION', 409);
    await tx.query('UPDATE booking_transactions SET status=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1', [id,to]);
    await tx.query('INSERT INTO booking_transaction_events (transaction_id,from_state,to_state,detail) VALUES ($1,$2,$3,$4::jsonb)', [id,from,to,JSON.stringify(detail)]);
  });
}

export async function getBookingTransaction(id: string) {
  const result = await query("SELECT t.id,t.customer_id,t.status,t.currency,t.total_amount,t.created_at,t.updated_at, COALESCE(json_agg(json_build_object('id',i.id,'type',i.resource_type,'resourceId',i.resource_id,'quantity',i.quantity,'status',i.status,'provider',i.provider_name,'unitPrice',i.unit_price) ORDER BY i.position) FILTER (WHERE i.id IS NOT NULL), '[]') AS items FROM booking_transactions t LEFT JOIN booking_transaction_items i ON i.transaction_id=t.id WHERE t.id=$1 GROUP BY t.id", [id]);
  if (!result.rowCount) throw new TransactionEngineError('Transaction was not found', 'TRANSACTION_NOT_FOUND', 404);
  return result.rows[0];
}

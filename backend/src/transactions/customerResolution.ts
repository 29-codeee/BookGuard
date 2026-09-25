/**
 * Customer resolution for rolled-back transactions (Phase 10 demo layer).
 *
 * Read-only. Determines whether a transaction is safe to offer "find an alternative" / "refund"
 * options, identifies the service that failed, and looks up real alternatives in the research
 * dataset. It never books, cancels, refunds or releases anything; a chosen alternative is booked
 * as a brand-new transaction through the normal idempotent Saga route.
 */
import { query } from '../db/client.js';
import { TransactionEngineError } from './errors.js';
import type { ResourceType } from './types.js';

export type ResolutionMode = 'CUSTOMER_OPTIONS' | 'OPERATOR_REVIEW' | 'NOT_APPLICABLE';
export type AlternativeMatch = 'SAME_DATE' | 'NEAREST_DATE';

export interface ResolutionAlternative {
  type: ResourceType;
  resourceId: string;
  provider: string;
  description: string;
  location: string;
  date: string | null;
  endDate: string | null;
  time: string | null;
  unitPrice: number;
  currency: string;
  available: number;
  match: AlternativeMatch;
}

export interface FailedService {
  itemId: string;
  type: ResourceType;
  resourceId: string;
  provider: string | null;
  quantity: number;
  operation: string;
  error: string | null;
}

export interface CustomerResolution {
  transactionId: string;
  state: string;
  mode: ResolutionMode;
  reason: string;
  failedService: FailedService | null;
  /** How alternatives were matched, in words, so the UI never implies a closer match than exists. */
  matchCriteria: string | null;
  alternatives: ResolutionAlternative[];
  alternativesSupported: boolean;
  replacementSupported: boolean;
}

const MAX_ALTERNATIVES = 5;

// Capacity accounting mirrors reserveTransactionResources: CONFIRMED and unexpired ACTIVE locks consume capacity.
const lockedQuantity = (type: ResourceType, idColumn: string) => `COALESCE((
  SELECT SUM(l.quantity) FROM booking_resource_locks l
   WHERE l.resource_type='${type}' AND l.resource_id=${idColumn}
     AND (l.status='CONFIRMED' OR (l.status='ACTIVE' AND l.expires_at>CURRENT_TIMESTAMP))
), 0)`;

interface AlternativeQuery {
  sql: string;
  criteria: string;
}

// Each query: same place (city / route) as the failed resource, a different provider, not sold out,
// same currency, enough live capacity; exact date first, then nearest dates, then price.
const ALTERNATIVE_QUERIES: Record<ResourceType, AlternativeQuery> = {
  transport: {
    criteria: 'Other transport providers in the same city; same date first, then the nearest available dates.',
    sql: `WITH o AS (
            SELECT v.city, i.date, v.provider FROM dataset_transport_inventory i JOIN dataset_vehicles v ON v.vehicle_id = i.vehicle_id
             WHERE i.transport_inventory_id = $1)
          SELECT * FROM (
            SELECT i.transport_inventory_id AS resource_id, v.provider, v.vehicle_type AS description, v.city AS location,
                   i.date::text AS date, NULL::text AS end_date, i.time_slot AS time, i.price AS unit_price, v.currency,
                   i.available_units - ${lockedQuantity('transport', 'i.transport_inventory_id')} AS available,
                   (i.date = o.date) AS same_date, ABS(i.date - o.date) AS distance
              FROM dataset_transport_inventory i JOIN dataset_vehicles v ON v.vehicle_id = i.vehicle_id, o
             WHERE v.city = o.city AND i.transport_inventory_id <> $1 AND LOWER(v.provider) <> LOWER(o.provider)
               AND COALESCE(i.status, '') <> 'sold_out' AND v.currency = $2) x
          WHERE available >= $3 ORDER BY same_date DESC, distance ASC, unit_price ASC, resource_id ASC LIMIT ${MAX_ALTERNATIVES}`
  },
  flight: {
    criteria: 'Other airlines on the same route; same departure date first, then the nearest available dates.',
    sql: `WITH o AS (SELECT origin_airport, destination_airport, departure_date, airline FROM dataset_flights WHERE flight_id = $1)
          SELECT * FROM (
            SELECT f.flight_id AS resource_id, f.airline AS provider, f.flight_number AS description,
                   f.origin_city || ' → ' || f.destination_city AS location,
                   f.departure_date::text AS date, NULL::text AS end_date, f.departure_time AS time, f.price AS unit_price, f.currency,
                   f.available_seats - ${lockedQuantity('flight', 'f.flight_id')} AS available,
                   (f.departure_date = o.departure_date) AS same_date, ABS(f.departure_date - o.departure_date) AS distance
              FROM dataset_flights f, o
             WHERE f.origin_airport = o.origin_airport AND f.destination_airport = o.destination_airport
               AND f.flight_id <> $1 AND LOWER(f.airline) <> LOWER(o.airline) AND f.currency = $2) x
          WHERE available >= $3 ORDER BY same_date DESC, distance ASC, unit_price ASC, resource_id ASC LIMIT ${MAX_ALTERNATIVES}`
  },
  hotel: {
    criteria: 'Other hotels in the same city; same check-in date first, then the nearest available dates.',
    sql: `WITH o AS (
            SELECT h.city, i.check_in, h.name FROM dataset_room_inventory i JOIN dataset_hotels h ON h.hotel_id = i.hotel_id
             WHERE i.room_inventory_id = $1)
          SELECT * FROM (
            SELECT i.room_inventory_id AS resource_id, h.name AS provider, i.room_type AS description, h.city AS location,
                   i.check_in::text AS date, i.check_out::text AS end_date, NULL::text AS time, i.price_per_night AS unit_price, i.currency,
                   i.available_rooms - ${lockedQuantity('hotel', 'i.room_inventory_id')} AS available,
                   (i.check_in = o.check_in) AS same_date, ABS(i.check_in - o.check_in) AS distance
              FROM dataset_room_inventory i JOIN dataset_hotels h ON h.hotel_id = i.hotel_id, o
             WHERE h.city = o.city AND i.room_inventory_id <> $1 AND LOWER(h.name) <> LOWER(o.name)
               AND COALESCE(i.status, '') <> 'sold_out' AND i.currency = $2) x
          WHERE available >= $3 ORDER BY same_date DESC, distance ASC, unit_price ASC, resource_id ASC LIMIT ${MAX_ALTERNATIVES}`
  },
  activity: {
    criteria: 'Other activity providers in the same city; same date first, then the nearest available dates.',
    sql: `WITH o AS (
            SELECT a.city, i.date, a.provider FROM dataset_activity_inventory i JOIN dataset_activities a ON a.activity_id = i.activity_id
             WHERE i.activity_inventory_id = $1)
          SELECT * FROM (
            SELECT i.activity_inventory_id AS resource_id, a.provider, a.activity_name AS description, a.city AS location,
                   i.date::text AS date, NULL::text AS end_date, i.start_time AS time, i.price_per_person AS unit_price, a.currency,
                   i.available_slots - ${lockedQuantity('activity', 'i.activity_inventory_id')} AS available,
                   (i.date = o.date) AS same_date, ABS(i.date - o.date) AS distance
              FROM dataset_activity_inventory i JOIN dataset_activities a ON a.activity_id = i.activity_id, o
             WHERE a.city = o.city AND i.activity_inventory_id <> $1 AND LOWER(a.provider) <> LOWER(o.provider)
               AND COALESCE(i.status, '') <> 'sold_out' AND a.currency = $2) x
          WHERE available >= $3 ORDER BY same_date DESC, distance ASC, unit_price ASC, resource_id ASC LIMIT ${MAX_ALTERNATIVES}`
  }
};

interface ItemRow {
  id: string;
  position: number;
  resource_type: ResourceType;
  resource_id: string;
  quantity: number;
  status: string;
  provider_name: string | null;
}

interface ResolutionContext {
  transaction: { id: string; status: string; customer_id: string; currency: string };
  items: ItemRow[];
  resolution: CustomerResolution;
}

async function loadResolution(transactionId: string): Promise<ResolutionContext> {
  const tx = await query<{ id: string; status: string; customer_id: string; currency: string }>(
    'SELECT id, status, customer_id, currency FROM booking_transactions WHERE id = $1',
    [transactionId]
  );
  if (!tx.rows[0]) throw new TransactionEngineError('Transaction was not found', 'TRANSACTION_NOT_FOUND', 404);
  const transaction = tx.rows[0];

  const items = (await query<ItemRow>(
    'SELECT id, position, resource_type, resource_id, quantity, status, provider_name FROM booking_transaction_items WHERE transaction_id = $1 ORDER BY position',
    [transactionId]
  )).rows;
  const confirmedLocks = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM booking_resource_locks WHERE transaction_id = $1 AND status = 'CONFIRMED'`,
    [transactionId]
  );

  const base = { transactionId, state: transaction.status, failedService: null, matchCriteria: null, alternatives: [], alternativesSupported: false, replacementSupported: false };

  if (transaction.status === 'ROLLBACK_FAILED') {
    return { transaction, items, resolution: { ...base, mode: 'OPERATOR_REVIEW', reason: 'Compensation could not be verified; affected resources remain protected until an operator resolves the incident.' } };
  }
  if (transaction.status !== 'ROLLED_BACK' && transaction.status !== 'FAILED') {
    return { transaction, items, resolution: { ...base, mode: 'NOT_APPLICABLE', reason: `No customer resolution is needed for state ${transaction.status}.` } };
  }
  // Defensive: a rolled-back transaction must not still hold capacity before we offer options.
  if (confirmedLocks.rows[0].n > 0) {
    return { transaction, items, resolution: { ...base, mode: 'OPERATOR_REVIEW', reason: 'Resources are still held; the rollback is not verified as safe.' } };
  }

  // The service that caused the failure: the provider row whose forward operation (reserve/confirm) failed.
  const failedOp = await query<{ item_id: string; provider_name: string; operation_type: string; error_message: string | null }>(
    `SELECT item_id, provider_name, operation_type, error_message FROM booking_transaction_providers
      WHERE transaction_id = $1 AND status = 'FAILED' AND operation_type IN ('RESERVE', 'CONFIRM') ORDER BY item_id LIMIT 1`,
    [transactionId]
  );
  const row = failedOp.rows[0];
  const item = row ? items.find(i => i.id === row.item_id) : undefined;
  const failedService: FailedService | null = row && item
    ? { itemId: item.id, type: item.resource_type, resourceId: item.resource_id, provider: row.provider_name, quantity: item.quantity, operation: row.operation_type, error: row.error_message }
    : null;

  const resolution: CustomerResolution = {
    ...base,
    mode: 'CUSTOMER_OPTIONS',
    reason: failedService
      ? `The ${failedService.type} service could not be booked; the rest of the trip was rolled back.`
      : transaction.status === 'FAILED'
        ? 'The requested services could not be reserved.'
        : 'The booking was rolled back before any service failed (for example, the payment was not authorized).',
    failedService
  };

  if (failedService) {
    const spec = ALTERNATIVE_QUERIES[failedService.type];
    try {
      const alts = await query<any>(spec.sql, [failedService.resourceId, transaction.currency, failedService.quantity]);
      resolution.alternatives = alts.rows.map(a => ({
        type: failedService.type,
        resourceId: a.resource_id,
        provider: a.provider,
        description: a.description ?? '',
        location: a.location ?? '',
        date: a.date ?? null,
        endDate: a.end_date ?? null,
        time: a.time ?? null,
        unitPrice: Number(a.unit_price),
        currency: a.currency,
        available: Number(a.available),
        match: a.same_date ? 'SAME_DATE' : 'NEAREST_DATE'
      }));
      resolution.matchCriteria = spec.criteria;
      resolution.alternativesSupported = true;
      resolution.replacementSupported = true;
    } catch {
      // The dataset lacks the attributes needed to match alternatives (e.g. a minimal test schema).
      resolution.matchCriteria = 'Alternative lookup is not supported by the current dataset schema.';
    }
  }
  return { transaction, items, resolution };
}

export async function getCustomerResolution(transactionId: string): Promise<CustomerResolution> {
  return (await loadResolution(transactionId)).resolution;
}

/**
 * Builds the request for a replacement booking: the original items with the failed one swapped for
 * the chosen alternative. The alternative is re-validated against the live alternatives list, so a
 * client cannot substitute an arbitrary or unavailable resource. The caller submits the result
 * through the normal idempotent transaction route.
 */
export async function buildReplacementRequest(transactionId: string, alternativeResourceId: string) {
  const { transaction, items, resolution } = await loadResolution(transactionId);
  if (resolution.mode !== 'CUSTOMER_OPTIONS' || !resolution.failedService || !resolution.replacementSupported) {
    throw new TransactionEngineError('This transaction is not eligible for a replacement booking', 'REPLACEMENT_NOT_ELIGIBLE', 409);
  }
  const chosen = resolution.alternatives.find(a => a.resourceId === alternativeResourceId);
  if (!chosen) {
    throw new TransactionEngineError('The selected alternative is not currently available for this transaction', 'ALTERNATIVE_NOT_AVAILABLE', 409);
  }
  const failed = resolution.failedService;
  return {
    alternative: chosen,
    request: {
      customerId: transaction.customer_id,
      items: items.map(i => ({
        type: i.resource_type,
        resourceId: i.id === failed.itemId ? chosen.resourceId : i.resource_id,
        quantity: i.quantity
      })),
      paymentMethod: 'card_mock'
    }
  };
}

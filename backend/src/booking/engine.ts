/**
 * BookGuard Core Booking Engine
 *
 * Single source of truth for every inventory-moving operation:
 *   hold      AVAILABLE -> HELD
 *   confirm   HELD      -> CONFIRMED            (via provider; may go RECONCILING / FAILED)
 *   expire    HELD      -> EXPIRED              (TTL elapsed; seats back to available)
 *   release   HELD      -> RELEASED             (traveller abandons before payment)
 *   cancel    CONFIRMED -> CANCELLED            (seats back to available)
 *
 * Correctness rules:
 *  - PostgreSQL is authoritative. The CHECK constraint on `inventory` enforces
 *    available + held + confirmed = total and non-negative counts; Redis is only a TTL trigger.
 *  - Every mutation runs in one transaction and locks rows in a fixed order
 *    (booking -> hold -> inventory) to avoid deadlocks.
 *  - Every inventory UPDATE is guarded (`WHERE held_quantity >= q ...`) and every
 *    hold/booking transition checks its source state, so a lost race is detected, never applied twice.
 *  - Confirm calls an external provider outside the DB transaction. A per-booking claim
 *    (`bookings.confirm_token`) guarantees only one provider call per booking at a time,
 *    and the sweeper will not expire a hold whose confirm is in flight.
 *  - Side effects (SSE broadcasts, Redis keys, provider cancels) run only after COMMIT.
 */
import crypto from 'crypto';
import { withTransaction, query, TransactionClient } from '../db/client.js';
import { getRedis } from '../redis/client.js';
import { eventHub, TraceEvent } from '../sse/eventHub.js';
import { config } from '../config.js';
import { providerAdapter } from '../providers/adapter.js';
import { ALLOWED_TRANSITIONS, BookingState, canTransition } from '../state/stateMachine.js';
import { BookingError } from './errors.js';

export const MAX_QUANTITY_PER_HOLD = 6;
export const MIN_HOLD_TTL_SECONDS = 1;
export const MAX_HOLD_TTL_SECONDS = 3600;
/** A confirm claim older than this is considered abandoned (process crash mid-provider-call). */
export const CONFIRM_CLAIM_TIMEOUT_SECONDS = 60;

export type BookingMode = 'NORMAL' | 'TATKAL' | 'HIGH_DEMAND';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type AfterCommit = () => Promise<void> | void;

interface TxContext {
  tx: TransactionClient;
  afterCommit: AfterCommit[];
}

async function runTx<T>(fn: (ctx: TxContext) => Promise<T>): Promise<T> {
  const afterCommit: AfterCommit[] = [];
  const result = await withTransaction(tx => fn({ tx, afterCommit }));
  for (const effect of afterCommit) {
    try {
      await effect();
    } catch (err) {
      console.error('[BookingEngine] Post-commit side effect failed:', err);
    }
  }
  return result;
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
}

function newTraceId(): string {
  return `trc_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

/** Emits an Ops trace step (live SSE + persisted to ops_trace_events). No-op without a traceId. */
function trace(
  traceId: string | undefined,
  type: TraceEvent['type'],
  stage: string,
  message: string,
  status: TraceEvent['status'],
  extra: Pick<TraceEvent, 'bookingId' | 'holdId' | 'resourceId' | 'data'> = {}
): void {
  if (!traceId) return;
  eventHub.emitTrace({ traceId, type, stage, message, status, ...extra });
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

interface LockedBooking {
  id: string;
  traveller_id: string;
  status: BookingState;
  total_amount: string | number;
  booking_mode: string;
  confirm_token: string | null;
  claim_live: boolean;
}

async function lockBooking(tx: TransactionClient, bookingId: string): Promise<LockedBooking> {
  const res = await tx.query<LockedBooking>(
    `SELECT id, traveller_id, status, total_amount, booking_mode, confirm_token,
            (confirm_token IS NOT NULL
             AND confirm_started_at > CURRENT_TIMESTAMP - make_interval(secs => $2)) AS claim_live
     FROM bookings WHERE id = $1 FOR UPDATE`,
    [bookingId, CONFIRM_CLAIM_TIMEOUT_SECONDS]
  );
  if (res.rows.length === 0) {
    throw new BookingError('BOOKING_NOT_FOUND', 404, `Booking ${bookingId} not found`);
  }
  return res.rows[0];
}

interface BookingItemInfo {
  item_id: string;
  inventory_id: string;
  code: string;
  name: string;
  resource_type: string;
  origin: string;
  destination: string;
}

async function primaryItem(tx: TransactionClient, bookingId: string): Promise<BookingItemInfo | null> {
  const res = await tx.query<BookingItemInfo>(
    `SELECT bi.id AS item_id, bi.inventory_id, i.code, i.name, i.resource_type, i.origin, i.destination
     FROM booking_items bi JOIN inventory i ON i.id = bi.inventory_id
     WHERE bi.booking_id = $1
     ORDER BY bi.created_at ASC, bi.id ASC LIMIT 1`,
    [bookingId]
  );
  return res.rows[0] ?? null;
}

interface LockedHold {
  id: string;
  inventory_id: string;
  quantity: number;
  status: string;
  expires_at: string | Date;
  is_expired: boolean;
}

async function lockHold(tx: TransactionClient, where: string, param: string): Promise<LockedHold | null> {
  const res = await tx.query<LockedHold>(
    `SELECT id, inventory_id, quantity, status, expires_at,
            expires_at <= CURRENT_TIMESTAMP AS is_expired
     FROM holds WHERE ${where}
     ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
    [param]
  );
  return res.rows[0] ?? null;
}

/** Validated booking state change + immutable audit event, inside the caller's transaction. */
async function transition(
  ctx: TxContext,
  bookingId: string,
  from: BookingState,
  to: BookingState,
  reason: string,
  operator: string,
  evidence?: unknown
): Promise<void> {
  if (!canTransition(from, to)) {
    throw new BookingError('INVALID_TRANSITION', 409, `Cannot move booking from ${from} to ${to}`, {
      currentStatus: from
    });
  }
  const updated = await ctx.tx.query(
    `UPDATE bookings SET status = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND status = $3 RETURNING id`,
    [to, bookingId, from]
  );
  if (updated.rows.length !== 1) {
    throw new BookingError('CONCURRENT_MODIFICATION', 409, `Booking ${bookingId} changed concurrently`);
  }
  const eventId = newId('evt');
  await ctx.tx.query(
    `INSERT INTO booking_events (id, booking_id, from_state, to_state, reason, evidence, operator)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [eventId, bookingId, from, to, reason, evidence ? JSON.stringify(evidence) : null, operator]
  );
  ctx.afterCommit.push(() =>
    eventHub.broadcast('booking_state_changed', {
      eventId,
      bookingId,
      fromState: from,
      toState: to,
      reason,
      operator,
      timestamp: new Date().toISOString()
    })
  );
}

/**
 * Guarded inventory move. `from`/`to` are bucket names. Fails loudly (and rolls back)
 * if the source bucket does not hold enough units, instead of letting counts drift.
 */
type Bucket = 'available' | 'held' | 'confirmed';

async function moveInventory(
  ctx: TxContext,
  inventoryId: string,
  from: Bucket,
  to: Bucket,
  quantity: number
): Promise<{ available: number; held: number; confirmed: number; total: number }> {
  const res = await ctx.tx.query<{
    available_quantity: number;
    held_quantity: number;
    confirmed_quantity: number;
    total_quantity: number;
  }>(
    `UPDATE inventory
     SET ${from}_quantity = ${from}_quantity - $1,
         ${to}_quantity = ${to}_quantity + $1,
         version = version + 1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND ${from}_quantity >= $1
     RETURNING available_quantity, held_quantity, confirmed_quantity, total_quantity`,
    [quantity, inventoryId]
  );
  if (res.rows.length !== 1) {
    throw new BookingError(
      from === 'available' ? 'INSUFFICIENT_INVENTORY' : 'INVENTORY_GUARD_FAILED',
      from === 'available' ? 409 : 500,
      from === 'available'
        ? 'Not enough available units'
        : `Inventory ${inventoryId} has fewer than ${quantity} ${from} units; refusing to move`
    );
  }
  const r = res.rows[0];
  ctx.afterCommit.push(() => broadcastInventoryUpdate(inventoryId));
  return { available: r.available_quantity, held: r.held_quantity, confirmed: r.confirmed_quantity, total: r.total_quantity };
}

function scheduleRedisDelete(ctx: TxContext, holdId: string): void {
  ctx.afterCommit.push(async () => {
    await getRedis().del(`hold:${holdId}`);
  });
}

export async function broadcastInventoryUpdate(inventoryId?: string): Promise<void> {
  try {
    const res = await query(
      `SELECT * FROM v_inventory ${inventoryId ? 'WHERE id = $1' : ''}`,
      inventoryId ? [inventoryId] : []
    );
    eventHub.broadcast('inventory_updated', {
      inventory: res.rows,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[BookingEngine] Error broadcasting inventory:', err);
  }
}

// ---------------------------------------------------------------------------
// HOLD: AVAILABLE -> HELD
// ---------------------------------------------------------------------------

export interface HoldRequest {
  travellerId: string;
  inventoryId: string;
  quantity?: number;
  ttlSeconds?: number;
  bookingMode?: BookingMode;
  /** Ops trace correlation id; when set, each step is emitted to the Ops trace feed. */
  traceId?: string;
  /** Runs inside the hold transaction (e.g. to link a prepared booking). Throwing rolls the hold back. */
  onHeld?: (tx: TransactionClient, hold: HoldResult) => Promise<void>;
  /** Commits the idempotency record atomically with the hold. Returns the stored response body. */
  onCommitResponse?: (tx: TransactionClient, hold: HoldResult) => Promise<unknown>;
}

export interface HoldResult {
  bookingId: string;
  holdId: string;
  inventoryId: string;
  quantity: number;
  expiresAt: string;
  ttlSeconds: number;
  totalAmount: number;
  status: 'HELD';
  bookingMode: BookingMode;
}

export function validateHoldInput(quantity: unknown, ttlSeconds: unknown): { quantity: number; ttlSeconds: number } {
  const q = quantity === undefined || quantity === null ? 1 : Number(quantity);
  if (!Number.isInteger(q) || q < 1 || q > MAX_QUANTITY_PER_HOLD) {
    throw new BookingError('INVALID_QUANTITY', 400, `quantity must be an integer between 1 and ${MAX_QUANTITY_PER_HOLD}`);
  }
  const ttl = ttlSeconds === undefined || ttlSeconds === null ? config.defaultHoldTtlSeconds : Number(ttlSeconds);
  if (!Number.isInteger(ttl) || ttl < MIN_HOLD_TTL_SECONDS || ttl > MAX_HOLD_TTL_SECONDS) {
    throw new BookingError(
      'INVALID_TTL',
      400,
      `ttlSeconds must be an integer between ${MIN_HOLD_TTL_SECONDS} and ${MAX_HOLD_TTL_SECONDS}`
    );
  }
  return { quantity: q, ttlSeconds: ttl };
}

export async function holdInventory(req: HoldRequest): Promise<{ hold: HoldResult; response?: unknown }> {
  if (!req.inventoryId) throw new BookingError('INVALID_REQUEST', 400, 'inventoryId is required');
  const { quantity, ttlSeconds } = validateHoldInput(req.quantity, req.ttlSeconds);
  const bookingMode: BookingMode = req.bookingMode ?? 'NORMAL';
  const tId = req.traceId;
  const resourceId = req.inventoryId;

  trace(tId, 'HOLD', 'TRANSACTION_BEGIN', 'Starting PostgreSQL transaction for hold', 'running', { resourceId });

  return runTx(async ctx => {
    const { tx } = ctx;
    const traveller = await tx.query(`SELECT id FROM travellers WHERE id = $1`, [req.travellerId]);
    if (traveller.rows.length === 0) {
      throw new BookingError('TRAVELLER_NOT_FOUND', 404, `Traveller ${req.travellerId} not found`);
    }

    // Row lock serialises all holds on this inventory row.
    trace(tId, 'HOLD', 'INVENTORY_LOCK', 'Locking inventory row FOR UPDATE', 'running', { resourceId });
    const invRes = await tx.query<{
      id: string;
      code: string;
      resource_type: string;
      price: string | number;
      available_quantity: number;
      held_quantity: number;
      confirmed_quantity: number;
      total_quantity: number;
    }>(
      `SELECT id, code, resource_type, price, available_quantity, held_quantity, confirmed_quantity, total_quantity
       FROM inventory WHERE id = $1 FOR UPDATE`,
      [req.inventoryId]
    );
    if (invRes.rows.length === 0) {
      throw new BookingError('INVENTORY_NOT_FOUND', 404, `Inventory ${req.inventoryId} not found`);
    }
    const inv = invRes.rows[0];
    if (inv.available_quantity < quantity) {
      throw new BookingError('INSUFFICIENT_INVENTORY', 409, 'No available units left for this item', {
        inventoryId: req.inventoryId,
        available: inv.available_quantity,
        requested: quantity
      });
    }

    trace(tId, 'HOLD', 'INVENTORY_VALIDATION', `Inventory valid. Available: ${inv.available_quantity}, Requested: ${quantity}`, 'success', {
      resourceId,
      data: { available: inv.available_quantity, requested: quantity }
    });

    const after = await moveInventory(ctx, req.inventoryId, 'available', 'held', quantity);
    trace(tId, 'HOLD', 'INVENTORY_UPDATED', `Inventory mutated. Held +${quantity}, Available -${quantity}`, 'success', {
      resourceId,
      data: {
        before: {
          available: inv.available_quantity,
          held: inv.held_quantity,
          confirmed: inv.confirmed_quantity,
          total: inv.total_quantity
        },
        after
      }
    });

    const price = Number(inv.price);
    const totalAmount = price * quantity;
    const bookingId = newId('bk');
    const holdId = newId('hld');

    await tx.query(
      `INSERT INTO bookings (id, traveller_id, status, total_amount, currency, booking_mode)
       VALUES ($1, $2, 'HELD', $3, 'INR', $4)`,
      [bookingId, req.travellerId, totalAmount, bookingMode]
    );
    trace(tId, 'HOLD', 'BOOKING_CREATED', `Created booking ${bookingId} in HELD state`, 'success', { bookingId, resourceId });
    const holdRes = await tx.query<{ expires_at: string | Date }>(
      `INSERT INTO holds (id, booking_id, inventory_id, quantity, expires_at, status)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + make_interval(secs => $5), 'ACTIVE')
       RETURNING expires_at`,
      [holdId, bookingId, req.inventoryId, quantity, ttlSeconds]
    );
    await tx.query(
      `INSERT INTO booking_items (id, booking_id, inventory_id, item_type, status, price)
       VALUES ($1, $2, $3, $4, 'HELD', $5)`,
      [newId('itm'), bookingId, req.inventoryId, inv.resource_type, price]
    );

    const expiresAt = toIso(holdRes.rows[0].expires_at);
    trace(tId, 'HOLD', 'HOLD_CREATED', `Created hold ${holdId} (TTL: ${ttlSeconds}s)`, 'success', {
      bookingId,
      holdId,
      resourceId,
      data: { expiresAt, ttlSeconds }
    });
    const holdEventId = newId('evt');
    await tx.query(
      `INSERT INTO booking_events (id, booking_id, from_state, to_state, reason, evidence, operator)
       VALUES ($1, $2, 'PENDING', 'HELD', $3, $4, 'HOLD_MANAGER')`,
      [
        holdEventId,
        bookingId,
        `Held ${quantity} unit(s) on ${inv.code} for ${ttlSeconds}s`,
        JSON.stringify({ holdId, ttlSeconds, expiresAt, availableBefore: inv.available_quantity, bookingMode })
      ]
    );
    trace(tId, 'HOLD', 'BOOKING_EVENT_CREATED', 'Recorded PENDING -> HELD state transition', 'success', {
      bookingId,
      holdId,
      resourceId
    });

    const hold: HoldResult = {
      bookingId,
      holdId,
      inventoryId: req.inventoryId,
      quantity,
      expiresAt,
      ttlSeconds,
      totalAmount,
      status: 'HELD',
      bookingMode
    };

    if (req.onHeld) await req.onHeld(tx, hold);
    const response = req.onCommitResponse ? await req.onCommitResponse(tx, hold) : undefined;

    ctx.afterCommit.push(async () => {
      trace(tId, 'HOLD', 'TRANSACTION_COMMITTED', 'PostgreSQL transaction committed successfully', 'success', {
        bookingId,
        holdId,
        resourceId
      });
      await getRedis().set(
        `hold:${holdId}`,
        JSON.stringify({ bookingId, inventoryId: req.inventoryId, quantity }),
        'EX',
        ttlSeconds
      );
      trace(tId, 'HOLD', 'REDIS_TTL_CREATED', `Set Redis TTL for key hold:${holdId} (${ttlSeconds}s)`, 'success', {
        bookingId,
        holdId,
        resourceId
      });
    });
    ctx.afterCommit.push(() =>
      eventHub.broadcast('booking_state_changed', {
        eventId: holdEventId,
        bookingId,
        fromState: 'PENDING',
        toState: 'HELD',
        reason: `Held ${quantity} unit(s)`,
        operator: 'SYSTEM',
        timestamp: new Date().toISOString()
      })
    );

    return { hold, response };
  });
}

// ---------------------------------------------------------------------------
// EXPIRE / RELEASE: HELD -> EXPIRED | RELEASED
// ---------------------------------------------------------------------------

async function releaseActiveHoldTx(
  ctx: TxContext,
  booking: LockedBooking,
  hold: LockedHold,
  toState: 'EXPIRED' | 'RELEASED',
  reason: string,
  operator: string
): Promise<void> {
  await moveInventory(ctx, hold.inventory_id, 'held', 'available', hold.quantity);
  const upd = await ctx.tx.query(
    `UPDATE holds SET status = $1 WHERE id = $2 AND status = 'ACTIVE' RETURNING id`,
    [toState, hold.id]
  );
  if (upd.rows.length !== 1) {
    throw new BookingError('CONCURRENT_MODIFICATION', 409, `Hold ${hold.id} changed concurrently`);
  }
  await ctx.tx.query(`UPDATE booking_items SET status = $1 WHERE booking_id = $2 AND status = 'HELD'`, [
    toState,
    booking.id
  ]);
  await ctx.tx.query(`UPDATE bookings SET confirm_token = NULL, confirm_started_at = NULL WHERE id = $1`, [booking.id]);
  await transition(ctx, booking.id, booking.status, toState, reason, operator, {
    holdId: hold.id,
    restoredQuantity: hold.quantity
  });
  scheduleRedisDelete(ctx, hold.id);
  if (toState === 'EXPIRED') {
    ctx.afterCommit.push(() =>
      eventHub.broadcast('hold_expired', { holdId: hold.id, bookingId: booking.id, inventoryId: hold.inventory_id })
    );
  }
}

/**
 * Expires a hold whose TTL has passed. Safe to call repeatedly and concurrently
 * (Redis TTL callback + DB sweeper): exactly one caller restocks.
 * Returns true only if this call performed the expiry.
 */
export async function expireHold(holdId: string): Promise<boolean> {
  const lookup = await query<{ booking_id: string }>(`SELECT booking_id FROM holds WHERE id = $1`, [holdId]);
  if (lookup.rows.length === 0) return false;
  const bookingId = lookup.rows[0].booking_id;
  const tId = newTraceId();
  trace(tId, 'EXPIRY', 'EXPIRY_TRIGGERED', `Triggered expiry for hold ${holdId}`, 'running', { bookingId, holdId });

  return runTx(async ctx => {
    trace(tId, 'EXPIRY', 'BOOKING_LOCK', 'Locking booking row FOR UPDATE', 'running', { bookingId });
    const booking = await lockBooking(ctx.tx, bookingId);
    trace(tId, 'EXPIRY', 'HOLD_LOCK', 'Locking hold row FOR UPDATE', 'running', { bookingId, holdId });
    const hold = await lockHold(ctx.tx, 'id = $1', holdId);
    const abort = (why: string) => {
      trace(tId, 'EXPIRY', 'EXPIRY_VALIDATION', `${why}. Aborting expiry.`, 'failed', { bookingId, holdId });
      return false;
    };
    if (!hold || hold.status !== 'ACTIVE') return abort(`Hold is not ACTIVE (current: ${hold?.status ?? 'MISSING'})`);
    if (booking.status !== 'HELD') return abort(`Booking is ${booking.status}, not HELD`); // e.g. RECONCILING keeps its seat held
    if (!hold.is_expired) return abort(`Hold is not genuinely expired yet (expires: ${toIso(hold.expires_at)})`); // DB clock is authoritative
    if (booking.claim_live) return abort('Confirmation is in flight'); // confirm decides the outcome

    trace(tId, 'EXPIRY', 'EXPIRY_VALIDATION', 'Hold is ACTIVE and genuinely expired. Proceeding to release.', 'success', {
      bookingId,
      holdId
    });
    await releaseActiveHoldTx(
      ctx,
      booking,
      hold,
      'EXPIRED',
      `Hold TTL expired; ${hold.quantity} unit(s) automatically restocked to inventory`,
      'HOLD_SWEEPER'
    );
    trace(tId, 'EXPIRY', 'INVENTORY_RELEASED', `Restocked ${hold.quantity} unit(s) back to inventory`, 'success', {
      bookingId,
      holdId,
      resourceId: hold.inventory_id
    });
    ctx.afterCommit.push(() => {
      const extra = { bookingId, holdId, resourceId: hold.inventory_id };
      trace(tId, 'EXPIRY', 'TRANSACTION_COMMITTED', 'Expiry transaction committed successfully', 'success', extra);
      trace(tId, 'EXPIRY', 'OPERATION_COMPLETED', 'Hold successfully expired', 'success', extra);
    });
    console.log(`[BookingEngine] Hold ${holdId} expired. Booking ${bookingId} -> EXPIRED.`);
    return true;
  });
}

/** Expires every overdue hold. Returns how many holds this call expired. */
export async function sweepExpiredHolds(limit = 50): Promise<number> {
  const due = await query<{ id: string }>(
    `SELECT h.id FROM holds h JOIN bookings b ON b.id = h.booking_id
     WHERE h.status = 'ACTIVE' AND b.status = 'HELD' AND h.expires_at <= CURRENT_TIMESTAMP
       AND (b.confirm_token IS NULL
            OR b.confirm_started_at <= CURRENT_TIMESTAMP - make_interval(secs => $2))
     ORDER BY h.expires_at ASC LIMIT $1`,
    [limit, CONFIRM_CLAIM_TIMEOUT_SECONDS]
  );
  let expired = 0;
  for (const row of due.rows) {
    try {
      if (await expireHold(row.id)) expired++;
    } catch (err) {
      console.error(`[BookingEngine] Failed to expire hold ${row.id}:`, err);
    }
  }
  return expired;
}

/** Traveller-initiated release of a held booking (HELD -> RELEASED). Idempotent. */
export async function releaseBooking(
  bookingId: string,
  reason = 'Traveller released the hold before payment'
): Promise<{ bookingId: string; status: BookingState; alreadyFinal: boolean }> {
  return runTx(async ctx => {
    const booking = await lockBooking(ctx.tx, bookingId);
    if (booking.status === 'RELEASED' || booking.status === 'EXPIRED') {
      return { bookingId, status: booking.status, alreadyFinal: true };
    }
    if (booking.status !== 'HELD') {
      throw new BookingError('INVALID_STATE', 409, `Cannot release booking in ${booking.status} state`, {
        currentStatus: booking.status
      });
    }
    if (booking.claim_live) {
      throw new BookingError('CONFIRM_IN_PROGRESS', 409, 'Payment confirmation is in progress for this booking');
    }
    const hold = await lockHold(ctx.tx, `booking_id = $1 AND status = 'ACTIVE'`, bookingId);
    if (!hold) {
      throw new BookingError('HOLD_NOT_FOUND', 409, `Booking ${bookingId} has no active hold`);
    }
    await releaseActiveHoldTx(ctx, booking, hold, 'RELEASED', reason, 'TRAVELLER');
    return { bookingId, status: 'RELEASED' as BookingState, alreadyFinal: false };
  });
}

// ---------------------------------------------------------------------------
// CONFIRM: HELD -> CONFIRMED (| RECONCILING | FAILED)
// ---------------------------------------------------------------------------

export interface ConfirmRequest {
  bookingId: string;
  travellerName?: string;
  passengerDetails?: any;
  /** Ops trace correlation id; when set, each step is emitted to the Ops trace feed. */
  traceId?: string;
}

export interface ConfirmItem {
  inventoryId: string;
  code: string;
  name: string;
  resourceType: string;
  origin: string;
  destination: string;
}

export type ConfirmResult =
  | {
      outcome: 'CONFIRMED';
      alreadyConfirmed: boolean;
      bookingId: string;
      pnr: string | null;
      quantity: number;
      totalAmount: number;
      item: ConfirmItem | null;
    }
  | { outcome: 'RECONCILING'; bookingId: string; item: ConfirmItem | null; alreadyReconciling: boolean }
  | { outcome: 'FAILED'; bookingId: string; error: string; item: ConfirmItem | null };

function toConfirmItem(item: BookingItemInfo | null): ConfirmItem | null {
  if (!item) return null;
  return {
    inventoryId: item.inventory_id,
    code: item.code,
    name: item.name,
    resourceType: item.resource_type,
    origin: item.origin,
    destination: item.destination
  };
}

async function currentPnr(tx: TransactionClient, bookingId: string): Promise<string | null> {
  const res = await tx.query<{ provider_ref: string }>(
    `SELECT provider_ref FROM provider_reservations
     WHERE booking_id = $1 AND provider_status = 'CONFIRMED'
     ORDER BY last_checked_at DESC LIMIT 1`,
    [bookingId]
  );
  return res.rows[0]?.provider_ref ?? null;
}

export async function confirmBooking(req: ConfirmRequest): Promise<ConfirmResult> {
  if (!req.bookingId) throw new BookingError('INVALID_REQUEST', 400, 'bookingId is required');
  const travellerName = req.passengerDetails?.name || req.travellerName || 'Traveller';

  // Phase 1: validate + claim (short transaction)
  type Phase1 =
    | { kind: 'done'; result: ConfirmResult }
    | { kind: 'expired'; item: ConfirmItem | null }
    | {
        kind: 'claimed';
        token: string;
        holdId: string;
        quantity: number;
        totalAmount: number;
        item: BookingItemInfo;
      };

  const tId = req.traceId;
  const bookingId = req.bookingId;

  const phase1 = await runTx<Phase1>(async ctx => {
    trace(tId, 'CONFIRM', 'BOOKING_LOCK', 'Locking booking row FOR UPDATE', 'running', { bookingId });
    const booking = await lockBooking(ctx.tx, req.bookingId);
    const item = await primaryItem(ctx.tx, req.bookingId);

    if (booking.status === 'CONFIRMED') {
      const q = await ctx.tx.query<{ quantity: number }>(
        `SELECT quantity FROM holds WHERE booking_id = $1 AND status = 'CONFIRMED' LIMIT 1`,
        [req.bookingId]
      );
      return {
        kind: 'done',
        result: {
          outcome: 'CONFIRMED',
          alreadyConfirmed: true,
          bookingId: booking.id,
          pnr: await currentPnr(ctx.tx, booking.id),
          quantity: q.rows[0]?.quantity ?? 1,
          totalAmount: Number(booking.total_amount),
          item: toConfirmItem(item)
        }
      };
    }
    if (booking.status === 'RECONCILING') {
      return {
        kind: 'done',
        result: { outcome: 'RECONCILING', bookingId: booking.id, item: toConfirmItem(item), alreadyReconciling: true }
      };
    }
    if (booking.status === 'EXPIRED' || booking.status === 'RELEASED') {
      return { kind: 'expired', item: toConfirmItem(item) };
    }
    if (booking.status !== 'HELD' || !item) {
      throw new BookingError('INVALID_STATE', 400, `Cannot confirm booking in ${booking.status} state`, {
        currentStatus: booking.status
      });
    }

    const hold = await lockHold(ctx.tx, `booking_id = $1 AND status = 'ACTIVE'`, req.bookingId);
    if (!hold) {
      throw new BookingError('HOLD_NOT_FOUND', 409, `Booking ${req.bookingId} has no active hold`);
    }
    if (booking.claim_live) {
      throw new BookingError('CONFIRM_IN_PROGRESS', 409, 'Another confirmation for this booking is in progress');
    }
    if (hold.is_expired) {
      // The TTL passed but the sweeper has not run yet: expire now, then report 410.
      await releaseActiveHoldTx(ctx, booking, hold, 'EXPIRED', 'Hold TTL expired before confirmation', 'HOLD_MANAGER');
      return { kind: 'expired', item: toConfirmItem(item) };
    }

    const token = crypto.randomUUID();
    await ctx.tx.query(
      `UPDATE bookings SET confirm_token = $1, confirm_started_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [token, booking.id]
    );
    trace(tId, 'CONFIRM', 'STATE_VALIDATION', `Booking is HELD with active hold ${hold.id}; confirmation claimed`, 'success', {
      bookingId,
      holdId: hold.id,
      resourceId: hold.inventory_id
    });
    return {
      kind: 'claimed',
      token,
      holdId: hold.id,
      quantity: hold.quantity,
      totalAmount: Number(booking.total_amount),
      item
    };
  });

  if (phase1.kind === 'done') return phase1.result;
  if (phase1.kind === 'expired') {
    throw new BookingError('HOLD_EXPIRED', 410, 'Hold expired before confirmation was completed', {
      inventoryId: phase1.item?.inventoryId
    });
  }

  const { token, holdId, quantity, totalAmount, item } = phase1;

  // Phase 2: external provider call (no DB locks held)
  console.log(`[BookingEngine] Invoking provider reserve for booking ${req.bookingId}...`);
  const resourceId = item.inventory_id;
  trace(tId, 'CONFIRM', 'PROVIDER_REQUEST_STARTED', 'Invoking provider reserve API', 'running', {
    bookingId,
    resourceId,
    data: { resourceCode: item.code }
  });
  const providerRes = await providerAdapter.reserve({
    bookingId: req.bookingId,
    itemType: 'flight',
    resourceCode: item.code,
    passengerOrGuestName: travellerName
  });
  trace(
    tId,
    'CONFIRM',
    'PROVIDER_RESPONSE_RECEIVED',
    `Provider responded. Success: ${providerRes.success}${providerRes.timeout ? ' (timeout)' : ''}`,
    providerRes.success ? 'success' : 'failed',
    { bookingId, resourceId, data: providerRes }
  );

  // Phase 3: apply the provider outcome (short transaction)
  let compensateProviderRef: string | null = null;
  try {
    const outcome = await runTx<ConfirmResult | 'HOLD_GONE'>(async ctx => {
      trace(tId, 'CONFIRM', 'BOOKING_LOCK', 'Re-locking booking row FOR UPDATE', 'running', { bookingId });
      const booking = await lockBooking(ctx.tx, req.bookingId);
      if (booking.confirm_token !== token) {
        // Our claim timed out and someone else took over. Never apply a second outcome.
        if (providerRes.success && providerRes.providerRef) compensateProviderRef = providerRes.providerRef;
        throw new BookingError('CONFIRM_CLAIM_LOST', 409, 'Confirmation claim expired; please check booking status');
      }
      trace(tId, 'CONFIRM', 'HOLD_LOCK', 'Locking hold row FOR UPDATE', 'running', { bookingId, holdId });
      const hold = await lockHold(ctx.tx, 'id = $1', holdId);
      if (!hold || hold.status !== 'ACTIVE' || booking.status !== 'HELD') {
        trace(tId, 'CONFIRM', 'STATE_REVALIDATION', `Booking is ${booking.status}; hold is no longer active`, 'failed', {
          bookingId,
          holdId
        });
        if (providerRes.success && providerRes.providerRef) compensateProviderRef = providerRes.providerRef;
        await ctx.tx.query(`UPDATE bookings SET confirm_token = NULL, confirm_started_at = NULL WHERE id = $1`, [
          booking.id
        ]);
        return 'HOLD_GONE';
      }

      await ctx.tx.query(`UPDATE bookings SET confirm_token = NULL, confirm_started_at = NULL WHERE id = $1`, [
        booking.id
      ]);
      trace(tId, 'CONFIRM', 'STATE_REVALIDATION', 'Booking state revalidated as HELD', 'success', { bookingId, holdId });
      ctx.afterCommit.push(() =>
        trace(tId, 'CONFIRM', 'TRANSACTION_COMMITTED', 'PostgreSQL transaction committed successfully', 'success', {
          bookingId,
          holdId,
          resourceId
        })
      );

      if (providerRes.timeout) {
        await transition(
          ctx,
          booking.id,
          'HELD',
          'RECONCILING',
          'Provider timeout during confirmation; seat remains held while reconciling',
          'RECONCILER',
          providerRes.rawResponse
        );
        return { outcome: 'RECONCILING', bookingId: booking.id, item: toConfirmItem(item), alreadyReconciling: false };
      }

      if (!providerRes.success) {
        await moveInventory(ctx, hold.inventory_id, 'held', 'available', hold.quantity);
        await ctx.tx.query(`UPDATE holds SET status = 'RELEASED' WHERE id = $1 AND status = 'ACTIVE'`, [hold.id]);
        await ctx.tx.query(`UPDATE booking_items SET status = 'FAILED' WHERE booking_id = $1`, [booking.id]);
        await transition(
          ctx,
          booking.id,
          'HELD',
          'FAILED',
          providerRes.error || 'Provider rejected reservation',
          'PROVIDER_ADAPTER',
          providerRes.rawResponse
        );
        scheduleRedisDelete(ctx, hold.id);
        return {
          outcome: 'FAILED',
          bookingId: booking.id,
          error: providerRes.error || 'PROVIDER_REJECTED',
          item: toConfirmItem(item)
        };
      }

      const pnr = providerRes.providerRef || `REF-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      await moveInventory(ctx, hold.inventory_id, 'held', 'confirmed', hold.quantity);
      trace(tId, 'CONFIRM', 'INVENTORY_CONFIRMED', `Inventory updated. Held -${hold.quantity}, Confirmed +${hold.quantity}`, 'success', {
        bookingId,
        holdId,
        resourceId
      });
      const holdUpd = await ctx.tx.query(
        `UPDATE holds SET status = 'CONFIRMED' WHERE id = $1 AND status = 'ACTIVE' RETURNING id`,
        [hold.id]
      );
      if (holdUpd.rows.length !== 1) {
        throw new BookingError('CONCURRENT_MODIFICATION', 409, `Hold ${hold.id} changed concurrently`);
      }
      await ctx.tx.query(`UPDATE booking_items SET status = 'CONFIRMED' WHERE booking_id = $1`, [booking.id]);
      await ctx.tx.query(
        `INSERT INTO provider_reservations (id, booking_id, booking_item_id, provider_name, provider_ref, provider_status, raw_response)
         VALUES ($1, $2, $3, $4, $5, 'CONFIRMED', $6)`,
        [newId('prv'), booking.id, item.item_id, item.name, pnr, JSON.stringify(providerRes.rawResponse)]
      );
      await transition(
        ctx,
        booking.id,
        'HELD',
        'CONFIRMED',
        `Reservation confirmed with PNR ${pnr}`,
        'PROVIDER_ADAPTER',
        providerRes.rawResponse
      );
      trace(tId, 'CONFIRM', 'BOOKING_STATE_TRANSITION', 'Booking transitioned to CONFIRMED', 'success', { bookingId });
      scheduleRedisDelete(ctx, hold.id);
      return {
        outcome: 'CONFIRMED',
        alreadyConfirmed: false,
        bookingId: booking.id,
        pnr,
        quantity,
        totalAmount,
        item: toConfirmItem(item)
      };
    });
    if (outcome === 'HOLD_GONE') {
      throw new BookingError('HOLD_EXPIRED', 410, 'Hold is no longer active; confirmation was not applied', {
        inventoryId: item.inventory_id
      });
    }
    return outcome;
  } finally {
    if (compensateProviderRef) {
      const ref = compensateProviderRef;
      console.warn(`[BookingEngine] Compensating orphan provider reservation ${ref}`);
      trace(tId, 'CONFIRM', 'PROVIDER_FINALIZATION', `Phantom reservation aborted. Cancelling provider PNR ${ref}`, 'running', {
        bookingId
      });
      try {
        await providerAdapter.cancel(ref);
        trace(tId, 'CONFIRM', 'PROVIDER_COMPENSATED', 'Provider reservation cancelled; booking state unchanged', 'success', {
          bookingId
        });
      } catch (err) {
        console.error(err);
        trace(
          tId,
          'CONFIRM',
          'PROVIDER_COMPENSATION_FAILED',
          `Provider cancel failed! Needs reconciliation. Error: ${(err as Error)?.message}`,
          'failed',
          { bookingId, data: { providerRef: ref } }
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// RECONCILIATION outcome (used by routes/reconciliation.ts inside its transaction)
// ---------------------------------------------------------------------------

/**
 * Moves inventory for a RECONCILING booking once its outcome is known.
 * CONFIRM: held -> confirmed. FAIL: held -> available. Guarded like every other move.
 */
export async function applyReconciliationInventoryTx(
  tx: TransactionClient,
  bookingId: string,
  action: 'CONFIRM' | 'FAIL'
): Promise<{ holdId: string | null; inventoryId: string | null; quantity: number }> {
  const ctx: TxContext = { tx, afterCommit: [] };
  const hold = await lockHold(tx, `booking_id = $1 AND status = 'ACTIVE'`, bookingId);
  if (!hold) {
    throw new BookingError('HOLD_NOT_FOUND', 409, `Booking ${bookingId} has no active hold to reconcile`);
  }
  if (action === 'CONFIRM') {
    await moveInventory(ctx, hold.inventory_id, 'held', 'confirmed', hold.quantity);
    await tx.query(`UPDATE holds SET status = 'CONFIRMED' WHERE id = $1 AND status = 'ACTIVE'`, [hold.id]);
    await tx.query(`UPDATE booking_items SET status = 'CONFIRMED' WHERE booking_id = $1`, [bookingId]);
  } else {
    await moveInventory(ctx, hold.inventory_id, 'held', 'available', hold.quantity);
    await tx.query(`UPDATE holds SET status = 'RELEASED' WHERE id = $1 AND status = 'ACTIVE'`, [hold.id]);
    await tx.query(`UPDATE booking_items SET status = 'FAILED' WHERE booking_id = $1`, [bookingId]);
  }
  return { holdId: hold.id, inventoryId: hold.inventory_id, quantity: hold.quantity };
}

// ---------------------------------------------------------------------------
// CANCEL: CONFIRMED -> CANCELLED (units back to AVAILABLE)
// ---------------------------------------------------------------------------

export interface CancelResult {
  bookingId: string;
  status: 'CANCELLED';
  alreadyCancelled: boolean;
  restoredQuantity: number;
  inventoryId: string | null;
}

export async function cancelBooking(
  bookingId: string,
  reason = 'Traveller requested cancellation',
  operator = 'TRAVELLER'
): Promise<CancelResult> {
  if (!bookingId) throw new BookingError('INVALID_REQUEST', 400, 'bookingId is required');
  let providerRef: string | null = null;

  const result = await runTx<CancelResult>(async ctx => {
    const booking = await lockBooking(ctx.tx, bookingId);
    if (booking.status === 'CANCELLED') {
      return { bookingId, status: 'CANCELLED', alreadyCancelled: true, restoredQuantity: 0, inventoryId: null };
    }
    if (booking.status !== 'CONFIRMED') {
      throw new BookingError('INVALID_STATE', 409, `Cannot cancel booking in ${booking.status} status`, {
        currentStatus: booking.status
      });
    }

    let restoredQuantity = 0;
    let inventoryId: string | null = null;
    const hold = await lockHold(ctx.tx, `booking_id = $1 AND status = 'CONFIRMED'`, bookingId);
    if (hold) {
      await moveInventory(ctx, hold.inventory_id, 'confirmed', 'available', hold.quantity);
      await ctx.tx.query(`UPDATE holds SET status = 'CANCELLED' WHERE id = $1 AND status = 'CONFIRMED'`, [hold.id]);
      restoredQuantity = hold.quantity;
      inventoryId = hold.inventory_id;
    } else {
      // Legacy bookings created outside the engine (no hold record): restock 1 unit per
      // confirmed item, but only if that inventory really has confirmed units to give back.
      const items = await ctx.tx.query<{ inventory_id: string }>(
        `SELECT inventory_id FROM booking_items WHERE booking_id = $1 AND status = 'CONFIRMED' ORDER BY id`,
        [bookingId]
      );
      for (const it of items.rows) {
        const res = await ctx.tx.query(
          `UPDATE inventory SET confirmed_quantity = confirmed_quantity - 1,
                                available_quantity = available_quantity + 1,
                                version = version + 1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND confirmed_quantity >= 1 RETURNING id`,
          [it.inventory_id]
        );
        if (res.rows.length === 1) {
          restoredQuantity++;
          inventoryId = inventoryId ?? it.inventory_id;
          const invId = it.inventory_id;
          ctx.afterCommit.push(() => broadcastInventoryUpdate(invId));
        }
      }
    }

    await ctx.tx.query(`UPDATE booking_items SET status = 'CANCELLED' WHERE booking_id = $1 AND status = 'CONFIRMED'`, [
      bookingId
    ]);
    providerRef = await currentPnr(ctx.tx, bookingId);
    await transition(ctx, bookingId, 'CONFIRMED', 'CANCELLED', reason, operator, { restoredQuantity });
    return { bookingId, status: 'CANCELLED', alreadyCancelled: false, restoredQuantity, inventoryId };
  });

  if (providerRef && !result.alreadyCancelled) {
    await providerAdapter.cancel(providerRef).catch(err => console.error('[BookingEngine] Provider cancel failed:', err));
  }
  return result;
}

// ---------------------------------------------------------------------------
// READ MODELS
// ---------------------------------------------------------------------------

export async function getBookingStatus(bookingId: string) {
  const bRes = await query<{
    id: string;
    status: BookingState;
    booking_mode: string;
    total_amount: string;
    currency: string;
    traveller_id: string;
    created_at: string;
    updated_at: string;
    confirm_in_progress: boolean;
  }>(
    `SELECT id, status, booking_mode, total_amount, currency, traveller_id, created_at, updated_at,
            (confirm_token IS NOT NULL
             AND confirm_started_at > CURRENT_TIMESTAMP - make_interval(secs => $2)) AS confirm_in_progress
     FROM bookings WHERE id = $1`,
    [bookingId, CONFIRM_CLAIM_TIMEOUT_SECONDS]
  );
  if (bRes.rows.length === 0) {
    throw new BookingError('BOOKING_NOT_FOUND', 404, `Booking ${bookingId} not found`);
  }
  const b = bRes.rows[0];

  const holdRes = await query<{
    id: string;
    inventory_id: string;
    quantity: number;
    status: string;
    expires_at: string | Date;
    seconds_remaining: string | number;
  }>(
    `SELECT id, inventory_id, quantity, status, expires_at,
            GREATEST(0, EXTRACT(EPOCH FROM (expires_at - CURRENT_TIMESTAMP))) AS seconds_remaining
     FROM holds WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [bookingId]
  );
  const itemsRes = await query(
    `SELECT bi.id AS "itemId", bi.item_type AS "itemType", bi.status, bi.price, bi.inventory_id AS "inventoryId",
            i.code, i.name, i.origin, i.destination, i.travel_date AS "travelDate"
     FROM booking_items bi JOIN inventory i ON i.id = bi.inventory_id
     WHERE bi.booking_id = $1 ORDER BY bi.created_at ASC`,
    [bookingId]
  );
  const pnrRes = await query<{ provider_ref: string }>(
    `SELECT provider_ref FROM provider_reservations WHERE booking_id = $1 AND provider_status = 'CONFIRMED'
     ORDER BY last_checked_at DESC LIMIT 1`,
    [bookingId]
  );

  const h = holdRes.rows[0];
  // A status read at/after the database-clock deadline finalizes expiry through
  // the same locked engine transition used by Redis and the periodic sweeper.
  if (h?.status === 'ACTIVE' && Number(h.seconds_remaining) <= 0) {
    if (await expireHold(h.id)) return getBookingStatus(bookingId);
  }
  return {
    bookingId: b.id,
    status: b.status,
    bookingMode: b.booking_mode,
    travellerId: b.traveller_id,
    totalAmount: Number(b.total_amount),
    currency: b.currency,
    pnr: pnrRes.rows[0]?.provider_ref ?? null,
    confirmInProgress: Boolean(b.confirm_in_progress),
    allowedTransitions: ALLOWED_TRANSITIONS[b.status] ?? [],
    hold: h
      ? {
          holdId: h.id,
          inventoryId: h.inventory_id,
          quantity: h.quantity,
          status: h.status,
          expiresAt: toIso(h.expires_at),
          secondsRemaining: h.status === 'ACTIVE' ? Math.floor(Number(h.seconds_remaining)) : 0
        }
      : null,
    items: itemsRes.rows,
    createdAt: b.created_at,
    updatedAt: b.updated_at
  };
}

export async function checkInvariants() {
  const violations = await query(
    `SELECT id, code, total_quantity, available_quantity, held_quantity, confirmed_quantity
     FROM inventory
     WHERE available_quantity + held_quantity + confirmed_quantity <> total_quantity
        OR available_quantity < 0 OR held_quantity < 0 OR confirmed_quantity < 0`
  );

  // Cross-check inventory counters against the hold ledger.
  const ledger = await query<{
    id: string;
    code: string;
    held_quantity: number;
    active_hold_units: string | number;
    confirmed_quantity: number;
    confirmed_hold_units: string | number;
  }>(
    `SELECT i.id, i.code, i.held_quantity, COALESCE(a.units, 0) AS active_hold_units,
            i.confirmed_quantity, COALESCE(c.units, 0) AS confirmed_hold_units
     FROM inventory i
     LEFT JOIN (SELECT inventory_id, SUM(quantity) AS units FROM holds WHERE status = 'ACTIVE' GROUP BY inventory_id) a
       ON a.inventory_id = i.id
     LEFT JOIN (SELECT inventory_id, SUM(quantity) AS units FROM holds WHERE status = 'CONFIRMED' GROUP BY inventory_id) c
       ON c.inventory_id = i.id
     WHERE i.held_quantity <> COALESCE(a.units, 0) OR i.confirmed_quantity <> COALESCE(c.units, 0)`
  );

  const duplicates = await query<{ booking_id: string; confirmations: string | number }>(
    `SELECT booking_id, COUNT(*) AS confirmations FROM provider_reservations
     WHERE provider_status = 'CONFIRMED' GROUP BY booking_id HAVING COUNT(*) > 1`
  );
  const liveHoldDupes = await query<{ booking_id: string }>(
    `SELECT booking_id FROM holds WHERE status IN ('ACTIVE', 'CONFIRMED') GROUP BY booking_id HAVING COUNT(*) > 1`
  );
  const overdue = await query<{ count: string | number }>(
    `SELECT COUNT(*) AS count FROM holds h JOIN bookings b ON b.id = h.booking_id
     WHERE h.status = 'ACTIVE' AND b.status = 'HELD' AND h.expires_at <= CURRENT_TIMESTAMP`
  );

  const ledgerMismatches = ledger.rows.map(r => ({
    inventoryId: r.id,
    code: r.code,
    heldQuantity: r.held_quantity,
    activeHoldUnits: Number(r.active_hold_units),
    confirmedQuantity: r.confirmed_quantity,
    confirmedHoldUnits: Number(r.confirmed_hold_units)
  }));

  return {
    invariantValid: violations.rows.length === 0,
    violations: violations.rows,
    duplicateConfirmations: duplicates.rows.length + liveHoldDupes.rows.length,
    duplicateConfirmationDetails: [...duplicates.rows, ...liveHoldDupes.rows],
    ledger: {
      // Rows touched by modules that bypass the hold ledger (e.g. demo simulators) can show up here.
      consistent: ledgerMismatches.length === 0,
      mismatches: ledgerMismatches
    },
    overdueActiveHolds: Number(overdue.rows[0]?.count ?? 0)
  };
}

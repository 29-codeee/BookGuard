import { getRedis } from './client.js';
import { withTransaction, query, TransactionClient } from '../db/client.js';
import { transitionBookingState } from '../state/stateMachine.js';
import { eventHub } from '../sse/eventHub.js';
import { config } from '../config.js';

export interface CreateHoldParams {
  travellerId: string;
  inventoryId: string;
  quantity?: number;
  ttlSeconds?: number;
}

export interface HoldResult {
  bookingId: string;
  holdId: string;
  inventoryId: string;
  quantity: number;
  expiresAt: string;
  ttlSeconds: number;
  totalAmount: number;
}

export async function createHold(params: CreateHoldParams): Promise<HoldResult> {
  const quantity = params.quantity || 1;
  const ttlSeconds = params.ttlSeconds || config.defaultHoldTtlSeconds;
  const bookingId = `bk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const holdId = `hld_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const itemId = `itm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  const result = await withTransaction(async (tx: TransactionClient) => {
    // 1. Atomically lock and check inventory
    const invRes = await tx.query<{
      id: string;
      code: string;
      price: string | number;
      available_quantity: number;
      held_quantity: number;
      confirmed_quantity: number;
      total_quantity: number;
    }>(
      `SELECT id, code, price, available_quantity, held_quantity, confirmed_quantity, total_quantity 
       FROM inventory 
       WHERE id = $1 FOR UPDATE`,
      [params.inventoryId]
    );

    if (invRes.rowCount === 0) {
      throw new Error(`INVENTORY_NOT_FOUND`);
    }

    const inv = invRes.rows[0];
    if (inv.available_quantity < quantity) {
      throw new Error(`INSUFFICIENT_INVENTORY`);
    }

    const price = Number(inv.price);
    const totalAmount = price * quantity;

    // 2. Decrement available, increment held
    await tx.query(
      `UPDATE inventory 
       SET available_quantity = available_quantity - $1, 
           held_quantity = held_quantity + $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [quantity, params.inventoryId]
    );

    // 3. Create Booking in HELD status
    await tx.query(
      `INSERT INTO bookings (id, traveller_id, status, total_amount, currency)
       VALUES ($1, $2, 'HELD', $3, 'INR')`,
      [bookingId, params.travellerId, totalAmount]
    );

    // 4. Create Hold record
    await tx.query(
      `INSERT INTO holds (id, booking_id, inventory_id, quantity, expires_at, status)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE')`,
      [holdId, bookingId, params.inventoryId, quantity, expiresAt]
    );

    // 5. Create Booking Item
    await tx.query(
      `INSERT INTO booking_items (id, booking_id, inventory_id, item_type, status, price)
       VALUES ($1, $2, $3, 'flight', 'HELD', $4)`,
      [itemId, bookingId, params.inventoryId, price]
    );

    // 6. Record audit event
    await tx.query(
      `INSERT INTO booking_events (id, booking_id, from_state, to_state, reason, evidence, operator)
       VALUES ($1, $2, 'PENDING', 'HELD', $3, $4, 'HOLD_MANAGER')`,
      [
        `evt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        bookingId,
        `Held ${quantity} seat(s) on ${inv.code} for ${ttlSeconds}s`,
        JSON.stringify({ holdId, ttlSeconds, expiresAt, availableBefore: inv.available_quantity })
      ]
    );

    return { bookingId, holdId, inventoryId: params.inventoryId, quantity, expiresAt, ttlSeconds, totalAmount };
  });

  // Store hold in Redis with TTL
  const redis = getRedis();
  await redis.set(
    `hold:${holdId}`,
    JSON.stringify({ bookingId, inventoryId: params.inventoryId, quantity }),
    'EX',
    ttlSeconds
  );

  // Broadcast updates
  eventHub.broadcast('booking_state_changed', {
    bookingId,
    fromState: 'PENDING',
    toState: 'HELD',
    reason: `Held ${quantity} seat(s)`,
    operator: 'SYSTEM',
    timestamp: new Date().toISOString()
  });

  await broadcastInventoryUpdate(params.inventoryId);

  return result;
}

interface ExpiredHoldInfo {
  bookingId: string;
  inventoryId: string;
  quantity: number;
}

export async function expireHold(holdId: string): Promise<boolean> {
  // IMPORTANT: nothing in this transaction callback may call the top-level
  // query()/broadcastInventoryUpdate() (as opposed to tx.query()) — PGlite is
  // a single-connection embedded engine, so issuing a query outside the open
  // transaction's own connection while that transaction is still uncommitted
  // deadlocks the whole process forever. Collect what a post-commit broadcast
  // needs here, and only actually broadcast after withTransaction returns.
  const expired = await withTransaction(async (tx: TransactionClient): Promise<ExpiredHoldInfo | null> => {
    // 0. Unlocked lookup to discover the owning booking, so we can take the
    // bookings lock first below. This row can be stale by the time we act on
    // it, but the ACTIVE re-check under lock (step 2) is what actually decides.
    const lookupRes = await tx.query<{ booking_id: string }>(
      `SELECT booking_id FROM holds WHERE id = $1`,
      [holdId]
    );
    if (lookupRes.rowCount === 0) return null;
    const bookingId = lookupRes.rows[0].booking_id;

    // 1. Lock the booking row FIRST. Global lock order across every
    // transaction that touches bookings + holds + inventory together is
    // bookings -> holds -> inventory (see bookings.ts /confirm). Locking
    // holds before bookings here would let this transaction and a
    // concurrent /confirm transaction wait on each other in opposite
    // orders -> deadlock under real concurrent Postgres connections.
    const bookingRes = await tx.query<{ id: string; status: string }>(
      `SELECT id, status FROM bookings WHERE id = $1 FOR UPDATE`,
      [bookingId]
    );
    if (bookingRes.rowCount === 0) return null;

    // 2. Lock the hold row and re-check it's still ACTIVE (single-winner
    // guard against a concurrent confirm/release that already resolved it).
    const holdRes = await tx.query<{
      id: string;
      booking_id: string;
      inventory_id: string;
      quantity: number;
      status: string;
    }>(
      `SELECT id, booking_id, inventory_id, quantity, status FROM holds WHERE id = $1 FOR UPDATE`,
      [holdId]
    );

    if (holdRes.rowCount === 0) return null;
    const hold = holdRes.rows[0];

    if (hold.status !== 'ACTIVE') {
      return null; // Already confirmed, expired, or released
    }

    // 3. Restock inventory (locked last in the global order)
    await tx.query(
      `UPDATE inventory
       SET available_quantity = available_quantity + $1,
           held_quantity = held_quantity - $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [hold.quantity, hold.inventory_id]
    );

    // 4. Mark hold EXPIRED
    await tx.query(`UPDATE holds SET status = 'EXPIRED' WHERE id = $1`, [holdId]);

    // 5. Transition booking to EXPIRED (row already locked in step 1)
    await tx.query(
      `UPDATE bookings SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [hold.booking_id]
    );

    // 6. Audit event
    await tx.query(
      `INSERT INTO booking_events (id, booking_id, from_state, to_state, reason, evidence, operator)
       VALUES ($1, $2, 'HELD', 'EXPIRED', $3, $4, 'HOLD_SWEEPER')`,
      [
        `evt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        hold.booking_id,
        `Hold TTL expired; ${hold.quantity} seat(s) automatically restocked to inventory`,
        JSON.stringify({ holdId, restoredQuantity: hold.quantity })
      ]
    );

    return { bookingId: hold.booking_id, inventoryId: hold.inventory_id, quantity: hold.quantity };
  });

  if (!expired) return false;

  console.log(`[HoldManager] Hold ${holdId} expired. Booking ${expired.bookingId} -> EXPIRED. Restocked ${expired.quantity} seat(s).`);

  // Broadcast only after the transaction has committed.
  eventHub.broadcast('booking_state_changed', {
    bookingId: expired.bookingId,
    fromState: 'HELD',
    toState: 'EXPIRED',
    reason: 'Hold TTL expired; seat released',
    operator: 'HOLD_SWEEPER',
    timestamp: new Date().toISOString()
  });

  eventHub.broadcast('hold_expired', {
    holdId,
    bookingId: expired.bookingId,
    inventoryId: expired.inventoryId
  });

  await broadcastInventoryUpdate(expired.inventoryId);

  return true;
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
    console.error('[HoldManager] Error broadcasting inventory:', err);
  }
}

// Initialize Hold Sweeper listener
export function startHoldSweeper(): void {
  const redis = getRedis();
  redis.onExpiry(async (expiredKey: string) => {
    if (expiredKey.startsWith('hold:')) {
      const holdId = expiredKey.replace('hold:', '');
      console.log(`[HoldSweeper] Intercepted Redis TTL expiry for key ${expiredKey}`);
      try {
        await expireHold(holdId);
      } catch (err) {
        console.error(`[HoldSweeper] Error expiring hold ${holdId}:`, err);
      }
    }
  });

  // Also run periodic sweeper every 3 seconds for expired DB holds (backup safety net)
  setInterval(async () => {
    try {
      const expiredDbHolds = await query<{ id: string }>(
        `SELECT id FROM holds WHERE status = 'ACTIVE' AND expires_at <= CURRENT_TIMESTAMP LIMIT 10`
      );
      for (const row of expiredDbHolds.rows) {
        await expireHold(row.id);
      }
    } catch {
      // ignore
    }
  }, 3000);
}

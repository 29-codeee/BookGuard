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
  idempotencyKey?: string;
  requestHash?: string;
  traceId?: string;
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
  const holdEventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  
  const tId = params.traceId;

  if (tId) {
    eventHub.emitTrace({
      traceId: tId,
      type: 'HOLD',
      stage: 'TRANSACTION_BEGIN',
      message: 'Starting PostgreSQL transaction for hold',
      status: 'running',
      resourceId: params.inventoryId
    });
  }

  const result = await withTransaction(async (tx: TransactionClient) => {
    if (tId) {
      eventHub.emitTrace({
        traceId: tId,
        type: 'HOLD',
        stage: 'INVENTORY_LOCK',
        message: 'Locking inventory row FOR UPDATE',
        status: 'running',
        resourceId: params.inventoryId
      });
    }
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
    
    if (tId) {
      eventHub.emitTrace({
        traceId: tId,
        type: 'HOLD',
        stage: 'INVENTORY_VALIDATION',
        message: `Inventory valid. Available: ${inv.available_quantity}, Requested: ${quantity}`,
        status: 'success',
        resourceId: params.inventoryId,
        data: { available: inv.available_quantity, requested: quantity }
      });
    }

    // 2. Decrement available, increment held
    await tx.query(
      `UPDATE inventory 
       SET available_quantity = available_quantity - $1, 
           held_quantity = held_quantity + $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [quantity, params.inventoryId]
    );

    if (tId) {
      eventHub.emitTrace({
        traceId: tId,
        type: 'HOLD',
        stage: 'INVENTORY_UPDATED',
        message: `Inventory mutated. Held +${quantity}, Available -${quantity}`,
        status: 'success',
        resourceId: params.inventoryId,
        data: { 
          before: { available: inv.available_quantity, held: inv.held_quantity, confirmed: inv.confirmed_quantity, total: inv.total_quantity },
          after: { available: inv.available_quantity - quantity, held: inv.held_quantity + quantity, confirmed: inv.confirmed_quantity, total: inv.total_quantity }
        }
      });
    }

    // 3. Create Booking in HELD status
    await tx.query(
      `INSERT INTO bookings (id, traveller_id, status, total_amount, currency)
       VALUES ($1, $2, 'HELD', $3, 'INR')`,
      [bookingId, params.travellerId, totalAmount]
    );

    if (tId) {
      eventHub.emitTrace({
        traceId: tId,
        type: 'HOLD',
        stage: 'BOOKING_CREATED',
        message: `Created booking ${bookingId} in HELD state`,
        status: 'success',
        bookingId,
        resourceId: params.inventoryId
      });
    }

    // 4. Create Hold record
    await tx.query(
      `INSERT INTO holds (id, booking_id, inventory_id, quantity, expires_at, status)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE')`,
      [holdId, bookingId, params.inventoryId, quantity, expiresAt]
    );
    
    if (tId) {
      eventHub.emitTrace({
        traceId: tId,
        type: 'HOLD',
        stage: 'HOLD_CREATED',
        message: `Created hold ${holdId} (TTL: ${ttlSeconds}s)`,
        status: 'success',
        bookingId,
        holdId,
        resourceId: params.inventoryId,
        data: { expiresAt, ttlSeconds }
      });
    }

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
        holdEventId,
        bookingId,
        `Held ${quantity} seat(s) on ${inv.code} for ${ttlSeconds}s`,
        JSON.stringify({ holdId, ttlSeconds, expiresAt, availableBefore: inv.available_quantity })
      ]
    );

    if (tId) {
      eventHub.emitTrace({
        traceId: tId,
        type: 'HOLD',
        stage: 'BOOKING_EVENT_CREATED',
        message: `Recorded PENDING -> HELD state transition`,
        status: 'success',
        bookingId,
        holdId,
        resourceId: params.inventoryId
      });
    }

    const holdResult = { bookingId, holdId, inventoryId: params.inventoryId, quantity, expiresAt, ttlSeconds, totalAmount };

    // 7. Insert Idempotency Key to serialize concurrent requests
    if (params.idempotencyKey && params.requestHash) {
      const responsePayload = {
        success: true,
        message: 'Seat held successfully',
        hold: holdResult
      };

      try {
        await tx.query(
          `INSERT INTO idempotency_keys (key, request_hash, booking_id, status_code, response_body)
           VALUES ($1, $2, $3, 201, $4)`,
          [params.idempotencyKey, params.requestHash, bookingId, JSON.stringify(responsePayload)]
        );
      } catch (err: any) {
        if (err.code === '23505' || err.message?.includes('UNIQUE constraint failed')) {
          throw new Error('IDEMPOTENCY_CONFLICT');
        }
        throw err;
      }
    }

    return holdResult;
  });

  if (tId) {
    eventHub.emitTrace({
      traceId: tId,
      type: 'HOLD',
      stage: 'TRANSACTION_COMMITTED',
      message: `PostgreSQL transaction committed successfully`,
      status: 'success',
      bookingId,
      holdId,
      resourceId: params.inventoryId
    });
  }

  // Store hold in Redis with TTL
  const redis = getRedis();
  await redis.set(
    `hold:${holdId}`,
    JSON.stringify({ bookingId, inventoryId: params.inventoryId, quantity }),
    'EX',
    ttlSeconds
  );

  if (tId) {
    eventHub.emitTrace({
      traceId: tId,
      type: 'HOLD',
      stage: 'REDIS_TTL_CREATED',
      message: `Set Redis TTL for key hold:${holdId} (${ttlSeconds}s)`,
      status: 'success',
      bookingId,
      holdId,
      resourceId: params.inventoryId
    });
  }

  // Broadcast updates
  eventHub.broadcast('booking_state_changed', {
    eventId: holdEventId,
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

export async function expireHold(holdId: string): Promise<boolean> {
  const traceId = `trc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  
  eventHub.emitTrace({
    traceId,
    type: 'EXPIRY',
    stage: 'EXPIRY_TRIGGERED',
    message: `Triggered expiry for hold ${holdId}`,
    status: 'running',
    holdId
  });

  // We need bookingId to lock booking first to prevent deadlocks with /confirm
  const initial = await query(`SELECT booking_id FROM holds WHERE id = $1`, [holdId]);
  if (initial.rowCount === 0) return false;
  const bookingId = initial.rows[0].booking_id;

  const expiredData = await withTransaction(async (tx: TransactionClient) => {
    eventHub.emitTrace({
      traceId,
      type: 'EXPIRY',
      stage: 'BOOKING_LOCK',
      message: 'Locking booking row FOR UPDATE',
      status: 'running',
      bookingId
    });

    // 1. Lock booking row first
    await tx.query(`SELECT id FROM bookings WHERE id = $1 FOR UPDATE`, [bookingId]);

    eventHub.emitTrace({
      traceId,
      type: 'EXPIRY',
      stage: 'HOLD_LOCK',
      message: 'Locking hold row FOR UPDATE',
      status: 'running',
      bookingId,
      holdId
    });

    // 2. Lock hold row
    const holdRes = await tx.query<{
      id: string;
      booking_id: string;
      inventory_id: string;
      quantity: number;
      status: string;
      expires_at: string;
    }>(
      `SELECT id, booking_id, inventory_id, quantity, status, expires_at FROM holds WHERE id = $1 FOR UPDATE`,
      [holdId]
    );

    if (holdRes.rowCount === 0) return null;
    const hold = holdRes.rows[0];

    // Single-winner check: only expire if currently ACTIVE
    if (hold.status !== 'ACTIVE') {
      eventHub.emitTrace({
        traceId,
        type: 'EXPIRY',
        stage: 'EXPIRY_VALIDATION',
        message: `Hold is not ACTIVE (current: ${hold.status}). Aborting expiry.`,
        status: 'failed',
        bookingId,
        holdId
      });
      return null; // Already confirmed, expired, or released
    }

    // Genuinely expired check: ensure it has actually reached its TTL
    if (new Date(hold.expires_at).getTime() > Date.now()) {
      eventHub.emitTrace({
        traceId,
        type: 'EXPIRY',
        stage: 'EXPIRY_VALIDATION',
        message: `Hold is not genuinely expired yet (expires: ${hold.expires_at}). Aborting.`,
        status: 'failed',
        bookingId,
        holdId
      });
      return null; // Not yet expired
    }

    eventHub.emitTrace({
      traceId,
      type: 'EXPIRY',
      stage: 'EXPIRY_VALIDATION',
      message: `Hold is ACTIVE and genuinely expired. Proceeding to release.`,
      status: 'success',
      bookingId,
      holdId
    });

    eventHub.emitTrace({
      traceId,
      type: 'EXPIRY',
      stage: 'INVENTORY_LOCK',
      message: 'Locking inventory row FOR UPDATE',
      status: 'running',
      bookingId,
      holdId,
      resourceId: hold.inventory_id
    });

    // 3. Lock and restock inventory
    await tx.query(
      `UPDATE inventory 
       SET available_quantity = available_quantity + $1, 
           held_quantity = held_quantity - $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [hold.quantity, hold.inventory_id]
    );

    eventHub.emitTrace({
      traceId,
      type: 'EXPIRY',
      stage: 'INVENTORY_RELEASED',
      message: `Restocked ${hold.quantity} seat(s) back to inventory`,
      status: 'success',
      bookingId,
      holdId,
      resourceId: hold.inventory_id
    });

    // 4. Mark hold EXPIRED
    await tx.query(`UPDATE holds SET status = 'EXPIRED' WHERE id = $1`, [holdId]);

    eventHub.emitTrace({
      traceId,
      type: 'EXPIRY',
      stage: 'HOLD_EXPIRED',
      message: `Hold marked as EXPIRED`,
      status: 'success',
      bookingId,
      holdId,
      resourceId: hold.inventory_id
    });

    // 5. Transition booking to EXPIRED using state machine (this also writes booking_events)
    await transitionBookingState({
      bookingId: hold.booking_id,
      toState: 'EXPIRED',
      reason: `Hold TTL expired; ${hold.quantity} seat(s) automatically restocked to inventory`,
      evidence: { holdId, restoredQuantity: hold.quantity },
      operator: 'HOLD_SWEEPER',
      tx
    });

    console.log(`[HoldManager] Hold ${holdId} expired. Booking ${hold.booking_id} -> EXPIRED. Restocked ${hold.quantity} seat(s).`);

    return hold;
  });

  if (expiredData) {
    eventHub.emitTrace({
      traceId,
      type: 'EXPIRY',
      stage: 'TRANSACTION_COMMITTED',
      message: `Expiry transaction committed successfully`,
      status: 'success',
      bookingId,
      holdId,
      resourceId: expiredData.inventory_id
    });

    eventHub.emitTrace({
      traceId,
      type: 'EXPIRY',
      stage: 'OPERATION_COMPLETED',
      message: `Hold successfully expired`,
      status: 'success',
      bookingId,
      holdId,
      resourceId: expiredData.inventory_id
    });
    // Broadcast outside transaction to prevent deadlocks in single-threaded PGlite engine
    eventHub.broadcast('hold_expired', {
      holdId,
      bookingId: expiredData.booking_id,
      inventoryId: expiredData.inventory_id
    });
    
    // Fire-and-forget inventory update (uses its own query client)
    broadcastInventoryUpdate(expiredData.inventory_id).catch(console.error);
    return true;
  }

  return false;
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

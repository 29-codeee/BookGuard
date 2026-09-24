import { TransactionClient, withTransaction, query } from '../db/client.js';
import { eventHub } from '../sse/eventHub.js';

export type BookingState = 
  | 'PENDING' 
  | 'HELD' 
  | 'RECONCILING' 
  | 'CONFIRMED' 
  | 'FAILED' 
  | 'EXPIRED' 
  | 'RELEASED'
  | 'CANCELLED';

// Allowed state transitions strictly enforced
export const ALLOWED_TRANSITIONS: Record<BookingState, BookingState[]> = {
  PENDING: ['HELD', 'FAILED'],
  HELD: ['CONFIRMED', 'RECONCILING', 'EXPIRED', 'RELEASED', 'FAILED'],
  RECONCILING: ['CONFIRMED', 'FAILED'], // exits only when provider status justifies!
  CONFIRMED: ['CANCELLED'],
  FAILED: [], // terminal
  EXPIRED: [], // terminal
  RELEASED: [], // terminal (hold released by the traveller before payment)
  CANCELLED: [] // terminal
};

export interface TransitionOptions {
  bookingId: string;
  toState: BookingState;
  reason: string;
  evidence?: any;
  operator?: string;
  tx?: TransactionClient; // optional existing transaction
  strict?: boolean; // if true, a booking already in toState is an error instead of a silent success
}

export function canTransition(from: BookingState, to: BookingState): boolean {
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

export async function transitionBookingState(options: TransitionOptions): Promise<{ success: boolean; fromState: BookingState; toState: BookingState }> {
  const { bookingId, toState, reason, evidence, operator = 'SYSTEM' } = options;

  const executeTransition = async (client: TransactionClient) => {
    // 1. Lock the booking row
    const bookingRes = await client.query<{ id: string; status: BookingState }>(
      `SELECT id, status FROM bookings WHERE id = $1 FOR UPDATE`,
      [bookingId]
    );

    if (bookingRes.rowCount === 0) {
      throw new Error(`[StateMachine] Booking ${bookingId} not found`);
    }

    const currentStatus = bookingRes.rows[0].status;

    // Check if idempotent / already in target state
    if (currentStatus === toState && !options.strict) {
      return { success: true, fromState: currentStatus, toState };
    }

    // Validate transition
    const validTargets = ALLOWED_TRANSITIONS[currentStatus] || [];
    if (!validTargets.includes(toState)) {
      throw new Error(`[StateMachine] Invalid state transition from ${currentStatus} to ${toState} for booking ${bookingId}`);
    }

    // 2. Update booking status
    await client.query(
      `UPDATE bookings SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [toState, bookingId]
    );

    // 3. Write immutable audit log to booking_events
    const eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    await client.query(
      `INSERT INTO booking_events (id, booking_id, from_state, to_state, reason, evidence, operator)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        eventId,
        bookingId,
        currentStatus,
        toState,
        reason,
        evidence ? JSON.stringify(evidence) : null,
        operator
      ]
    );

    return { success: true, fromState: currentStatus, toState };
  };

  let result;
  if (options.tx) {
    result = await executeTransition(options.tx);
  } else {
    result = await withTransaction(executeTransition);
  }

  // Broadcast state change over SSE
  eventHub.broadcast('booking_state_changed', {
    bookingId,
    fromState: result.fromState,
    toState: result.toState,
    reason,
    operator,
    timestamp: new Date().toISOString()
  });

  return result;
}

export async function getBookingEvents(bookingId: string) {
  const res = await query(
    `SELECT * FROM booking_events WHERE booking_id = $1 ORDER BY created_at ASC`,
    [bookingId]
  );
  return res.rows;
}

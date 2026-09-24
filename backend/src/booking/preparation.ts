/**
 * High-Demand / Tatkal prepared booking flow.
 *
 *   Prepare trip -> passengers -> selected train -> payment preference
 *     -> booking window opens -> explicit user approval -> execute
 *   execute = the normal engine hold (same locking, same invariant, same idempotency)
 *     -> demo payment + POST /api/bookings/confirm (the normal confirm endpoint)
 *
 * Nothing here bypasses authentication, payment, CAPTCHA or provider controls: the
 * preparation only stores what the traveller entered ahead of time, and the final
 * booking goes through exactly the same engine calls as a normal booking.
 */
import crypto from 'crypto';
import { query, withTransaction, TransactionClient } from '../db/client.js';
import { holdInventory, HoldResult, MAX_QUANTITY_PER_HOLD } from './engine.js';
import { BookingError } from './errors.js';
import { beginIdempotent, completeIdempotent, abandonIdempotent, hashRequest } from './idempotency.js';

export type PreparationMode = 'TATKAL' | 'HIGH_DEMAND';
export type PreparationStatus = 'DRAFT' | 'READY' | 'APPROVED' | 'SUBMITTED' | 'CANCELLED';

export const MAX_TATKAL_PASSENGERS = 4;
export const PAYMENT_METHODS = ['UPI', 'CARD', 'NETBANKING', 'WALLET'] as const;
// The preparation stores a preference only. Secrets must never be pre-filled.
const FORBIDDEN_PAYMENT_FIELDS = ['cardNumber', 'cvv', 'cvc', 'pin', 'upiPin', 'otp', 'password', 'expiry'];

export interface TripDetails {
  origin: string;
  destination: string;
  travelDate: string; // YYYY-MM-DD
  travelClass?: string;
}

export interface PassengerDetails {
  name: string;
  age: number;
  gender?: string;
  berthPreference?: string;
}

export interface PaymentPreference {
  method: (typeof PAYMENT_METHODS)[number];
  label?: string;
}

interface PreparationRow {
  id: string;
  traveller_id: string;
  mode: PreparationMode;
  status: PreparationStatus;
  trip: TripDetails | null;
  passengers: PassengerDetails[] | null;
  inventory_id: string | null;
  payment_preference: PaymentPreference | null;
  window_opens_at: string | Date | null;
  approved_at: string | Date | null;
  booking_id: string | null;
  window_open: boolean;
  seconds_until_window: string | number | null;
  created_at: string;
  updated_at: string;
}

const SELECT_PREP = `
  SELECT id, traveller_id, mode, status, trip, passengers, inventory_id, payment_preference,
         window_opens_at, approved_at, booking_id, created_at, updated_at,
         (window_opens_at IS NULL OR window_opens_at <= CURRENT_TIMESTAMP) AS window_open,
         GREATEST(0, CEIL(EXTRACT(EPOCH FROM (window_opens_at - CURRENT_TIMESTAMP)))) AS seconds_until_window
  FROM booking_preparations`;

function checklist(p: PreparationRow) {
  return {
    trip: Boolean(p.trip),
    passengers: Array.isArray(p.passengers) && p.passengers.length > 0,
    selection: Boolean(p.inventory_id),
    payment: Boolean(p.payment_preference)
  };
}

function isComplete(p: PreparationRow): boolean {
  return Object.values(checklist(p)).every(Boolean);
}

function nextAction(p: PreparationRow): string {
  if (p.status === 'CANCELLED') return 'NONE';
  if (p.status === 'SUBMITTED') return 'CONFIRM_PAYMENT';
  const c = checklist(p);
  if (!c.trip) return 'PREPARE_TRIP';
  if (!c.passengers) return 'PREPARE_PASSENGERS';
  if (!c.selection) return 'SELECT_INVENTORY';
  if (!c.payment) return 'PREPARE_PAYMENT';
  if (!p.window_open) return 'WAIT_FOR_WINDOW';
  if (p.status !== 'APPROVED') return 'AWAIT_USER_APPROVAL';
  return 'EXECUTE';
}

function toIso(v: string | Date | null): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

async function toView(p: PreparationRow) {
  let selection = null;
  if (p.inventory_id) {
    const inv = await query(
      `SELECT id, resource_type, code, name, origin, destination, travel_date, departure_time,
              price, available_quantity, total_quantity
       FROM inventory WHERE id = $1`,
      [p.inventory_id]
    );
    selection = inv.rows[0] ?? null;
  }
  let booking = null;
  if (p.booking_id) {
    const b = await query(`SELECT id, status FROM bookings WHERE id = $1`, [p.booking_id]);
    booking = b.rows[0] ? { bookingId: b.rows[0].id, status: b.rows[0].status } : null;
  }
  return {
    preparationId: p.id,
    travellerId: p.traveller_id,
    mode: p.mode,
    status: p.status,
    trip: p.trip,
    passengers: p.passengers ?? [],
    inventoryId: p.inventory_id,
    selection,
    paymentPreference: p.payment_preference,
    windowOpensAt: toIso(p.window_opens_at),
    windowOpen: Boolean(p.window_open),
    secondsUntilWindow: p.window_open ? 0 : Number(p.seconds_until_window ?? 0),
    approvedAt: toIso(p.approved_at),
    bookingId: p.booking_id,
    booking,
    checklist: checklist(p),
    nextAction: nextAction(p),
    createdAt: p.created_at,
    updatedAt: p.updated_at
  };
}

export type PreparationView = Awaited<ReturnType<typeof toView>>;

async function loadPrep(id: string, tx?: TransactionClient, lock = false): Promise<PreparationRow> {
  const sql = `${SELECT_PREP} WHERE id = $1${lock ? ' FOR UPDATE' : ''}`;
  const res = tx ? await tx.query<PreparationRow>(sql, [id]) : await query<PreparationRow>(sql, [id]);
  if (res.rows.length === 0) {
    throw new BookingError('PREPARATION_NOT_FOUND', 404, `Prepared booking ${id} not found`);
  }
  return res.rows[0];
}

/**
 * Locks the preparation, applies an edit, and recomputes DRAFT/READY.
 * Any edit after approval clears the approval: the user must approve what will actually be booked.
 */
async function mutate(
  id: string,
  apply: (tx: TransactionClient, current: PreparationRow) => Promise<void>
): Promise<PreparationView> {
  await withTransaction(async tx => {
    const current = await loadPrep(id, tx, true);
    if (current.status === 'SUBMITTED' || current.status === 'CANCELLED') {
      throw new BookingError('PREPARATION_LOCKED', 409, `Prepared booking is ${current.status} and can no longer be edited`);
    }
    await apply(tx, current);
    const updated = await loadPrep(id, tx);
    const status: PreparationStatus = isComplete(updated) ? 'READY' : 'DRAFT';
    await tx.query(
      `UPDATE booking_preparations SET status = $2, approved_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id, status]
    );
  });
  return getPreparation(id);
}

function requireString(value: unknown, field: string, max = 64): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new BookingError('INVALID_REQUEST', 400, `${field} is required (max ${max} characters)`);
  }
  return value.trim();
}

function parseWindow(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) {
    throw new BookingError('INVALID_REQUEST', 400, 'windowOpensAt must be an ISO-8601 timestamp');
  }
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function createPreparation(input: {
  travellerId?: string;
  mode?: PreparationMode;
  windowOpensAt?: string | null;
}): Promise<PreparationView> {
  const travellerId = input.travellerId || 'traveller_priya';
  const mode = input.mode ?? 'TATKAL';
  if (mode !== 'TATKAL' && mode !== 'HIGH_DEMAND') {
    throw new BookingError('INVALID_REQUEST', 400, `mode must be TATKAL or HIGH_DEMAND`);
  }
  const traveller = await query(`SELECT id FROM travellers WHERE id = $1`, [travellerId]);
  if (traveller.rows.length === 0) {
    throw new BookingError('TRAVELLER_NOT_FOUND', 404, `Traveller ${travellerId} not found`);
  }
  const id = `prep_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
  await query(
    `INSERT INTO booking_preparations (id, traveller_id, mode, status, window_opens_at)
     VALUES ($1, $2, $3, 'DRAFT', $4)`,
    [id, travellerId, mode, parseWindow(input.windowOpensAt)]
  );
  return getPreparation(id);
}

export async function getPreparation(id: string): Promise<PreparationView> {
  return toView(await loadPrep(id));
}

export async function listPreparations(travellerId: string): Promise<PreparationView[]> {
  const res = await query<PreparationRow>(`${SELECT_PREP} WHERE traveller_id = $1 ORDER BY created_at DESC`, [travellerId]);
  return Promise.all(res.rows.map(toView));
}

export async function updateTrip(id: string, trip: Partial<TripDetails>): Promise<PreparationView> {
  const value: TripDetails = {
    origin: requireString(trip?.origin, 'origin').toUpperCase(),
    destination: requireString(trip?.destination, 'destination').toUpperCase(),
    travelDate: requireString(trip?.travelDate, 'travelDate', 10)
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.travelDate)) {
    throw new BookingError('INVALID_REQUEST', 400, 'travelDate must be YYYY-MM-DD');
  }
  if (trip.travelClass) value.travelClass = requireString(trip.travelClass, 'travelClass', 32);
  return mutate(id, async tx => {
    await tx.query(`UPDATE booking_preparations SET trip = $2::jsonb WHERE id = $1`, [id, JSON.stringify(value)]);
  });
}

export async function updatePassengers(id: string, passengers: unknown): Promise<PreparationView> {
  if (!Array.isArray(passengers) || passengers.length === 0) {
    throw new BookingError('INVALID_REQUEST', 400, 'passengers must be a non-empty array');
  }
  const clean: PassengerDetails[] = passengers.map((p: any, i: number) => {
    const age = Number(p?.age);
    if (!Number.isInteger(age) || age < 1 || age > 125) {
      throw new BookingError('INVALID_REQUEST', 400, `passengers[${i}].age must be an integer between 1 and 125`);
    }
    const out: PassengerDetails = { name: requireString(p?.name, `passengers[${i}].name`, 100), age };
    if (p?.gender) out.gender = requireString(p.gender, `passengers[${i}].gender`, 16);
    if (p?.berthPreference) out.berthPreference = requireString(p.berthPreference, `passengers[${i}].berthPreference`, 32);
    return out;
  });
  return mutate(id, async (tx, current) => {
    const max = current.mode === 'TATKAL' ? MAX_TATKAL_PASSENGERS : MAX_QUANTITY_PER_HOLD;
    if (clean.length > max) {
      throw new BookingError('INVALID_REQUEST', 400, `${current.mode} bookings allow at most ${max} passengers`);
    }
    await tx.query(`UPDATE booking_preparations SET passengers = $2::jsonb WHERE id = $1`, [id, JSON.stringify(clean)]);
  });
}

export async function selectInventory(id: string, inventoryId: unknown): Promise<PreparationView> {
  const invId = requireString(inventoryId, 'inventoryId');
  return mutate(id, async (tx, current) => {
    const inv = await tx.query<{ resource_type: string; origin: string; destination: string; travel_date: string }>(
      `SELECT resource_type, origin, destination, travel_date::text AS travel_date FROM inventory WHERE id = $1`,
      [invId]
    );
    if (inv.rows.length === 0) {
      throw new BookingError('INVENTORY_NOT_FOUND', 404, `Inventory ${invId} not found`);
    }
    const item = inv.rows[0];
    if (current.mode === 'TATKAL' && item.resource_type !== 'train') {
      throw new BookingError('INVALID_SELECTION', 400, 'Tatkal mode requires a train');
    }
    const trip = current.trip;
    if (
      trip &&
      (item.origin.toUpperCase() !== trip.origin ||
        item.destination.toUpperCase() !== trip.destination ||
        item.travel_date !== trip.travelDate)
    ) {
      throw new BookingError('INVALID_SELECTION', 400, 'Selected item does not match the prepared trip (origin, destination, date)');
    }
    await tx.query(`UPDATE booking_preparations SET inventory_id = $2 WHERE id = $1`, [id, invId]);
  });
}

export async function updatePaymentPreference(id: string, pref: any): Promise<PreparationView> {
  const method = String(pref?.method ?? '').toUpperCase();
  if (!(PAYMENT_METHODS as readonly string[]).includes(method)) {
    throw new BookingError('INVALID_REQUEST', 400, `method must be one of ${PAYMENT_METHODS.join(', ')}`);
  }
  const forbidden = Object.keys(pref ?? {}).filter(k => FORBIDDEN_PAYMENT_FIELDS.includes(k));
  if (forbidden.length > 0) {
    throw new BookingError(
      'SENSITIVE_PAYMENT_DATA_REJECTED',
      400,
      `Do not store payment secrets in a preparation (${forbidden.join(', ')}); they are entered at payment time`
    );
  }
  const value: PaymentPreference = { method: method as PaymentPreference['method'] };
  if (pref?.label) value.label = requireString(pref.label, 'label', 64);
  return mutate(id, async tx => {
    await tx.query(`UPDATE booking_preparations SET payment_preference = $2::jsonb WHERE id = $1`, [
      id,
      JSON.stringify(value)
    ]);
  });
}

export async function updateWindow(id: string, windowOpensAt: unknown): Promise<PreparationView> {
  const value = parseWindow(windowOpensAt);
  return mutate(id, async tx => {
    await tx.query(`UPDATE booking_preparations SET window_opens_at = $2 WHERE id = $1`, [id, value]);
  });
}

/** Explicit user approval. Only possible once everything is prepared and the booking window is open. */
export async function approvePreparation(id: string, userApproved: unknown): Promise<PreparationView> {
  if (userApproved !== true) {
    throw new BookingError('USER_APPROVAL_REQUIRED', 400, 'userApproved must be true; the traveller has to approve the booking');
  }
  await withTransaction(async tx => {
    const p = await loadPrep(id, tx, true);
    if (p.status === 'APPROVED') return; // idempotent
    if (p.status !== 'READY') {
      throw new BookingError('PREPARATION_NOT_READY', 409, `Prepared booking is ${p.status}; complete all steps first`, {
        checklist: checklist(p),
        nextAction: nextAction(p)
      });
    }
    if (!p.window_open) {
      throw new BookingError('BOOKING_WINDOW_NOT_OPEN', 409, 'The booking window has not opened yet', {
        windowOpensAt: toIso(p.window_opens_at),
        secondsUntilWindow: Number(p.seconds_until_window ?? 0)
      });
    }
    await tx.query(
      `UPDATE booking_preparations SET status = 'APPROVED', approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'READY'`,
      [id]
    );
  });
  return getPreparation(id);
}

export async function cancelPreparation(id: string): Promise<PreparationView> {
  await withTransaction(async tx => {
    const p = await loadPrep(id, tx, true);
    if (p.status === 'CANCELLED') return;
    if (p.status === 'SUBMITTED') {
      throw new BookingError(
        'PREPARATION_LOCKED',
        409,
        'Already submitted; release or cancel the booking via /api/bookings instead',
        { bookingId: p.booking_id }
      );
    }
    await tx.query(
      `UPDATE booking_preparations SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id]
    );
  });
  return getPreparation(id);
}

function buildExecuteResponse(prep: PreparationRow, hold: HoldResult) {
  const passengers = prep.passengers ?? [];
  return {
    success: true,
    message: 'Prepared booking submitted: inventory held through the standard booking engine',
    preparationId: prep.id,
    hold,
    next: {
      action: 'CONFIRM_PAYMENT',
      method: 'POST',
      endpoint: '/api/bookings/confirm',
      idempotencyKey: `prep:${prep.id}:confirm`,
      body: {
        bookingId: hold.bookingId,
        travellerName: passengers[0]?.name,
        passengerDetails: { name: passengers[0]?.name, passengers },
        paymentDetails: { method: prep.payment_preference?.method, demo: true }
      }
    }
  };
}

/**
 * Final step. Creates the hold with the *normal* engine call. Idempotent per preparation:
 * retries (or double clicks) replay the first result instead of holding more inventory.
 */
export async function executePreparation(
  id: string,
  opts: { ttlSeconds?: number } = {}
): Promise<{ statusCode: number; body: any; replayed: boolean }> {
  const key = `prep:${id}:execute`;
  const begin = await beginIdempotent('prepared_execute', key, hashRequest('prepared_execute', { id }));
  if (begin.kind === 'replay') return { statusCode: begin.statusCode, body: begin.body, replayed: true };

  try {
    const prep = await loadPrep(id);
    if (prep.status !== 'APPROVED') {
      throw new BookingError('PREPARATION_NOT_APPROVED', 409, `Prepared booking is ${prep.status}; user approval is required`, {
        nextAction: nextAction(prep)
      });
    }
    if (!prep.window_open) {
      throw new BookingError('BOOKING_WINDOW_NOT_OPEN', 409, 'The booking window has not opened yet');
    }

    const { response } = await holdInventory({
      travellerId: prep.traveller_id,
      inventoryId: prep.inventory_id as string,
      quantity: prep.passengers?.length ?? 1,
      ttlSeconds: opts.ttlSeconds,
      bookingMode: prep.mode,
      // Same transaction as the hold: the preparation flips to SUBMITTED only if the hold commits.
      onHeld: async (tx, hold) => {
        const upd = await tx.query(
          `UPDATE booking_preparations
           SET status = 'SUBMITTED', booking_id = $2, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND status = 'APPROVED'
             AND (window_opens_at IS NULL OR window_opens_at <= CURRENT_TIMESTAMP)
           RETURNING id`,
          [id, hold.bookingId]
        );
        if (upd.rows.length !== 1) {
          throw new BookingError('PREPARATION_NOT_APPROVED', 409, 'Prepared booking changed before submission');
        }
      },
      onCommitResponse: (tx, hold) =>
        completeIdempotent(key, 201, buildExecuteResponse(prep, hold), hold.bookingId, tx)
    });
    return { statusCode: 201, body: response, replayed: false };
  } catch (err) {
    // Nothing was allocated, so the attempt may be retried (e.g. seats free up again).
    await abandonIdempotent(key);
    throw err;
  }
}

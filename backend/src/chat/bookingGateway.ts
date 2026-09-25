/**
 * BOOKING API REQUESTS: the chatbot's hand-off to booking modules.
 *
 *   AI Chatbot -> BookingRequest -> [module registry] -> Hotel / Transport service
 *                                                     -> Payment demo -> Saga / rollback
 *
 * The chatbot never completes a booking itself. It builds a predictable request,
 * stores it in `booking_requests`, and dispatches it to the module registered for its type.
 *
 * Default modules:
 *  - item linked to BookGuard inventory -> reserve via the booking engine (status HELD);
 *    the Payment Demo step is POST /api/bookings/confirm with the returned bookingId.
 *  - otherwise -> PENDING_MODULE, for a teammate's service to pick up
 *    (GET /api/booking-requests?status=PENDING_MODULE, then PATCH its status).
 *
 * Teammates replace a default with registerBookingModule('hotel_booking', myHotelService).
 */
import crypto from 'crypto';
import { query } from '../db/client.js';
import { holdInventory, getBookingStatus } from '../booking/engine.js';
import { isBookingError } from '../booking/errors.js';
import type { HotelOption, TransportOption, TripState } from './types.js';
import { addDaysIso, nightsFor, roomsFor } from './planner.js';

export const DEMO_TRAVELLER_ID = process.env.CHAT_DEMO_TRAVELLER_ID || 'traveller_priya';
const ENGINE_MAX_UNITS = 6;
const HOLD_TTL_SECONDS = 45;

export interface HotelBookingRequest {
  type: 'hotel_booking';
  requestId: string;
  sessionId: string | null;
  destination: string;
  destinationCode: string;
  travellers: number;
  rooms: number;
  checkIn: string;
  checkOut: string;
  nights: number;
  hotelId: string;
  hotelName: string;
  pricePerNight: number;
  estimatedTotal: number;
  currency: 'INR';
  inventoryId: string | null;
  demo: true;
}

export interface TransportBookingRequest {
  type: 'transport_booking';
  requestId: string;
  sessionId: string | null;
  from: string;
  fromCode: string;
  to: string;
  toCode: string;
  travellers: number;
  date: string;
  returnDate: string | null;
  mode: 'flight' | 'train' | 'bus';
  optionId: string;
  operator: string;
  code: string;
  pricePerPerson: number;
  estimatedTotal: number;
  currency: 'INR';
  inventoryId: string | null;
  demo: true;
}

export type BookingRequest = HotelBookingRequest | TransportBookingRequest;

export type BookingRequestStatus =
  | 'RECEIVED'
  | 'HELD'
  | 'PENDING_MODULE'
  | 'REJECTED'
  | 'CONFIRMED'
  | 'FAILED'
  | 'CANCELLED';

export interface ModuleResult {
  status: BookingRequestStatus;
  module: string;
  message: string;
  bookingId?: string | null;
  holdExpiresAt?: string | null;
}

export type BookingModule = (request: BookingRequest) => Promise<ModuleResult>;

export interface BookingRequestRecord {
  requestId: string;
  type: BookingRequest['type'];
  status: BookingRequestStatus;
  module: string | null;
  message: string | null;
  bookingId: string | null;
  externalRef: string | null;
  request: BookingRequest;
  booking: unknown | null;
  next: { action: string; method: string; endpoint: string; body: unknown; note: string } | null;
  createdAt: string;
  updatedAt: string;
  duplicate?: boolean;
}

export class BookingRequestError extends Error {
  constructor(public readonly code: string, message: string, public readonly httpStatus = 400) {
    super(message);
    this.name = 'BookingRequestError';
  }
}

// ---------------------------------------------------------------------------
// Request builders (from chatbot trip state)
// ---------------------------------------------------------------------------

function requireTripBasics(trip: TripState) {
  if (!trip.destination || !trip.startDate || !trip.durationDays || !trip.travellers) {
    throw new BookingRequestError(
      'INCOMPLETE_TRIP',
      'Destination, travel date, duration and number of travellers are needed before booking'
    );
  }
  return {
    destination: trip.destination,
    startDate: trip.startDate,
    durationDays: trip.durationDays,
    travellers: trip.travellers
  };
}

export function buildHotelRequest(trip: TripState, hotel: HotelOption, sessionId: string | null): HotelBookingRequest {
  const b = requireTripBasics(trip);
  const nights = nightsFor(b.durationDays);
  const rooms = roomsFor(b.travellers);
  return {
    type: 'hotel_booking',
    requestId: `breq_${crypto.randomUUID()}`,
    sessionId,
    destination: b.destination.name,
    destinationCode: b.destination.code,
    travellers: b.travellers,
    rooms,
    checkIn: b.startDate,
    checkOut: addDaysIso(b.startDate, nights),
    nights,
    hotelId: hotel.id,
    hotelName: hotel.name,
    pricePerNight: hotel.pricePerNight,
    estimatedTotal: hotel.pricePerNight * rooms * nights,
    currency: 'INR',
    inventoryId: hotel.inventoryId,
    demo: true
  };
}

export function buildTransportRequest(
  trip: TripState,
  option: TransportOption,
  sessionId: string | null
): TransportBookingRequest {
  const b = requireTripBasics(trip);
  if (!trip.origin) throw new BookingRequestError('INCOMPLETE_TRIP', 'Starting city is needed before booking transport');
  return {
    type: 'transport_booking',
    requestId: `breq_${crypto.randomUUID()}`,
    sessionId,
    from: trip.origin.name,
    fromCode: trip.origin.code,
    to: b.destination.name,
    toCode: b.destination.code,
    travellers: b.travellers,
    date: b.startDate,
    returnDate: addDaysIso(b.startDate, Math.max(0, b.durationDays - 1)),
    mode: option.mode,
    optionId: option.id,
    operator: option.operator,
    code: option.code,
    pricePerPerson: option.pricePerPerson,
    estimatedTotal: option.pricePerPerson * b.travellers,
    currency: 'INR',
    inventoryId: option.inventoryId,
    demo: true
  };
}

// ---------------------------------------------------------------------------
// Validation (for requests posted directly by other modules / the UI)
// ---------------------------------------------------------------------------

const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const isPosInt = (v: unknown, max: number) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= max;

export function validateBookingRequest(req: any): string[] {
  const errors: string[] = [];
  if (!req || typeof req !== 'object') return ['request body must be an object'];
  if (req.type !== 'hotel_booking' && req.type !== 'transport_booking') {
    errors.push("type must be 'hotel_booking' or 'transport_booking'");
    return errors;
  }
  if (!isPosInt(req.travellers, 20)) errors.push('travellers must be an integer between 1 and 20');
  if (req.type === 'hotel_booking') {
    if (!req.hotelId) errors.push('hotelId is required');
    if (!req.destination) errors.push('destination is required');
    if (!isDate(req.checkIn)) errors.push('checkIn must be YYYY-MM-DD');
    if (!isDate(req.checkOut)) errors.push('checkOut must be YYYY-MM-DD');
    if (isDate(req.checkIn) && isDate(req.checkOut) && req.checkOut <= req.checkIn) errors.push('checkOut must be after checkIn');
  } else {
    if (!req.from) errors.push('from is required');
    if (!req.to) errors.push('to is required');
    if (!isDate(req.date)) errors.push('date must be YYYY-MM-DD');
    if (!req.optionId && !req.mode) errors.push('optionId or mode is required');
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Module registry
// ---------------------------------------------------------------------------

const unitsFor = (req: BookingRequest) => (req.type === 'hotel_booking' ? req.rooms : req.travellers);

/** Default module for items that exist in BookGuard inventory: a normal engine hold. */
const bookguardInventoryModule: BookingModule = async req => {
  const units = unitsFor(req);
  if (!req.inventoryId) {
    return pendingModule(req);
  }
  if (units > ENGINE_MAX_UNITS) {
    return {
      status: 'PENDING_MODULE',
      module: req.type === 'hotel_booking' ? 'hotel-service' : 'transport-service',
      message: `Group of ${units} exceeds the ${ENGINE_MAX_UNITS}-unit instant hold limit; queued for the group-booking desk`
    };
  }
  try {
    const { hold } = await holdInventory({
      travellerId: DEMO_TRAVELLER_ID,
      inventoryId: req.inventoryId,
      quantity: units,
      ttlSeconds: HOLD_TTL_SECONDS
    });
    return {
      status: 'HELD',
      module: 'bookguard-engine',
      message: `${units} ${req.type === 'hotel_booking' ? 'room(s)' : 'seat(s)'} reserved for ${HOLD_TTL_SECONDS / 60} minutes pending demo payment`,
      bookingId: hold.bookingId,
      holdExpiresAt: hold.expiresAt
    };
  } catch (err) {
    if (isBookingError(err)) {
      return {
        status: 'REJECTED',
        module: 'bookguard-engine',
        message:
          err.code === 'INSUFFICIENT_INVENTORY'
            ? 'Not enough availability left for this option'
            : `Booking module rejected the request (${err.code})`
      };
    }
    throw err;
  }
};

/** Default for demo-only items: park the request for the owning teammate's service. */
function pendingModule(req: BookingRequest): ModuleResult {
  return {
    status: 'PENDING_MODULE',
    module: req.type === 'hotel_booking' ? 'hotel-service' : 'transport-service',
    message: 'Demo option: request queued for the booking module (no real booking made)'
  };
}

const registry = new Map<BookingRequest['type'], BookingModule>([
  ['hotel_booking', bookguardInventoryModule],
  ['transport_booking', bookguardInventoryModule]
]);

/** Integration hook for teammates' Hotel / Transport services. */
export function registerBookingModule(type: BookingRequest['type'], module: BookingModule): void {
  registry.set(type, module);
}

// ---------------------------------------------------------------------------
// Dispatch + persistence
// ---------------------------------------------------------------------------

function dedupeKey(req: BookingRequest): string {
  const essence =
    req.type === 'hotel_booking'
      ? [req.sessionId, req.type, req.hotelId, req.checkIn, req.checkOut, req.rooms]
      : [req.sessionId, req.type, req.optionId, req.date, req.travellers];
  return crypto.createHash('sha256').update(JSON.stringify(essence)).digest('hex').slice(0, 64);
}

interface Row {
  id: string;
  type: BookingRequest['type'];
  payload: BookingRequest;
  status: BookingRequestStatus;
  module: string | null;
  booking_id: string | null;
  external_ref: string | null;
  message: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

const iso = (v: string | Date) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

async function toRecord(row: Row): Promise<BookingRequestRecord> {
  let booking: any = null;
  if (row.booking_id) {
    try {
      booking = await getBookingStatus(row.booking_id);
    } catch {
      booking = null;
    }
  }
  const status = liveStatus(row.status, booking?.status);
  return {
    requestId: row.id,
    type: row.type,
    status,
    module: row.module,
    message: row.message,
    bookingId: row.booking_id,
    externalRef: row.external_ref,
    request: row.payload,
    booking,
    next:
      status === 'HELD' && row.booking_id
        ? {
            action: 'DEMO_PAYMENT_AND_CONFIRM',
            method: 'POST',
            endpoint: '/api/bookings/confirm',
            body: { bookingId: row.booking_id, paymentDetails: { method: 'DEMO', demo: true } },
            note: 'Handled by the Payment Demo module; send an Idempotency-Key header'
          }
        : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

/** A request linked to an engine booking reflects that booking's live state. */
function liveStatus(stored: BookingRequestStatus, bookingStatus?: string): BookingRequestStatus {
  if (stored !== 'HELD' || !bookingStatus) return stored;
  if (bookingStatus === 'CONFIRMED') return 'CONFIRMED';
  if (bookingStatus === 'CANCELLED') return 'CANCELLED';
  if (['EXPIRED', 'RELEASED', 'FAILED'].includes(bookingStatus)) return 'FAILED';
  return stored;
}

export async function submitBookingRequest(req: BookingRequest): Promise<BookingRequestRecord> {
  const errors = validateBookingRequest(req);
  if (errors.length > 0) throw new BookingRequestError('INVALID_BOOKING_REQUEST', errors.join('; '));

  // 1. Record first. The dedupe key makes a double-clicked "Book" return the same request.
  const key = dedupeKey(req);
  const inserted = await query<Row>(
    `INSERT INTO booking_requests (id, session_id, type, payload, status, dedupe_key)
     VALUES ($1, $2, $3, $4::jsonb, 'RECEIVED', $5)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING *`,
    [req.requestId, req.sessionId, req.type, JSON.stringify(req), key]
  );
  if (inserted.rows.length === 0) {
    const existing = await query<Row>(`SELECT * FROM booking_requests WHERE dedupe_key = $1`, [key]);
    const record = await toRecord(existing.rows[0]);
    // A previous attempt that did not reserve anything may be retried.
    if (!['REJECTED', 'FAILED', 'CANCELLED'].includes(record.status)) return { ...record, duplicate: true };
    await query(`UPDATE booking_requests SET dedupe_key = NULL WHERE id = $1`, [record.requestId]);
    return submitBookingRequest({ ...req, requestId: `breq_${crypto.randomUUID()}` });
  }

  // 2. Dispatch to the registered module.
  let result: ModuleResult;
  try {
    result = await registry.get(req.type)!(req);
  } catch (err) {
    console.error('[BookingGateway] Module failure:', err);
    result = { status: 'REJECTED', module: 'unknown', message: 'The booking module is unavailable right now' };
  }

  const updated = await query<Row>(
    `UPDATE booking_requests
     SET status = $2, module = $3, message = $4, booking_id = $5, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 RETURNING *`,
    [req.requestId, result.status, result.module, result.message, result.bookingId ?? null]
  );
  return toRecord(updated.rows[0]);
}

export async function getBookingRequest(requestId: string): Promise<BookingRequestRecord | null> {
  const res = await query<Row>(`SELECT * FROM booking_requests WHERE id = $1`, [requestId]);
  return res.rows[0] ? toRecord(res.rows[0]) : null;
}

export async function listBookingRequests(filter: { status?: string; type?: string; sessionId?: string }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.status) where.push(`status = $${params.push(filter.status)}`);
  if (filter.type) where.push(`type = $${params.push(filter.type)}`);
  if (filter.sessionId) where.push(`session_id = $${params.push(filter.sessionId)}`);
  const res = await query<Row>(
    `SELECT * FROM booking_requests ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC LIMIT 200`,
    params
  );
  return Promise.all(res.rows.map(toRecord));
}

const MODULE_STATUSES: BookingRequestStatus[] = ['PENDING_MODULE', 'CONFIRMED', 'FAILED', 'CANCELLED', 'REJECTED'];

/** Modules report progress back (e.g. hotel service confirmed, saga rolled back). */
export async function updateBookingRequestStatus(
  requestId: string,
  update: { status: string; externalRef?: string; message?: string; module?: string }
): Promise<BookingRequestRecord> {
  if (!MODULE_STATUSES.includes(update.status as BookingRequestStatus)) {
    throw new BookingRequestError('INVALID_STATUS', `status must be one of ${MODULE_STATUSES.join(', ')}`);
  }
  const res = await query<Row>(
    `UPDATE booking_requests
     SET status = $2, external_ref = COALESCE($3, external_ref), message = COALESCE($4, message),
         module = COALESCE($5, module), updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 RETURNING *`,
    [requestId, update.status, update.externalRef ?? null, update.message ?? null, update.module ?? null]
  );
  if (res.rows.length === 0) throw new BookingRequestError('NOT_FOUND', `Booking request ${requestId} not found`, 404);
  return toRecord(res.rows[0]);
}

import { FastifyInstance, FastifyPluginOptions, FastifyReply } from 'fastify';
import { query } from '../db/client.js';
import {
  holdInventory,
  confirmBooking,
  cancelBooking,
  releaseBooking,
  getBookingStatus,
  HoldResult,
  ConfirmResult
} from '../booking/engine.js';
import { BookingError, isBookingError } from '../booking/errors.js';
import {
  readIdempotencyKey,
  hashRequest,
  beginIdempotent,
  completeIdempotent,
  abandonIdempotent
} from '../booking/idempotency.js';
import { runReconciliationCopilot } from '../ai/copilot.js';
import { getRecoveryAlternatives } from '../ai/recovery.js';
import { eventHub } from '../sse/eventHub.js';

function newTraceId(): string {
  return `trc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export function buildHoldResponse(hold: HoldResult) {
  return { success: true, message: 'Seat held successfully', hold };
}

async function recoveryFor(inventoryId: string | undefined, language = 'en') {
  try {
    const inv = inventoryId
      ? await query<{ origin: string; destination: string }>(`SELECT origin, destination FROM inventory WHERE id = $1`, [inventoryId])
      : { rows: [] as { origin: string; destination: string }[] };
    const origin = inv.rows[0]?.origin ?? 'BLR';
    const destination = inv.rows[0]?.destination ?? 'GOI';
    return await getRecoveryAlternatives(origin, destination, inventoryId ?? '', language);
  } catch (err) {
    console.error('[Bookings] Recovery lookup failed:', err);
    return null;
  }
}

function sendError(reply: FastifyReply, err: unknown) {
  if (isBookingError(err)) {
    return reply.status(err.httpStatus).send(err.toBody());
  }
  console.error('[Bookings] Unexpected error:', err);
  return reply.status(500).send({ success: false, error: 'INTERNAL_ERROR', message: (err as Error)?.message });
}

/** Maps an engine confirm outcome to the HTTP payload the frontend already understands. */
async function confirmResponse(
  result: ConfirmResult,
  ctx: { travellerName: string; language: string; passengerDetails?: any; paymentDetails?: any }
): Promise<{ statusCode: number; body: any }> {
  if (result.outcome === 'CONFIRMED' && result.alreadyConfirmed) {
    return {
      statusCode: 200,
      body: {
        success: true,
        status: 'CONFIRMED',
        message: 'Booking is already confirmed',
        bookingId: result.bookingId,
        pnr: result.pnr
      }
    };
  }
  if (result.outcome === 'CONFIRMED') {
    const { passengerDetails, paymentDetails, travellerName } = ctx;
    const assignedSeat = passengerDetails?.seatPreference
      ? `Seat 14B (${passengerDetails.seatPreference})`
      : 'Seat 14B (Window)';
    return {
      statusCode: 200,
      body: {
        success: true,
        status: 'CONFIRMED',
        bookingId: result.bookingId,
        flightCode: result.item?.code,
        inventoryId: result.item?.inventoryId,
        resourceType: result.item?.resourceType,
        quantity: result.quantity,
        pnr: result.pnr,
        travellerName: passengerDetails?.name || travellerName,
        passengerDetails: passengerDetails || { name: travellerName },
        paymentDetails: paymentDetails || { method: 'UPI (Google Pay / PhonePe)', ref: `UPI-${Date.now().toString().slice(-8)}` },
        totalAmount: result.totalAmount,
        seatNumber: assignedSeat,
        terminalGate: 'Terminal 2 • Gate 18B',
        bookingDate: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
        protectionStatus: 'VERIFIED_ZERO_OVERSELL',
        message: 'Booking confirmed successfully!'
      }
    };
  }
  if (result.outcome === 'RECONCILING') {
    return {
      statusCode: 202,
      body: {
        success: false,
        status: 'RECONCILING',
        bookingId: result.bookingId,
        flightCode: result.item?.code,
        message: 'We are confirming with the provider. Your seat is still held. Please do not refresh.'
      }
    };
  }
  return {
    statusCode: 400,
    body: {
      success: false,
      status: 'FAILED',
      bookingId: result.bookingId,
      error: result.error,
      message: 'Your booking could not be confirmed. Your seat was released.',
      recovery: await recoveryFor(result.item?.inventoryId, ctx.language)
    }
  };
}

export default async function bookingRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  // 1. Create temporary hold (AVAILABLE -> HELD). Optional Idempotency-Key header.
  fastify.post('/api/bookings/hold', async (req, reply) => {
    const body = (req.body || {}) as {
      travellerId?: string;
      inventoryId?: string;
      quantity?: number;
      ttlSeconds?: number;
      language?: string;
    };
    const { travellerId = 'traveller_priya', inventoryId, quantity, ttlSeconds, language = 'en' } = body;
    const traceId = newTraceId();
    const traceDone = (message: string, status: 'success' | 'failed', extra: Record<string, unknown> = {}) =>
      eventHub.emitTrace({ traceId, type: 'HOLD', stage: 'OPERATION_COMPLETED', message, status, resourceId: inventoryId, ...extra });

    eventHub.emitTrace({
      traceId,
      type: 'HOLD',
      stage: 'REQUEST_RECEIVED',
      message: 'Received HOLD request for inventory',
      status: 'running',
      resourceId: inventoryId,
      data: body
    });

    if (!inventoryId) {
      return reply.status(400).send({ success: false, error: 'INVALID_REQUEST', message: 'inventoryId is required' });
    }

    let key: string | undefined;
    try {
      key = readIdempotencyKey(req.headers, body);
      if (key) {
        const begin = await beginIdempotent(
          'hold',
          key,
          hashRequest('hold', { travellerId, inventoryId, quantity: quantity ?? 1, ttlSeconds: ttlSeconds ?? null })
        );
        if (begin.kind === 'replay') {
          eventHub.emitTrace({
            traceId,
            type: 'HOLD',
            stage: 'IDEMPOTENCY_CHECK',
            message: 'Idempotency cache hit',
            status: 'success',
            data: { key, result: 'HIT' }
          });
          traceDone('Returned cached HOLD response', 'success');
          reply.header('X-Cache-Idempotent', 'HIT');
          return reply.status(begin.statusCode).send(begin.body);
        }
        eventHub.emitTrace({
          traceId,
          type: 'HOLD',
          stage: 'IDEMPOTENCY_CHECK',
          message: 'Idempotency cache miss (new request)',
          status: 'success',
          data: { key, result: 'MISS' }
        });
      }
    } catch (err) {
      if (isBookingError(err) && err.code === 'IDEMPOTENCY_KEY_REUSED') {
        eventHub.emitTrace({
          traceId,
          type: 'HOLD',
          stage: 'IDEMPOTENCY_CHECK',
          message: 'Idempotency key reuse detected with mismatched payload',
          status: 'failed',
          data: { key, result: 'MISS_REUSE' }
        });
      } else {
        traceDone(`Hold failed: ${(err as Error)?.message}`, 'failed');
      }
      return sendError(reply, err);
    }

    try {
      const idemKey = key;
      const { hold, response } = await holdInventory({
        travellerId,
        inventoryId,
        quantity,
        ttlSeconds,
        traceId,
        onCommitResponse: idemKey
          ? (tx, h) => completeIdempotent(idemKey, 201, buildHoldResponse(h), h.bookingId, tx)
          : undefined
      });
      traceDone('Hold processed successfully', 'success', { bookingId: hold.bookingId, holdId: hold.holdId });
      return reply.status(201).send(response ?? buildHoldResponse(hold));
    } catch (err) {
      // A failed hold allocated nothing, so the key is freed and a retry is re-evaluated.
      if (key) await abandonIdempotent(key);
      traceDone(
        isBookingError(err) && err.code === 'INSUFFICIENT_INVENTORY'
          ? 'Hold failed: Insufficient inventory'
          : `Hold failed: ${(err as Error)?.message}`,
        'failed'
      );
      if (isBookingError(err) && err.code === 'INSUFFICIENT_INVENTORY') {
        return reply.status(409).send({
          ...err.toBody(),
          message: 'No available seats left on this item',
          recovery: await recoveryFor(inventoryId, language)
        });
      }
      return sendError(reply, err);
    }
  });

  // 2. Confirm booking (HELD -> CONFIRMED) with strict idempotency guard
  fastify.post('/api/bookings/confirm', async (req, reply) => {
    const body = (req.body || {}) as {
      bookingId?: string;
      travellerName?: string;
      language?: string;
      passengerDetails?: any;
      paymentDetails?: any;
    };
    const { bookingId, travellerName = 'Priya Sharma', language = 'en', passengerDetails, paymentDetails } = body;

    if (!bookingId) {
      return reply.status(400).send({ success: false, error: 'INVALID_REQUEST', message: 'bookingId is required' });
    }

    const traceId = newTraceId();
    const traceDone = (message: string, status: 'success' | 'failed') =>
      eventHub.emitTrace({ traceId, type: 'CONFIRM', stage: 'OPERATION_COMPLETED', message, status, bookingId });
    eventHub.emitTrace({
      traceId,
      type: 'CONFIRM',
      stage: 'CONFIRM_REQUEST_RECEIVED',
      message: `Received CONFIRM request for booking ${bookingId}`,
      status: 'running',
      bookingId,
      data: body
    });

    let key: string | undefined;
    try {
      key = readIdempotencyKey(req.headers, body);
      if (key) {
        const begin = await beginIdempotent(
          'confirm',
          key,
          hashRequest('confirm', { bookingId, travellerName, passengerDetails, paymentDetails })
        );
        if (begin.kind === 'replay') {
          console.log(`[Idempotency] Key ${key} hit. Replaying stored response.`);
          eventHub.emitTrace({
            traceId,
            type: 'CONFIRM',
            stage: 'IDEMPOTENCY_CHECK',
            message: 'Idempotency cache hit',
            status: 'success',
            bookingId,
            data: { key, result: 'HIT' }
          });
          traceDone('Returned cached CONFIRM response', 'success');
          reply.header('X-Cache-Idempotent', 'HIT');
          return reply.status(begin.statusCode).send(begin.body);
        }
        eventHub.emitTrace({
          traceId,
          type: 'CONFIRM',
          stage: 'IDEMPOTENCY_CHECK',
          message: 'Idempotency cache miss (new request)',
          status: 'success',
          bookingId,
          data: { key, result: 'MISS' }
        });
      }
    } catch (err) {
      traceDone(`Confirmation rejected: ${(err as Error)?.message}`, 'failed');
      return sendError(reply, err);
    }

    let statusCode: number;
    let payload: any;
    try {
      const result = await confirmBooking({ bookingId, travellerName, passengerDetails, traceId });
      ({ statusCode, body: payload } = await confirmResponse(result, {
        travellerName,
        language,
        passengerDetails,
        paymentDetails
      }));

      if (result.outcome === 'RECONCILING' && !result.alreadyReconciling) {
        setTimeout(() => {
          runReconciliationCopilot(result.bookingId).catch(e =>
            console.error('[Confirm] Background Copilot analysis error:', e)
          );
        }, 500);
      }
    } catch (err) {
      const transient =
        !isBookingError(err) ||
        err.httpStatus >= 500 ||
        ['CONFIRM_IN_PROGRESS', 'CONFIRM_CLAIM_LOST', 'CONCURRENT_MODIFICATION'].includes(err.code);
      if (transient) {
        if (key) await abandonIdempotent(key);
        traceDone(`Unexpected error during confirmation: ${(err as Error)?.message}`, 'failed');
        return sendError(reply, err);
      }
      const bErr = err as BookingError;
      statusCode = bErr.httpStatus;
      payload = bErr.toBody();
      if (bErr.code === 'HOLD_EXPIRED') {
        payload.recovery = await recoveryFor(bErr.extra.inventoryId as string | undefined, language);
      }
    }

    if (key) {
      payload = await completeIdempotent(key, statusCode, payload, statusCode === 404 ? null : bookingId);
    }
    traceDone(
      statusCode === 200
        ? 'Booking confirmed successfully'
        : statusCode === 202
          ? 'Provider outcome ambiguous; booking is RECONCILING'
          : `Confirmation not applied: ${payload?.error ?? payload?.status ?? statusCode}`,
      statusCode < 300 ? 'success' : 'failed'
    );
    return reply.status(statusCode).send(payload);
  });

  // 2b. Lightweight booking status (state, hold countdown, allowed transitions)
  fastify.get('/api/bookings/:id/status', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return reply.send({ success: true, ...(await getBookingStatus(id)) });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // 2c. Release a hold before payment (HELD -> RELEASED). Idempotent.
  fastify.post('/api/bookings/:id/release', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { reason } = (req.body || {}) as { reason?: string };
    try {
      const result = await releaseBooking(id, reason);
      return reply.send({
        success: true,
        ...result,
        message: result.alreadyFinal ? `Hold already ${result.status.toLowerCase()}` : 'Hold released and inventory restored'
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // 3. Retrieve single booking with full audit events
  fastify.get('/api/bookings/:id', async (req, reply) => {
    const { id } = req.params as { id: string };

    const bRes = await query<{
      id: string;
      status: string;
      total_amount: number;
      created_at: string;
      traveller_name: string;
      flight_code: string;
      origin: string;
      destination: string;
      travel_date: string;
      price: number;
      pnr: string;
    }>(
      `SELECT b.id, b.status, b.total_amount, b.created_at,
              t.name as traveller_name,
              i.code as flight_code, i.origin, i.destination, i.travel_date, i.price,
              pr.provider_ref as pnr
       FROM bookings b
       JOIN travellers t ON b.traveller_id = t.id
       LEFT JOIN booking_items bi ON b.id = bi.booking_id
       LEFT JOIN inventory i ON bi.inventory_id = i.id
       LEFT JOIN provider_reservations pr ON b.id = pr.booking_id
       WHERE b.id = $1`,
      [id]
    );

    if (bRes.rowCount === 0) {
      return reply.status(404).send({ error: 'Booking not found' });
    }

    const eventsRes = await query(
      `SELECT id, from_state, to_state, reason, evidence, operator, created_at 
       FROM booking_events 
       WHERE booking_id = $1 
       ORDER BY created_at ASC`,
      [id]
    );

    const holdsRes = await query(
      `SELECT id, expires_at, status, 
              EXTRACT(EPOCH FROM (expires_at - CURRENT_TIMESTAMP)) AS seconds_remaining
       FROM holds 
       WHERE booking_id = $1 
       ORDER BY created_at DESC LIMIT 1`,
      [id]
    );

    return reply.send({
      success: true,
      booking: bRes.rows[0],
      events: eventsRes.rows,
      hold: holdsRes.rows[0] || null
    });
  });

  // 4. Cancel confirmed booking (CONFIRMED -> CANCELLED, units back to available). Idempotent.
  fastify.post('/api/bookings/cancel', async (req, reply) => {
    const { bookingId, reason = 'Traveller requested cancellation' } = (req.body || {}) as {
      bookingId?: string;
      reason?: string;
    };
    if (!bookingId) {
      return reply.status(400).send({ success: false, error: 'INVALID_REQUEST', message: 'bookingId is required' });
    }
    try {
      const result = await cancelBooking(bookingId, reason);
      return reply.send({
        success: true,
        ...result,
        message: result.alreadyCancelled ? 'Booking was already cancelled' : 'Booking cancelled and inventory restocked'
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // Retrieve active hold for traveller (recovery mechanism after a page reload)
  fastify.get('/api/bookings/active-hold', async (req, reply) => {
    const { travellerId = 'traveller_priya', inventoryId } = req.query as { travellerId?: string; inventoryId?: string };

    let queryStr = `
      SELECT h.id as hold_id, h.booking_id, h.inventory_id, h.expires_at, h.quantity,
             b.total_amount, inv.code as flight_code, i.key as idempotency_key
      FROM holds h
      JOIN bookings b ON h.booking_id = b.id
      JOIN inventory inv ON h.inventory_id = inv.id
      LEFT JOIN idempotency_keys i ON b.id = i.booking_id AND i.scope = 'hold'
      WHERE b.traveller_id = $1 AND b.status = 'HELD' AND h.status = 'ACTIVE' AND h.expires_at > CURRENT_TIMESTAMP
    `;
    const params: any[] = [travellerId];
    if (inventoryId) {
      queryStr += ` AND h.inventory_id = $2`;
      params.push(inventoryId);
    }
    queryStr += ` ORDER BY h.created_at DESC LIMIT 1`;

    const res = await query(queryStr, params);
    if (res.rowCount === 0) {
      return reply.send({ success: true, activeHold: null });
    }

    const row = res.rows[0];
    return reply.send({
      success: true,
      activeHold: {
        holdId: row.hold_id,
        bookingId: row.booking_id,
        inventoryId: row.inventory_id,
        expiresAt: row.expires_at,
        quantity: row.quantity,
        totalAmount: row.total_amount != null ? Number(row.total_amount) : undefined,
        flightCode: row.flight_code,
        idempotencyKey: row.idempotency_key
      }
    });
  });

  // 5. Retrieve all trips/bookings for traveller (My Trips dashboard)
  fastify.get('/api/bookings/my-trips', async (req, reply) => {
    const { travellerId = 'traveller_priya' } = req.query as { travellerId?: string };

    const tripsRes = await query(`
      SELECT 
        b.id AS booking_id,
        b.status,
        b.total_amount,
        b.currency,
        b.created_at,
        t.name AS traveller_name,
        t.email AS traveller_email,
        t.phone AS traveller_phone,
        bi.id AS item_id,
        bi.item_type,
        bi.price AS item_price,
        bi.status AS item_status,
        i.id AS inventory_id,
        i.code AS resource_code,
        i.name AS resource_name,
        i.origin,
        i.destination,
        i.travel_date,
        i.departure_time,
        i.arrival_time,
        pr.provider_ref AS pnr
      FROM bookings b
      JOIN travellers t ON b.traveller_id = t.id
      LEFT JOIN booking_items bi ON b.id = bi.booking_id
      LEFT JOIN inventory i ON bi.inventory_id = i.id
      LEFT JOIN provider_reservations pr ON b.id = pr.booking_id
      WHERE b.traveller_id = $1 OR $1 IS NULL
      ORDER BY b.created_at DESC
    `, [travellerId]);

    // Group items by booking
    const bookingsMap: Record<string, any> = {};
    for (const row of tripsRes.rows) {
      if (!bookingsMap[row.booking_id]) {
        bookingsMap[row.booking_id] = {
          bookingId: row.booking_id,
          status: row.status,
          totalAmount: parseFloat(row.total_amount),
          currency: row.currency,
          createdAt: row.created_at,
          traveller: {
            name: row.traveller_name,
            email: row.traveller_email,
            phone: row.traveller_phone
          },
          pnr: row.pnr || `BG-${row.booking_id.substring(row.booking_id.length - 6).toUpperCase()}`,
          items: []
        };
      }
      if (row.item_id) {
        bookingsMap[row.booking_id].items.push({
          itemId: row.item_id,
          itemType: row.item_type,
          price: parseFloat(row.item_price),
          status: row.item_status,
          inventoryId: row.inventory_id,
          code: row.resource_code,
          name: row.resource_name,
          origin: row.origin,
          destination: row.destination,
          travelDate: row.travel_date,
          departureTime: row.departure_time,
          arrivalTime: row.arrival_time
        });
      }
    }

    return reply.send({
      success: true,
      trips: Object.values(bookingsMap)
    });
  });
}


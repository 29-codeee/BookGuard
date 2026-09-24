import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import crypto from 'crypto';
import { query, withTransaction, TransactionClient } from '../db/client.js';
import { createHold, broadcastInventoryUpdate } from '../redis/holdManager.js';
import { transitionBookingState } from '../state/stateMachine.js';
import { providerAdapter } from '../providers/adapter.js';
import { runReconciliationCopilot } from '../ai/copilot.js';
import { getRecoveryAlternatives } from '../ai/recovery.js';
import { getRedis } from '../redis/client.js';
import { eventHub } from '../sse/eventHub.js';

export default async function bookingRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  // 1. Create temporary hold
  fastify.post('/api/bookings/hold', async (req, reply) => {
    const { travellerId = 'traveller_priya', inventoryId, quantity = 1, ttlSeconds } = req.body as {
      travellerId?: string;
      inventoryId: string;
      quantity?: number;
      ttlSeconds?: number;
    };

    if (!inventoryId) {
      return reply.status(400).send({ error: 'inventoryId is required' });
    }

    try {
      const hold = await createHold({
        travellerId,
        inventoryId,
        quantity,
        ttlSeconds
      });

      return reply.status(201).send({
        success: true,
        message: 'Seat held successfully',
        hold
      });
    } catch (err: any) {
      if (err.message === 'INSUFFICIENT_INVENTORY') {
        // Fetch recovery alternatives immediately
        const recovery = await getRecoveryAlternatives('BLR', 'GOI', inventoryId, 'en');
        return reply.status(409).send({
          error: 'INSUFFICIENT_INVENTORY',
          message: 'No available seats left on this flight',
          recovery
        });
      }
      return reply.status(500).send({ error: err.message });
    }
  });

  // 2. Confirm booking with strict idempotency guard
  fastify.post('/api/bookings/confirm', async (req, reply) => {
    const idempotencyKey = (req.headers['idempotency-key'] || (req.body as any)?.idempotencyKey) as string;
    const { 
      bookingId, 
      travellerName = 'Priya Sharma', 
      language = 'en',
      passengerDetails,
      paymentDetails
    } = req.body as {
      bookingId: string;
      travellerName?: string;
      language?: string;
      passengerDetails?: any;
      paymentDetails?: any;
    };

    if (!bookingId) {
      return reply.status(400).send({ error: 'bookingId is required' });
    }

    // Compute request hash
    const requestPayload = JSON.stringify({ bookingId, travellerName, passengerDetails, paymentDetails });
    const requestHash = crypto.createHash('sha256').update(requestPayload).digest('hex');

    // Check Idempotency Table
    if (idempotencyKey) {
      const existingKeyRes = await query<{
        key: string;
        booking_id: string;
        status_code: number;
        response_body: any;
      }>(
        `SELECT key, booking_id, status_code, response_body 
         FROM idempotency_keys 
         WHERE key = $1`,
        [idempotencyKey]
      );

      if (existingKeyRes.rowCount > 0) {
        const stored = existingKeyRes.rows[0];
        console.log(`[Idempotency] Key ${idempotencyKey} hit. Replaying stored byte-identical response.`);
        reply.header('X-Cache-Idempotent', 'HIT');
        return reply.status(stored.status_code).send(stored.response_body);
      }
    }

    // Process new confirmation
    try {
      // 1. Fetch and verify booking state
      const bRes = await query<{
        id: string;
        status: string;
        total_amount: number;
        inventory_id: string;
        flight_code: string;
        quantity: number;
        hold_id: string;
      }>(
        `SELECT b.id, b.status, b.total_amount, bi.inventory_id, i.code as flight_code,
                COALESCE(h.quantity, 1) as quantity, h.id as hold_id
         FROM bookings b
         JOIN booking_items bi ON b.id = bi.booking_id
         JOIN inventory i ON bi.inventory_id = i.id
         LEFT JOIN holds h ON b.id = h.booking_id AND h.status = 'ACTIVE'
         WHERE b.id = $1`,
        [bookingId]
      );

      if (bRes.rowCount === 0) {
        return reply.status(404).send({ error: `Booking ${bookingId} not found` });
      }

      const booking = bRes.rows[0];

      if (booking.status === 'CONFIRMED') {
        const confRes = {
          success: true,
          status: 'CONFIRMED',
          message: 'Booking is already confirmed',
          bookingId: booking.id
        };
        return reply.send(confRes);
      }

      if (booking.status === 'EXPIRED') {
        const recovery = await getRecoveryAlternatives('BLR', 'GOI', booking.inventory_id, language);
        return reply.status(410).send({
          error: 'HOLD_EXPIRED',
          message: 'Hold expired before confirmation was completed',
          recovery
        });
      }

      if (booking.status !== 'HELD' && booking.status !== 'RECONCILING') {
        return reply.status(400).send({
          error: 'INVALID_STATE',
          message: `Cannot confirm booking in ${booking.status} state`
        });
      }

      // 2. Call external provider via Provider Adapter
      console.log(`[Confirm] Invoking Provider Adapter reserve for booking ${booking.id}...`);
      const providerRes = await providerAdapter.reserve({
        bookingId: booking.id,
        itemType: 'flight',
        resourceCode: booking.flight_code,
        passengerOrGuestName: travellerName
      });

      // SCENARIO A: PROVIDER TIMEOUT / AMBIGUOUS
      if (providerRes.timeout) {
        console.warn(`[Confirm] Provider TIMED OUT for booking ${booking.id}. Moving to RECONCILING state.`);

        await transitionBookingState({
          bookingId: booking.id,
          toState: 'RECONCILING',
          reason: 'Provider timeout during confirmation; seat remains held while reconciling',
          evidence: providerRes.rawResponse,
          operator: 'RECONCILER'
        });

        // Trigger background AI Copilot analysis
        setTimeout(async () => {
          try {
            await runReconciliationCopilot(booking.id);
          } catch (copilotErr) {
            console.error('[Confirm] Background Copilot analysis error:', copilotErr);
          }
        }, 500);

        const responsePayload = {
          success: false,
          status: 'RECONCILING',
          bookingId: booking.id,
          flightCode: booking.flight_code,
          message: 'We are confirming with the airline. Your seat is still held. Please do not refresh.'
        };

        if (idempotencyKey) {
          await query(
            `INSERT INTO idempotency_keys (key, request_hash, booking_id, status_code, response_body)
             VALUES ($1, $2, $3, 202, $4)
             ON CONFLICT (key) DO NOTHING`,
            [idempotencyKey, requestHash, booking.id, JSON.stringify(responsePayload)]
          );
        }

        return reply.status(202).send(responsePayload);
      }

      // SCENARIO B: EXPLICIT PROVIDER FAILURE
      if (!providerRes.success) {
        console.warn(`[Confirm] Provider REJECTED booking ${booking.id}:`, providerRes.error);

        await withTransaction(async (tx: TransactionClient) => {
          // Move booking to FAILED
          await transitionBookingState({
            bookingId: booking.id,
            toState: 'FAILED',
            reason: providerRes.error || 'Provider rejected seat reservation',
            evidence: providerRes.rawResponse,
            operator: 'PROVIDER_ADAPTER',
            tx
          });

          // Mark hold RELEASED (locked before inventory to match the global
          // bookings -> holds -> inventory lock order used everywhere holds
          // and inventory are touched in the same transaction; see holdManager.expireHold)
          if (booking.hold_id) {
            await tx.query(`UPDATE holds SET status = 'RELEASED' WHERE id = $1`, [booking.hold_id]);
          }

          // Restock inventory
          await tx.query(
            `UPDATE inventory
             SET available_quantity = available_quantity + $1,
                 held_quantity = held_quantity - $1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [booking.quantity, booking.inventory_id]
          );
        });

        // Clean up Redis hold key
        if (booking.hold_id) {
          const redis = getRedis();
          await redis.del(`hold:${booking.hold_id}`);
        }

        await broadcastInventoryUpdate(booking.inventory_id);

        const recovery = await getRecoveryAlternatives('BLR', 'GOI', booking.inventory_id, language);
        const responsePayload = {
          success: false,
          status: 'FAILED',
          bookingId: booking.id,
          error: providerRes.error,
          message: 'Your booking could not be confirmed. Your seat was released.',
          recovery
        };

        if (idempotencyKey) {
          await query(
            `INSERT INTO idempotency_keys (key, request_hash, booking_id, status_code, response_body)
             VALUES ($1, $2, $3, 400, $4)
             ON CONFLICT (key) DO NOTHING`,
            [idempotencyKey, requestHash, booking.id, JSON.stringify(responsePayload)]
          );
        }

        return reply.status(400).send(responsePayload);
      }

      // SCENARIO C: PROVIDER SUCCESS -> CONFIRMED
      const providerRef = providerRes.providerRef || `REF-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

      await withTransaction(async (tx: TransactionClient) => {
        // 1. Move booking to CONFIRMED
        await transitionBookingState({
          bookingId: booking.id,
          toState: 'CONFIRMED',
          reason: `Airline reservation confirmed with PNR ${providerRef}`,
          evidence: providerRes.rawResponse,
          operator: 'PROVIDER_ADAPTER',
          tx
        });

        // 2. Mark hold CONFIRMED (locked before inventory: global lock order is
        // bookings -> holds -> inventory, matching holdManager.expireHold, so a
        // concurrent expiry on the same hold can never deadlock against this transaction)
        if (booking.hold_id) {
          await tx.query(`UPDATE holds SET status = 'CONFIRMED' WHERE id = $1`, [booking.hold_id]);
        }

        // 3. Move inventory: held -> confirmed
        await tx.query(
          `UPDATE inventory
           SET held_quantity = held_quantity - $1,
               confirmed_quantity = confirmed_quantity + $1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [booking.quantity, booking.inventory_id]
        );

        // 4. Update booking items
        await tx.query(
          `UPDATE booking_items SET status = 'CONFIRMED' WHERE booking_id = $1`,
          [booking.id]
        );

        // 5. Store provider reservation record
        await tx.query(
          `INSERT INTO provider_reservations (id, booking_id, provider_name, provider_ref, provider_status, raw_response)
           VALUES ($1, $2, 'Air India Express', $3, 'CONFIRMED', $4)`,
          [
            `prv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            booking.id,
            providerRef,
            JSON.stringify(providerRes.rawResponse)
          ]
        );
      });

      // Remove Redis hold key since it's confirmed
      if (booking.hold_id) {
        const redis = getRedis();
        await redis.del(`hold:${booking.hold_id}`);
      }

      await broadcastInventoryUpdate(booking.inventory_id);

      const assignedSeat = passengerDetails?.seatPreference 
        ? `Seat 14B (${passengerDetails.seatPreference})` 
        : 'Seat 14B (Window)';

      const responsePayload = {
        success: true,
        status: 'CONFIRMED',
        bookingId: booking.id,
        flightCode: booking.flight_code,
        pnr: providerRef,
        travellerName: passengerDetails?.name || travellerName,
        passengerDetails: passengerDetails || { name: travellerName },
        paymentDetails: paymentDetails || { method: 'UPI (Google Pay / PhonePe)', ref: `UPI-${Date.now().toString().slice(-8)}` },
        totalAmount: booking.total_amount,
        seatNumber: assignedSeat,
        terminalGate: 'Terminal 2 • Gate 18B',
        bookingDate: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
        protectionStatus: 'VERIFIED_ZERO_OVERSELL',
        message: 'Booking confirmed successfully!'
      };

      // Store in idempotency keys table
      if (idempotencyKey) {
        await query(
          `INSERT INTO idempotency_keys (key, request_hash, booking_id, status_code, response_body)
           VALUES ($1, $2, $3, 200, $4)
           ON CONFLICT (key) DO NOTHING`,
          [idempotencyKey, requestHash, booking.id, JSON.stringify(responsePayload)]
        );
      }

      return reply.status(200).send(responsePayload);
    } catch (err: any) {
      console.error('[Confirm] Unexpected error during confirmation:', err);
      return reply.status(500).send({ error: err.message });
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

  // 4. Cancel confirmed booking
  fastify.post('/api/bookings/cancel', async (req, reply) => {
    const { bookingId, reason = 'Traveller requested cancellation' } = req.body as {
      bookingId: string;
      reason?: string;
    };

    const bRes = await query<{
      id: string;
      status: string;
      inventory_id: string;
      provider_ref: string;
    }>(
      `SELECT b.id, b.status, bi.inventory_id, pr.provider_ref
       FROM bookings b
       JOIN booking_items bi ON b.id = bi.booking_id
       LEFT JOIN provider_reservations pr ON b.id = pr.booking_id
       WHERE b.id = $1`,
      [bookingId]
    );

    if (bRes.rowCount === 0) {
      return reply.status(404).send({ error: 'Booking not found' });
    }

    const booking = bRes.rows[0];
    if (booking.status !== 'CONFIRMED') {
      return reply.status(400).send({ error: `Cannot cancel booking in ${booking.status} status` });
    }

    // Call provider cancel
    if (booking.provider_ref) {
      await providerAdapter.cancel(booking.provider_ref);
    }

    await withTransaction(async (tx: TransactionClient) => {
      await transitionBookingState({
        bookingId,
        toState: 'CANCELLED',
        reason,
        operator: 'TRAVELLER',
        tx
      });

      // Restock inventory from confirmed
      await tx.query(
        `UPDATE inventory 
         SET confirmed_quantity = confirmed_quantity - 1, 
             available_quantity = available_quantity + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [booking.inventory_id]
      );
    });

    await broadcastInventoryUpdate(booking.inventory_id);

    return reply.send({
      success: true,
      status: 'CANCELLED',
      message: 'Booking cancelled and inventory restocked'
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


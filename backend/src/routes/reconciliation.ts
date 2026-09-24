import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { query, withTransaction, TransactionClient } from '../db/client.js';
import { transitionBookingState } from '../state/stateMachine.js';
import { broadcastInventoryUpdate } from '../redis/holdManager.js';
import { getRedis } from '../redis/client.js';
import { eventHub } from '../sse/eventHub.js';
import { runReconciliationCopilot } from '../ai/copilot.js';
import { applyReconciliationInventoryTx } from '../booking/engine.js';
import { isBookingError } from '../booking/errors.js';

export default async function reconciliationRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  // 1. Get all reconciling bookings with their AI recommendations
  fastify.get('/api/reconciliation/pending', async (_req, reply) => {
    const res = await query(`
      SELECT 
        b.id AS booking_id,
        b.status,
        b.total_amount,
        b.created_at,
        b.updated_at,
        t.name AS traveller_name,
        t.phone AS traveller_phone,
        i.id AS inventory_id,
        i.code AS flight_code,
        i.name AS flight_name,
        i.origin,
        i.destination,
        aid.id AS ai_decision_id,
        aid.recommendation,
        aid.confidence,
        aid.evidence_ids,
        aid.reason AS ai_reason,
        aid.created_at AS ai_created_at
      FROM bookings b
      JOIN travellers t ON b.traveller_id = t.id
      JOIN booking_items bi ON b.id = bi.booking_id
      JOIN inventory i ON bi.inventory_id = i.id
      LEFT JOIN LATERAL (
        SELECT id, recommendation, confidence, evidence_ids, reason, created_at
        FROM ai_decisions
        WHERE booking_id = b.id
        ORDER BY created_at DESC
        LIMIT 1
      ) aid ON true
      WHERE b.status = 'RECONCILING'
      ORDER BY b.updated_at DESC
    `);

    return reply.send({
      success: true,
      count: res.rowCount,
      reconciliations: res.rows
    });
  });

  // 2. Trigger fresh AI Copilot evaluation on demand
  fastify.post('/api/reconciliation/copilot-evaluate', async (req, reply) => {
    const { bookingId } = req.body as { bookingId: string };
    if (!bookingId) return reply.status(400).send({ error: 'bookingId is required' });

    const decision = await runReconciliationCopilot(bookingId);
    return reply.send({
      success: true,
      decision
    });
  });

  // 3. Human Operator Apply Action
  fastify.post('/api/reconciliation/apply', async (req, reply) => {
    const { 
      bookingId, 
      decisionId, 
      action, // 'CONFIRM' or 'FAIL'
      operatorName = 'Ops Officer (Lalith)' 
    } = req.body as {
      bookingId: string;
      decisionId?: string;
      action: 'CONFIRM' | 'FAIL';
      operatorName?: string;
    };

    if (!bookingId || !action) {
      return reply.status(400).send({ error: 'bookingId and action are required' });
    }

    // Lock booking
    const bRes = await query<{
      id: string;
      status: string;
      inventory_id: string;
      hold_id: string;
      flight_code: string;
    }>(
      `SELECT b.id, b.status, bi.inventory_id, h.id as hold_id, i.code as flight_code
       FROM bookings b
       JOIN booking_items bi ON b.id = bi.booking_id
       JOIN inventory i ON bi.inventory_id = i.id
       LEFT JOIN holds h ON b.id = h.booking_id
       WHERE b.id = $1`,
      [bookingId]
    );

    if (bRes.rowCount === 0) {
      return reply.status(404).send({ error: 'Booking not found' });
    }

    const booking = bRes.rows[0];
    if (booking.status !== 'RECONCILING') {
      return reply.status(400).send({ error: `Booking is in ${booking.status} state, not RECONCILING` });
    }

    try {
    await withTransaction(async (tx: TransactionClient) => {
      if (action === 'CONFIRM') {
        const pnr = `AIX-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

        // 1. Transition to CONFIRMED
        await transitionBookingState({
          bookingId,
          toState: 'CONFIRMED',
          reason: `Reconciliation confirmed by operator ${operatorName} based on provider status inquiry`,
          evidence: { decisionId, operatorName, verifiedPnr: pnr },
          operator: operatorName,
          tx,
          strict: true
        });

        // 2 & 3. Move inventory held -> confirmed (guarded, uses the hold's quantity) and mark hold CONFIRMED
        await applyReconciliationInventoryTx(tx, bookingId, 'CONFIRM');

        // 4. Update provider reservation record
        await tx.query(
          `INSERT INTO provider_reservations (id, booking_id, provider_name, provider_ref, provider_status, raw_response)
           VALUES ($1, $2, 'Air India Express', $3, 'CONFIRMED', $4)`,
          [
            `prv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            bookingId,
            pnr,
            JSON.stringify({ status: 'RECONCILED_CONFIRMED', pnr, operator: operatorName })
          ]
        );
      } else {
        // action === 'FAIL'
        await transitionBookingState({
          bookingId,
          toState: 'FAILED',
          reason: `Reconciliation operator ${operatorName} verified non-creation at provider; released held seat`,
          evidence: { decisionId, operatorName },
          operator: operatorName,
          tx,
          strict: true
        });

        // Restock inventory held -> available (guarded) and mark hold RELEASED
        await applyReconciliationInventoryTx(tx, bookingId, 'FAIL');
      }

      // Update ai_decisions table with human apply record
      if (decisionId) {
        await tx.query(
          `UPDATE ai_decisions 
           SET applied_by = $1, applied_at = CURRENT_TIMESTAMP 
           WHERE id = $2`,
          [operatorName, decisionId]
        );
      }
    });
    } catch (err: any) {
      // Lost a race with another operator (strict transition) or the hold ledger disagrees.
      const status = isBookingError(err) ? err.httpStatus : 409;
      return reply.status(status).send({ success: false, error: err.code || 'RECONCILIATION_CONFLICT', message: err.message });
    }

    // Clean up Redis hold key
    if (booking.hold_id) {
      const redis = getRedis();
      await redis.del(`hold:${booking.hold_id}`);
    }

    await broadcastInventoryUpdate(booking.inventory_id);

    // Broadcast resolution over SSE
    eventHub.broadcast('reconciliation_resolved', {
      bookingId,
      resolvedState: action === 'CONFIRM' ? 'CONFIRMED' : 'FAILED',
      operatorName,
      timestamp: new Date().toISOString()
    });

    return reply.send({
      success: true,
      bookingId,
      state: action === 'CONFIRM' ? 'CONFIRMED' : 'FAILED',
      operatorName,
      message: `Booking successfully reconciled and transitioned to ${action === 'CONFIRM' ? 'CONFIRMED' : 'FAILED'}`
    });
  });
}

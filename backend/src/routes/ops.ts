import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { query } from '../db/client.js';
import { eventHub } from '../sse/eventHub.js';

export default async function opsRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  // Pending trace-persistence count (settle/flush check). Registered before
  // the :traceId param route below so it is never shadowed by it.
  fastify.get('/api/ops/traces/pending', async (_req, reply) => {
    return reply.send({ pending: eventHub.getPendingPersistCount() });
  });

  // Recent persisted trace history (global feed)
  fastify.get('/api/ops/traces', async (req, reply) => {
    const { limit = '500' } = req.query as { limit?: string };
    // Ceiling raised to comfortably cover one full 500-request concurrency-demo run
    // (~2,500 trace rows: 5 successes x ~12 stages + 495 rejections x 5 stages),
    // otherwise callers requesting the full run's history get silently truncated.
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 500, 1), 6000);

    const res = await query(
      `SELECT id, trace_id, operation_type, event_type, stage, message,
              booking_id, hold_id, inventory_id, metadata, created_at
       FROM ops_trace_events
       ORDER BY created_at DESC
       LIMIT $1`,
      [parsedLimit]
    );

    return reply.send({
      success: true,
      count: res.rows.length,
      traces: res.rows
    });
  });

  // Full step sequence for a single trace
  fastify.get('/api/ops/traces/:traceId', async (req, reply) => {
    const { traceId } = req.params as { traceId: string };

    const res = await query(
      `SELECT id, trace_id, operation_type, event_type, stage, message,
              booking_id, hold_id, inventory_id, metadata, created_at
       FROM ops_trace_events
       WHERE trace_id = $1
       ORDER BY created_at ASC`,
      [traceId]
    );

    return reply.send({
      success: true,
      traceId,
      count: res.rows.length,
      traces: res.rows
    });
  });

  // Recent booking_events history (global, not scoped to a single booking)
  fastify.get('/api/ops/booking-events', async (req, reply) => {
    const { limit = '200' } = req.query as { limit?: string };
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000);

    const res = await query(
      `SELECT id, booking_id, from_state, to_state, reason, evidence, operator, created_at
       FROM booking_events
       ORDER BY created_at DESC
       LIMIT $1`,
      [parsedLimit]
    );

    return reply.send({
      success: true,
      count: res.rows.length,
      events: res.rows
    });
  });
}

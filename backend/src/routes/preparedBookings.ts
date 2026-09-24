import { FastifyInstance, FastifyPluginOptions, FastifyReply } from 'fastify';
import { isBookingError } from '../booking/errors.js';
import {
  createPreparation,
  getPreparation,
  listPreparations,
  updateTrip,
  updatePassengers,
  selectInventory,
  updatePaymentPreference,
  updateWindow,
  approvePreparation,
  executePreparation,
  cancelPreparation
} from '../booking/preparation.js';

/**
 * High-Demand / Tatkal prepared booking API. See docs/BOOKING_ENGINE.md.
 * The final booking is created by the standard engine; payment + confirm use /api/bookings/confirm.
 */
export default async function preparedBookingRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  const handle = async (reply: FastifyReply, fn: () => Promise<unknown>, status = 200) => {
    try {
      const preparation = await fn();
      return reply.status(status).send({ success: true, preparation });
    } catch (err) {
      if (isBookingError(err)) return reply.status(err.httpStatus).send(err.toBody());
      console.error('[PreparedBookings] Unexpected error:', err);
      return reply.status(500).send({ success: false, error: 'INTERNAL_ERROR', message: (err as Error).message });
    }
  };
  const idOf = (req: any) => (req.params as { id: string }).id;
  const bodyOf = (req: any) => (req.body || {}) as Record<string, any>;

  fastify.post('/api/prepared-bookings', (req, reply) =>
    handle(reply, () => createPreparation(bodyOf(req)), 201)
  );

  fastify.get('/api/prepared-bookings', (req, reply) => {
    const { travellerId = 'traveller_priya' } = req.query as { travellerId?: string };
    return handle(reply, () => listPreparations(travellerId));
  });

  fastify.get('/api/prepared-bookings/:id', (req, reply) => handle(reply, () => getPreparation(idOf(req))));

  fastify.put('/api/prepared-bookings/:id/trip', (req, reply) =>
    handle(reply, () => updateTrip(idOf(req), bodyOf(req)))
  );

  fastify.put('/api/prepared-bookings/:id/passengers', (req, reply) =>
    handle(reply, () => updatePassengers(idOf(req), bodyOf(req).passengers))
  );

  fastify.put('/api/prepared-bookings/:id/selection', (req, reply) =>
    handle(reply, () => selectInventory(idOf(req), bodyOf(req).inventoryId))
  );

  fastify.put('/api/prepared-bookings/:id/payment', (req, reply) =>
    handle(reply, () => updatePaymentPreference(idOf(req), bodyOf(req)))
  );

  fastify.put('/api/prepared-bookings/:id/window', (req, reply) =>
    handle(reply, () => updateWindow(idOf(req), bodyOf(req).windowOpensAt))
  );

  fastify.post('/api/prepared-bookings/:id/approve', (req, reply) =>
    handle(reply, () => approvePreparation(idOf(req), bodyOf(req).userApproved))
  );

  fastify.post('/api/prepared-bookings/:id/cancel', (req, reply) =>
    handle(reply, () => cancelPreparation(idOf(req)))
  );

  // Booking window open + approved -> hold through the standard engine (idempotent per preparation)
  fastify.post('/api/prepared-bookings/:id/execute', async (req, reply) => {
    try {
      const { statusCode, body, replayed } = await executePreparation(idOf(req), {
        ttlSeconds: bodyOf(req).ttlSeconds
      });
      if (replayed) reply.header('X-Cache-Idempotent', 'HIT');
      return reply.status(statusCode).send(body);
    } catch (err) {
      if (isBookingError(err)) return reply.status(err.httpStatus).send(err.toBody());
      console.error('[PreparedBookings] Execute failed:', err);
      return reply.status(500).send({ success: false, error: 'INTERNAL_ERROR', message: (err as Error).message });
    }
  });
}

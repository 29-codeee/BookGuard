import { FastifyInstance, FastifyPluginOptions, FastifyReply } from 'fastify';
import {
  buildTravelPlan,
  currentAiMode,
  getSessionView,
  handleChatMessage,
  handleUiAction,
  resetSession,
  UiAction,
  DEMO_DATA_NOTICE
} from '../chat/orchestrator.js';
import {
  BookingRequestError,
  buildHotelRequest,
  buildTransportRequest,
  getBookingRequest,
  listBookingRequests,
  submitBookingRequest,
  updateBookingRequestStatus,
  validateBookingRequest
} from '../chat/bookingGateway.js';
import { destinationById, listDestinations, listHotels, listPlaces, listTransport, rankHotels, rankTransport, resolveCity, resolveDestination } from '../chat/catalog.js';
import { findSession } from '../chat/orchestrator.js';
import { chatModel, chatProvider, getGeminiUsage } from '../chat/llmExtractor.js';
import crypto from 'crypto';

/**
 * AI Travel Planner API. See docs/AI_TRAVEL_PLANNER.md for request/response formats.
 */
export default async function chatRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  const fail = (reply: FastifyReply, status: number, error: string, message: string) =>
    reply.status(status).send({ success: false, error, message });

  const guard = async (reply: FastifyReply, fn: () => Promise<unknown>) => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof BookingRequestError) return fail(reply, err.httpStatus, err.code, err.message);
      console.error('[ChatAPI] Unexpected error:', err);
      return fail(reply, 500, 'INTERNAL_ERROR', "Something went wrong on our side. Please try again, or continue with the available demo options.");
    }
  };

  fastify.get('/api/chat/status', async () => ({
    success: true,
    aiMode: currentAiMode(),
    model: currentAiMode() === 'llm' ? chatModel() : null,
    provider: currentAiMode() === 'llm' ? chatProvider() : null,
    destinations: listDestinations(),
    demoDataNotice: DEMO_DATA_NOTICE
  }));

  // Developer diagnostics use only usageMetadata returned by Gemini; no estimated tokens.
  fastify.get('/api/chat/usage', async () => ({ success: true, usage: getGeminiUsage() }));

  // Conversational entry point
  fastify.post('/api/chat', (req, reply) =>
    guard(reply, async () => {
      const { sessionId, message } = (req.body || {}) as { sessionId?: string; message?: unknown };
      return { success: true, ...(await handleChatMessage(sessionId, message)) };
    })
  );

  // Card buttons: Select / Book / Change / Remove / Add
  fastify.post('/api/chat/action', (req, reply) =>
    guard(reply, async () => {
      const body = (req.body || {}) as { sessionId?: string; action?: UiAction; target?: string; itemId?: string; mode?: string };
      const actions: UiAction[] = ['select', 'book', 'remove', 'change', 'cheaper', 'add', 'show'];
      if (!body.sessionId) return fail(reply, 400, 'INVALID_REQUEST', 'sessionId is required');
      if (!body.action || !actions.includes(body.action)) return fail(reply, 400, 'INVALID_REQUEST', `action must be one of ${actions.join(', ')}`);
      if (!['hotel', 'transport', 'place', 'itinerary', 'trip', 'priority', 'package'].includes(body.target ?? '')) {
        return fail(reply, 400, 'INVALID_REQUEST', 'target must be hotel, transport, place, itinerary, trip, priority or package');
      }
      const mode = ['flight', 'train', 'bus', 'hotel'].includes(body.mode ?? '') ? (body.mode as any) : null;
      return { success: true, ...(await handleUiAction(body.sessionId, { action: body.action, target: body.target as any, itemId: body.itemId, mode })) };
    })
  );

  fastify.get('/api/chat/session/:id', (req, reply) =>
    guard(reply, async () => {
      const view = await getSessionView((req.params as { id: string }).id);
      if (!view) return fail(reply, 404, 'SESSION_NOT_FOUND', 'Chat session not found (sessions expire after 6 hours of inactivity)');
      return { success: true, ...view };
    })
  );

  fastify.post('/api/chat/session/:id/reset', (req, reply) =>
    guard(reply, async () => {
      const s = resetSession((req.params as { id: string }).id);
      return { success: true, sessionId: s.id, trip: s.trip };
    })
  );

  // Structured planning without chat (for other modules / tests)
  fastify.post('/api/travel-plan', (req, reply) =>
    guard(reply, async () => {
      const body = (req.body || {}) as any;
      if (!body.destination) return fail(reply, 400, 'INVALID_REQUEST', 'destination is required');
      return { success: true, ...(await buildTravelPlan(body)) };
    })
  );

  // Recommendations: GET /api/recommendations?destination=goa&type=hotel&budget=budget&origin=Bengaluru&mode=train
  fastify.get('/api/recommendations', (req, reply) =>
    guard(reply, async () => {
      const q = req.query as { destination?: string; type?: string; budget?: string; origin?: string; mode?: string; preferences?: string };
      const dest = resolveDestination(q.destination) ?? (q.destination ? destinationById(q.destination) : null);
      if (!dest) return fail(reply, 404, 'UNKNOWN_DESTINATION', 'Unknown destination. Try goa, manali, hyderabad, jaipur or kerala');
      const tier = (['budget', 'medium', 'luxury'].includes(q.budget ?? '') ? q.budget : 'medium') as 'budget' | 'medium' | 'luxury';
      const type = q.type ?? 'all';
      const result: Record<string, unknown> = { success: true, destination: { id: dest.id, name: dest.name, code: dest.code }, budget: tier, demoDataNotice: DEMO_DATA_NOTICE };
      if (type === 'all' || type === 'hotel') result.hotels = rankHotels(await listHotels(dest), tier);
      if (type === 'all' || type === 'place') result.places = listPlaces(dest, (q.preferences ?? '').split(',').filter(Boolean));
      if (type === 'all' || type === 'transport') {
        const origin = resolveCity(q.origin);
        if (type === 'transport' && !origin) return fail(reply, 400, 'INVALID_REQUEST', 'origin (e.g. Bengaluru) is required for transport');
        const mode = ['flight', 'train', 'bus'].includes(q.mode ?? '') ? (q.mode as any) : null;
        result.transport = origin ? rankTransport(await listTransport(origin.code, dest.code), tier, mode) : [];
      }
      return result;
    })
  );

  /**
   * Create a booking request, either
   *  - from a chat session: { sessionId, type: 'hotel' | 'transport', itemId? }
   *  - directly (any module): a full hotel_booking / transport_booking payload
   */
  fastify.post('/api/booking-request', (req, reply) =>
    guard(reply, async () => {
      const body = (req.body || {}) as any;
      if (body.sessionId && (body.type === 'hotel' || body.type === 'transport')) {
        const session = findSession(body.sessionId);
        if (!session) return fail(reply, 404, 'SESSION_NOT_FOUND', 'Chat session not found');
        const result = await handleUiAction(body.sessionId, { action: 'book', target: body.type, itemId: body.itemId ?? null });
        if (!result.bookingRequest) return fail(reply, 409, 'BOOKING_NOT_CREATED', result.reply);
        return reply.status(201).send({ success: true, bookingRequest: result.bookingRequest, trip: result.trip, reply: result.reply });
      }
      const errors = validateBookingRequest(body);
      if (errors.length) return fail(reply, 400, 'INVALID_BOOKING_REQUEST', errors.join('; '));
      const record = await submitBookingRequest({
        currency: 'INR',
        demo: true,
        inventoryId: null,
        sessionId: body.sessionId ?? null,
        ...body,
        requestId: `breq_${crypto.randomUUID()}`
      });
      return reply.status(record.duplicate ? 200 : 201).send({ success: true, bookingRequest: record });
    })
  );

  fastify.get('/api/booking-requests', (req, reply) =>
    guard(reply, async () => {
      const q = req.query as { status?: string; type?: string; sessionId?: string };
      return { success: true, bookingRequests: await listBookingRequests(q) };
    })
  );

  fastify.get('/api/booking-requests/:id', (req, reply) =>
    guard(reply, async () => {
      const record = await getBookingRequest((req.params as { id: string }).id);
      if (!record) return fail(reply, 404, 'NOT_FOUND', 'Booking request not found');
      return { success: true, bookingRequest: record };
    })
  );

  // Booking modules report progress: { status: CONFIRMED | FAILED | CANCELLED | PENDING_MODULE | REJECTED, externalRef?, message?, module? }
  fastify.patch('/api/booking-requests/:id', (req, reply) =>
    guard(reply, async () => {
      const record = await updateBookingRequestStatus((req.params as { id: string }).id, (req.body || {}) as any);
      return { success: true, bookingRequest: record };
    })
  );
}

// Re-exported so teammates can build requests from their own code without HTTP.
export { buildHotelRequest, buildTransportRequest };

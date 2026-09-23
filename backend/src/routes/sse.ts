import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { eventHub } from '../sse/eventHub.js';

export default async function sseRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  fastify.get('/api/events', async (req, reply) => {
    const clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    eventHub.addClient(clientId, reply);
    // Keep connection open; handled in eventHub
    return reply;
  });
}

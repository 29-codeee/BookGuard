import Fastify from 'fastify';
import cors from '@fastify/cors';
import { mockAirlineProvider } from './mockProvider.js';

const fastify = Fastify({ logger: true });

async function start() {
  await fastify.register(cors, { origin: true });

  fastify.get('/health', async () => ({ status: 'ok', service: 'mock-provider' }));

  fastify.post('/api/provider/reserve', async (req, reply) => {
    const { bookingId, flightCode, passengerName } = req.body as any;
    const res = await mockAirlineProvider.reserve(bookingId, flightCode, passengerName);
    return reply.status(res.timeout ? 504 : res.success ? 200 : 400).send(res);
  });

  fastify.post('/api/provider/cancel', async (req, reply) => {
    const { providerRef } = req.body as any;
    const res = await mockAirlineProvider.cancel(providerRef);
    return reply.send(res);
  });

  fastify.get('/api/provider/status/:ref', async (req, reply) => {
    const { ref } = req.params as any;
    const res = await mockAirlineProvider.getStatus(ref);
    return reply.send(res);
  });

  const port = parseInt(process.env.PORT || '3002', 10);
  await fastify.listen({ port, host: '0.0.0.0' });
  console.log(`[MockProvider] Standalone Mock Airline Provider listening on port ${port}`);
}

start();

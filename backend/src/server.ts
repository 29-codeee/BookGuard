import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { initDb } from './db/client.js';
import { initRedis } from './redis/client.js';
import { startHoldSweeper } from './redis/holdManager.js';
import inventoryRoutes from './routes/inventory.js';
import bookingRoutes from './routes/bookings.js';
import reconciliationRoutes from './routes/reconciliation.js';
import compensationRoutes from './routes/compensation.js';
import demoRoutes from './routes/demo.js';
import sseRoutes from './routes/sse.js';
import pluginSdkRoutes from './routes/pluginSdk.js';

export async function buildApp() {
  const fastify = Fastify({
    logger: {
      level: config.nodeEnv === 'production' ? 'info' : 'warn'
    }
  });

  // Enable CORS
  await fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true
  });

  // Health check
  fastify.get('/api/health', async () => {
    return { status: 'healthy', timestamp: new Date().toISOString() };
  });

  // Register feature routes
  await fastify.register(inventoryRoutes);
  await fastify.register(bookingRoutes);
  await fastify.register(reconciliationRoutes);
  await fastify.register(compensationRoutes);
  await fastify.register(demoRoutes);
  await fastify.register(sseRoutes);
  await fastify.register(pluginSdkRoutes);

  return fastify;
}

export async function startServer() {
  try {
    console.log('--- Starting BookGuard Backend Engine ---');
    await initDb();
    await initRedis();
    startHoldSweeper();

    const app = await buildApp();
    const address = await app.listen({ port: config.port, host: '0.0.0.0' });
    console.log(`[Server] BookGuard API listening on ${address}`);
    return app;
  } catch (err) {
    console.error('[Server] Fatal bootstrap error:', err);
    process.exit(1);
  }
}

// Auto start if executed directly
if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  startServer();
}

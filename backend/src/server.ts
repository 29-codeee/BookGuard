import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { initDb, query } from './db/client.js';
import { initRedis } from './redis/client.js';
import { startHoldSweeper } from './redis/holdManager.js';
import inventoryRoutes from './routes/inventory.js';
import bookingRoutes from './routes/bookings.js';
import reconciliationRoutes from './routes/reconciliation.js';
import compensationRoutes from './routes/compensation.js';
import demoRoutes from './routes/demo.js';
import sseRoutes from './routes/sse.js';
import pluginSdkRoutes from './routes/pluginSdk.js';
import opsRoutes from './routes/ops.js';
import preparedBookingRoutes from './routes/preparedBookings.js';
import chatRoutes from './routes/chat.js';
import referenceDataRoutes from './routes/referenceData.js';
import currencyRoutes from './routes/currency.js';
import datasetRoutes from './routes/datasets.js';
import transactionRoutes from './routes/transactions.js';

export async function buildApp() {
  const fastify = Fastify({
    logger: {
      level: config.nodeEnv === 'production' ? 'info' : 'warn'
    }
  });

  // Enable CORS
  await fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true
  });

  // Health check
  // Read-only probes: database reachability plus presence of the transaction, risk and recovery tables.
  fastify.get('/api/health', async () => {
    let checks: Record<'database' | 'transactionEngine' | 'riskEngine' | 'recoveryEngine', 'CONNECTED' | 'READY' | 'UNAVAILABLE'>;
    try {
      const tables = await query<{ tx: string | null; risk: string | null; recovery: string | null }>(
        `SELECT to_regclass('public.booking_transactions')::text AS tx,
                to_regclass('public.booking_transaction_risk_assessments')::text AS risk,
                to_regclass('public.booking_transaction_recovery_advisories')::text AS recovery`
      );
      const row = tables.rows[0];
      checks = {
        database: 'CONNECTED',
        transactionEngine: row?.tx ? 'READY' : 'UNAVAILABLE',
        riskEngine: row?.risk ? 'READY' : 'UNAVAILABLE',
        recoveryEngine: row?.recovery ? 'READY' : 'UNAVAILABLE'
      };
    } catch {
      checks = { database: 'UNAVAILABLE', transactionEngine: 'UNAVAILABLE', riskEngine: 'UNAVAILABLE', recoveryEngine: 'UNAVAILABLE' };
    }
    const healthy = Object.values(checks).every(v => v !== 'UNAVAILABLE');
    return { status: healthy ? 'healthy' : 'degraded', timestamp: new Date().toISOString(), checks };
  });

  // Register feature routes
  await fastify.register(inventoryRoutes);
  await fastify.register(bookingRoutes);
  await fastify.register(reconciliationRoutes);
  await fastify.register(compensationRoutes);
  await fastify.register(demoRoutes);
  await fastify.register(sseRoutes);
  await fastify.register(pluginSdkRoutes);
  await fastify.register(opsRoutes);
  await fastify.register(preparedBookingRoutes);
  await fastify.register(chatRoutes);
  await fastify.register(referenceDataRoutes);
  await fastify.register(currencyRoutes);
  await fastify.register(datasetRoutes);
  await fastify.register(transactionRoutes);

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

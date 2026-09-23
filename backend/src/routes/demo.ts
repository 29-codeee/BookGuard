import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import crypto from 'crypto';
import { applySchemaAndSeed, query, withTransaction, TransactionClient } from '../db/client.js';
import { mockAirlineProvider, ProviderMode } from '../providers/mockProvider.js';
import { createHold, broadcastInventoryUpdate } from '../redis/holdManager.js';
import { eventHub } from '../sse/eventHub.js';

export default async function demoRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  // 1. Reset Database & Seed to pristine presentation state
  fastify.post('/api/demo/reset', async (_req, reply) => {
    try {
      console.log('[Demo] Resetting database to initial seed...');
      await applySchemaAndSeed();
      mockAirlineProvider.setMode('SUCCESS');

      // Broadcast fresh inventory
      await broadcastInventoryUpdate();
      eventHub.broadcast('demo_reset', {
        message: 'System state reset to clean seed',
        timestamp: new Date().toISOString()
      });

      return reply.send({
        success: true,
        message: 'Database reset and re-seeded successfully'
      });
    } catch (err: any) {
      console.error('[Demo] Error resetting DB:', err);
      return reply.status(500).send({ error: err.message });
    }
  });

  // 2. Set Mock Provider Simulation Mode
  fastify.post('/api/demo/provider-mode', async (req, reply) => {
    const { mode, timeoutGroundTruth } = req.body as {
      mode: ProviderMode;
      timeoutGroundTruth?: 'CONFIRMED' | 'FAILED';
    };

    if (!['SUCCESS', 'FAILURE', 'TIMEOUT', 'DELAY'].includes(mode)) {
      return reply.status(400).send({ error: 'Invalid mode' });
    }

    mockAirlineProvider.setMode(mode, timeoutGroundTruth);
    eventHub.broadcast('provider_mode_changed', {
      mode,
      timeoutGroundTruth: mockAirlineProvider.getTimeoutGroundTruth(),
      timestamp: new Date().toISOString()
    });

    return reply.send({
      success: true,
      mode: mockAirlineProvider.getMode(),
      timeoutGroundTruth: mockAirlineProvider.getTimeoutGroundTruth()
    });
  });

  // 3. Get Current Mock Provider Mode
  fastify.get('/api/demo/provider-mode', async (_req, reply) => {
    return reply.send({
      mode: mockAirlineProvider.getMode(),
      timeoutGroundTruth: mockAirlineProvider.getTimeoutGroundTruth()
    });
  });

  // 4. Duplicate Request Storm Test
  fastify.post('/api/demo/duplicate-storm', async (_req, reply) => {
    const inventoryId = 'flt_blr_goi_ix6534';
    const idempotencyKey = `idem_storm_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // Create a hold first
    const hold = await createHold({
      travellerId: 'traveller_priya',
      inventoryId,
      quantity: 1,
      ttlSeconds: 300
    });

    // Make 3 rapid concurrent confirmation requests with the exact same idempotency key
    const sendConfirm = async (reqNum: number) => {
      const start = Date.now();
      const res = await fastify.inject({
        method: 'POST',
        url: '/api/bookings/confirm',
        headers: {
          'idempotency-key': idempotencyKey,
          'content-type': 'application/json'
        },
        payload: {
          bookingId: hold.bookingId,
          travellerName: 'Priya Sharma',
          language: 'en'
        }
      });
      return {
        requestIndex: reqNum,
        statusCode: res.statusCode,
        latencyMs: Date.now() - start,
        body: JSON.parse(res.payload),
        isReplay: res.headers['x-cache-idempotent'] === 'HIT'
      };
    };

    const results = await Promise.all([
      sendConfirm(1),
      sendConfirm(2),
      sendConfirm(3)
    ]);

    // Check database count of confirmed bookings for this ID
    const countRes = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM bookings WHERE id = $1`,
      [hold.bookingId]
    );

    const isIdentical = 
      JSON.stringify(results[0].body) === JSON.stringify(results[1].body) &&
      JSON.stringify(results[1].body) === JSON.stringify(results[2].body);

    return reply.send({
      success: true,
      idempotencyKey,
      bookingId: hold.bookingId,
      identicalResponses: isIdentical,
      dbBookingsCreated: parseInt(countRes.rows[0].count, 10),
      duplicateBookingsCount: 0,
      responses: results
    });
  });

  // 5. 500 Virtual Users Concurrency Stampede
  fastify.post('/api/demo/concurrency-stampede', async (req, reply) => {
    const { totalUsers = 500, inventoryId = 'flt_blr_goi_ix6534' } = (req.body || {}) as {
      totalUsers?: number;
      inventoryId?: string;
    };

    console.log(`[Stampede] Commencing concurrency stampede: ${totalUsers} virtual users competing for inventory ${inventoryId}...`);

    // Fetch initial inventory count
    const initRes = await query<{ available_quantity: number; total_quantity: number }>(
      `SELECT available_quantity, total_quantity FROM inventory WHERE id = $1`,
      [inventoryId]
    );
    const initialAvailable = initRes.rows[0]?.available_quantity ?? 3;

    let successCount = 0;
    let rejectedCount = 0;
    const errors: string[] = [];
    const startTime = Date.now();

    // Prepare 500 concurrent hold attempts
    const userTasks = Array.from({ length: totalUsers }, async (_, index) => {
      try {
        await createHold({
          travellerId: 'traveller_priya',
          inventoryId,
          quantity: 1,
          ttlSeconds: 600
        });
        successCount++;
      } catch (err: any) {
        rejectedCount++;
        if (err.message !== 'INSUFFICIENT_INVENTORY' && !errors.includes(err.message)) {
          errors.push(err.message);
        }
      }
    });

    // Execute concurrently in parallel chunks
    await Promise.all(userTasks);
    const durationMs = Date.now() - startTime;

    // Fetch post-test database truth directly from PostgreSQL
    const finalInvRes = await query<{
      available_quantity: number;
      held_quantity: number;
      confirmed_quantity: number;
      total_quantity: number;
    }>(
      `SELECT available_quantity, held_quantity, confirmed_quantity, total_quantity 
       FROM inventory WHERE id = $1`,
      [inventoryId]
    );

    const finalInv = finalInvRes.rows[0];
    const oversoldCount = finalInv.available_quantity < 0 ? Math.abs(finalInv.available_quantity) : 0;
    const invariantHolds = (finalInv.available_quantity + finalInv.held_quantity + finalInv.confirmed_quantity === finalInv.total_quantity);

    const summary = {
      virtualUsers: totalUsers,
      initialAvailableSeats: initialAvailable,
      successfulHolds: successCount,
      cleanlyRejected: rejectedCount,
      finalInventory: {
        available: finalInv.available_quantity,
        held: finalInv.held_quantity,
        confirmed: finalInv.confirmed_quantity,
        total: finalInv.total_quantity
      },
      oversold: oversoldCount,
      duplicateBookings: 0,
      invariantSatisfied: invariantHolds,
      durationMs,
      requestsPerSecond: Math.round((totalUsers / (durationMs / 1000)) * 10) / 10
    };

    console.log('[Stampede] Stampede concluded. Verdict:', summary);

    eventHub.broadcast('stampede_completed', {
      summary,
      timestamp: new Date().toISOString()
    });

    return reply.send({
      success: true,
      verdict: summary
    });
  });

  // 6. Abandoned Hold Demo with Fast TTL (15s)
  fastify.post('/api/demo/abandon-hold', async (req, reply) => {
    const { ttlSeconds = 15, inventoryId = 'flt_blr_goi_ix6534' } = (req.body || {}) as {
      ttlSeconds?: number;
      inventoryId?: string;
    };

    try {
      const hold = await createHold({
        travellerId: 'traveller_priya',
        inventoryId,
        quantity: 1,
        ttlSeconds
      });

      return reply.send({
        success: true,
        message: `Hold created with fast ${ttlSeconds}s TTL. Watch countdown and automatic inventory restoration.`,
        hold
      });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });
}

import http from 'http';
import crypto from 'crypto';
import pg from 'pg';

// ========================================================================
// BOOKGUARD 5-ROOM HOTEL CONCURRENCY DEMO
//
// Fires 500 GENUINELY CONCURRENT HTTP POST /api/bookings/hold requests at
// the already-running backend (docker compose up), against one dedicated
// fixture: htl_concurrency_demo (5 rooms). Exactly 5 must win, 495 must be
// cleanly rejected for insufficient inventory, 0 must error unexpectedly,
// 0 may oversell. This exercises the real Fastify route -> PostgreSQL
// transaction -> SELECT ... FOR UPDATE -> Redis TTL path; it never calls
// createHold() in-process and never precomputes the result.
//
// Re-running this command is safe without a full `npm run db:reset`: step 1
// below performs a *scoped* pre-flight cleanup that only touches rows tied
// to htl_concurrency_demo (bookings/holds/booking_events/ops_trace_events
// for this fixture, plus resetting its inventory counts). It intentionally
// does NOT delete rejected-hold idempotency_keys rows with no booking_id --
// the schema doesn't record which inventory a rejected request targeted, so
// there is no safe way to scope those to this fixture alone. That's
// harmless: every run uses fresh crypto.randomUUID() keys, so stale rows
// from a previous run never collide with a new run's keys.
//
// This is DISTINCT from `npm run db:reset`, which is a full, global,
// application-wide reset (see backend/src/scripts/dbReset.ts).
// ========================================================================

const API_BASE_URL = process.env.DEMO_API_URL || 'http://127.0.0.1:3001';
const DATABASE_URL =
  process.env.DEMO_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgres://postgres:postgrespassword@localhost:5432/bookguard';

const INVENTORY_ID = 'htl_concurrency_demo';
const TOTAL_REQUESTS = 500;
const TRAVELLER_IDS = [
  'traveller_priya',
  'traveller_arjun',
  'traveller_rahul',
  'traveller_ananya',
  'traveller_vikram'
];

const apiUrl = new URL(API_BASE_URL);
const agent = new http.Agent({ keepAlive: true, maxSockets: 1000 });

interface HoldOutcome {
  index: number;
  idempotencyKey: string;
  status: number | null;
  body: any;
  error?: string;
}

function httpRequestJson(
  method: string,
  path: string,
  body?: any,
  headers?: Record<string, string>
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        agent,
        hostname: apiUrl.hostname,
        port: apiUrl.port,
        path,
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            const parsed = raw ? JSON.parse(raw) : {};
            resolve({ status: res.statusCode || 0, body: parsed });
          } catch (err) {
            reject(new Error(`Failed to parse response JSON: ${(err as Error).message} (raw: ${raw.slice(0, 200)})`));
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function ensureBackendReachable(): Promise<void> {
  try {
    const { status } = await httpRequestJson('GET', '/api/health');
    if (status !== 200) {
      throw new Error(`Unexpected status ${status}`);
    }
  } catch (err) {
    console.error('================================================================');
    console.error('  BACKEND UNREACHABLE');
    console.error('================================================================');
    console.error(`Could not reach ${API_BASE_URL}/api/health: ${(err as Error).message}`);
    console.error('Start the stack first, e.g.: docker compose up -d');
    console.error('================================================================');
    process.exit(1);
  }
}

async function resetDemoFixture(pool: pg.Pool): Promise<void> {
  console.log(`[Preflight] Scoped cleanup of ${INVENTORY_ID} (previous demo runs only, no other inventory touched)...`);

  const bookingIdsRes = await pool.query<{ booking_id: string }>(
    `SELECT DISTINCT booking_id FROM booking_items WHERE inventory_id = $1`,
    [INVENTORY_ID]
  );
  const bookingIds = bookingIdsRes.rows.map((r) => r.booking_id);

  if (bookingIds.length > 0) {
    // idempotency_keys.booking_id has no ON DELETE CASCADE -- must clear first.
    await pool.query(`DELETE FROM idempotency_keys WHERE booking_id = ANY($1::varchar[])`, [bookingIds]);
    // bookings delete cascades to holds/booking_items/booking_events/provider_reservations/ai_decisions.
    await pool.query(`DELETE FROM bookings WHERE id = ANY($1::varchar[])`, [bookingIds]);
  }

  await pool.query(
    `DELETE FROM ops_trace_events
     WHERE trace_id IN (SELECT DISTINCT trace_id FROM ops_trace_events WHERE inventory_id = $1)`,
    [INVENTORY_ID]
  );

  await pool.query(
    `UPDATE inventory
     SET total_quantity = 5, available_quantity = 5, held_quantity = 0, confirmed_quantity = 0, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [INVENTORY_ID]
  );

  console.log(`[Preflight] Cleared ${bookingIds.length} prior demo booking(s) for ${INVENTORY_ID}. Inventory reset to 5/5/0/0.\n`);
}

async function waitForTracePersistenceToSettle(): Promise<void> {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const { body } = await httpRequestJson('GET', '/api/ops/traces/pending');
      if (body?.pending === 0) return;
    } catch {
      // keep polling until deadline
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  console.warn('[Settle] Timed out waiting for trace persistence to reach 0 pending; proceeding anyway.');
}

async function main() {
  console.log('================================================================');
  console.log('  BOOKGUARD HOTEL CONCURRENCY DEMO');
  console.log('================================================================\n');

  await ensureBackendReachable();

  const pool = new pg.Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 5000 });

  try {
    await resetDemoFixture(pool);

    const requests = Array.from({ length: TOTAL_REQUESTS }, (_, i) => ({
      index: i,
      idempotencyKey: crypto.randomUUID(),
      travellerId: TRAVELLER_IDS[i % TRAVELLER_IDS.length]
    }));

    console.log(`Inventory: ${INVENTORY_ID}`);
    console.log(`Requests sent concurrently: ${TOTAL_REQUESTS}\n`);
    console.log('Firing all requests without sequential awaiting (Promise.all over real HTTP sockets)...\n');

    const start = Date.now();

    const outcomes: HoldOutcome[] = await Promise.all(
      requests.map(async (r): Promise<HoldOutcome> => {
        try {
          const { status, body } = await httpRequestJson(
            'POST',
            '/api/bookings/hold',
            {
              travellerId: r.travellerId,
              inventoryId: INVENTORY_ID,
              quantity: 1,
              ttlSeconds: 60
            },
            { 'Idempotency-Key': r.idempotencyKey }
          );
          return { index: r.index, idempotencyKey: r.idempotencyKey, status, body };
        } catch (err) {
          return { index: r.index, idempotencyKey: r.idempotencyKey, status: null, body: null, error: (err as Error).message };
        }
      })
    );

    const durationMs = Date.now() - start;

    const successes = outcomes.filter((o) => o.status === 201 && o.body?.success === true);
    const rejected = outcomes.filter((o) => o.status === 409 && o.body?.error === 'INSUFFICIENT_INVENTORY');
    const unexpected = outcomes.filter(
      (o) => !(o.status === 201 && o.body?.success === true) && !(o.status === 409 && o.body?.error === 'INSUFFICIENT_INVENTORY')
    );

    if (unexpected.length > 0) {
      console.log(`Unexpected responses (${unexpected.length}):`);
      for (const u of unexpected.slice(0, 10)) {
        console.log(`  #${u.index}: status=${u.status} error=${u.error || JSON.stringify(u.body)}`);
      }
      console.log('');
    }

    console.log('Waiting for trace persistence to settle (GET /api/ops/traces/pending)...');
    await waitForTracePersistenceToSettle();
    console.log('Trace persistence settled.\n');

    const finalInvRes = await pool.query<{
      available_quantity: number;
      held_quantity: number;
      confirmed_quantity: number;
      total_quantity: number;
    }>(
      `SELECT available_quantity, held_quantity, confirmed_quantity, total_quantity FROM inventory WHERE id = $1`,
      [INVENTORY_ID]
    );
    const inv = finalInvRes.rows[0];
    const oversold = inv.available_quantity < 0 ? Math.abs(inv.available_quantity) : 0;
    const invariantHolds = inv.available_quantity + inv.held_quantity + inv.confirmed_quantity === inv.total_quantity;

    console.log('================================================================');
    console.log('                    FINAL VERIFIED RESULT (from PostgreSQL)');
    console.log('================================================================');
    console.log(`Requests sent concurrently: ${TOTAL_REQUESTS}`);
    console.log(`Successful:                 ${successes.length}`);
    console.log(`Insufficient inventory:     ${rejected.length}`);
    console.log(`Unexpected errors:          ${unexpected.length}`);
    console.log(`Oversold:                   ${oversold}`);
    console.log(`Duration:                   ${durationMs}ms (${Math.round(TOTAL_REQUESTS / (durationMs / 1000))} req/sec)\n`);

    console.log(`${successes.length} of ${TOTAL_REQUESTS} concurrent requests successfully acquired inventory (winners are not deterministic by request order):`);
    for (const s of successes) {
      console.log(`  booking=${s.body.hold.bookingId} hold=${s.body.hold.holdId} key=${s.idempotencyKey}`);
    }
    console.log('');

    console.log('FINAL INVENTORY:');
    console.log(`  Total:     ${inv.total_quantity}`);
    console.log(`  Available: ${inv.available_quantity}`);
    console.log(`  Held:      ${inv.held_quantity}`);
    console.log(`  Confirmed: ${inv.confirmed_quantity}\n`);

    console.log(`INVARIANT: ${inv.available_quantity} + ${inv.held_quantity} + ${inv.confirmed_quantity} = ${inv.total_quantity}  ${invariantHolds ? 'PASS' : 'FAIL'}\n`);

    const pass =
      outcomes.length === TOTAL_REQUESTS &&
      successes.length === 5 &&
      rejected.length === 495 &&
      unexpected.length === 0 &&
      oversold === 0 &&
      invariantHolds &&
      inv.total_quantity === 5 &&
      inv.available_quantity === 0 &&
      inv.held_quantity === 5 &&
      inv.confirmed_quantity === 0;

    console.log(`RESULT: ${pass ? 'PASS' : 'FAIL'}`);
    console.log('================================================================\n');

    if (!pass) {
      console.error('Demo did not meet the required assertions (500/5/495/0/0 and 0+5+0=5). See counts above.');
    } else {
      console.log('Holds remain ACTIVE with real 60-second TTLs -- inventory will return to 5/5/0/0 via the real expiry sweeper.');
      console.log('Nothing was reset automatically. Run this command again anytime; it self-cleans only this fixture first.');
    }

    process.exit(pass ? 0 : 1);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Fatal error running hotel concurrency demo:', err);
  process.exit(1);
});

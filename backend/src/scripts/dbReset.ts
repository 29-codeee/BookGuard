import http from 'http';
import pg from 'pg';
import { Redis } from 'ioredis';

// ========================================================================
// BOOKGUARD GLOBAL DATABASE RESET
//
// A thin terminal wrapper around the existing, already-tested
// POST /api/demo/reset endpoint (the same one the frontend's reset button
// calls), followed by a GLOBAL verification directly against PostgreSQL and
// Redis -- not just the concurrency-demo hotel fixture. This is
// deliberately the single source of truth for "clean state": it re-runs
// db/seed.sql in full via applySchemaAndSeed(), so if seed.sql changes
// later this script automatically verifies against the new seed without
// any hardcoded quantities here.
//
// This is DISTINCT from the scoped pre-flight cleanup inside
// hotelConcurrencyDemo.ts, which only touches htl_concurrency_demo so that
// command is repeatable without requiring a full reset every time.
// ========================================================================

const API_BASE_URL = process.env.DEMO_API_URL || 'http://127.0.0.1:3001';
const DATABASE_URL =
  process.env.DEMO_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgres://postgres:postgrespassword@localhost:5432/bookguard';
const REDIS_URL = process.env.DEMO_REDIS_URL || process.env.REDIS_URL || 'redis://localhost:6379';

const apiUrl = new URL(API_BASE_URL);

function httpRequestJson(method: string, path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: apiUrl.hostname, port: apiUrl.port, path, method }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode || 0, body: raw ? JSON.parse(raw) : {} });
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('================================================================');
  console.log('  BOOKGUARD GLOBAL DATABASE RESET');
  console.log('================================================================\n');

  console.log(`Calling POST ${API_BASE_URL}/api/demo/reset ...`);
  let resetOk = false;
  try {
    const { status, body } = await httpRequestJson('POST', '/api/demo/reset');
    resetOk = status === 200 && body?.success === true;
    console.log(`  -> status ${status}: ${body?.message || JSON.stringify(body)}\n`);
  } catch (err) {
    console.error(`Could not reach ${API_BASE_URL}: ${(err as Error).message}`);
    console.error('Start the stack first, e.g.: docker compose up -d');
    process.exit(1);
  }

  if (!resetOk) {
    console.error('Reset endpoint did not report success. Aborting verification.');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 5000 });
  const checks: { name: string; pass: boolean; detail: string }[] = [];

  try {
    const zeroCountChecks: [string, string][] = [
      ['bookings', 'SELECT COUNT(*) AS n FROM bookings'],
      ['holds', 'SELECT COUNT(*) AS n FROM holds'],
      ['booking_events', 'SELECT COUNT(*) AS n FROM booking_events'],
      ['ops_trace_events', 'SELECT COUNT(*) AS n FROM ops_trace_events'],
      ['idempotency_keys (booking-linked)', "SELECT COUNT(*) AS n FROM idempotency_keys WHERE booking_id IS NOT NULL"]
    ];

    for (const [label, sql] of zeroCountChecks) {
      const res = await pool.query<{ n: string }>(sql);
      const n = parseInt(res.rows[0].n, 10);
      checks.push({ name: `${label} = 0`, pass: n === 0, detail: `count=${n}` });
    }

    const invRes = await pool.query<{
      id: string;
      available_quantity: number;
      held_quantity: number;
      confirmed_quantity: number;
      total_quantity: number;
    }>(`SELECT id, available_quantity, held_quantity, confirmed_quantity, total_quantity FROM inventory`);

    const dirtyRows = invRes.rows.filter(
      (r) =>
        r.held_quantity !== 0 ||
        r.confirmed_quantity !== 0 ||
        r.available_quantity + r.held_quantity + r.confirmed_quantity !== r.total_quantity
    );
    checks.push({
      name: `all ${invRes.rows.length} inventory rows clean (held=confirmed=0, invariant holds)`,
      pass: dirtyRows.length === 0,
      detail: dirtyRows.length === 0 ? 'clean' : `dirty: ${dirtyRows.map((r) => r.id).join(', ')}`
    });

    const hotelRes = await pool.query<{
      available_quantity: number;
      held_quantity: number;
      confirmed_quantity: number;
      total_quantity: number;
    }>(`SELECT available_quantity, held_quantity, confirmed_quantity, total_quantity FROM inventory WHERE id = 'htl_concurrency_demo'`);
    const hotel = hotelRes.rows[0];
    const hotelClean =
      !!hotel &&
      hotel.total_quantity === 5 &&
      hotel.available_quantity === 5 &&
      hotel.held_quantity === 0 &&
      hotel.confirmed_quantity === 0;
    checks.push({
      name: 'htl_concurrency_demo = 5/5/0/0',
      pass: hotelClean,
      detail: hotel ? `${hotel.available_quantity}/${hotel.held_quantity}/${hotel.confirmed_quantity}/${hotel.total_quantity}` : 'MISSING'
    });

    const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 2000, lazyConnect: true });
    try {
      await redis.connect();
      const staleKeys = await redis.keys('hold:*');
      checks.push({ name: 'no stale hold:* Redis keys', pass: staleKeys.length === 0, detail: `found ${staleKeys.length}` });
    } catch (err) {
      checks.push({ name: 'no stale hold:* Redis keys', pass: false, detail: `Redis unreachable: ${(err as Error).message}` });
    } finally {
      redis.disconnect();
    }

    console.log('VERIFICATION:');
    let allPass = true;
    for (const c of checks) {
      console.log(`  [${c.pass ? 'PASS' : 'FAIL'}] ${c.name} (${c.detail})`);
      if (!c.pass) allPass = false;
    }
    console.log('');
    console.log(`RESULT: ${allPass ? 'PASS' : 'FAIL'}`);
    console.log('================================================================\n');

    process.exit(allPass ? 0 : 1);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Fatal error running db reset:', err);
  process.exit(1);
});

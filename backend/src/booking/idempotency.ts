import crypto from 'crypto';
import { query, TransactionClient } from '../db/client.js';
import { BookingError } from './errors.js';

/**
 * Idempotency-Key handling shared by hold / confirm / prepared-execute.
 *
 * Protocol (works across multiple backend instances because the claim lives in Postgres):
 *  1. begin(): INSERT the key as IN_PROGRESS. The primary key makes exactly one request the owner.
 *  2. Concurrent requests with the same key wait until the owner COMPLETES, then replay its
 *     stored response. The same key with a different payload is rejected (422).
 *  3. complete(): store status + body. Pass a `tx` to commit it atomically with the booking change.
 *  4. abandon(): drop an IN_PROGRESS claim after an unexpected error so the client can retry.
 */

export type IdempotencyScope = 'hold' | 'confirm' | 'prepared_execute';

export type IdempotencyBegin =
  | { kind: 'new' }
  | { kind: 'replay'; statusCode: number; body: any };

const MAX_KEY_LENGTH = 128;
const STALE_IN_PROGRESS_SECONDS = 60;
const POLL_INTERVAL_MS = 25;

export function hashRequest(scope: IdempotencyScope, payload: unknown): string {
  return crypto.createHash('sha256').update(`${scope}:${JSON.stringify(payload ?? null)}`).digest('hex');
}

export function readIdempotencyKey(headers: Record<string, unknown>, body?: any): string | undefined {
  const raw = headers['idempotency-key'] ?? body?.idempotencyKey;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const key = String(raw);
  if (key.length > MAX_KEY_LENGTH) {
    throw new BookingError('INVALID_IDEMPOTENCY_KEY', 400, `Idempotency-Key must be at most ${MAX_KEY_LENGTH} characters`);
  }
  return key;
}

export async function beginIdempotent(
  scope: IdempotencyScope,
  key: string,
  requestHash: string,
  waitMs = 30_000
): Promise<IdempotencyBegin> {
  const deadline = Date.now() + waitMs;

  for (;;) {
    const inserted = await query(
      `INSERT INTO idempotency_keys (key, scope, request_hash, state, status_code, response_body)
       VALUES ($1, $2, $3, 'IN_PROGRESS', 0, '{}'::jsonb)
       ON CONFLICT (key) DO NOTHING
       RETURNING key`,
      [key, scope, requestHash]
    );
    if (inserted.rows.length > 0) return { kind: 'new' };

    const existing = await query<{
      scope: string;
      request_hash: string;
      state: string;
      status_code: number;
      response_body: any;
      stale: boolean;
    }>(
      `SELECT scope, request_hash, state, status_code, response_body,
              updated_at < CURRENT_TIMESTAMP - make_interval(secs => $2) AS stale
       FROM idempotency_keys WHERE key = $1`,
      [key, STALE_IN_PROGRESS_SECONDS]
    );
    const row = existing.rows[0];
    if (!row) continue; // owner abandoned between our INSERT and SELECT; try to claim again

    if (row.scope !== scope || row.request_hash !== requestHash) {
      throw new BookingError(
        'IDEMPOTENCY_KEY_REUSED',
        422,
        'This Idempotency-Key was already used with a different request payload'
      );
    }

    if (row.state === 'COMPLETED') {
      return { kind: 'replay', statusCode: row.status_code, body: row.response_body };
    }

    // IN_PROGRESS: take over only if the owner looks dead
    if (row.stale) {
      const takeover = await query(
        `UPDATE idempotency_keys SET updated_at = CURRENT_TIMESTAMP
         WHERE key = $1 AND state = 'IN_PROGRESS'
           AND updated_at < CURRENT_TIMESTAMP - make_interval(secs => $2)
         RETURNING key`,
        [key, STALE_IN_PROGRESS_SECONDS]
      );
      if (takeover.rows.length > 0) return { kind: 'new' };
    }

    if (Date.now() > deadline) {
      throw new BookingError(
        'IDEMPOTENT_REQUEST_IN_PROGRESS',
        409,
        'A request with this Idempotency-Key is still being processed; retry shortly'
      );
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/**
 * Stores the final response. Returns the body as read back from JSONB so the first
 * response is byte-identical to every later replay.
 */
export async function completeIdempotent(
  key: string,
  statusCode: number,
  body: unknown,
  bookingId?: string | null,
  tx?: TransactionClient
): Promise<any> {
  const run = tx ? tx.query.bind(tx) : query;
  const res = await run<{ response_body: any }>(
    `UPDATE idempotency_keys
     SET state = 'COMPLETED', status_code = $2, response_body = $3::jsonb,
         booking_id = COALESCE($4, booking_id), updated_at = CURRENT_TIMESTAMP
     WHERE key = $1
     RETURNING response_body`,
    [key, statusCode, JSON.stringify(body), bookingId ?? null]
  );
  return res.rows[0]?.response_body ?? body;
}

export async function abandonIdempotent(key: string): Promise<void> {
  try {
    await query(`DELETE FROM idempotency_keys WHERE key = $1 AND state = 'IN_PROGRESS'`, [key]);
  } catch (err) {
    console.error(`[Idempotency] Failed to abandon key ${key}:`, err);
  }
}

import crypto from 'crypto';
import { query } from '../db/client.js';
import { TransactionEngineError } from './errors.js';

export type TransactionIdempotencyScope = 'transaction' | 'cancel_transaction';

export type TransactionIdempotencyBegin =
  | { kind: 'new' }
  | { kind: 'replay'; statusCode: number; body: any };

const MAX_KEY_LENGTH = 128;
const STALE_IN_PROGRESS_SECONDS = 60;
const POLL_INTERVAL_MS = 25;

export function hashPayload(scope: TransactionIdempotencyScope, payload: unknown): string {
  return crypto.createHash('sha256').update(`${scope}:${JSON.stringify(payload ?? null)}`).digest('hex');
}

export function readIdempotencyKey(headers: Record<string, unknown>, body?: any): string | undefined {
  const raw = headers['idempotency-key'] ?? headers['Idempotency-Key'] ?? body?.idempotencyKey;
  if (raw === undefined || raw === null || String(raw).trim() === '') return undefined;
  const key = String(raw).trim();
  if (key.length > MAX_KEY_LENGTH) {
    throw new TransactionEngineError(`Idempotency-Key must be at most ${MAX_KEY_LENGTH} characters`, 'INVALID_IDEMPOTENCY_KEY', 400);
  }
  return key;
}

/**
 * Claims the Idempotency-Key in the database.
 * If already completed with the identical request, returns the cached replay response.
 * If reused with a different request payload, throws an IDEMPOTENCY_KEY_REUSED (422) error.
 */
export async function beginTransactionIdempotency(
  key: string,
  payload: unknown,
  scope: TransactionIdempotencyScope = 'transaction',
  waitMs = 30_000
): Promise<TransactionIdempotencyBegin> {
  const requestHash = hashPayload(scope, payload);
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
    if (!row) continue; // Owner abandoned between INSERT and SELECT; retry claim

    if (row.scope !== scope || row.request_hash !== requestHash) {
      throw new TransactionEngineError(
        'This Idempotency-Key was already used with a different request payload',
        'IDEMPOTENCY_KEY_REUSED',
        422
      );
    }

    if (row.state === 'COMPLETED') {
      return { kind: 'replay', statusCode: row.status_code, body: row.response_body };
    }

    // In progress: take over if owner appears dead/stale
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
      throw new TransactionEngineError(
        'A request with this Idempotency-Key is still being processed; retry shortly',
        'IDEMPOTENT_REQUEST_IN_PROGRESS',
        409
      );
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/**
 * Stores the final response status and JSON payload atomically in the database.
 */
export async function completeTransactionIdempotency(
  key: string,
  statusCode: number,
  body: unknown,
  _transactionId?: string | null
): Promise<any> {
  const res = await query<{ response_body: any }>(
    `UPDATE idempotency_keys
     SET state = 'COMPLETED', status_code = $2, response_body = $3::jsonb, updated_at = CURRENT_TIMESTAMP
     WHERE key = $1
     RETURNING response_body`,
    [key, statusCode, JSON.stringify(body)]
  );
  return res.rows[0]?.response_body ?? body;
}

export async function abandonTransactionIdempotency(key: string): Promise<void> {
  try {
    await query(`DELETE FROM idempotency_keys WHERE key = $1 AND state = 'IN_PROGRESS'`, [key]);
  } catch (err) {
    console.error(`[Idempotency] Failed to abandon key ${key}:`, err);
  }
}

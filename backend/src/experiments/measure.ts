import type { FastifyInstance } from 'fastify';
import { getTransactionDetails } from '../transactions/saga.js';
import { countBy, summarize } from './stats.js';
import type { AggregateMetrics, ProviderOpTiming, TrialRecord } from './types.js';

export interface SubmitOptions {
  variant: string;
  trial: number;
  body: Record<string, unknown>;
  idempotencyKey: string | null;
}

export interface ApiResponse {
  status: number;
  body: any;
  endToEndMs: number;
}

/** Submits through the real Fastify route (validation, idempotency, payment, saga) without network I/O. */
export async function postTransaction(app: FastifyInstance, body: unknown, idempotencyKey: string | null): Promise<ApiResponse> {
  const started = performance.now();
  const res = await app.inject({
    method: 'POST',
    url: '/api/transactions',
    payload: body as any,
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}
  });
  const endToEndMs = performance.now() - started;
  let parsed: any = null;
  try {
    parsed = res.json();
  } catch {
    parsed = { raw: res.body };
  }
  return { status: res.statusCode, body: parsed, endToEndMs };
}

type Details = Awaited<ReturnType<typeof getTransactionDetails>>;

const toMs = (v: unknown) => new Date(v as string).getTime();

const START_EVENTS: Record<string, 'RESERVE' | 'CONFIRM' | 'CANCEL'> = {
  RESERVE_STARTED: 'RESERVE',
  CONFIRM_STARTED: 'CONFIRM',
  COMPENSATION_STARTED: 'CANCEL'
};
const END_EVENTS: Record<string, { op: 'RESERVE' | 'CONFIRM' | 'CANCEL'; outcome: 'SUCCEEDED' | 'FAILED' }> = {
  PROVIDER_RESERVED: { op: 'RESERVE', outcome: 'SUCCEEDED' },
  PROVIDER_RESERVE_FAILED: { op: 'RESERVE', outcome: 'FAILED' },
  PROVIDER_CONFIRMED: { op: 'CONFIRM', outcome: 'SUCCEEDED' },
  PROVIDER_CONFIRM_FAILED: { op: 'CONFIRM', outcome: 'FAILED' },
  COMPENSATION_SUCCEEDED: { op: 'CANCEL', outcome: 'SUCCEEDED' },
  COMPENSATION_FAILED: { op: 'CANCEL', outcome: 'FAILED' }
};

const eventName = (e: Details['events'][number]) => (e.detail && typeof e.detail.event === 'string' ? e.detail.event : e.toState);

/**
 * Provider-operation latency = time between the persisted *_STARTED event and its outcome event for the
 * same item. Both timestamps come from the database clock, so this includes the engine's persistence
 * around the provider call (the mock adapters themselves return immediately).
 */
export function providerOpTimings(details: Details): ProviderOpTiming[] {
  const typeByItem = new Map(details.items.map(i => [i.id, i.type as string]));
  const open = new Map<string, number>();
  const out: ProviderOpTiming[] = [];
  for (const e of details.events) {
    if (!e.itemId) continue;
    const name = eventName(e);
    const startOp = START_EVENTS[name];
    if (startOp) {
      open.set(`${e.itemId}:${startOp}`, toMs(e.createdAt));
      continue;
    }
    const end = END_EVENTS[name];
    if (!end) continue;
    const key = `${e.itemId}:${end.op}`;
    const start = open.get(key);
    if (start === undefined) continue;
    open.delete(key);
    out.push({ itemType: typeByItem.get(e.itemId) ?? 'unknown', operation: end.op, outcome: end.outcome, latencyMs: toMs(e.createdAt) - start });
  }
  return out;
}

export function paymentFromEvents(details: Details): TrialRecord['payment'] {
  const payment: TrialRecord['payment'] = { authorized: false, authorizationFailed: false, captured: false, captureFailed: false, reversal: null };
  for (const e of details.events) {
    // Stage transitions can cite a payment failure as their cause; only payment rows (no fromState) count.
    if (e.itemId !== null || e.fromState !== null) continue;
    switch (eventName(e)) {
      case 'PAYMENT_AUTHORIZED': payment.authorized = true; break;
      case 'PAYMENT_AUTHORIZATION_FAILED': payment.authorizationFailed = true; break;
      case 'PAYMENT_CAPTURED': payment.captured = true; break;
      case 'PAYMENT_CAPTURE_FAILED': payment.captureFailed = true; break;
      case 'PAYMENT_REFUNDED': payment.reversal = e.detail?.status === 'VOIDED' ? 'VOIDED' : 'REFUNDED'; break;
      case 'PAYMENT_REFUND_FAILED': payment.reversal = 'FAILED'; break;
    }
  }
  return payment;
}

export async function recordTrial(app: FastifyInstance, options: SubmitOptions): Promise<TrialRecord> {
  const response = await postTransaction(app, options.body, options.idempotencyKey);
  return buildTrialRecord(options, response);
}

export async function buildTrialRecord(options: Pick<SubmitOptions, 'variant' | 'trial' | 'idempotencyKey'>, response: ApiResponse): Promise<TrialRecord> {
  const body = response.body ?? {};
  const transactionId: string | null = typeof body.transactionId === 'string' ? body.transactionId : null;
  const record: TrialRecord = {
    trial: options.trial,
    variant: options.variant,
    idempotencyKey: options.idempotencyKey,
    httpStatus: response.status,
    errorCode: typeof body.error === 'string' ? body.error : null,
    errorMessage: typeof body.message === 'string' && !transactionId ? body.message : null,
    transactionId,
    finalState: null,
    failurePhase: typeof body.failure?.phase === 'string' ? body.failure.phase : null,
    idempotentReplay: false,
    endToEndMs: Math.round(response.endToEndMs * 1000) / 1000,
    sagaMs: null,
    providerOps: [],
    compensationsSucceeded: 0,
    compensationsFailed: 0,
    payment: { authorized: false, authorizationFailed: false, captured: false, captureFailed: false, reversal: null },
    locks: { confirmed: 0, released: 0, active: 0, expired: 0 },
    unresolvedLocks: 0,
    riskLevel: null,
    riskScore: null,
    riskDecision: null,
    riskFactorCodes: [],
    recoveryRecommendation: null,
    recoverySeverity: null,
    recoveryConfidence: null
  };
  if (!transactionId) return record;

  // Read back what the engine persisted; this happens after the timed request.
  const details = await getTransactionDetails(transactionId);
  record.finalState = details.transaction.status;
  if (details.events.length > 1) {
    const times = details.events.map(e => toMs(e.createdAt));
    record.sagaMs = Math.max(...times) - Math.min(...times);
  }
  record.providerOps = providerOpTimings(details);
  record.compensationsSucceeded = record.providerOps.filter(o => o.operation === 'CANCEL' && o.outcome === 'SUCCEEDED').length;
  record.compensationsFailed = record.providerOps.filter(o => o.operation === 'CANCEL' && o.outcome === 'FAILED').length;
  record.payment = paymentFromEvents(details);
  for (const lock of details.locks) {
    if (lock.status === 'CONFIRMED') record.locks.confirmed++;
    else if (lock.status === 'RELEASED') record.locks.released++;
    else if (lock.status === 'ACTIVE') record.locks.active++;
    else if (lock.status === 'EXPIRED') record.locks.expired++;
  }
  record.unresolvedLocks = details.transaction.status === 'ROLLBACK_FAILED' ? record.locks.confirmed : 0;
  const risk = details.riskAssessment as any;
  if (risk) {
    record.riskLevel = risk.riskLevel;
    record.riskScore = Number(risk.riskScore);
    record.riskDecision = risk.decision;
    record.riskFactorCodes = (risk.factors ?? []).map((f: any) => f.code);
  }
  const advisory = details.recoveryAdvisory as any;
  if (advisory) {
    record.recoveryRecommendation = advisory.recommendation;
    record.recoverySeverity = advisory.severity;
    record.recoveryConfidence = Number(advisory.confidence);
  }
  return record;
}

/**
 * Marks replays: several successful responses carrying the same transactionId means one execution plus
 * replays. The replay count is exact; which request executed is not identifiable from responses, so
 * the lowest trial index is treated as the executor.
 */
export function markReplays(trials: TrialRecord[]): void {
  const seen = new Set<string>();
  for (const t of [...trials].sort((a, b) => a.trial - b.trial)) {
    if (!t.transactionId) continue;
    t.idempotentReplay = seen.has(t.transactionId);
    seen.add(t.transactionId);
  }
}

const rate = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 10000) / 10000);

export function aggregate(trials: TrialRecord[], window: { wallClockMs: number; concurrency: number; observedMaxInFlight: number }): AggregateMetrics {
  // Transaction-level facts are counted once per executed transaction, not once per replayed response.
  const executed = trials.filter(t => t.transactionId && !t.idempotentReplay);
  const byState = countBy(executed, t => t.finalState);
  const providerOps = executed.flatMap(t => t.providerOps);
  const opGroups: Record<string, number[]> = {};
  for (const op of providerOps) (opGroups[`${op.operation}_${op.outcome}`] ??= []).push(op.latencyMs);
  const compensationsSucceeded = executed.reduce((s, t) => s + t.compensationsSucceeded, 0);
  const compensationsFailed = executed.reduce((s, t) => s + t.compensationsFailed, 0);
  const attempted = compensationsSucceeded + compensationsFailed;

  return {
    totalRequests: trials.length,
    successfulTransactions: byState.COMPLETED ?? 0,
    failedTransactions: byState.FAILED ?? 0,
    rolledBackTransactions: byState.ROLLED_BACK ?? 0,
    rollbackFailures: byState.ROLLBACK_FAILED ?? 0,
    distinctTransactions: new Set(executed.map(t => t.transactionId)).size,
    idempotentReplays: trials.filter(t => t.idempotentReplay).length,
    rejectedRequests: countBy(trials.filter(t => !t.transactionId), t => t.errorCode ?? `HTTP_${t.httpStatus}`),
    rejectedLockAttempts: executed.filter(t => t.failurePhase === 'RESOURCE_RESERVATION').length,
    confirmedReservations: executed.reduce((s, t) => s + t.locks.confirmed, 0),
    releasedReservations: executed.reduce((s, t) => s + t.locks.released, 0),
    unresolvedLocks: executed.reduce((s, t) => s + t.unresolvedLocks, 0),
    compensationsAttempted: attempted,
    compensationsSucceeded,
    compensationsFailed,
    compensationSuccessRate: rate(compensationsSucceeded, attempted),
    compensationFailureRate: rate(compensationsFailed, attempted),
    payment: {
      authorized: executed.filter(t => t.payment.authorized).length,
      authorizationFailed: executed.filter(t => t.payment.authorizationFailed).length,
      captured: executed.filter(t => t.payment.captured).length,
      captureFailed: executed.filter(t => t.payment.captureFailed).length,
      refunded: executed.filter(t => t.payment.reversal === 'REFUNDED').length,
      voided: executed.filter(t => t.payment.reversal === 'VOIDED').length,
      reversalFailed: executed.filter(t => t.payment.reversal === 'FAILED').length
    },
    finalStates: byState,
    riskLevels: countBy(executed, t => t.riskLevel),
    recoveryRecommendations: countBy(executed, t => t.recoveryRecommendation),
    latency: {
      endToEndMs: summarize(trials.map(t => t.endToEndMs)),
      sagaMs: summarize(executed.map(t => t.sagaMs).filter((v): v is number => v !== null)),
      providerOpMs: Object.fromEntries(Object.entries(opGroups).sort().map(([k, v]) => [k, summarize(v)]))
    },
    throughputRps: window.wallClockMs > 0 ? Math.round((trials.length / (window.wallClockMs / 1000)) * 1000) / 1000 : null,
    wallClockMs: Math.round(window.wallClockMs * 1000) / 1000,
    concurrency: window.concurrency,
    observedMaxInFlight: window.observedMaxInFlight
  };
}

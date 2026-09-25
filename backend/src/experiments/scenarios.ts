/**
 * Phase 8 experiment definitions.
 *
 * Each experiment drives the real POST /api/transactions route with deterministic failure injection
 * (the same mechanism as the Phase 4 FailureScenarios) against isolated synthetic resources.
 * Pass/fail criteria compare measured values with the behaviour the engine documents; they never
 * substitute for measurements.
 */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { generateRecoveryAdvisory, type RecoveryAdvisorOptions } from '../ai/recoveryAdvisor.js';
import type { InjectedFailures } from '../providers/datasetAdapters.js';
import {
  createResourceSet,
  EXPERIMENT_CUSTOMER,
  itemsFor,
  RESOURCE_TYPES,
  type ExperimentResourceType,
  type ResourceSet
} from './isolation.js';
import { buildTrialRecord, markReplays, postTransaction, recordTrial } from './measure.js';
import { runWithConcurrency, seededRandom, summarize } from './stats.js';
import type { AggregateMetrics, CriterionResult, TrialRecord } from './types.js';

export interface RunOptions {
  /** Overrides each experiment's default request/trial count. */
  requests?: number;
  /** Overrides each experiment's default concurrency (or concurrency sweep). */
  concurrency?: number;
  seed: number;
}

export interface ExperimentContext {
  app: FastifyInstance;
  runId: string;
  experimentId: string;
  options: RunOptions;
  newResources(capacity: number): Promise<ResourceSet>;
  key(...parts: Array<string | number>): string;
}

export interface VariantRun {
  variant: string;
  trials: TrialRecord[];
  wallClockMs: number;
  concurrency: number;
  observedMaxInFlight: number;
}

export interface ExperimentOutput {
  config: Record<string, unknown>;
  runs: VariantRun[];
  findings: string[];
  extraMetrics?: Record<string, unknown>;
}

export interface CriteriaInput {
  metrics: AggregateMetrics;
  variants: Record<string, AggregateMetrics>;
  trials: TrialRecord[];
  output: ExperimentOutput;
}

export interface ExperimentDefinition {
  id: string;
  category: number;
  title: string;
  description: string;
  run(ctx: ExperimentContext): Promise<ExperimentOutput>;
  criteria(input: CriteriaInput): CriterionResult[];
}

// ---------------- helpers ----------------

const THREE: readonly ExperimentResourceType[] = ['hotel', 'flight', 'transport'];
const LARGE_CAPACITY = 100_000;

function requestBody(set: ResourceSet, types: readonly ExperimentResourceType[], extra: Record<string, unknown> = {}) {
  return { customerId: EXPERIMENT_CUSTOMER, items: itemsFor(set, types), paymentMethod: 'card_mock', ...extra };
}

export function crit(id: string, description: string, expected: unknown, actual: unknown, passed = isDeepStrictEqual(expected, actual)): CriterionResult {
  return { id, description, expected, actual, passed };
}

const injected = (type: string, op: string) => `injected ${type} ${op} failure`;

async function runVariant(
  ctx: ExperimentContext,
  variant: string,
  count: number,
  concurrency: number,
  make: (i: number) => { body: Record<string, unknown>; key: string | null }
): Promise<VariantRun> {
  const outcome = await runWithConcurrency(count, concurrency, async i => {
    const { body, key } = make(i);
    return recordTrial(ctx.app, { variant, trial: i, body, idempotencyKey: key });
  });
  markReplays(outcome.results);
  return { variant, trials: outcome.results, wallClockMs: outcome.wallClockMs, concurrency, observedMaxInFlight: outcome.observedMaxInFlight };
}

const opCount = (m: AggregateMetrics, key: string) => m.latency.providerOpMs[key]?.count ?? 0;

// Failure points shared by the matrix (E12) and the seeded workload (E15).
export type FailurePoint = { kind: 'none' } | { kind: 'reserve' | 'confirm'; index: number } | { kind: 'reserve-last+cancel-first' };

export function failurePointLabel(k: number, p: FailurePoint): string {
  if (p.kind === 'none') return `k${k}-none`;
  if (p.kind === 'reserve-last+cancel-first') return `k${k}-reserve@${k}+cancel@1`;
  return `k${k}-${p.kind}@${p.index}`;
}

export function failurePointsFor(k: number, includeCancel: boolean): FailurePoint[] {
  const points: FailurePoint[] = [{ kind: 'none' }];
  for (let i = 1; i <= k; i++) points.push({ kind: 'reserve', index: i });
  for (let i = 1; i <= k; i++) points.push({ kind: 'confirm', index: i });
  if (includeCancel && k >= 2) points.push({ kind: 'reserve-last+cancel-first' });
  return points;
}

export function failureSimulationFor(k: number, p: FailurePoint): InjectedFailures {
  const types = RESOURCE_TYPES.slice(0, k);
  if (p.kind === 'none') return {};
  if (p.kind === 'reserve-last+cancel-first') {
    return { reserve: { [types[k - 1]]: injected(types[k - 1], 'reserve') }, cancel: { [types[0]]: injected(types[0], 'cancellation') } };
  }
  const type = types[p.index - 1];
  return { [p.kind]: { [type]: injected(type, p.kind) } };
}

export interface ExpectedOutcome {
  state: string;
  compensationsSucceeded: number;
  compensationsFailed: number;
  captured: boolean;
  reversal: 'REFUNDED' | 'VOIDED' | null;
  confirmedLocks: number;
}

/**
 * Saga semantics documented in transactions/saga.ts: reservations run in request order, a reserve
 * failure compensates earlier reservations in reverse, a confirm failure (after capture) compensates
 * every reservation, an authorized-but-uncaptured payment is voided and a captured one refunded.
 */
export function expectedOutcome(k: number, p: FailurePoint): ExpectedOutcome {
  switch (p.kind) {
    case 'none':
      return { state: 'COMPLETED', compensationsSucceeded: 0, compensationsFailed: 0, captured: true, reversal: null, confirmedLocks: k };
    case 'reserve':
      return { state: 'ROLLED_BACK', compensationsSucceeded: p.index - 1, compensationsFailed: 0, captured: false, reversal: 'VOIDED', confirmedLocks: 0 };
    case 'confirm':
      return { state: 'ROLLED_BACK', compensationsSucceeded: k, compensationsFailed: 0, captured: true, reversal: 'REFUNDED', confirmedLocks: 0 };
    case 'reserve-last+cancel-first':
      return { state: 'ROLLBACK_FAILED', compensationsSucceeded: k - 2, compensationsFailed: 1, captured: false, reversal: 'VOIDED', confirmedLocks: 1 };
  }
}

export function observedOutcome(t: TrialRecord): ExpectedOutcome {
  return {
    state: t.finalState ?? 'NONE',
    compensationsSucceeded: t.compensationsSucceeded,
    compensationsFailed: t.compensationsFailed,
    captured: t.payment.captured,
    reversal: t.payment.reversal === 'FAILED' ? null : t.payment.reversal,
    confirmedLocks: t.locks.confirmed
  };
}

// ---------------- experiments ----------------

const E01: ExperimentDefinition = {
  id: 'E01-baseline-success',
  category: 1,
  title: 'Baseline successful booking',
  description: 'Three-provider bookings (hotel, flight, transport) with no injected failures, executed sequentially to establish baseline latency.',
  async run(ctx) {
    const n = ctx.options.requests ?? 20;
    const c = ctx.options.concurrency ?? 1;
    const set = await ctx.newResources(LARGE_CAPACITY);
    const run = await runVariant(ctx, 'baseline', n, c, i => ({ body: requestBody(set, THREE), key: ctx.key('b', i) }));
    return { config: { requests: n, concurrency: c, providers: 3, failureInjection: 'none' }, runs: [run], findings: [] };
  },
  criteria: ({ metrics: m }) => [
    crit('all-completed', 'Every request completes', m.totalRequests, m.successfulTransactions),
    crit('locks-confirmed', 'One CONFIRMED lock per item (3 per booking)', 3 * m.totalRequests, m.confirmedReservations),
    crit('payment-captured', 'Payment captured for every booking', m.totalRequests, m.payment.captured),
    crit('no-compensation', 'No compensation attempted', 0, m.compensationsAttempted)
  ]
};

const E02: ExperimentDefinition = {
  id: 'E02-first-provider-failure',
  category: 2,
  title: 'First-provider failure',
  description: 'The first provider (hotel) rejects its reservation, so no provider holds anything to compensate.',
  async run(ctx) {
    const n = ctx.options.requests ?? 10;
    const c = ctx.options.concurrency ?? 1;
    const set = await ctx.newResources(LARGE_CAPACITY);
    const failureSimulation = { reserve: { hotel: injected('hotel', 'reserve') } };
    const run = await runVariant(ctx, 'reserve@hotel', n, c, i => ({ body: requestBody(set, THREE, { failureSimulation }), key: ctx.key('f', i) }));
    return { config: { requests: n, concurrency: c, providers: 3, failureInjection: failureSimulation }, runs: [run], findings: [] };
  },
  criteria: ({ metrics: m }) => [
    crit('all-rolled-back', 'Every transaction ends ROLLED_BACK', m.totalRequests, m.rolledBackTransactions),
    crit('one-reserve-attempt', 'Exactly one failed reserve per transaction and no successful reserves', [m.totalRequests, 0], [opCount(m, 'RESERVE_FAILED'), opCount(m, 'RESERVE_SUCCEEDED')]),
    crit('no-compensation', 'Nothing to compensate', 0, m.compensationsAttempted),
    crit('payment-voided', 'Authorized payment voided', m.totalRequests, m.payment.voided),
    crit('locks-released', 'All 3 locks per transaction released', 3 * m.totalRequests, m.releasedReservations)
  ]
};

const E03: ExperimentDefinition = {
  id: 'E03-failure-after-multiple-reservations',
  category: 3,
  title: 'Failure after multiple successful provider reservations',
  description: 'Hotel and flight reserve successfully, then transport fails (Phase 4 scenario A); the two earlier reservations are compensated in reverse order.',
  async run(ctx) {
    const n = ctx.options.requests ?? 10;
    const c = ctx.options.concurrency ?? 1;
    const set = await ctx.newResources(LARGE_CAPACITY);
    const failureSimulation = { reserve: { transport: injected('transport', 'reserve') } };
    const run = await runVariant(ctx, 'reserve@transport', n, c, i => ({ body: requestBody(set, THREE, { failureSimulation }), key: ctx.key('f', i) }));
    return { config: { requests: n, concurrency: c, providers: 3, failureInjection: failureSimulation }, runs: [run], findings: [] };
  },
  criteria: ({ metrics: m }) => [
    crit('all-rolled-back', 'Every transaction ends ROLLED_BACK', m.totalRequests, m.rolledBackTransactions),
    crit('two-compensations', 'Two successful compensations per transaction', 2 * m.totalRequests, m.compensationsSucceeded),
    crit('compensation-rate', 'Compensation success rate is 1', 1, m.compensationSuccessRate),
    crit('no-capture', 'Payment never captured; authorization voided', [0, m.totalRequests], [m.payment.captured, m.payment.voided]),
    crit('no-held-capacity', 'No CONFIRMED locks remain', 0, m.confirmedReservations)
  ]
};

const E04: ExperimentDefinition = {
  id: 'E04-successful-compensation',
  category: 4,
  title: 'Successful compensation after capture',
  description: 'All providers reserve and payment is captured, then the transport confirmation fails; every reservation is compensated and the captured payment refunded.',
  async run(ctx) {
    const n = ctx.options.requests ?? 10;
    const c = ctx.options.concurrency ?? 1;
    const set = await ctx.newResources(LARGE_CAPACITY);
    const failureSimulation = { confirm: { transport: injected('transport', 'confirm') } };
    const run = await runVariant(ctx, 'confirm@transport', n, c, i => ({ body: requestBody(set, THREE, { failureSimulation }), key: ctx.key('f', i) }));
    return { config: { requests: n, concurrency: c, providers: 3, failureInjection: failureSimulation }, runs: [run], findings: [] };
  },
  criteria: ({ metrics: m }) => [
    crit('all-rolled-back', 'Every transaction ends ROLLED_BACK', m.totalRequests, m.rolledBackTransactions),
    crit('all-compensated', 'All three reservations compensated per transaction', 3 * m.totalRequests, m.compensationsSucceeded),
    crit('compensation-rate', 'Compensation success rate is 1', 1, m.compensationSuccessRate),
    crit('payment-refunded', 'Captured payment refunded', [m.totalRequests, m.totalRequests], [m.payment.captured, m.payment.refunded]),
    crit('no-held-capacity', 'No CONFIRMED locks remain', 0, m.confirmedReservations)
  ]
};

const E05: ExperimentDefinition = {
  id: 'E05-compensation-failure',
  category: 5,
  title: 'Compensation failure / ROLLBACK_FAILED',
  description: 'Transport reservation fails and one or two cancellations also fail (Phase 4 scenario E and a double-failure variant).',
  async run(ctx) {
    const n = ctx.options.requests ?? 10;
    const c = ctx.options.concurrency ?? 1;
    const variants: Record<string, InjectedFailures> = {
      'cancel-flight-fails': { reserve: { transport: injected('transport', 'reserve') }, cancel: { flight: injected('flight', 'cancellation') } },
      'cancel-flight-and-hotel-fail': {
        reserve: { transport: injected('transport', 'reserve') },
        cancel: { flight: injected('flight', 'cancellation'), hotel: injected('hotel', 'cancellation') }
      }
    };
    const runs: VariantRun[] = [];
    for (const [variant, failureSimulation] of Object.entries(variants)) {
      const set = await ctx.newResources(LARGE_CAPACITY);
      runs.push(await runVariant(ctx, variant, n, c, i => ({ body: requestBody(set, THREE, { failureSimulation }), key: ctx.key(variant, i) })));
    }
    return { config: { requestsPerVariant: n, concurrency: c, providers: 3, failureInjection: variants }, runs, findings: [] };
  },
  criteria: ({ variants: v, metrics: m }) => {
    const a = v['cancel-flight-fails'];
    const b = v['cancel-flight-and-hotel-fail'];
    return [
      crit('rollback-failed', 'Every transaction ends ROLLBACK_FAILED', m.totalRequests, m.rollbackFailures),
      crit('single-failure-split', 'One failed and one successful compensation per transaction (single failure)', [a.totalRequests, a.totalRequests], [a.compensationsFailed, a.compensationsSucceeded]),
      crit('double-failure-split', 'Two failed compensations per transaction (double failure)', [2 * b.totalRequests, 0], [b.compensationsFailed, b.compensationsSucceeded]),
      crit('locks-held', 'Each failed compensation leaves exactly one unresolved CONFIRMED lock', m.compensationsFailed, m.unresolvedLocks),
      crit('manual-review', 'Persisted advisory is MANUAL_OPERATOR_REVIEW for every transaction', { MANUAL_OPERATOR_REVIEW: m.totalRequests }, m.recoveryRecommendations)
    ];
  }
};

const E06: ExperimentDefinition = {
  id: 'E06-payment-authorization-failure',
  category: 6,
  title: 'Payment authorization failure',
  description: 'The payment gateway declines authorization after resources are locked and before any provider is contacted.',
  async run(ctx) {
    const n = ctx.options.requests ?? 10;
    const c = ctx.options.concurrency ?? 1;
    const set = await ctx.newResources(LARGE_CAPACITY);
    const paymentFailureSimulation = { authorize: 'experiment: authorization declined' };
    const run = await runVariant(ctx, 'authorize-declined', n, c, i => ({ body: requestBody(set, THREE, { paymentFailureSimulation }), key: ctx.key('p', i) }));
    return { config: { requests: n, concurrency: c, providers: 3, paymentFailureSimulation }, runs: [run], findings: [] };
  },
  criteria: ({ metrics: m }) => [
    crit('all-rolled-back', 'Every transaction ends ROLLED_BACK', m.totalRequests, m.rolledBackTransactions),
    crit('auth-failed', 'Authorization failure recorded for every transaction', m.totalRequests, m.payment.authorizationFailed),
    crit('no-provider-calls', 'No provider operation was attempted', 0, Object.values(m.latency.providerOpMs).reduce((s, x) => s + x.count, 0)),
    crit('locks-released', 'All locks released', [3 * m.totalRequests, 0], [m.releasedReservations, m.confirmedReservations])
  ]
};

const E07: ExperimentDefinition = {
  id: 'E07-payment-capture-failure',
  category: 7,
  title: 'Payment capture failure',
  description: 'All providers reserve, then payment capture fails; every reservation is compensated.',
  async run(ctx) {
    const n = ctx.options.requests ?? 10;
    const c = ctx.options.concurrency ?? 1;
    const set = await ctx.newResources(LARGE_CAPACITY);
    const paymentFailureSimulation = { capture: 'experiment: capture failed' };
    const run = await runVariant(ctx, 'capture-failed', n, c, i => ({ body: requestBody(set, THREE, { paymentFailureSimulation }), key: ctx.key('p', i) }));
    const reversals = run.trials.reduce<Record<string, number>>((acc, t) => {
      const k = t.payment.reversal ?? 'NONE';
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    const findings = [`Payment reversal recorded after capture failure: ${JSON.stringify(reversals)} (the payment was never captured).`];
    return { config: { requests: n, concurrency: c, providers: 3, paymentFailureSimulation }, runs: [run], findings, extraMetrics: { reversalAfterCaptureFailure: reversals } };
  },
  criteria: ({ metrics: m }) => [
    crit('all-rolled-back', 'Every transaction ends ROLLED_BACK', m.totalRequests, m.rolledBackTransactions),
    crit('capture-failed', 'Capture failure recorded; nothing captured', [m.totalRequests, 0], [m.payment.captureFailed, m.payment.captured]),
    crit('all-compensated', 'All three reservations compensated', 3 * m.totalRequests, m.compensationsSucceeded),
    crit('no-held-capacity', 'No CONFIRMED locks remain', 0, m.confirmedReservations)
  ]
};

const E08: ExperimentDefinition = {
  id: 'E08-duplicate-idempotency',
  category: 8,
  title: 'Duplicate idempotency requests (sequential)',
  description: 'Each key is sent several times with the same payload (successful and rolled-back originals), then once with a different payload.',
  async run(ctx) {
    const keys = ctx.options.requests ?? 5;
    const dups = 4;
    const set = await ctx.newResources(LARGE_CAPACITY);
    const failing = { failureSimulation: { reserve: { transport: injected('transport', 'reserve') } } };
    const runs: VariantRun[] = [];
    let identicalReplays = 0;
    let replayResponses = 0;
    for (const [variant, extra] of [['duplicate-success', {}], ['duplicate-after-rollback', failing]] as const) {
      const trials: TrialRecord[] = [];
      const started = performance.now();
      for (let k = 0; k < keys; k++) {
        const key = ctx.key(variant, k);
        const body = requestBody(set, THREE, extra);
        let first: any = null;
        for (let d = 0; d < dups; d++) {
          const res = await postTransaction(ctx.app, body, key);
          if (d === 0) first = res.body;
          else {
            replayResponses++;
            if (isDeepStrictEqual(res.body, first)) identicalReplays++;
          }
          trials.push(await buildTrialRecord({ variant, trial: k * dups + d, idempotencyKey: key }, res));
        }
      }
      markReplays(trials);
      runs.push({ variant, trials, wallClockMs: performance.now() - started, concurrency: 1, observedMaxInFlight: 1 });
    }
    // Same keys, different payload (quantity 2) must be rejected without executing.
    const mismatch: TrialRecord[] = [];
    const started = performance.now();
    for (let k = 0; k < keys; k++) {
      const key = ctx.key('duplicate-success', k);
      const body = { ...requestBody(set, THREE), items: itemsFor(set, THREE, 2) };
      mismatch.push(await buildTrialRecord({ variant: 'payload-mismatch', trial: k, idempotencyKey: key }, await postTransaction(ctx.app, body, key)));
    }
    runs.push({ variant: 'payload-mismatch', trials: mismatch, wallClockMs: performance.now() - started, concurrency: 1, observedMaxInFlight: 1 });
    return {
      config: { keys, sendsPerKey: dups, payloadMismatchPerKey: 1, concurrency: 1 },
      runs,
      findings: [`${identicalReplays} of ${replayResponses} replayed responses were byte-identical to the original response.`],
      extraMetrics: { replayResponses, identicalReplays }
    };
  },
  criteria: ({ variants: v, output }) => {
    const keys = output.config.keys as number;
    const dups = output.config.sendsPerKey as number;
    const x = output.extraMetrics as { replayResponses: number; identicalReplays: number };
    return [
      crit('one-execution-per-key', 'Exactly one transaction per key (success and rollback originals)', [keys, keys], [v['duplicate-success'].distinctTransactions, v['duplicate-after-rollback'].distinctTransactions]),
      crit('replays', 'All duplicates served as replays', 2 * keys * (dups - 1), v['duplicate-success'].idempotentReplays + v['duplicate-after-rollback'].idempotentReplays),
      crit('identical-replays', 'Replayed responses identical to the original', x.replayResponses, x.identicalReplays),
      crit('payload-mismatch-rejected', 'Reused key with a different payload rejected (422 IDEMPOTENCY_KEY_REUSED)', { IDEMPOTENCY_KEY_REUSED: keys }, v['payload-mismatch'].rejectedRequests),
      crit('mismatch-no-execution', 'Rejected mismatches created no transactions', 0, v['payload-mismatch'].distinctTransactions)
    ];
  }
};

const E09: ExperimentDefinition = {
  id: 'E09-concurrent-same-idempotency-key',
  category: 9,
  title: 'Concurrent requests using the same idempotency key',
  description: 'For each concurrency level, groups of identical requests sharing one key are released simultaneously.',
  async run(ctx) {
    const levels = ctx.options.concurrency ? [ctx.options.concurrency] : [2, 4, 8, 16];
    const groups = ctx.options.requests ?? 3;
    const set = await ctx.newResources(LARGE_CAPACITY);
    const runs: VariantRun[] = [];
    const consistency: Record<string, { groups: number; groupsWithSingleTransactionId: number }> = {};
    for (const c of levels) {
      const variant = `c${c}`;
      const trials: TrialRecord[] = [];
      let wall = 0;
      let maxInFlight = 0;
      let consistent = 0;
      for (let g = 0; g < groups; g++) {
        const key = ctx.key(variant, g);
        const body = requestBody(set, THREE);
        const outcome = await runWithConcurrency(c, c, i => recordTrial(ctx.app, { variant, trial: g * c + i, body, idempotencyKey: key }));
        wall += outcome.wallClockMs;
        maxInFlight = Math.max(maxInFlight, outcome.observedMaxInFlight);
        if (new Set(outcome.results.map(t => t.transactionId)).size === 1 && outcome.results[0].transactionId) consistent++;
        trials.push(...outcome.results);
      }
      markReplays(trials);
      consistency[variant] = { groups, groupsWithSingleTransactionId: consistent };
      runs.push({ variant, trials, wallClockMs: wall, concurrency: c, observedMaxInFlight: maxInFlight });
    }
    return { config: { concurrencyLevels: levels, groupsPerLevel: groups, requestsPerGroup: 'equal to concurrency level' }, runs, findings: [], extraMetrics: { consistency } };
  },
  criteria: ({ variants: v, output }) => {
    const consistency = output.extraMetrics!.consistency as Record<string, { groups: number; groupsWithSingleTransactionId: number }>;
    const levels = output.config.concurrencyLevels as number[];
    const groups = output.config.groupsPerLevel as number;
    const actualDistinct = Object.fromEntries(levels.map(c => [`c${c}`, v[`c${c}`].distinctTransactions]));
    const actualReplays = Object.fromEntries(levels.map(c => [`c${c}`, v[`c${c}`].idempotentReplays]));
    return [
      crit('single-execution', 'Exactly one transaction per key at every concurrency level', Object.fromEntries(levels.map(c => [`c${c}`, groups])), actualDistinct),
      crit('replays', 'All other concurrent requests replayed', Object.fromEntries(levels.map(c => [`c${c}`, groups * (c - 1)])), actualReplays),
      crit('same-transaction-id', 'Every response in a group carries the same transactionId', Object.fromEntries(levels.map(c => [`c${c}`, groups])), Object.fromEntries(Object.entries(consistency).map(([k, x]) => [k, x.groupsWithSingleTransactionId]))),
      crit('no-in-progress-errors', 'No request gave up waiting (IDEMPOTENT_REQUEST_IN_PROGRESS)', 0, Object.values(v).reduce((s, m) => s + (m.rejectedRequests.IDEMPOTENT_REQUEST_IN_PROGRESS ?? 0), 0))
    ];
  }
};

const E10: ExperimentDefinition = {
  id: 'E10-concurrent-same-resource',
  category: 10,
  title: 'Concurrent attempts against the same inventory',
  description: 'N simultaneous single-flight bookings (distinct keys) compete for a flight with capacity C; the engine must never confirm more than C.',
  async run(ctx) {
    const scenarios = [
      { variant: 'C5-N20', capacity: 5, n: ctx.options.requests ?? 20 },
      { variant: 'C1-N10-last-seat', capacity: 1, n: 10 }
    ];
    const runs: VariantRun[] = [];
    for (const s of scenarios) {
      const c = ctx.options.concurrency ?? s.n;
      const set = await ctx.newResources(s.capacity);
      runs.push(await runVariant(ctx, s.variant, s.n, c, i => ({ body: requestBody(set, ['flight']), key: ctx.key(s.variant, i) })));
    }
    return { config: { scenarios: scenarios.map(s => ({ ...s, concurrency: ctx.options.concurrency ?? s.n })), item: 'flight x1' }, runs, findings: [] };
  },
  criteria: ({ variants: v, output }) => {
    const scenarios = output.config.scenarios as Array<{ variant: string; capacity: number; n: number }>;
    return scenarios.flatMap(s => {
      const m = v[s.variant];
      return [
        crit(`${s.variant}:completed`, `Exactly min(C, N) bookings complete`, Math.min(s.capacity, s.n), m.successfulTransactions),
        crit(`${s.variant}:no-oversell`, 'CONFIRMED locks never exceed capacity', true, m.confirmedReservations <= s.capacity, m.confirmedReservations <= s.capacity),
        crit(`${s.variant}:rejected`, 'The remainder is rejected at reservation', Math.max(s.n - s.capacity, 0), m.rejectedLockAttempts)
      ];
    });
  }
};

const E11: ExperimentDefinition = {
  id: 'E11-lock-contention',
  category: 11,
  title: 'Reservation-lock contention',
  description: 'Hot-row sweep: bookings on the same hotel+flight rows at increasing concurrency (capacity sufficient, so contention is on row locks). Plus opposite item orders to probe lock-ordering deadlocks.',
  async run(ctx) {
    const levels = ctx.options.concurrency ? [ctx.options.concurrency] : [1, 2, 4, 8, 16];
    const n = ctx.options.requests ?? 32;
    const runs: VariantRun[] = [];
    for (const c of levels) {
      const set = await ctx.newResources(n);
      runs.push(await runVariant(ctx, `hot-row-c${c}`, n, c, i => ({ body: requestBody(set, ['hotel', 'flight']), key: ctx.key('hot', c, i) })));
    }
    const orderConcurrency = Math.max(...levels);
    const set = await ctx.newResources(n);
    runs.push(await runVariant(ctx, 'opposite-order', n, orderConcurrency, i => ({
      body: requestBody(set, i % 2 === 0 ? ['hotel', 'flight'] : ['flight', 'hotel']),
      key: ctx.key('order', i)
    })));
    const throughput = Object.fromEntries(runs.map(r => [r.variant, r.trials.length / (r.wallClockMs / 1000)]));
    return {
      config: { concurrencyLevels: levels, requestsPerLevel: n, capacity: n, items: ['hotel', 'flight'], oppositeOrderConcurrency: orderConcurrency },
      runs,
      findings: [`Measured throughput (req/s) per variant: ${Object.entries(throughput).map(([k, x]) => `${k}=${x.toFixed(2)}`).join(', ')}.`]
    };
  },
  criteria: ({ variants: v, trials }) => {
    const entries = Object.entries(v);
    const deadlocks = trials.filter(t => /deadlock/i.test(t.errorMessage ?? '')).length;
    return [
      crit('all-completed', 'Every contended booking completes (capacity is sufficient)', Object.fromEntries(entries.map(([k, m]) => [k, m.totalRequests])), Object.fromEntries(entries.map(([k, m]) => [k, m.successfulTransactions]))),
      crit('no-rejections', 'No request rejected under contention', 0, entries.reduce((s, [, m]) => s + m.rejectedLockAttempts + Object.values(m.rejectedRequests).reduce((a, b) => a + b, 0), 0)),
      crit('no-deadlocks', 'No deadlock errors with opposite item orders', 0, deadlocks)
    ];
  }
};

const E12: ExperimentDefinition = {
  id: 'E12-multi-provider-failure-points',
  category: 12,
  title: 'Multi-provider transactions with different failure points',
  description: 'Every provider count k = 1..4 crossed with every failure point (none, reserve@i, confirm@i, reserve@k+cancel@1).',
  async run(ctx) {
    const trialsPerCell = ctx.options.requests ?? 3;
    const set = await ctx.newResources(LARGE_CAPACITY);
    const runs: VariantRun[] = [];
    for (let k = 1; k <= 4; k++) {
      for (const point of failurePointsFor(k, true)) {
        const variant = failurePointLabel(k, point);
        const failureSimulation = failureSimulationFor(k, point);
        runs.push(await runVariant(ctx, variant, trialsPerCell, 1, i => ({
          body: requestBody(set, RESOURCE_TYPES.slice(0, k), { failureSimulation }),
          key: ctx.key(variant, i)
        })));
        for (const t of runs[runs.length - 1].trials) t.extra = { k, point, expected: expectedOutcome(k, point) };
      }
    }
    return { config: { providerCounts: [1, 2, 3, 4], trialsPerCell, cells: runs.length, order: RESOURCE_TYPES }, runs, findings: [] };
  },
  criteria: ({ trials, variants: v }) => {
    const mismatches = trials
      .filter(t => !isDeepStrictEqual(observedOutcome(t), (t.extra as any).expected))
      .map(t => ({ variant: t.variant, trial: t.trial, expected: (t.extra as any).expected, observed: observedOutcome(t) }));
    const sagaByK = [1, 2, 3, 4].map(k => summarize(trials.filter(t => (t.extra as any).k === k && t.sagaMs !== null).map(t => t.sagaMs!)).mean);
    return [
      crit('outcomes-match-saga-semantics', 'Every cell ends in the state, compensations, payment and lock outcome the Saga defines', [], mismatches),
      crit('cells-covered', 'All failure-point cells executed', Object.keys(v).length, Object.values(v).filter(m => m.totalRequests > 0).length),
      crit('saga-latency-recorded', 'Saga latency measured for every provider count', 4, sagaByK.filter(x => x !== null).length)
    ];
  }
};

const RISK_CONDITIONS: Record<string, Record<string, unknown>> = {
  baseline: {},
  'reliability-0.92': { reliabilityScore: 0.92 },
  'reliability-0.85': { reliabilityScore: 0.85 },
  maintenance: { status: 'maintenance' },
  suspended: { status: 'suspended' },
  'no-rollback': { supportsRollback: false },
  'latency-1500ms': { responseTimeMs: 1500 },
  'latency-2500ms': { responseTimeMs: 2500 },
  'historical-failures-2': { historicalFailures: 2 },
  'historical-rollback-failure': { historicalRollbackFailures: 1 },
  'worst-case': { reliabilityScore: 0.85, status: 'maintenance', supportsRollback: false, responseTimeMs: 2500, historicalFailures: 3, historicalRollbackFailures: 2 }
};

const E13: ExperimentDefinition = {
  id: 'E13-risk-under-provider-conditions',
  category: 13,
  title: 'Risk assessment under different provider conditions',
  description: 'Deterministic telemetry conditions (applied to all 3 providers via riskOverrides), provider counts 1-4, and capacity pressure. Bookings still execute: risk is advisory.',
  async run(ctx) {
    const trials = ctx.options.requests ?? 3;
    const runs: VariantRun[] = [];
    const set = await ctx.newResources(LARGE_CAPACITY);
    for (const [condition, override] of Object.entries(RISK_CONDITIONS)) {
      const riskOverrides = Object.fromEntries(THREE.map(t => [t, override]));
      runs.push(await runVariant(ctx, `condition:${condition}`, trials, 1, i => ({ body: requestBody(set, THREE, { riskOverrides }), key: ctx.key('cond', condition, i) })));
    }
    for (let k = 1; k <= 4; k++) {
      runs.push(await runVariant(ctx, `providers:${k}`, trials, 1, i => ({ body: requestBody(set, RESOURCE_TYPES.slice(0, k)), key: ctx.key('prov', k, i) })));
    }
    // Capacity pressure: requested quantity equals the remaining capacity (fresh capacity-1 resources per trial).
    const pressure: TrialRecord[] = [];
    const started = performance.now();
    for (let i = 0; i < trials; i++) {
      const tight = await ctx.newResources(1);
      pressure.push(await recordTrial(ctx.app, { variant: 'capacity-pressure', trial: i, body: requestBody(tight, THREE), idempotencyKey: ctx.key('cap', i) }));
    }
    runs.push({ variant: 'capacity-pressure', trials: pressure, wallClockMs: performance.now() - started, concurrency: 1, observedMaxInFlight: 1 });

    const table = Object.fromEntries(runs.map(r => {
      const scores = r.trials.map(t => t.riskScore);
      return [r.variant, {
        scores,
        levels: [...new Set(r.trials.map(t => t.riskLevel))],
        factorCodes: [...new Set(r.trials.flatMap(t => t.riskFactorCodes))].sort()
      }];
    }));
    return { config: { trialsPerCondition: trials, conditions: RISK_CONDITIONS, providerCounts: [1, 2, 3, 4], capacityPressure: 'capacity 1, quantity 1' }, runs, findings: [], extraMetrics: { riskByVariant: table } };
  },
  criteria: ({ trials, output }) => {
    const table = output.extraMetrics!.riskByVariant as Record<string, { scores: Array<number | null>; levels: string[] }>;
    const nonDeterministic = Object.entries(table).filter(([, r]) => new Set(r.scores).size !== 1).map(([k]) => k);
    const decisionMismatch = trials.filter(t => t.riskLevel !== null && (t.riskLevel === 'HIGH') !== (t.riskDecision === 'REVIEW')).length;
    const first = (k: string) => table[k]?.scores[0] ?? null;
    const worst = first('condition:worst-case');
    const others = Object.keys(table).filter(k => k !== 'condition:worst-case').map(first);
    const byK = [1, 2, 3, 4].map(k => first(`providers:${k}`));
    return [
      crit('deterministic', 'Identical conditions always produce identical scores', [], nonDeterministic),
      crit('advisory-only', 'Every booking still completes regardless of risk', trials.length, trials.filter(t => t.finalState === 'COMPLETED').length),
      crit('worst-case-dominates', 'The combined worst case scores at least as high as every other condition', true, worst !== null && others.every(s => s !== null && s <= worst), worst !== null && others.every(s => s !== null && s <= worst)),
      crit('provider-count-monotonic', 'Score does not decrease as provider count grows', true, byK.every((s, i) => i === 0 || (s !== null && byK[i - 1] !== null && s >= byK[i - 1]!)), byK.every((s, i) => i === 0 || (s !== null && byK[i - 1] !== null && s >= byK[i - 1]!))),
      crit('decision-consistent', 'Decision is REVIEW exactly when level is HIGH', 0, decisionMismatch)
    ];
  }
};

interface RecoveryCondition {
  expected: 'AUTOMATIC_RETRY' | 'ALTERNATIVE_PROVIDER' | 'MANUAL_OPERATOR_REVIEW';
  rule: string;
  extra: Record<string, unknown>;
  overrides?: RecoveryAdvisorOptions['providerOverrides'];
}

const failAt = (type: string, message: string) => ({ failureSimulation: { reserve: { [type]: message } } });

// Expected classes follow the decision rules documented in ai/recoveryAdvisor.ts.
const RECOVERY_CONDITIONS: Record<string, RecoveryCondition> = {
  'transient-timeout': { expected: 'AUTOMATIC_RETRY', rule: 'transient error, active provider, no lock/compensation issue', extra: failAt('transport', 'Provider gateway timeout (ETIMEDOUT)') },
  'maintenance-error': { expected: 'ALTERNATIVE_PROVIDER', rule: 'maintenance in error message', extra: failAt('transport', 'Supplier system under maintenance') },
  'maintenance-telemetry': { expected: 'ALTERNATIVE_PROVIDER', rule: 'provider status maintenance', extra: failAt('transport', 'Provider gateway timeout (ETIMEDOUT)'), overrides: { transport: { status: 'maintenance' } } },
  'repeated-failures': { expected: 'ALTERNATIVE_PROVIDER', rule: '>= 2 historical failures', extra: failAt('transport', 'Provider gateway timeout (ETIMEDOUT)'), overrides: { transport: { historicalFailures: 3 } } },
  'no-rollback-support': { expected: 'MANUAL_OPERATOR_REVIEW', rule: 'provider does not support rollback', extra: failAt('transport', 'Provider gateway timeout (ETIMEDOUT)'), overrides: { transport: { supportsRollback: false } } },
  'allocation-rejected': { expected: 'MANUAL_OPERATOR_REVIEW', rule: 'non-transient allocation rejection (conservative fallback)', extra: failAt('transport', 'Allocation refused: sold out') },
  ambiguous: { expected: 'MANUAL_OPERATOR_REVIEW', rule: 'ambiguous error (conservative fallback)', extra: failAt('transport', 'Unexpected supplier response code 418') },
  'compensation-failure': { expected: 'MANUAL_OPERATOR_REVIEW', rule: 'compensation failed + unresolved lock', extra: { failureSimulation: { reserve: { transport: injected('transport', 'reserve') }, cancel: { flight: injected('flight', 'cancellation') } } } },
  'refund-failure': { expected: 'MANUAL_OPERATOR_REVIEW', rule: 'payment refund failed', extra: { ...failAt('transport', injected('transport', 'reserve')), paymentFailureSimulation: { refund: 'experiment: refund declined' } } }
};

const E14: ExperimentDefinition = {
  id: 'E14-recovery-advisor-classification',
  category: 14,
  title: 'Recovery-advisor classification under different failure evidence',
  description: 'Real failed transactions with controlled error evidence and provider telemetry; the persisted advisory is recorded and the read-only advisor is also evaluated directly on the same persisted evidence.',
  async run(ctx) {
    const trials = ctx.options.requests ?? 3;
    const set = await ctx.newResources(LARGE_CAPACITY);
    const runs: VariantRun[] = [];
    const advisorMs: number[] = [];
    for (const [condition, spec] of Object.entries(RECOVERY_CONDITIONS)) {
      const run = await runVariant(ctx, condition, trials, 1, i => ({
        body: requestBody(set, THREE, { ...spec.extra, ...(spec.overrides ? { recoveryOverrides: spec.overrides } : {}) }),
        key: ctx.key('rec', condition, i)
      }));
      for (const t of run.trials) {
        if (!t.transactionId) continue;
        const started = performance.now();
        const direct = await generateRecoveryAdvisory(t.transactionId, { providerOverrides: spec.overrides });
        advisorMs.push(performance.now() - started);
        t.extra = {
          expected: spec.expected,
          rule: spec.rule,
          directRecommendation: direct?.recommendation ?? null,
          directSeverity: direct?.severity ?? null,
          directConfidence: direct?.confidence ?? null,
          directReasonCodes: direct?.reasons.map(r => r.code) ?? []
        };
      }
      runs.push(run);
    }
    const all = runs.flatMap(r => r.trials);
    const persistedByState = all.reduce<Record<string, number>>((acc, t) => {
      if (t.recoveryRecommendation) acc[t.finalState ?? 'NONE'] = (acc[t.finalState ?? 'NONE'] ?? 0) + 1;
      return acc;
    }, {});
    const directCounts = all.reduce<Record<string, number>>((acc, t) => {
      const r = (t.extra as any)?.directRecommendation ?? 'NONE';
      acc[r] = (acc[r] ?? 0) + 1;
      return acc;
    }, {});
    const classification = Object.fromEntries(runs.map(r => [r.variant, {
      expected: RECOVERY_CONDITIONS[r.variant].expected,
      states: [...new Set(r.trials.map(t => t.finalState))],
      persisted: [...new Set(r.trials.map(t => t.recoveryRecommendation))],
      direct: [...new Set(r.trials.map(t => (t.extra as any)?.directRecommendation))],
      directSeverity: [...new Set(r.trials.map(t => (t.extra as any)?.directSeverity))],
      directConfidence: [...new Set(r.trials.map(t => (t.extra as any)?.directConfidence))]
    }]));
    const reachableOnlyDirectly = Object.keys(directCounts).filter(k => k !== 'MANUAL_OPERATOR_REVIEW' && k !== 'NONE');
    return {
      config: { trialsPerCondition: trials, conditions: Object.fromEntries(Object.entries(RECOVERY_CONDITIONS).map(([k, c]) => [k, { expected: c.expected, rule: c.rule, overrides: c.overrides ?? null }])) },
      runs,
      findings: [
        `Persisted advisories by final state: ${JSON.stringify(persistedByState)}. The saga invokes the advisor only on ROLLBACK_FAILED.`,
        `Direct evaluation on the same evidence produced: ${JSON.stringify(directCounts)}.` +
          (reachableOnlyDirectly.length ? ` ${reachableOnlyDirectly.join(', ')} were observed only through direct evaluation, never persisted by the saga.` : '')
      ],
      extraMetrics: { classification, persistedAdvisoriesByState: persistedByState, directRecommendationCounts: directCounts, advisorEvaluationMs: summarize(advisorMs) }
    };
  },
  criteria: ({ trials, output }) => {
    const mismatches = trials
      .filter(t => (t.extra as any)?.directRecommendation !== (t.extra as any)?.expected)
      .map(t => ({ variant: t.variant, trial: t.trial, expected: (t.extra as any)?.expected, actual: (t.extra as any)?.directRecommendation }));
    const persistedOutsideRollbackFailed = trials.filter(t => t.recoveryRecommendation && t.finalState !== 'ROLLBACK_FAILED').length;
    const classification = output.extraMetrics!.classification as Record<string, { direct: unknown[] }>;
    return [
      crit('matches-documented-rules', 'Direct classification matches the advisor’s documented decision rules', [], mismatches),
      crit('deterministic', 'Each condition classifies identically across trials', [], Object.entries(classification).filter(([, c]) => c.direct.length !== 1).map(([k]) => k)),
      crit('persisted-only-on-rollback-failed', 'Saga persists advisories only for ROLLBACK_FAILED', 0, persistedOutsideRollbackFailed)
    ];
  }
};

const E15: ExperimentDefinition = {
  id: 'E15-seeded-mixed-workload',
  category: 12,
  title: 'Seeded mixed-failure concurrent workload',
  description: 'A concurrent workload whose provider count and failure point per request are drawn from a seeded PRNG (mulberry32), checking Saga invariants under interleaving.',
  async run(ctx) {
    const n = ctx.options.requests ?? 40;
    const c = ctx.options.concurrency ?? 8;
    const random = seededRandom(ctx.options.seed);
    const plan = Array.from({ length: n }, () => {
      const k = 1 + Math.floor(random() * 4);
      const points = failurePointsFor(k, true);
      const point = points[Math.floor(random() * points.length)];
      return { k, point, label: failurePointLabel(k, point) };
    });
    const planHash = createHash('sha256').update(JSON.stringify(plan.map(p => p.label))).digest('hex');
    const set = await ctx.newResources(LARGE_CAPACITY);
    const run = await runVariant(ctx, 'mixed', n, c, i => ({
      body: requestBody(set, RESOURCE_TYPES.slice(0, plan[i].k), { failureSimulation: failureSimulationFor(plan[i].k, plan[i].point) }),
      key: ctx.key('mix', i)
    }));
    for (const t of run.trials) t.extra = { k: plan[t.trial].k, point: plan[t.trial].point, cell: plan[t.trial].label, expected: expectedOutcome(plan[t.trial].k, plan[t.trial].point) };
    const cellCounts = plan.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.label]: (acc[p.label] ?? 0) + 1 }), {});
    return { config: { requests: n, concurrency: c, seed: ctx.options.seed, prng: 'mulberry32' }, runs: [run], findings: [], extraMetrics: { planHash, cellCounts } };
  },
  criteria: ({ trials }) => [
    crit('outcomes-match-saga-semantics', 'Every request’s outcome matches its planned failure point under concurrency', [], trials
      .filter(t => !isDeepStrictEqual(observedOutcome(t), (t.extra as any).expected))
      .map(t => ({ trial: t.trial, cell: (t.extra as any).cell, expected: (t.extra as any).expected, observed: observedOutcome(t) })))
  ]
};

export const EXPERIMENTS: ExperimentDefinition[] = [E01, E02, E03, E04, E05, E06, E07, E08, E09, E10, E11, E12, E13, E14, E15];

/** Invariants checked on every experiment in addition to its own criteria. */
export function invariantCriteria(trials: TrialRecord[]): CriterionResult[] {
  const executed = trials.filter(t => t.transactionId && !t.idempotentReplay);
  const terminal = new Set(['COMPLETED', 'ROLLED_BACK', 'ROLLBACK_FAILED', 'FAILED']);
  return [
    crit('inv:terminal-states', 'Every transaction reached a terminal state', [], executed.filter(t => !terminal.has(t.finalState ?? '')).map(t => t.transactionId)),
    crit('inv:no-active-locks', 'No ACTIVE (provisional) lock outlives its transaction', 0, executed.reduce((s, t) => s + t.locks.active, 0)),
    crit('inv:no-capacity-held-after-rollback', 'ROLLED_BACK/FAILED transactions hold no CONFIRMED locks', 0,
      executed.filter(t => t.finalState === 'ROLLED_BACK' || t.finalState === 'FAILED').reduce((s, t) => s + t.locks.confirmed, 0)),
    crit('inv:no-server-errors', 'No 5xx responses', 0, trials.filter(t => t.httpStatus >= 500).length)
  ];
}

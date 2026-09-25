import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../server.js';
import { query } from '../db/client.js';
import { createResourceSet, createSyntheticDataset, openExperimentDatabase } from './isolation.js';
import { aggregate } from './measure.js';
import { EXPERIMENTS, invariantCriteria, type ExperimentDefinition, type RunOptions } from './scenarios.js';
import { RESULT_SCHEMA_VERSION, type EngineKind, type ExperimentResult, type RunEnvironment, type RunResult, type TrialRecord } from './types.js';

export interface RunnerOptions extends RunOptions {
  engine: EngineKind;
  only?: string[];
  keepDatabase?: boolean;
  serverUrl?: string;
  runId?: string;
  command?: string;
  log?: (line: string) => void;
}

export function selectExperiments(only?: string[]): ExperimentDefinition[] {
  if (!only || only.length === 0) return EXPERIMENTS;
  const wanted = only.map(s => s.trim().toUpperCase()).filter(Boolean);
  const selected = EXPERIMENTS.filter(e => wanted.some(w => e.id.toUpperCase() === w || e.id.toUpperCase().startsWith(`${w}-`)));
  const unknown = wanted.filter(w => !EXPERIMENTS.some(e => e.id.toUpperCase() === w || e.id.toUpperCase().startsWith(`${w}-`)));
  if (unknown.length) throw new Error(`Unknown experiment(s): ${unknown.join(', ')}. Use --list to see available experiments.`);
  return selected;
}

export function newRunId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '_').toLowerCase();
  return `${stamp}_${Math.random().toString(36).slice(2, 6)}`;
}

function git(cmd: string): string | null {
  try {
    return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}

/** Deletes an experiment's transactions (cascading to items, locks, providers, events, risk, advisories) and keys. */
async function cleanupExperiment(trials: TrialRecord[]): Promise<ExperimentResult['cleanup']> {
  const ids = [...new Set(trials.map(t => t.transactionId).filter((x): x is string => !!x))];
  const keys = [...new Set(trials.map(t => t.idempotencyKey).filter((x): x is string => !!x))];
  const tx = ids.length ? await query('DELETE FROM booking_transactions WHERE id = ANY($1)', [ids]) : { rowCount: 0 };
  const ik = keys.length ? await query('DELETE FROM idempotency_keys WHERE key = ANY($1)', [keys]) : { rowCount: 0 };
  const remaining = await query<{ n: number }>(
    `SELECT (SELECT count(*) FROM booking_transactions WHERE id = ANY($1))::int
          + (SELECT count(*) FROM booking_resource_locks WHERE transaction_id = ANY($1))::int
          + (SELECT count(*) FROM booking_transaction_events WHERE transaction_id = ANY($1))::int
          + (SELECT count(*) FROM idempotency_keys WHERE key = ANY($2))::int AS n`,
    [ids, keys]
  );
  return { transactionsDeleted: tx.rowCount, idempotencyKeysDeleted: ik.rowCount, verifiedEmpty: remaining.rows[0]?.n === 0 };
}

export async function runExperiments(options: RunnerOptions): Promise<RunResult> {
  const log = options.log ?? (() => {});
  const selected = selectExperiments(options.only);
  const runId = options.runId ?? newRunId();
  const startedAt = new Date().toISOString();
  const db = await openExperimentDatabase(options.engine, runId, { serverUrl: options.serverUrl, keepDatabase: options.keepDatabase });
  let teardown = '';
  const experiments: ExperimentResult[] = [];
  try {
    await createSyntheticDataset();
    const app = await buildApp();
    let resourceCounter = 0;
    try {
      for (const def of selected) {
        log(`▶ ${def.id} — ${def.title}`);
        const expStarted = new Date().toISOString();
        const errors: string[] = [];
        const shortId = def.id.split('-')[0];
        let output;
        try {
          output = await def.run({
            app,
            runId,
            experimentId: def.id,
            options: { requests: options.requests, concurrency: options.concurrency, seed: options.seed },
            newResources: capacity => createResourceSet(`R${String(++resourceCounter).padStart(4, '0')}`, capacity),
            key: (...parts) => `exp:${runId}:${shortId}:${parts.join(':')}`.slice(0, 128)
          });
        } catch (err) {
          errors.push(err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err));
          output = { config: {}, runs: [], findings: [] };
        }

        const trials = output.runs.flatMap(r => r.trials);
        const variants = Object.fromEntries(output.runs.map(r => [r.variant, aggregate(r.trials, r)]));
        const totalWall = output.runs.reduce((s, r) => s + r.wallClockMs, 0);
        const metrics = aggregate(trials, {
          wallClockMs: totalWall,
          concurrency: Math.max(0, ...output.runs.map(r => r.concurrency)),
          observedMaxInFlight: Math.max(0, ...output.runs.map(r => r.observedMaxInFlight))
        });
        let criteria = invariantCriteria(trials);
        if (!errors.length) {
          try {
            criteria = [...def.criteria({ metrics, variants, trials, output }), ...criteria];
          } catch (err) {
            errors.push(`criteria evaluation failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        const cleanup = await cleanupExperiment(trials);
        const passed = errors.length === 0 && trials.length > 0 && criteria.every(c => c.passed) && cleanup.verifiedEmpty;
        experiments.push({
          experimentId: def.id,
          category: def.category,
          title: def.title,
          description: def.description,
          config: output.config,
          trials: trials.length,
          startedAt: expStarted,
          finishedAt: new Date().toISOString(),
          metrics,
          variants,
          extraMetrics: output.extraMetrics ?? {},
          criteria,
          passed,
          findings: output.findings,
          errors,
          cleanup,
          trialRecords: trials
        });
        const failed = criteria.filter(c => !c.passed).map(c => c.id);
        log(`  ${passed ? '✓ PASS' : '✕ FAIL'} ${trials.length} requests, ${metrics.distinctTransactions} transactions` +
          (failed.length ? `; failed criteria: ${failed.join(', ')}` : '') + (errors.length ? `; errors: ${errors.length}` : ''));
      }
    } finally {
      await app.close();
    }
  } finally {
    teardown = await db.teardown();
  }

  const environment: RunEnvironment = {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model ?? 'unknown',
    totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
    engine: db.engine,
    databaseVersion: db.databaseVersion,
    poolMax: db.poolMax,
    isolatedDatabase: db.isolatedDatabase,
    gitCommit: git('rev-parse HEAD'),
    gitDirty: (() => { const s = git('status --porcelain'); return s === null ? null : s.length > 0; })()
  };

  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    command: options.command ?? '',
    options: {
      engine: options.engine,
      only: options.only ?? null,
      requests: options.requests ?? null,
      concurrency: options.concurrency ?? null,
      seed: options.seed,
      keepDatabase: options.keepDatabase ?? false
    },
    environment,
    experiments,
    summary: { total: experiments.length, passed: experiments.filter(e => e.passed).length, failed: experiments.filter(e => !e.passed).length },
    isolation: {
      description: db.engine === 'pglite'
        ? 'In-memory PGlite database with a synthetic dataset; the research database was never connected.'
        : `Dedicated database ${db.isolatedDatabase} created for this run with a synthetic dataset; the research database was never written.`,
      researchDatabaseTouched: false,
      teardown
    }
  };
}

// ---------------- output ----------------

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  return [headers.join(','), ...rows.map(r => headers.map(h => csvCell(r[h])).join(','))].join('\n') + '\n';
}

const metricColumns = (m: ExperimentResult['metrics']) => ({
  totalRequests: m.totalRequests,
  distinctTransactions: m.distinctTransactions,
  completed: m.successfulTransactions,
  failed: m.failedTransactions,
  rolledBack: m.rolledBackTransactions,
  rollbackFailed: m.rollbackFailures,
  idempotentReplays: m.idempotentReplays,
  rejectedLockAttempts: m.rejectedLockAttempts,
  rejectedRequests: m.rejectedRequests,
  confirmedReservations: m.confirmedReservations,
  releasedReservations: m.releasedReservations,
  unresolvedLocks: m.unresolvedLocks,
  compensationsAttempted: m.compensationsAttempted,
  compensationSuccessRate: m.compensationSuccessRate,
  paymentCaptured: m.payment.captured,
  paymentAuthFailed: m.payment.authorizationFailed,
  paymentCaptureFailed: m.payment.captureFailed,
  paymentRefunded: m.payment.refunded,
  paymentVoided: m.payment.voided,
  paymentReversalFailed: m.payment.reversalFailed,
  riskLevels: m.riskLevels,
  recoveryRecommendations: m.recoveryRecommendations,
  e2eMeanMs: m.latency.endToEndMs.mean,
  e2eP50Ms: m.latency.endToEndMs.p50,
  e2eP95Ms: m.latency.endToEndMs.p95,
  e2eP99Ms: m.latency.endToEndMs.p99,
  e2eMaxMs: m.latency.endToEndMs.max,
  sagaMeanMs: m.latency.sagaMs.mean,
  sagaP95Ms: m.latency.sagaMs.p95,
  throughputRps: m.throughputRps,
  wallClockMs: m.wallClockMs,
  concurrency: m.concurrency,
  observedMaxInFlight: m.observedMaxInFlight
});

export function writeRunOutputs(result: RunResult, outRoot: string): string {
  const dir = path.join(outRoot, result.runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(result, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'summary.csv'), toCsv(result.experiments.map(e => ({
    runId: result.runId,
    experimentId: e.experimentId,
    category: e.category,
    passed: e.passed,
    criteriaPassed: e.criteria.filter(c => c.passed).length,
    criteriaTotal: e.criteria.length,
    ...metricColumns(e.metrics)
  }))));
  fs.writeFileSync(path.join(dir, 'variants.csv'), toCsv(result.experiments.flatMap(e => Object.entries(e.variants).map(([variant, m]) => ({
    runId: result.runId,
    experimentId: e.experimentId,
    variant,
    ...metricColumns(m)
  })))));
  fs.writeFileSync(path.join(dir, 'trials.csv'), toCsv(result.experiments.flatMap(e => e.trialRecords.map(t => ({
    runId: result.runId,
    experimentId: e.experimentId,
    variant: t.variant,
    trial: t.trial,
    httpStatus: t.httpStatus,
    errorCode: t.errorCode,
    transactionId: t.transactionId,
    finalState: t.finalState,
    failurePhase: t.failurePhase,
    idempotentReplay: t.idempotentReplay,
    endToEndMs: t.endToEndMs,
    sagaMs: t.sagaMs,
    providerOps: t.providerOps,
    compensationsSucceeded: t.compensationsSucceeded,
    compensationsFailed: t.compensationsFailed,
    paymentAuthorized: t.payment.authorized,
    paymentCaptured: t.payment.captured,
    paymentReversal: t.payment.reversal,
    locksConfirmed: t.locks.confirmed,
    locksReleased: t.locks.released,
    unresolvedLocks: t.unresolvedLocks,
    riskLevel: t.riskLevel,
    riskScore: t.riskScore,
    riskDecision: t.riskDecision,
    recoveryRecommendation: t.recoveryRecommendation,
    extra: t.extra ?? null
  })))));
  fs.writeFileSync(path.join(dir, 'criteria.csv'), toCsv(result.experiments.flatMap(e => e.criteria.map(c => ({
    runId: result.runId,
    experimentId: e.experimentId,
    criterion: c.id,
    passed: c.passed,
    description: c.description,
    expected: c.expected,
    actual: c.actual
  })))));
  return dir;
}

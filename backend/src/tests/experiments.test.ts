/**
 * BookGuard Phase 8: Stress & Failure Experiments Framework Tests.
 *
 * Verifies the reproducibility, metric measurement, concurrency pooling,
 * scenario criteria, output serialization, and database isolation of the Phase 8
 * experiment framework.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  EXPERIMENTS,
  invariantCriteria,
  type ExperimentDefinition
} from '../experiments/scenarios.js';
import {
  selectExperiments,
  newRunId,
  runExperiments,
  toCsv,
  writeRunOutputs
} from '../experiments/runner.js';
import {
  percentile,
  summarize,
  countBy,
  runWithConcurrency,
  seededRandom
} from '../experiments/stats.js';
import { experimentDatabaseName } from '../experiments/isolation.js';
import { RESULT_SCHEMA_VERSION, type RunResult } from '../experiments/types.js';

describe('Phase 8: Experiment Framework & Reproducibility Tests', () => {
  // 1. Experiment selection & resolution
  test('1. selectExperiments returns all 15 experiments by default', () => {
    const all = selectExperiments();
    assert.equal(all.length, 15);
    assert.equal(all[0].id, 'E01-baseline-success');
    assert.equal(all[14].id, 'E15-seeded-mixed-workload');
  });

  test('2. selectExperiments selects subsets by exact ID or prefix and throws on unknown', () => {
    const subset = selectExperiments(['E01', 'e09-concurrent-same-idempotency-key']);
    assert.equal(subset.length, 2);
    assert.equal(subset[0].id, 'E01-baseline-success');
    assert.equal(subset[1].id, 'E09-concurrent-same-idempotency-key');

    assert.throws(
      () => selectExperiments(['E99-non-existent']),
      /Unknown experiment\(s\): E99-NON-EXISTENT/
    );
  });

  // 2. Statistics and Measurement Engine
  test('3. percentile correctly computes nearest-rank percentiles without interpolation', () => {
    assert.equal(percentile([], 50), null);
    assert.equal(percentile([42], 50), 42);
    assert.equal(percentile([42], 99), 42);

    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    assert.equal(percentile(values, 50), 50);
    assert.equal(percentile(values, 95), 100);
    assert.equal(percentile(values, 1), 10);
  });

  test('4. summarize computes min, max, mean, p50, p95, p99, and stddev', () => {
    const stats = summarize([10, 20, 30, 40, 50]);
    assert.equal(stats.count, 5);
    assert.equal(stats.min, 10);
    assert.equal(stats.max, 50);
    assert.equal(stats.mean, 30);
    assert.equal(stats.p50, 30);
    assert.ok(stats.stddev !== null && stats.stddev > 0);

    const empty = summarize([]);
    assert.equal(empty.count, 0);
    assert.equal(empty.min, null);
    assert.equal(empty.mean, null);
  });

  test('5. countBy aggregates values by frequency', () => {
    const items = ['apple', 'banana', 'apple', 'orange', 'banana', 'apple'];
    const counts = countBy(items, x => x);
    assert.deepEqual(counts, { apple: 3, banana: 2, orange: 1 });
  });

  test('6. runWithConcurrency strictly bounds in-flight executions', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const taskCount = 20;
    const concurrencyLimit = 4;

    const outcome = await runWithConcurrency(taskCount, concurrencyLimit, async (idx) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Small simulated async work
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight--;
      return idx * 2;
    });

    assert.equal(outcome.results.length, taskCount);
    assert.ok(maxInFlight <= concurrencyLimit, `maxInFlight (${maxInFlight}) exceeded limit (${concurrencyLimit})`);
    assert.equal(outcome.observedMaxInFlight, maxInFlight);
    assert.equal(outcome.results[0], 0);
    assert.equal(outcome.results[19], 38);
  });

  test('7. seededRandom is strictly deterministic', () => {
    const rng1 = seededRandom(12345);
    const seq1 = Array.from({ length: 10 }, () => rng1());

    const rng2 = seededRandom(12345);
    const seq2 = Array.from({ length: 10 }, () => rng2());

    assert.deepEqual(seq1, seq2, 'Identical seed must produce identical PRNG sequence');

    const rng3 = seededRandom(99999);
    const seq3 = Array.from({ length: 10 }, () => rng3());
    assert.notDeepEqual(seq1, seq3, 'Different seeds must produce different sequences');
  });

  // 3. Output Serialization & Safety
  test('8. toCsv properly escapes quotes, commas, newlines, and objects', () => {
    const rows = [
      { id: 1, name: 'Simple', notes: null, meta: null },
      { id: 2, name: 'With, Comma', notes: 'Line 1\nLine 2', meta: null },
      { id: 3, name: 'With "Quotes"', notes: null, meta: { key: 'val' } }
    ];
    const csv = toCsv(rows);
    assert.ok(csv.includes('id,name,notes,meta'));
    assert.ok(csv.includes('"With, Comma"'));
    assert.ok(csv.includes('"Line 1\nLine 2"'));
    assert.ok(csv.includes('"With ""Quotes"""'));
  });

  test('9. experimentDatabaseName enforces database name format safety', () => {
    const valid = experimentDatabaseName('run_123');
    assert.ok(valid.startsWith('bookguard_exp_'));
    assert.match(valid, /^bookguard_exp_[a-z0-9_]+$/);

    // Empty suffix or oversized suffix throws
    assert.throws(() => experimentDatabaseName(''));
    assert.throws(() => experimentDatabaseName('a'.repeat(50)));
  });

  test('10. writeRunOutputs generates valid directory structure with all CSV and JSON artifacts', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-exp-test-'));
    try {
      const mockResult: RunResult = {
        schemaVersion: RESULT_SCHEMA_VERSION,
        runId: 'test_run_123',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        command: 'test',
        options: { engine: 'pglite', seed: 42 },
        environment: {
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          cpus: 4,
          cpuModel: 'Test CPU',
          totalMemoryMb: 8192,
          engine: 'pglite',
          databaseVersion: 'PGlite 16',
          poolMax: null,
          isolatedDatabase: null,
          gitCommit: null,
          gitDirty: null
        },
        experiments: [],
        summary: { total: 0, passed: 0, failed: 0 },
        isolation: {
          description: 'In-memory test',
          researchDatabaseTouched: false,
          teardown: 'Cleaned'
        }
      };

      const outDir = writeRunOutputs(mockResult, tmpDir);
      assert.ok(fs.existsSync(path.join(outDir, 'run.json')));
      assert.ok(fs.existsSync(path.join(outDir, 'summary.csv')));
      assert.ok(fs.existsSync(path.join(outDir, 'variants.csv')));
      assert.ok(fs.existsSync(path.join(outDir, 'trials.csv')));
      assert.ok(fs.existsSync(path.join(outDir, 'criteria.csv')));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // 4. End-to-end execution of live scenarios
  test('11. E01 (Baseline Success) executes against isolated engine and passes all criteria', async () => {
    const result = await runExperiments({
      engine: 'pglite',
      only: ['E01'],
      requests: 3,
      concurrency: 1,
      seed: 42
    });

    assert.equal(result.experiments.length, 1);
    const exp = result.experiments[0];
    assert.equal(exp.passed, true, `E01 failed: ${exp.errors.join(', ')}`);
    assert.equal(exp.metrics.successfulTransactions, 3);
    assert.equal(exp.metrics.failedTransactions, 0);
    assert.equal(exp.metrics.confirmedReservations, 9); // 3 items * 3 requests
    assert.equal(exp.metrics.unresolvedLocks, 0);
    assert.equal(exp.cleanup.verifiedEmpty, true);
  });

  test('12. E02 (First Provider Failure) executes rollback without leaks', async () => {
    const result = await runExperiments({
      engine: 'pglite',
      only: ['E02'],
      requests: 2,
      concurrency: 1,
      seed: 42
    });

    assert.equal(result.experiments.length, 1);
    const exp = result.experiments[0];
    assert.equal(exp.passed, true, `E02 failed: ${exp.errors.join(', ')}`);
    assert.equal(exp.metrics.rolledBackTransactions, 2);
    assert.equal(exp.metrics.successfulTransactions, 0);
    assert.equal(exp.metrics.unresolvedLocks, 0);
    assert.equal(exp.cleanup.verifiedEmpty, true);
  });

  test('13. E08 (Duplicate Idempotency) detects exact replays and rejects payload mismatch', async () => {
    const result = await runExperiments({
      engine: 'pglite',
      only: ['E08'],
      requests: 2,
      concurrency: 1,
      seed: 42
    });

    assert.equal(result.experiments.length, 1);
    const exp = result.experiments[0];
    assert.equal(exp.passed, true, `E08 failed: ${exp.errors.join(', ')}`);
    assert.ok(exp.metrics.idempotentReplays > 0);
    assert.equal(exp.cleanup.verifiedEmpty, true);
  });

  test('14. Invariant criteria catch unreleased locks or non-terminal states', () => {
    const passingTrial: any = {
      transactionId: 'tx-1',
      idempotentReplay: false,
      finalState: 'COMPLETED',
      locks: { active: 0, confirmed: 3, released: 0, expired: 0 },
      httpStatus: 200
    };
    const passCriteria = invariantCriteria([passingTrial]);
    assert.ok(passCriteria.every(c => c.passed));

    const leakingTrial: any = {
      transactionId: 'tx-2',
      idempotentReplay: false,
      finalState: 'ROLLED_BACK',
      locks: { active: 1, confirmed: 1, released: 0, expired: 0 }, // Leaked lock!
      httpStatus: 200
    };
    const failCriteria = invariantCriteria([leakingTrial]);
    assert.ok(failCriteria.some(c => !c.passed));
  });
});

/**
 * Phase 9 Automated Test Suite: Research Evaluation & Analysis Engine
 *
 * Verifies that:
 * 1. Experiment run loaders correctly read raw Phase 8 outputs without data loss.
 * 2. Metric calculation algorithms correctly derive statistical summaries (mean, percentiles, rates).
 * 3. All 5 SVG research charts are properly formed with valid XML tags and real data bindings.
 * 4. Research evaluation report accurately formats experimental tables and answers RQ1-RQ8.
 * 5. Everything executes deterministically without touching seeded research databases.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {
  loadRunResult,
  computeResearchMetrics,
  generateLatencyChart,
  generateConcurrencyChart,
  generateRiskScoresChart,
  generateRecoveryAdvisorChart,
  generateLockContentionChart,
  generateEvaluationReport
} from '../experiments/evaluate.js';

const RESULTS_DIR = path.resolve(process.cwd(), '../experiments/results');

test('Phase 9 Evaluation: loadRunResult parses the Phase 8 experiment run', () => {
  const run = loadRunResult(RESULTS_DIR, '20260924_215150_n6lu');
  assert.equal(run.runId, '20260924_215150_n6lu');
  assert.equal(run.summary.total, 15);
  assert.equal(run.summary.passed, 15);
  assert.equal(run.summary.failed, 0);
  assert.equal(run.experiments.length, 15);

  const totalTrials = run.experiments.reduce((acc, e) => acc + e.trials, 0);
  assert.equal(totalTrials, 643);
});

test('Phase 9 Evaluation: computeResearchMetrics computes accurate empirical metrics', () => {
  const run = loadRunResult(RESULTS_DIR, '20260924_215150_n6lu');
  const metrics = computeResearchMetrics(run);

  assert.equal(metrics.runId, '20260924_215150_n6lu');
  assert.equal(metrics.totalTrials, 643);
  assert.equal(metrics.totalExperiments, 15);
  assert.equal(metrics.allPassed, true);

  // Baseline performance (E01)
  assert.ok(metrics.baseline.e2eMeanMs > 300 && metrics.baseline.e2eMeanMs < 500, `Unexpected baseline mean: ${metrics.baseline.e2eMeanMs}`);
  assert.ok(metrics.baseline.e2eP95Ms > metrics.baseline.e2eP50Ms);
  assert.ok(metrics.baseline.throughputRps > 0);

  // Transaction consistency & compensation (RQ1, RQ2, RQ3)
  assert.equal(metrics.failureHandling.singleProviderRollbackRate, 1.0, 'Single provider rollback must be 100%');
  assert.equal(metrics.failureHandling.compensationSuccessRate, 1.0, 'Compensation success must be 100%');
  assert.equal(metrics.failureHandling.unresolvedLockCountOnRollbackFailed, 30, 'Rollback failed must preserve 30 locks');
  assert.equal(metrics.failureHandling.retainedLocksUnreleased, 30);

  // Idempotency (RQ4)
  assert.equal(metrics.idempotency.sequentialReplayAccuracy, 1.0);
  assert.equal(metrics.idempotency.concurrentReplayAccuracy, 1.0);
  assert.equal(metrics.idempotency.payloadMismatchRejectionRate, 1.0);

  // Concurrency & Locks (RQ5)
  assert.equal(metrics.concurrencyAndLocks.oversellInstances, 0, 'Zero oversell instances permitted');
  assert.equal(metrics.concurrencyAndLocks.hotRowDeadlocks, 0, 'Zero deadlocks permitted');
  assert.ok(metrics.concurrencyAndLocks.maxObservedThroughput > 10);

  // AI & Recovery classification (RQ7)
  assert.equal(metrics.aiIntelligence.riskDeterminismRate, 1.0);
  assert.equal(metrics.aiIntelligence.riskAdvisoryCompliance, 1.0);
  assert.equal(metrics.aiIntelligence.recoveryRuleAccuracy, 1.0);
  assert.equal(metrics.aiIntelligence.recoveryPersistenceIntegrity, 1.0);
});

test('Phase 9 Evaluation: SVG Chart Generators produce valid, well-formed SVG XML', () => {
  const run = loadRunResult(RESULTS_DIR, '20260924_215150_n6lu');

  const charts = [
    { name: 'latency', svg: generateLatencyChart(run) },
    { name: 'concurrency', svg: generateConcurrencyChart(run) },
    { name: 'risk', svg: generateRiskScoresChart(run) },
    { name: 'recovery', svg: generateRecoveryAdvisorChart(run) },
    { name: 'locks', svg: generateLockContentionChart(run) }
  ];

  for (const { name, svg } of charts) {
    assert.ok(svg.startsWith('<svg'), `${name} chart must start with <svg`);
    assert.ok(svg.endsWith('</svg>'), `${name} chart must end with </svg>`);
    assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'), `${name} chart must include SVG namespace`);
    assert.ok(svg.includes('viewBox='), `${name} chart must declare a viewBox`);
    assert.ok(svg.includes('<rect'), `${name} chart must contain visual rect elements`);
    assert.ok(svg.includes('<text'), `${name} chart must contain text labels`);
  }
});

test('Phase 9 Evaluation: generateEvaluationReport formats Markdown containing all RQs and tables', () => {
  const run = loadRunResult(RESULTS_DIR, '20260924_215150_n6lu');
  const metrics = computeResearchMetrics(run);
  const report = generateEvaluationReport(run, metrics);

  assert.ok(report.includes('# BookGuard Research Evaluation Report (Phase 9)'));
  assert.ok(report.includes('RQ1: Multi-Provider Transaction Consistency Under Failure'));
  assert.ok(report.includes('RQ2: Effectiveness of Saga Compensation'));
  assert.ok(report.includes('RQ3: Behavior Under Compensation Failure'));
  assert.ok(report.includes('RQ4: Idempotency Protection Under Repeated and Concurrent Requests'));
  assert.ok(report.includes('RQ5: Reservation-Locking Behavior Under High Contention'));
  assert.ok(report.includes('RQ6: Latency and Throughput Overhead of Transaction Integrity'));
  assert.ok(report.includes('RQ7: Risk and Recovery Intelligence Classification'));
  assert.ok(report.includes('RQ8: Prototype Limitations'));
  assert.ok(report.includes('## 4. Comprehensive Experiment Data Table'));
  assert.ok(report.includes('| **E01-baseline-success** |'));
  assert.ok(report.includes('| **E15-seeded-mixed-workload** |'));
  assert.ok(report.includes('## 5. Research Limitations'));
  assert.ok(report.includes('## 6. Reproduction Instructions'));
});

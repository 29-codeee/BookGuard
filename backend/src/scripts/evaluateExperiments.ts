/**
 * CLI script to evaluate Phase 8 experiment results and generate research tables,
 * metrics summary, and publication-ready SVG charts.
 *
 * Usage:
 *   npx tsx src/scripts/evaluateExperiments.ts [--results-dir DIR] [--out DIR] [--run-id ID]
 */
import fs from 'node:fs';
import path from 'node:path';
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

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=', 2);
      if (inline !== undefined) args[k] = inline;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) args[k] = argv[++i];
      else args[k] = 'true';
    }
  }
  return args;
}

export function runEvaluation(resultsRoot: string, outputDir: string, specificRunId?: string) {
  console.log(`[Evaluation] Loading Phase 8 experiment results from ${resultsRoot}...`);
  const run = loadRunResult(resultsRoot, specificRunId);
  console.log(`[Evaluation] Found run ${run.runId} (${run.experiments.length} experiments, ${run.experiments.reduce((s, e) => s + e.trials, 0)} trials).`);

  const metrics = computeResearchMetrics(run);

  fs.mkdirSync(outputDir, { recursive: true });

  // 1. Generate SVG charts
  console.log('[Evaluation] Generating research charts (SVG)...');
  const latencySvg = generateLatencyChart(run);
  fs.writeFileSync(path.join(outputDir, 'chart_latency_by_scenario.svg'), latencySvg);

  const concurrencySvg = generateConcurrencyChart(run);
  fs.writeFileSync(path.join(outputDir, 'chart_concurrency_scaling.svg'), concurrencySvg);

  const riskSvg = generateRiskScoresChart(run);
  fs.writeFileSync(path.join(outputDir, 'chart_risk_scores.svg'), riskSvg);

  const recoverySvg = generateRecoveryAdvisorChart(run);
  fs.writeFileSync(path.join(outputDir, 'chart_recovery_classification.svg'), recoverySvg);

  const lockSvg = generateLockContentionChart(run);
  fs.writeFileSync(path.join(outputDir, 'chart_lock_contention.svg'), lockSvg);

  // 2. Generate structured metrics JSON & Markdown report
  console.log('[Evaluation] Generating structured metrics and research report...');
  fs.writeFileSync(path.join(outputDir, 'metrics_summary.json'), JSON.stringify(metrics, null, 2) + '\n');

  const report = generateEvaluationReport(run, metrics);
  fs.writeFileSync(path.join(outputDir, 'RESEARCH_EVALUATION.md'), report + '\n');

  console.log(`[Evaluation] Success! All evaluation artifacts written to: ${outputDir}`);
  return { run, metrics, outputDir };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const resultsRoot = path.resolve(process.cwd(), args['results-dir'] || '../experiments/results');
  const outputDir = path.resolve(process.cwd(), args['out'] || '../experiments/evaluation');
  const specificRunId = args['run-id'];

  runEvaluation(resultsRoot, outputDir, specificRunId);
}

main();

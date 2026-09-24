/**
 * BookGuard Phase 8 experiment runner.
 *
 * Usage (from backend/):
 *   npm run experiments -- [--engine pglite|postgres] [--only E01,E09] [--requests N] [--concurrency C]
 *                          [--seed S] [--out DIR] [--keep-db] [--list]
 *
 * --engine pglite   (default) in-memory embedded PostgreSQL; nothing outside this process is touched.
 * --engine postgres creates a dedicated bookguard_exp_<runId> database on the DATABASE_URL server,
 *                   runs there, and drops it afterwards (keep it with --keep-db). The research
 *                   database named in DATABASE_URL is never written.
 */
import path from 'node:path';
import { EXPERIMENTS } from '../experiments/scenarios.js';
import { runExperiments, writeRunOutputs } from '../experiments/runner.js';
import type { EngineKind } from '../experiments/types.js';

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`Unexpected argument: ${a}`);
    const [name, inline] = a.slice(2).split('=', 2);
    if (inline !== undefined) args[name] = inline;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) args[name] = argv[++i];
    else args[name] = true;
  }
  return args;
}

function positiveInt(value: string | boolean | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer`);
  return n;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    for (const e of EXPERIMENTS) console.log(`${e.id.padEnd(42)} [cat ${e.category}] ${e.title}`);
    return;
  }
  const engine = (args.engine ?? 'pglite') as EngineKind;
  if (engine !== 'pglite' && engine !== 'postgres') throw new Error('--engine must be pglite or postgres');
  const seed = args.seed === undefined ? 42 : Number(args.seed);
  if (!Number.isInteger(seed)) throw new Error('--seed must be an integer');
  const outRoot = path.resolve(process.cwd(), typeof args.out === 'string' ? args.out : '../experiments/results');

  const result = await runExperiments({
    engine,
    only: typeof args.only === 'string' ? args.only.split(',') : undefined,
    requests: positiveInt(args.requests, 'requests'),
    concurrency: positiveInt(args.concurrency, 'concurrency'),
    seed,
    keepDatabase: args['keep-db'] === true,
    command: `npm run experiments -- ${process.argv.slice(2).join(' ')}`.trim(),
    log: line => console.log(line)
  });
  const dir = writeRunOutputs(result, outRoot);
  console.log(`\n${result.summary.passed}/${result.summary.total} experiments passed · engine=${result.environment.engine}` +
    (result.environment.isolatedDatabase ? ` (${result.environment.isolatedDatabase})` : ''));
  console.log(result.isolation.teardown);
  console.log(`Results: ${dir}`);
  process.exitCode = result.summary.failed === 0 ? 0 : 1;
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 2;
});

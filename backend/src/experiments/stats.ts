import type { LatencyStats } from './types.js';

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Nearest-rank percentile (no interpolation), so every reported value is an observed sample. */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

export function summarize(values: number[]): LatencyStats {
  const sorted = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return { count: 0, min: null, max: null, mean: null, p50: null, p95: null, p99: null, stddev: null };
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  // Sample standard deviation; undefined for a single observation.
  const stddev = n > 1 ? Math.sqrt(sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : null;
  return {
    count: n,
    min: round(sorted[0]),
    max: round(sorted[n - 1]),
    mean: round(mean),
    p50: round(percentile(sorted, 50)!),
    p95: round(percentile(sorted, 95)!),
    p99: round(percentile(sorted, 99)!),
    stddev: stddev === null ? null : round(stddev)
  };
}

export function countBy<T>(items: T[], key: (item: T) => string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    if (k === null || k === undefined) continue;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export interface PoolOutcome<R> {
  results: R[];
  wallClockMs: number;
  observedMaxInFlight: number;
}

/**
 * Closed-loop fixed-concurrency executor. Exactly `concurrency` workers start together and pull task
 * indices in order, so submission order is deterministic and in-flight work never exceeds `concurrency`.
 */
export async function runWithConcurrency<R>(
  count: number,
  concurrency: number,
  task: (index: number) => Promise<R>
): Promise<PoolOutcome<R>> {
  if (!Number.isInteger(count) || count < 0) throw new Error('count must be a non-negative integer');
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('concurrency must be a positive integer');
  const results = new Array<R>(count);
  let next = 0;
  let inFlight = 0;
  let observedMaxInFlight = 0;
  const started = performance.now();
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= count) return;
      inFlight++;
      observedMaxInFlight = Math.max(observedMaxInFlight, inFlight);
      try {
        results[index] = await task(index);
      } finally {
        inFlight--;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(count, 1)) }, worker));
  return { results, wallClockMs: performance.now() - started, observedMaxInFlight };
}

/** Mulberry32: small deterministic PRNG so seeded workloads are exactly reproducible. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

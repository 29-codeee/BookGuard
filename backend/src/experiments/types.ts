/**
 * Phase 8 experiment result schema. Consumed by Phase 9 analysis; bump RESULT_SCHEMA_VERSION on breaking changes.
 * Every number in these structures is measured from actual engine execution — nothing is estimated or hard-coded.
 */

export const RESULT_SCHEMA_VERSION = 1;

export type EngineKind = 'pglite' | 'postgres';

export interface LatencyStats {
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  stddev: number | null;
}

export interface ProviderOpTiming {
  itemType: string;
  operation: 'RESERVE' | 'CONFIRM' | 'CANCEL';
  outcome: 'SUCCEEDED' | 'FAILED';
  latencyMs: number;
}

/** One request submitted to the engine, plus what the engine persisted for it. */
export interface TrialRecord {
  trial: number;
  /** Scenario variant inside an experiment (e.g. a concurrency level or failure point). */
  variant: string;
  idempotencyKey: string | null;
  httpStatus: number;
  errorCode: string | null;
  errorMessage: string | null;
  transactionId: string | null;
  finalState: string | null;
  failurePhase: string | null;
  /** True when the idempotency layer returned a stored response instead of executing. */
  idempotentReplay: boolean;
  /** Wall-clock time of the API call, measured in-process around Fastify inject. */
  endToEndMs: number;
  /** Span between the first and last persisted event of the transaction (DB clock). */
  sagaMs: number | null;
  providerOps: ProviderOpTiming[];
  compensationsSucceeded: number;
  compensationsFailed: number;
  payment: {
    authorized: boolean;
    authorizationFailed: boolean;
    captured: boolean;
    captureFailed: boolean;
    reversal: 'REFUNDED' | 'VOIDED' | 'FAILED' | null;
  };
  locks: { confirmed: number; released: number; active: number; expired: number };
  unresolvedLocks: number;
  riskLevel: string | null;
  riskScore: number | null;
  riskDecision: string | null;
  riskFactorCodes: string[];
  recoveryRecommendation: string | null;
  recoverySeverity: string | null;
  recoveryConfidence: number | null;
  /** Free-form, measured extras for a specific experiment (e.g. directly evaluated advisor output). */
  extra?: Record<string, unknown>;
}

export interface AggregateMetrics {
  totalRequests: number;
  successfulTransactions: number;
  failedTransactions: number;
  rolledBackTransactions: number;
  rollbackFailures: number;
  /** Distinct transactions persisted for this experiment (duplicates collapse under idempotency). */
  distinctTransactions: number;
  idempotentReplays: number;
  rejectedRequests: Record<string, number>;
  rejectedLockAttempts: number;
  confirmedReservations: number;
  releasedReservations: number;
  unresolvedLocks: number;
  compensationsAttempted: number;
  compensationsSucceeded: number;
  compensationsFailed: number;
  compensationSuccessRate: number | null;
  compensationFailureRate: number | null;
  payment: {
    authorized: number;
    authorizationFailed: number;
    captured: number;
    captureFailed: number;
    refunded: number;
    voided: number;
    reversalFailed: number;
  };
  finalStates: Record<string, number>;
  riskLevels: Record<string, number>;
  recoveryRecommendations: Record<string, number>;
  latency: {
    endToEndMs: LatencyStats;
    sagaMs: LatencyStats;
    providerOpMs: Record<string, LatencyStats>;
  };
  /** Requests per second over the experiment's measured wall-clock window. */
  throughputRps: number | null;
  wallClockMs: number;
  concurrency: number;
  observedMaxInFlight: number;
}

export interface CriterionResult {
  id: string;
  description: string;
  expected: unknown;
  actual: unknown;
  passed: boolean;
}

export interface ExperimentResult {
  experimentId: string;
  category: number;
  title: string;
  description: string;
  config: Record<string, unknown>;
  trials: number;
  startedAt: string;
  finishedAt: string;
  metrics: AggregateMetrics;
  /** Per-variant aggregates for sweeps (concurrency levels, failure points, conditions). */
  variants: Record<string, AggregateMetrics>;
  /** Experiment-specific measured tables (risk scores per condition, classifier outcomes, ...). */
  extraMetrics: Record<string, unknown>;
  criteria: CriterionResult[];
  passed: boolean;
  findings: string[];
  errors: string[];
  cleanup: { transactionsDeleted: number; idempotencyKeysDeleted: number; verifiedEmpty: boolean };
  trialRecords: TrialRecord[];
}

export interface RunEnvironment {
  node: string;
  platform: string;
  arch: string;
  cpus: number;
  cpuModel: string;
  totalMemoryMb: number;
  engine: EngineKind;
  databaseVersion: string | null;
  poolMax: number | null;
  isolatedDatabase: string | null;
  gitCommit: string | null;
  gitDirty: boolean | null;
}

export interface RunResult {
  schemaVersion: number;
  runId: string;
  startedAt: string;
  finishedAt: string;
  command: string;
  options: Record<string, unknown>;
  environment: RunEnvironment;
  experiments: ExperimentResult[];
  summary: { total: number; passed: number; failed: number };
  isolation: {
    description: string;
    researchDatabaseTouched: false;
    teardown: string;
  };
}

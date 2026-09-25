/**
 * BookGuard Transaction Risk Assessment Service (Phase 6A)
 *
 * Provides a deterministic, explainable, evidence-grounded advisory risk assessment
 * for multi-provider booking transactions.
 *
 * ARCHITECTURAL CONSTRAINTS & PRINCIPLES:
 * 1. Advisory Layer: The risk assessment is strictly advisory. High risk NEVER blocks
 *    the Saga execution engine.
 * 2. Deterministic & Non-Predictive: This is a deterministic research prototype scoring
 *    model grounded in concrete telemetry (reliability, latency, rollback flags, status,
 *    historical events, and bundle complexity). It is NOT a trained statistical predictive
 *    model or an LLM hallucination engine.
 * 3. Non-Invasive & Read-Only: This service never mutates inventory, never acquires locks,
 *    never calls external provider APIs, and never mutates seeded dataset records.
 * 4. Fault Tolerant: Failures within this advisory layer must NEVER abort or fail the
 *    underlying booking transaction.
 *
 * SCORING FORMULA DOCUMENTATION:
 * Base Score:
 *   - Starts from a neutral baseline of 10.
 *
 * Provider-Specific Penalties (evaluated per unique provider):
 *   - Reliability Score (dataset_providers.reliability_score):
 *       < 0.90 -> +25 points (HIGH severity: critical failure vulnerability)
 *       0.90..0.949 -> +15 points (MEDIUM severity: below operational target)
 *       0.95..0.979 -> +5 points (LOW severity: minor deviation from ideal)
 *       >= 0.98 -> 0 points (high reliability baseline)
 *   - Operational Status (dataset_providers.status):
 *       'maintenance' -> +30 points (HIGH severity: provider currently in maintenance)
 *       other non-active -> +35 points (HIGH severity: provider suspended or inactive)
 *       'active' -> 0 points
 *   - Rollback Support (dataset_providers.supports_rollback):
 *       false -> +20 points (MEDIUM severity: automated reverse-compensation impossible)
 *       true -> 0 points
 *   - Response Latency (dataset_providers.response_time_ms):
 *       > 2000ms -> +10 points (MEDIUM severity: elevated timeout risk)
 *       1001..2000ms -> +5 points (LOW severity: moderate latency)
 *       <= 1000ms -> 0 points
 *   - Historical Failures (dataset_event_logs):
 *       rollback failure count > 0 -> +20 points (HIGH severity: past compensation failures)
 *       failure count >= 2 -> +15 points (HIGH severity: recurring operational failures)
 *       failure count == 1 -> +8 points (MEDIUM severity: isolated failure)
 *
 * Transaction-Level Penalties:
 *   - Multi-Provider Bundling (distributed coordination risk):
 *       2 distinct providers -> +10 points (LOW severity)
 *       3 distinct providers -> +20 points (MEDIUM severity)
 *       4+ distinct providers -> +30 points (HIGH severity)
 *   - Resource Contention (read-only inventory check):
 *       available capacity <= requested quantity -> +15 points (MEDIUM severity)
 *
 * Final Normalization & Risk Level Classification:
 *   - Raw score is clamped to range [0, 100].
 *   - LOW:    0 - 39  (decision: 'PROCEED')
 *   - MEDIUM: 40 - 69 (decision: 'PROCEED')
 *   - HIGH:   70 - 100 (decision: 'REVIEW')
 */

import { randomUUID } from 'node:crypto';
import { query } from '../db/client.js';
import type { CreateTransactionInput, RequestedItem, ResourceType } from '../transactions/types.js';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type RiskDecision = 'PROCEED' | 'REVIEW';

export interface RiskFactor {
  code: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  value: number | string | boolean;
  explanation: string;
  evidenceIds: string[];
}

export interface ProviderRiskAssessment {
  provider: string;
  riskScore: number;
  reliabilityScore: number | null;
  responseTimeMs: number | null;
  supportsRollback: boolean | null;
  status: string | null;
  evidenceIds: string[];
}

export interface TransactionRiskAssessment {
  riskScore: number; // 0–100
  riskLevel: RiskLevel;
  decision: RiskDecision;
  factors: RiskFactor[];
  providerAssessments: ProviderRiskAssessment[];
  calculatedAt: string;
}

export interface ProviderTelemetryOverride {
  reliabilityScore?: number;
  responseTimeMs?: number;
  supportsRollback?: boolean;
  status?: string;
  historicalFailures?: number;
  historicalRollbackFailures?: number;
}

export interface RiskAssessmentOptions {
  transactionId?: string;
  providerOverrides?: Record<string, ProviderTelemetryOverride>;
  simulateError?: boolean;
}

interface ResolvedResource {
  providerName: string;
  capacity: number;
  availableCapacity: number;
  unitPrice: number;
  currency: string;
}

interface ProviderTelemetry {
  providerId: string | null;
  reliabilityScore: number | null;
  responseTimeMs: number | null;
  supportsRollback: boolean | null;
  supportsIdempotency: boolean | null;
  status: string | null;
  historicalFailures: number;
  historicalRollbackFailures: number;
}

const BASELINE_SCORE = 10;

/**
 * Pure read-only inspection of requested resources.
 * NEVER acquires row locks (no FOR UPDATE) and NEVER mutates inventory.
 */
async function resolveResourceReadOnly(item: RequestedItem): Promise<ResolvedResource | null> {
  try {
    let row: any = null;
    if (item.type === 'flight') {
      const res = await query<any>(
        'SELECT airline AS provider_name, available_seats AS capacity, price AS unit_price, currency FROM dataset_flights WHERE flight_id = $1',
        [item.resourceId]
      );
      row = res.rows[0];
    } else if (item.type === 'hotel') {
      const res = await query<any>(
        'SELECT h.name AS provider_name, i.available_rooms AS capacity, i.price_per_night AS unit_price, i.currency FROM dataset_room_inventory i JOIN dataset_hotels h ON h.hotel_id = i.hotel_id WHERE i.room_inventory_id = $1',
        [item.resourceId]
      );
      row = res.rows[0];
    } else if (item.type === 'transport') {
      const res = await query<any>(
        'SELECT v.provider AS provider_name, i.available_units AS capacity, i.price AS unit_price, v.currency FROM dataset_transport_inventory i JOIN dataset_vehicles v ON v.vehicle_id = i.vehicle_id WHERE i.transport_inventory_id = $1',
        [item.resourceId]
      );
      row = res.rows[0];
    } else if (item.type === 'activity') {
      const res = await query<any>(
        'SELECT a.provider AS provider_name, i.available_slots AS capacity, i.price_per_person AS unit_price, a.currency FROM dataset_activity_inventory i JOIN dataset_activities a ON a.activity_id = i.activity_id WHERE i.activity_inventory_id = $1',
        [item.resourceId]
      );
      row = res.rows[0];
    }

    if (!row) {
      // Fallback: use generic label if resource not found in seeded dataset (e.g. test resources)
      return {
        providerName: `${item.type.charAt(0).toUpperCase() + item.type.slice(1)} provider`,
        capacity: 10,
        availableCapacity: 10,
        unitPrice: 100,
        currency: 'INR'
      };
    }

    // Check active reservation locks (read-only count)
    let lockedQty = 0;
    try {
      const lockRes = await query<{ quantity: number }>(
        "SELECT COALESCE(SUM(quantity), 0)::int AS quantity FROM booking_resource_locks WHERE resource_type = $1 AND resource_id = $2 AND (status = 'CONFIRMED' OR (status = 'ACTIVE' AND expires_at > CURRENT_TIMESTAMP))",
        [item.type, item.resourceId]
      );
      lockedQty = Number(lockRes.rows[0]?.quantity ?? 0);
    } catch {
      // lock check fallback
    }

    const capacity = Number(row.capacity ?? 0);
    const availableCapacity = Math.max(0, capacity - lockedQty);

    return {
      providerName: row.provider_name || `${item.type} provider`,
      capacity,
      availableCapacity,
      unitPrice: Number(row.unit_price ?? 0),
      currency: row.currency || 'INR'
    };
  } catch {
    return null;
  }
}

/**
 * Reads telemetry for a provider from dataset_providers and dataset_event_logs.
 * Gracefully falls back if dataset tables do not exist in test mock environments.
 */
async function fetchProviderTelemetry(
  providerName: string,
  resourceType: ResourceType,
  override?: ProviderTelemetryOverride
): Promise<ProviderTelemetry> {
  const telemetry: ProviderTelemetry = {
    providerId: null,
    reliabilityScore: 0.96,
    responseTimeMs: 800,
    supportsRollback: true,
    supportsIdempotency: true,
    status: 'active',
    historicalFailures: 0,
    historicalRollbackFailures: 0
  };

  try {
    const pRes = await query<{
      provider_id: string;
      reliability_score: string | number | null;
      response_time_ms: number | null;
      supports_rollback: boolean | null;
      supports_idempotency: boolean | null;
      status: string | null;
    }>(
      `SELECT provider_id, reliability_score, response_time_ms, supports_rollback, supports_idempotency, status
       FROM dataset_providers
       WHERE (
         LOWER(provider_name) = LOWER($1)
         OR LOWER(provider_name) LIKE '%' || LOWER($1) || '%'
         OR LOWER($1) LIKE '%' || LOWER(provider_name) || '%'
       ) AND provider_type = $2
       ORDER BY CASE WHEN LOWER(provider_name) = LOWER($1) THEN 0 ELSE 1 END, provider_id ASC
       LIMIT 1`,
      [providerName, resourceType]
    );

    let row = pRes.rows[0];
    if (!row) {
      // Secondary fallback: match any provider of this category
      const fallbackRes = await query<any>(
        'SELECT provider_id, reliability_score, response_time_ms, supports_rollback, supports_idempotency, status FROM dataset_providers WHERE provider_type = $1 ORDER BY provider_id ASC LIMIT 1',
        [resourceType]
      );
      row = fallbackRes.rows[0];
    }

    if (row) {
      telemetry.providerId = row.provider_id;
      telemetry.reliabilityScore = row.reliability_score !== null ? Number(row.reliability_score) : telemetry.reliabilityScore;
      telemetry.responseTimeMs = row.response_time_ms !== null ? Number(row.response_time_ms) : telemetry.responseTimeMs;
      telemetry.supportsRollback = row.supports_rollback !== null ? Boolean(row.supports_rollback) : telemetry.supportsRollback;
      telemetry.supportsIdempotency = row.supports_idempotency !== null ? Boolean(row.supports_idempotency) : telemetry.supportsIdempotency;
      telemetry.status = row.status || telemetry.status;

      // Fetch historical operational telemetry from event logs
      try {
        const eRes = await query<{ failures: string | number; rollback_failures: string | number }>(
          `SELECT
             COUNT(*) FILTER (WHERE status = 'failure') AS failures,
             COUNT(*) FILTER (WHERE event_type = 'rollback_failure') AS rollback_failures
           FROM dataset_event_logs
           WHERE provider_id = $1`,
          [row.provider_id]
        );
        if (eRes.rowCount) {
          telemetry.historicalFailures = Number(eRes.rows[0].failures || 0);
          telemetry.historicalRollbackFailures = Number(eRes.rows[0].rollback_failures || 0);
        }
      } catch {
        // Event log query is non-critical
      }
    }
  } catch {
    // dataset_providers does not exist in isolated test runner; use baseline telemetry
  }

  // Apply deterministic overrides if supplied
  if (override) {
    if (override.reliabilityScore !== undefined) telemetry.reliabilityScore = override.reliabilityScore;
    if (override.responseTimeMs !== undefined) telemetry.responseTimeMs = override.responseTimeMs;
    if (override.supportsRollback !== undefined) telemetry.supportsRollback = override.supportsRollback;
    if (override.status !== undefined) telemetry.status = override.status;
    if (override.historicalFailures !== undefined) telemetry.historicalFailures = override.historicalFailures;
    if (override.historicalRollbackFailures !== undefined) telemetry.historicalRollbackFailures = override.historicalRollbackFailures;
  }

  return telemetry;
}

/**
 * Calculates a deterministic, explainable risk assessment for a prospective booking transaction.
 * Purely read-only; does not modify database state or lock resources.
 */
export async function assessTransactionRisk(
  input: CreateTransactionInput,
  options?: RiskAssessmentOptions
): Promise<TransactionRiskAssessment> {
  if (options?.simulateError) {
    throw new Error('Simulated risk assessment engine failure for resilience verification');
  }

  const factors: RiskFactor[] = [];
  const providerAssessments: ProviderRiskAssessment[] = [];
  let totalPenalties = 0;

  // Resolve resources for all requested items
  const resolvedItems: Array<{ item: RequestedItem; resource: ResolvedResource }> = [];
  const providersByName = new Map<string, { type: ResourceType; items: RequestedItem[]; resource: ResolvedResource }>();

  for (const item of input.items) {
    const resource = (await resolveResourceReadOnly(item)) || {
      providerName: `${item.type} provider`,
      capacity: 10,
      availableCapacity: 10,
      unitPrice: 100,
      currency: 'INR'
    };
    resolvedItems.push({ item, resource });

    const key = resource.providerName;
    if (!providersByName.has(key)) {
      providersByName.set(key, { type: item.type, items: [item], resource });
    } else {
      providersByName.get(key)!.items.push(item);
    }
  }

  // 1. Evaluate Provider-Specific Telemetry
  for (const [providerName, group] of providersByName.entries()) {
    const override = options?.providerOverrides?.[providerName] || options?.providerOverrides?.[group.type];
    const telemetry = await fetchProviderTelemetry(providerName, group.type, override);

    let providerPenalties = 0;
    const providerEvidenceIds: string[] = [];

    if (telemetry.providerId) {
      providerEvidenceIds.push(`prov_id_${telemetry.providerId}`);
    }

    // A. Reliability Score Factor
    if (telemetry.reliabilityScore !== null) {
      const rel = telemetry.reliabilityScore;
      if (rel < 0.90) {
        providerPenalties += 25;
        const evId = `prov_${providerName}_rel_${rel.toFixed(3)}`;
        providerEvidenceIds.push(evId);
        factors.push({
          code: 'LOW_PROVIDER_RELIABILITY',
          severity: 'HIGH',
          value: rel,
          explanation: `Provider "${providerName}" has low reliability score (${rel.toFixed(3)} < 0.90)`,
          evidenceIds: [evId]
        });
      } else if (rel < 0.95) {
        providerPenalties += 15;
        const evId = `prov_${providerName}_rel_${rel.toFixed(3)}`;
        providerEvidenceIds.push(evId);
        factors.push({
          code: 'MODERATE_PROVIDER_RELIABILITY',
          severity: 'MEDIUM',
          value: rel,
          explanation: `Provider "${providerName}" has moderate reliability score (${rel.toFixed(3)} < 0.95)`,
          evidenceIds: [evId]
        });
      } else if (rel < 0.98) {
        providerPenalties += 5;
        const evId = `prov_${providerName}_rel_${rel.toFixed(3)}`;
        providerEvidenceIds.push(evId);
        factors.push({
          code: 'SUBOPTIMAL_PROVIDER_RELIABILITY',
          severity: 'LOW',
          value: rel,
          explanation: `Provider "${providerName}" reliability score (${rel.toFixed(3)}) is slightly below optimal 0.98 baseline`,
          evidenceIds: [evId]
        });
      }
    }

    // B. Operational Status Factor
    if (telemetry.status === 'maintenance') {
      providerPenalties += 30;
      const evId = `prov_${providerName}_status_maintenance`;
      providerEvidenceIds.push(evId);
      factors.push({
        code: 'PROVIDER_MAINTENANCE',
        severity: 'HIGH',
        value: telemetry.status,
        explanation: `Provider "${providerName}" is currently flagged in maintenance status`,
        evidenceIds: [evId]
      });
    } else if (telemetry.status && telemetry.status !== 'active') {
      providerPenalties += 35;
      const evId = `prov_${providerName}_status_${telemetry.status}`;
      providerEvidenceIds.push(evId);
      factors.push({
        code: 'PROVIDER_INACTIVE',
        severity: 'HIGH',
        value: telemetry.status,
        explanation: `Provider "${providerName}" has inactive status "${telemetry.status}"`,
        evidenceIds: [evId]
      });
    }

    // C. Rollback Support Factor
    if (telemetry.supportsRollback === false) {
      providerPenalties += 20;
      const evId = `prov_${providerName}_no_rollback`;
      providerEvidenceIds.push(evId);
      factors.push({
        code: 'UNSUPPORTED_ROLLBACK',
        severity: 'MEDIUM',
        value: false,
        explanation: `Provider "${providerName}" does not support atomic reverse compensation (rollback)`,
        evidenceIds: [evId]
      });
    }

    // D. Response Latency Factor
    if (telemetry.responseTimeMs !== null) {
      const lat = telemetry.responseTimeMs;
      if (lat > 2000) {
        providerPenalties += 10;
        const evId = `prov_${providerName}_latency_${lat}`;
        providerEvidenceIds.push(evId);
        factors.push({
          code: 'HIGH_LATENCY',
          severity: 'MEDIUM',
          value: lat,
          explanation: `Provider "${providerName}" has elevated average latency (${lat}ms > 2000ms)`,
          evidenceIds: [evId]
        });
      } else if (lat > 1000) {
        providerPenalties += 5;
        const evId = `prov_${providerName}_latency_${lat}`;
        providerEvidenceIds.push(evId);
        factors.push({
          code: 'MODERATE_LATENCY',
          severity: 'LOW',
          value: lat,
          explanation: `Provider "${providerName}" has moderate latency (${lat}ms > 1000ms)`,
          evidenceIds: [evId]
        });
      }
    }

    // E. Historical Failure Telemetry Factor
    if (telemetry.historicalRollbackFailures > 0) {
      providerPenalties += 20;
      const evId = `prov_${providerName}_hist_rollback_fail_${telemetry.historicalRollbackFailures}`;
      providerEvidenceIds.push(evId);
      factors.push({
        code: 'HISTORICAL_ROLLBACK_FAILURES',
        severity: 'HIGH',
        value: telemetry.historicalRollbackFailures,
        explanation: `Provider "${providerName}" has ${telemetry.historicalRollbackFailures} recorded rollback failures in dataset event logs`,
        evidenceIds: [evId]
      });
    }
    if (telemetry.historicalFailures >= 2) {
      providerPenalties += 15;
      const evId = `prov_${providerName}_hist_fails_${telemetry.historicalFailures}`;
      providerEvidenceIds.push(evId);
      factors.push({
        code: 'HIGH_HISTORICAL_FAILURES',
        severity: 'HIGH',
        value: telemetry.historicalFailures,
        explanation: `Provider "${providerName}" has ${telemetry.historicalFailures} recorded failure events in historical logs`,
        evidenceIds: [evId]
      });
    } else if (telemetry.historicalFailures === 1) {
      providerPenalties += 8;
      const evId = `prov_${providerName}_hist_fails_1`;
      providerEvidenceIds.push(evId);
      factors.push({
        code: 'HISTORICAL_FAILURES',
        severity: 'MEDIUM',
        value: 1,
        explanation: `Provider "${providerName}" has 1 recorded failure event in historical logs`,
        evidenceIds: [evId]
      });
    }

    totalPenalties += providerPenalties;

    const providerScore = Math.min(100, Math.max(0, Math.round(BASELINE_SCORE + providerPenalties)));
    providerAssessments.push({
      provider: providerName,
      riskScore: providerScore,
      reliabilityScore: telemetry.reliabilityScore,
      responseTimeMs: telemetry.responseTimeMs,
      supportsRollback: telemetry.supportsRollback,
      status: telemetry.status,
      evidenceIds: providerEvidenceIds
    });
  }

  // 2. Transaction-Level Factors
  // A. Multi-Provider Bundle Risk (distributed coordination risk across independent providers)
  const distinctProviderCount = providersByName.size;
  if (distinctProviderCount === 2) {
    totalPenalties += 10;
    factors.push({
      code: 'MULTI_PROVIDER_BUNDLE_2',
      severity: 'LOW',
      value: 2,
      explanation: 'Transaction coordinates 2 independent providers; distributed failure probability is slightly elevated',
      evidenceIds: ['tx_providers_count_2']
    });
  } else if (distinctProviderCount === 3) {
    totalPenalties += 20;
    factors.push({
      code: 'MULTI_PROVIDER_BUNDLE_3',
      severity: 'MEDIUM',
      value: 3,
      explanation: 'Transaction coordinates 3 independent providers; multi-leg Saga compensation risk is elevated',
      evidenceIds: ['tx_providers_count_3']
    });
  } else if (distinctProviderCount >= 4) {
    totalPenalties += 30;
    factors.push({
      code: 'MULTI_PROVIDER_BUNDLE_4_PLUS',
      severity: 'HIGH',
      value: distinctProviderCount,
      explanation: `Transaction coordinates ${distinctProviderCount} independent providers; multi-leg failure probability compounds`,
      evidenceIds: [`tx_providers_count_${distinctProviderCount}`]
    });
  }

  // B. Tight Capacity / Inventory Contention (Read-Only Check)
  for (const { item, resource } of resolvedItems) {
    if (resource.availableCapacity <= item.quantity) {
      totalPenalties += 15;
      const evId = `res_${item.type}_${item.resourceId}_avail_${resource.availableCapacity}`;
      factors.push({
        code: 'TIGHT_CAPACITY',
        severity: 'MEDIUM',
        value: resource.availableCapacity,
        explanation: `Requested resource ${item.resourceId} (${item.type}) capacity is near saturation (${resource.availableCapacity} remaining for quantity ${item.quantity})`,
        evidenceIds: [evId]
      });
      break; // report once per transaction to avoid multi-item double counting
    }
  }

  // 3. Final Score Normalization and Classification
  const rawScore = BASELINE_SCORE + totalPenalties;
  const riskScore = Math.min(100, Math.max(0, Math.round(rawScore)));

  let riskLevel: RiskLevel;
  let decision: RiskDecision;

  if (riskScore < 40) {
    riskLevel = 'LOW';
    decision = 'PROCEED';
  } else if (riskScore < 70) {
    riskLevel = 'MEDIUM';
    decision = 'PROCEED';
  } else {
    riskLevel = 'HIGH';
    decision = 'REVIEW';
  }

  return {
    riskScore,
    riskLevel,
    decision,
    factors,
    providerAssessments,
    calculatedAt: new Date().toISOString()
  };
}

/**
 * Persists an advisory transaction risk assessment into the additive
 * booking_transaction_risk_assessments table.
 */
export async function persistRiskAssessment(
  transactionId: string,
  assessment: TransactionRiskAssessment
): Promise<string> {
  const id = `ra_${randomUUID()}`;
  await query(
    `INSERT INTO booking_transaction_risk_assessments
     (id, transaction_id, risk_score, risk_level, decision, factors, provider_assessments, calculated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
    [
      id,
      transactionId,
      assessment.riskScore,
      assessment.riskLevel,
      assessment.decision,
      JSON.stringify(assessment.factors),
      JSON.stringify(assessment.providerAssessments),
      assessment.calculatedAt
    ]
  );
  return id;
}

/**
 * Reads a persisted risk assessment by transaction ID.
 */
export async function getRiskAssessmentByTransactionId(
  transactionId: string
): Promise<TransactionRiskAssessment | null> {
  const res = await query<{
    risk_score: string | number;
    risk_level: RiskLevel;
    decision: RiskDecision;
    factors: RiskFactor[] | string;
    provider_assessments: ProviderRiskAssessment[] | string;
    calculated_at: string;
  }>(
    `SELECT risk_score, risk_level, decision, factors, provider_assessments, calculated_at
     FROM booking_transaction_risk_assessments
     WHERE transaction_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [transactionId]
  );

  if (!res.rowCount) return null;
  const row = res.rows[0];
  return {
    riskScore: Number(row.risk_score),
    riskLevel: row.risk_level,
    decision: row.decision,
    factors: typeof row.factors === 'string' ? JSON.parse(row.factors) : row.factors,
    providerAssessments: typeof row.provider_assessments === 'string' ? JSON.parse(row.provider_assessments) : row.provider_assessments,
    calculatedAt: new Date(row.calculated_at).toISOString()
  };
}

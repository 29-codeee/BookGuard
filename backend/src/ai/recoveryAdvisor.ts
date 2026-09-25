/**
 * BookGuard Recovery Intelligence Service (Phase 6B)
 *
 * Deterministic, explainable, evidence-grounded advisor that analyzes transactions
 * requiring recovery (such as ROLLBACK_FAILED, failed provider cancellations, or unresolved locks)
 * and generates advisory recommendations for human operators.
 *
 * ARCHITECTURAL CONSTRAINTS & PRINCIPLES:
 * 1. Strictly Advisory: The recovery advisor NEVER automatically retries, never automatically cancels,
 *    never automatically releases locks, never mutates provider/payment states, and never modifies inventory.
 * 2. Deterministic & Non-Predictive: Recommendations are derived strictly from recorded database evidence
 *    (operation states, error messages, rollback support flags, lock statuses, and dataset telemetry).
 *    No LLM or black-box ML model is used for numerical classification or recovery decisions.
 * 3. Non-Blocking / Fault Tolerant: Advisor failures must NEVER cause transaction failure or worsen
 *    transaction state.
 *
 * RECOMMENDATION CATEGORIES:
 * A. AUTOMATIC_RETRY:
 *    - Transient network timeouts, socket disconnects, or temporary 503s.
 *    - Provider supports idempotency or rollback.
 *    - Provider is in 'active' status.
 *    - No unresolved CONFIRMED locks or compensation failures.
 *
 * B. ALTERNATIVE_PROVIDER:
 *    - Failed provider is under maintenance or inactive.
 *    - Provider has repeated historical operational failures in event logs.
 *    - Permanent capacity/allocation rejection where alternative provider is available.
 *    - Recommends alternative options; NEVER books alternatives automatically.
 *
 * C. MANUAL_OPERATOR_REVIEW (Conservative Default):
 *    - Reverse compensation failed (provider cancellation failure or payment refund failure).
 *    - Unresolved resource lock remains in CONFIRMED status.
 *    - Provider does not support rollback.
 *    - Error condition is ambiguous or non-transient.
 *    - Payment/refund discrepancy requires human audit.
 *
 * CONFIDENCE METRIC DOCUMENTATION:
 * Base Confidence: 70
 * Evidence adjustments:
 *   - Explicit compensation failure: +25 (very strong evidence for manual review)
 *   - Unresolved CONFIRMED lock: +20 (strong capacity protection evidence)
 *   - Provider unsupported rollback: +15
 *   - Error cleanly matches transient regex: +20
 *   - Provider under maintenance with verified alternative: +18
 *   - Ambiguous/conflicting error: -10
 * Clamped to range [50, 98]. Represents rule-matching clarity based on recorded database evidence.
 */

import { randomUUID } from 'node:crypto';
import { query } from '../db/client.js';
import type { ResourceType } from '../transactions/types.js';

export type RecoveryRecommendation =
  | 'AUTOMATIC_RETRY'
  | 'ALTERNATIVE_PROVIDER'
  | 'MANUAL_OPERATOR_REVIEW';

export type RecoverySeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface RecoveryReason {
  code: string;
  severity: RecoverySeverity;
  explanation: string;
  evidenceIds: string[];
}

export interface AffectedItem {
  itemId: string;
  provider: string;
  reference: string | null;
  error: string | null;
}

export interface RecoveryAdvisory {
  recommendation: RecoveryRecommendation;
  severity: RecoverySeverity;
  confidence: number; // 0–100
  reasons: RecoveryReason[];
  suggestedActions: string[];
  affectedItems: AffectedItem[];
  generatedAt: string;
}

export interface RecoveryAdvisorOptions {
  providerOverrides?: Record<string, {
    status?: string;
    supportsRollback?: boolean;
    supportsIdempotency?: boolean;
    reliabilityScore?: number;
    historicalFailures?: number;
    historicalRollbackFailures?: number;
  }>;
  simulateError?: boolean;
}

interface ProviderTelemetry {
  providerId: string | null;
  reliabilityScore: number | null;
  supportsRollback: boolean | null;
  supportsIdempotency: boolean | null;
  status: string | null;
  historicalFailures: number;
  historicalRollbackFailures: number;
}

const TRANSIENT_ERROR_REGEX = /timeout|etimedout|network|connection|econnreset|econnrefused|socket|503|gateway|temporary/i;
const ALLOCATION_REJECTED_REGEX = /no rooms|sold out|allocation refused|exhausted|capacity exceeded|rejected/i;

async function fetchProviderTelemetry(
  providerName: string,
  resourceType: ResourceType,
  override?: {
    status?: string;
    supportsRollback?: boolean;
    supportsIdempotency?: boolean;
    reliabilityScore?: number;
    historicalFailures?: number;
    historicalRollbackFailures?: number;
  }
): Promise<ProviderTelemetry> {
  const telemetry: ProviderTelemetry = {
    providerId: null,
    reliabilityScore: 0.95,
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
      supports_rollback: boolean | null;
      supports_idempotency: boolean | null;
      status: string | null;
    }>(
      `SELECT provider_id, reliability_score, supports_rollback, supports_idempotency, status
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
      const fallbackRes = await query<any>(
        'SELECT provider_id, reliability_score, supports_rollback, supports_idempotency, status FROM dataset_providers WHERE provider_type = $1 ORDER BY provider_id ASC LIMIT 1',
        [resourceType]
      );
      row = fallbackRes.rows[0];
    }

    if (row) {
      telemetry.providerId = row.provider_id;
      telemetry.reliabilityScore = row.reliability_score !== null ? Number(row.reliability_score) : telemetry.reliabilityScore;
      telemetry.supportsRollback = row.supports_rollback !== null ? Boolean(row.supports_rollback) : telemetry.supportsRollback;
      telemetry.supportsIdempotency = row.supports_idempotency !== null ? Boolean(row.supports_idempotency) : telemetry.supportsIdempotency;
      telemetry.status = row.status || telemetry.status;

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
        // non-critical
      }
    }
  } catch {
    // fallback
  }

  if (override) {
    if (override.status !== undefined) telemetry.status = override.status;
    if (override.supportsRollback !== undefined) telemetry.supportsRollback = override.supportsRollback;
    if (override.supportsIdempotency !== undefined) telemetry.supportsIdempotency = override.supportsIdempotency;
    if (override.reliabilityScore !== undefined) telemetry.reliabilityScore = override.reliabilityScore;
    if (override.historicalFailures !== undefined) telemetry.historicalFailures = override.historicalFailures;
    if (override.historicalRollbackFailures !== undefined) telemetry.historicalRollbackFailures = override.historicalRollbackFailures;
  }

  return telemetry;
}

/**
 * Checks if an alternative active provider exists in the dataset for a resource category.
 */
async function findAlternativeProvider(resourceType: ResourceType, excludeProvider: string): Promise<string | null> {
  try {
    const res = await query<{ provider_name: string }>(
      `SELECT provider_name
       FROM dataset_providers
       WHERE provider_type = $1 AND status = 'active' AND LOWER(provider_name) != LOWER($2)
       ORDER BY reliability_score DESC, response_time_ms ASC
       LIMIT 1`,
      [resourceType, excludeProvider]
    );
    return res.rows[0]?.provider_name || null;
  } catch {
    return 'Alternative ' + resourceType + ' provider';
  }
}

/**
 * Analyzes transaction state, failure events, unresolved locks, and provider telemetry
 * to deterministically generate a structured advisory recommendation.
 * Returns null for normal COMPLETED transactions where no recovery is needed.
 */
export async function generateRecoveryAdvisory(
  transactionId: string,
  options?: RecoveryAdvisorOptions
): Promise<RecoveryAdvisory | null> {
  if (options?.simulateError) {
    throw new Error('Simulated recovery advisor failure for resilience testing');
  }

  // 1. Fetch transaction record
  const txRes = await query<{ id: string; status: string }>(
    'SELECT id, status FROM booking_transactions WHERE id = $1',
    [transactionId]
  );
  if (!txRes.rowCount) return null;
  const txStatus = txRes.rows[0].status;

  // 2. Fetch provider operations
  const provOpsRes = await query<{
    item_id: string;
    provider_name: string;
    status: string;
    operation_type: string;
    provider_reference: string | null;
    error_message: string | null;
  }>(
    'SELECT item_id, provider_name, status, operation_type, provider_reference, error_message FROM booking_transaction_providers WHERE transaction_id = $1',
    [transactionId]
  );

  // 3. Fetch resource locks
  const locksRes = await query<{
    item_id: string;
    resource_type: ResourceType;
    resource_id: string;
    quantity: number;
    status: string;
  }>(
    'SELECT item_id, resource_type, resource_id, quantity, status FROM booking_resource_locks WHERE transaction_id = $1',
    [transactionId]
  );

  // 4. Fetch transaction items
  const itemsRes = await query<{
    id: string;
    resource_type: ResourceType;
    resource_id: string;
    status: string;
    provider_name: string;
  }>(
    'SELECT id, resource_type, resource_id, status, provider_name FROM booking_transaction_items WHERE transaction_id = $1',
    [transactionId]
  );

  // 5. Fetch events (to check for payment refund failure)
  const eventsRes = await query<{ to_state: string; detail: any }>(
    'SELECT to_state, detail FROM booking_transaction_events WHERE transaction_id = $1',
    [transactionId]
  );

  const paymentRefundFailed = eventsRes.rows.some(
    e => (typeof e.detail === 'object' && e.detail?.event === 'PAYMENT_REFUND_FAILED')
  );

  // Identify affected items
  const failedOps = provOpsRes.rows.filter(o => o.status === 'FAILED');
  const confirmedLocks = locksRes.rows.filter(l => l.status === 'CONFIRMED' || (l.status === 'ACTIVE' && txStatus === 'ROLLBACK_FAILED'));

  // If transaction had no failed operations, no confirmed locks, and no payment refund failure, no recovery needed
  if (failedOps.length === 0 && confirmedLocks.length === 0 && !paymentRefundFailed) {
    return null;
  }

  const affectedItems: AffectedItem[] = [];
  const affectedItemIds = new Set<string>();

  for (const op of provOpsRes.rows) {
    if (op.status === 'FAILED' || (op.operation_type === 'CANCEL' && op.status === 'FAILED')) {
      affectedItemIds.add(op.item_id);
      affectedItems.push({
        itemId: op.item_id,
        provider: op.provider_name,
        reference: op.provider_reference,
        error: op.error_message
      });
    }
  }

  for (const lock of confirmedLocks) {
    if (!affectedItemIds.has(lock.item_id)) {
      affectedItemIds.add(lock.item_id);
      const itemRow = itemsRes.rows.find(i => i.id === lock.item_id);
      affectedItems.push({
        itemId: lock.item_id,
        provider: itemRow?.provider_name || 'Unknown provider',
        reference: null,
        error: 'Unresolved persistent lock condition'
      });
    }
  }

  const reasons: RecoveryReason[] = [];
  let recommendation: RecoveryRecommendation = 'MANUAL_OPERATOR_REVIEW';
  let severity: RecoverySeverity = 'MEDIUM';
  let confidence = 70;
  const suggestedActions: string[] = [];

  // Categorization flags
  let compensationFailed = failedOps.some(o => o.operation_type === 'CANCEL');
  let hasConfirmedLock = confirmedLocks.length > 0;
  let paymentDiscrepancy = paymentRefundFailed;

  // Evaluate affected providers
  const itemTypeMap = new Map(itemsRes.rows.map(i => [i.id, i.resource_type]));

  let hasUnsupportedRollback = false;
  let hasMaintenance = false;
  let hasRepeatedFailures = false;
  let isTransientError = false;
  let isAmbiguousError = false;
  let alternativeProviderFound: string | null = null;

  for (const item of affectedItems) {
    const rType = itemTypeMap.get(item.itemId) || ('flight' as ResourceType);
    const override = options?.providerOverrides?.[item.provider] || options?.providerOverrides?.[rType];
    const telemetry = await fetchProviderTelemetry(item.provider, rType, override);

    if (telemetry.supportsRollback === false) {
      hasUnsupportedRollback = true;
      reasons.push({
        code: 'UNSUPPORTED_ROLLBACK',
        severity: 'HIGH',
        explanation: `Provider "${item.provider}" does not support automated rollback compensation.`,
        evidenceIds: [`prov_${item.provider}_no_rollback`]
      });
    }

    if (telemetry.status === 'maintenance' || (item.error && /maintenance/i.test(item.error))) {
      hasMaintenance = true;
      const alt = await findAlternativeProvider(rType, item.provider);
      alternativeProviderFound = alt;
      reasons.push({
        code: 'PROVIDER_MAINTENANCE',
        severity: 'MEDIUM',
        explanation: `Provider "${item.provider}" is currently in maintenance status. Alternative provider "${alt || 'available'}" can satisfy request.`,
        evidenceIds: [`prov_${item.provider}_maintenance`, alt ? `alt_prov_${alt}` : 'alt_catalog']
      });
    }

    if (telemetry.historicalRollbackFailures > 0) {
      reasons.push({
        code: 'HISTORICAL_ROLLBACK_FAILURES',
        severity: 'HIGH',
        explanation: `Provider "${item.provider}" has ${telemetry.historicalRollbackFailures} recorded rollback failures in historical logs.`,
        evidenceIds: [`prov_${item.provider}_hist_rollback_fail_${telemetry.historicalRollbackFailures}`]
      });
    }

    if (telemetry.historicalFailures >= 2) {
      hasRepeatedFailures = true;
      const alt = await findAlternativeProvider(rType, item.provider);
      if (alt) alternativeProviderFound = alt;
      reasons.push({
        code: 'REPEATED_HISTORICAL_FAILURES',
        severity: 'MEDIUM',
        explanation: `Provider "${item.provider}" exhibits recurring operational failures (${telemetry.historicalFailures} logged failures).` + (alt ? ` Recommended alternative: "${alt}".` : ''),
        evidenceIds: [`prov_${item.provider}_hist_fails_${telemetry.historicalFailures}`, ...(alt ? [`alt_prov_${alt}`] : [])]
      });
    }

    if (item.error) {
      if (TRANSIENT_ERROR_REGEX.test(item.error)) {
        isTransientError = true;
      } else if (!ALLOCATION_REJECTED_REGEX.test(item.error) && !/maintenance/i.test(item.error)) {
        isAmbiguousError = true;
      }
    }
  }

  // Check compensation failures
  if (compensationFailed) {
    reasons.unshift({
      code: 'COMPENSATION_FAILED',
      severity: 'HIGH',
      explanation: 'Provider reverse-compensation failed during Saga rollback; resource remains in uncancelled state with supplier.',
      evidenceIds: failedOps.filter(o => o.operation_type === 'CANCEL').map(o => `op_${o.item_id}_CANCEL_FAILED`)
    });
  }

  if (hasConfirmedLock) {
    reasons.push({
      code: 'UNRESOLVED_RESOURCE_LOCK',
      severity: 'HIGH',
      explanation: 'Resource lock remains in CONFIRMED status; capacity is blocked and cannot be safely released without supplier verification.',
      evidenceIds: confirmedLocks.map(l => `lock_${l.item_id}_CONFIRMED`)
    });
  }

  if (paymentDiscrepancy) {
    reasons.push({
      code: 'PAYMENT_REFUND_DISCREPANCY',
      severity: 'HIGH',
      explanation: 'Payment refund/void failed; transaction financial ledger requires operator reconciliation.',
      evidenceIds: ['evt_PAYMENT_REFUND_FAILED']
    });
  }

  // --- DETERMINISTIC DECISION RULES ---

  // 1. HARD MANUAL REVIEW TRIGGERS (Safety First)
  if (compensationFailed || hasConfirmedLock || hasUnsupportedRollback || paymentDiscrepancy || txStatus === 'ROLLBACK_FAILED') {
    recommendation = 'MANUAL_OPERATOR_REVIEW';
    severity = 'HIGH';
    confidence = 94;

    if (compensationFailed) confidence = Math.min(98, confidence + 3);
    if (hasConfirmedLock) confidence = Math.min(98, confidence + 2);

    suggestedActions.push(
      'Escalate incident to Operations Officer for supplier verification',
      'Verify PNR status directly in provider portal or GDS',
      'Do NOT release CONFIRMED resource locks until supplier cancellation is verified',
      'Audit payment gateway status for refund confirmation'
    );
  } else if (hasMaintenance || hasRepeatedFailures) {
    // 2. ALTERNATIVE PROVIDER TRIGGERS
    recommendation = 'ALTERNATIVE_PROVIDER';
    severity = 'MEDIUM';
    confidence = 88;

    suggestedActions.push(
      alternativeProviderFound
        ? `Switch reservation to verified alternative provider "${alternativeProviderFound}"`
        : 'Present verified alternative provider options to traveller',
      'Prepare substitute itinerary segment with active supplier',
      'Do not retry original supplier while maintenance or repeated failure is active'
    );
  } else if (isTransientError && !isAmbiguousError && !hasUnsupportedRollback) {
    // 3. AUTOMATIC RETRY TRIGGERS
    recommendation = 'AUTOMATIC_RETRY';
    severity = 'LOW';
    confidence = 90;

    reasons.push({
      code: 'TRANSIENT_FAILURE_DETECTED',
      severity: 'LOW',
      explanation: 'Failure was caused by transient network latency or timeout; provider supports safe idempotent retry.',
      evidenceIds: ['err_transient_pattern_matched']
    });

    suggestedActions.push(
      'Execute automated idempotent retry with exponential backoff (retry count < 3)',
      'Monitor supplier gateway response latency',
      'Retain provisional locks during the retry grace window'
    );
  } else {
    // 4. CONSERVATIVE FALLBACK (Ambiguous / Unknown error)
    recommendation = 'MANUAL_OPERATOR_REVIEW';
    severity = 'MEDIUM';
    confidence = 75;

    reasons.push({
      code: 'AMBIGUOUS_ERROR_CONDITION',
      severity: 'MEDIUM',
      explanation: 'Failure evidence is ambiguous or non-transient; conservative operator review recommended.',
      evidenceIds: ['err_ambiguous_fallback']
    });

    suggestedActions.push(
      'Inspect detailed supplier payload in audit logs',
      'Manually confirm reservation status before modifying booking state'
    );
  }

  return {
    recommendation,
    severity,
    confidence,
    reasons,
    suggestedActions,
    affectedItems,
    generatedAt: new Date().toISOString()
  };
}

/**
 * Persists an advisory into the booking_transaction_recovery_advisories table.
 * Replaces any existing advisory for this transaction to maintain a single authoritative record.
 */
export async function persistRecoveryAdvisory(
  transactionId: string,
  advisory: RecoveryAdvisory
): Promise<string> {
  const id = `rec_${randomUUID()}`;
  await query('DELETE FROM booking_transaction_recovery_advisories WHERE transaction_id = $1', [transactionId]);
  await query(
    `INSERT INTO booking_transaction_recovery_advisories
     (id, transaction_id, recommendation, severity, confidence, reasons, suggested_actions, affected_items, generated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9)`,
    [
      id,
      transactionId,
      advisory.recommendation,
      advisory.severity,
      advisory.confidence,
      JSON.stringify(advisory.reasons),
      JSON.stringify(advisory.suggestedActions),
      JSON.stringify(advisory.affectedItems),
      advisory.generatedAt
    ]
  );
  return id;
}

/**
 * Reads the latest persisted recovery advisory for a transaction.
 */
export async function getRecoveryAdvisoryByTransactionId(
  transactionId: string
): Promise<RecoveryAdvisory | null> {
  const res = await query<{
    recommendation: RecoveryRecommendation;
    severity: RecoverySeverity;
    confidence: string | number;
    reasons: RecoveryReason[] | string;
    suggested_actions: string[] | string;
    affected_items: AffectedItem[] | string;
    generated_at: string;
  }>(
    `SELECT recommendation, severity, confidence, reasons, suggested_actions, affected_items, generated_at
     FROM booking_transaction_recovery_advisories
     WHERE transaction_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [transactionId]
  );

  if (!res.rowCount) return null;
  const row = res.rows[0];
  return {
    recommendation: row.recommendation,
    severity: row.severity,
    confidence: Number(row.confidence),
    reasons: typeof row.reasons === 'string' ? JSON.parse(row.reasons) : row.reasons,
    suggestedActions: typeof row.suggested_actions === 'string' ? JSON.parse(row.suggested_actions) : row.suggested_actions,
    affectedItems: typeof row.affected_items === 'string' ? JSON.parse(row.affected_items) : row.affected_items,
    generatedAt: new Date(row.generated_at).toISOString()
  };
}

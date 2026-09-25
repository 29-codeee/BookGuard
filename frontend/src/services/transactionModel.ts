/**
 * Types, response validation, and pure derivations for the Transaction Operations dashboard.
 *
 * Everything here is computed from GET /api/transactions/:id responses. Nothing is simulated:
 * when the backend did not record something, derivations report it as not recorded.
 */

export const TRANSACTION_STATES = [
  'PENDING', 'RESERVING', 'PROCESSING', 'COMPLETED', 'ROLLING_BACK', 'ROLLED_BACK', 'FAILED', 'ROLLBACK_FAILED'
] as const;
export type TransactionState = typeof TRANSACTION_STATES[number];

export interface TxItem {
  id: string;
  position: number;
  type: string;
  resourceId: string;
  quantity: number;
  status: string;
  provider: string | null;
  unitPrice: number | null;
  currency: string | null;
}

export interface TxProvider {
  id: string;
  itemId: string;
  provider: string;
  status: string;
  operation: string;
  reference: string | null;
  error: string | null;
  updatedAt: string;
}

export interface TxEvent {
  id: string;
  itemId: string | null;
  fromState: string | null;
  toState: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface TxLock {
  id: string;
  itemId: string;
  resourceType: string;
  resourceId: string;
  quantity: number;
  status: string;
  expiresAt: string;
  createdAt: string;
}

export interface RiskFactor {
  code: string;
  severity: string;
  value: unknown;
  explanation: string;
  evidenceIds: string[];
}

export interface ProviderRiskAssessment {
  provider: string;
  riskScore: number | null;
  reliabilityScore: number | null;
  responseTimeMs: number | null;
  supportsRollback: boolean | null;
  status: string | null;
  evidenceIds: string[];
}

export interface RiskAssessment {
  riskScore: number;
  riskLevel: string;
  decision: string;
  factors: RiskFactor[];
  providerAssessments: ProviderRiskAssessment[];
  calculatedAt: string | null;
}

export interface RecoveryReason {
  code: string;
  severity: string;
  explanation: string;
  evidenceIds: string[];
}

export interface RecoveryAffectedItem {
  itemId: string;
  provider: string;
  reference: string | null;
  error: string | null;
}

export interface RecoveryAdvisory {
  recommendation: string;
  severity: string;
  confidence: number | null;
  reasons: RecoveryReason[];
  suggestedActions: string[];
  affectedItems: RecoveryAffectedItem[];
  generatedAt: string | null;
}

export interface RecoveryRequiredEntry {
  itemId: string;
  provider: string;
  reference: string | null;
  error: string | null;
}

export interface TransactionDetails {
  transactionId: string;
  state: string;
  currency: string;
  totalAmount: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  items: TxItem[];
  providers: TxProvider[];
  events: TxEvent[];
  /** null when the backend response did not include lock data. */
  locks: TxLock[] | null;
  recoveryRequired: RecoveryRequiredEntry[];
  riskAssessment: RiskAssessment | null;
  recoveryAdvisory: RecoveryAdvisory | null;
  /** Optional sections that were present but could not be interpreted. */
  sectionWarnings: string[];
}

export interface TransactionSummary {
  transactionId: string;
  state: string;
  currency: string;
  totalAmount: number | null;
  itemCount: number | null;
  riskScore: number | null;
  riskLevel: string | null;
  recoveryRecommendation: string | null;
  recoverySeverity: string | null;
  createdAt: string | null;
}

export interface TransactionPage {
  total: number;
  limit: number;
  offset: number;
  transactions: TransactionSummary[];
}

export type HealthCheckValue = 'CONNECTED' | 'READY' | 'UNAVAILABLE' | 'UNKNOWN';

export interface SystemHealth {
  status: string;
  timestamp: string | null;
  checks: {
    database: HealthCheckValue;
    transactionEngine: HealthCheckValue;
    riskEngine: HealthCheckValue;
    recoveryEngine: HealthCheckValue;
  };
}

export interface DemoScenario {
  id: string;
  label: string;
  description: string;
  expectedState: string;
  source: string;
  request: Record<string, unknown>;
}

export class MalformedResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedResponseError';
  }
}

// ---------- primitive readers ----------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);
const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((s): s is string => s !== null) : []);
const objList = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

// ---------- parsers ----------

function parseRisk(v: unknown): RiskAssessment | null {
  if (!isObj(v)) return null;
  const riskScore = num(v.riskScore);
  const riskLevel = str(v.riskLevel);
  const decision = str(v.decision);
  if (riskScore === null || !riskLevel || !decision) return null;
  return {
    riskScore,
    riskLevel,
    decision,
    calculatedAt: str(v.calculatedAt),
    factors: objList(v.factors).map(f => ({
      code: str(f.code) ?? 'UNKNOWN_FACTOR',
      severity: str(f.severity) ?? 'UNKNOWN',
      value: f.value,
      explanation: str(f.explanation) ?? '',
      evidenceIds: strList(f.evidenceIds)
    })),
    providerAssessments: objList(v.providerAssessments).map(p => ({
      provider: str(p.provider) ?? 'Unknown provider',
      riskScore: num(p.riskScore),
      reliabilityScore: num(p.reliabilityScore),
      responseTimeMs: num(p.responseTimeMs),
      supportsRollback: typeof p.supportsRollback === 'boolean' ? p.supportsRollback : null,
      status: str(p.status),
      evidenceIds: strList(p.evidenceIds)
    }))
  };
}

function parseAdvisory(v: unknown): RecoveryAdvisory | null {
  if (!isObj(v)) return null;
  const recommendation = str(v.recommendation);
  if (!recommendation) return null;
  return {
    recommendation,
    severity: str(v.severity) ?? 'UNKNOWN',
    confidence: num(v.confidence),
    generatedAt: str(v.generatedAt),
    reasons: objList(v.reasons).map(r => ({
      code: str(r.code) ?? 'UNKNOWN_REASON',
      severity: str(r.severity) ?? 'UNKNOWN',
      explanation: str(r.explanation) ?? '',
      evidenceIds: strList(r.evidenceIds)
    })),
    suggestedActions: strList(v.suggestedActions),
    affectedItems: objList(v.affectedItems).map(a => ({
      itemId: str(a.itemId) ?? '',
      provider: str(a.provider) ?? 'Unknown provider',
      reference: str(a.reference),
      error: str(a.error)
    }))
  };
}

/** Validates the core of a transaction detail response; optional sections degrade to null. */
export function parseTransactionDetails(body: unknown): TransactionDetails {
  if (!isObj(body)) throw new MalformedResponseError('Response body is not an object');
  const transactionId = str(body.transactionId);
  const state = str(body.state);
  if (!transactionId || !state) throw new MalformedResponseError('Response is missing transactionId or state');
  if (!Array.isArray(body.items) || !Array.isArray(body.events)) {
    throw new MalformedResponseError('Response is missing items or events');
  }

  const sectionWarnings: string[] = [];
  const riskAssessment = parseRisk(body.riskAssessment);
  if (body.riskAssessment != null && !riskAssessment) sectionWarnings.push('riskAssessment');
  const recoveryAdvisory = parseAdvisory(body.recoveryAdvisory);
  if (body.recoveryAdvisory != null && !recoveryAdvisory) sectionWarnings.push('recoveryAdvisory');

  return {
    transactionId,
    state,
    currency: str(body.currency) ?? 'INR',
    totalAmount: num(body.totalAmount),
    createdAt: str(body.createdAt),
    updatedAt: str(body.updatedAt),
    items: objList(body.items).map((i, index) => ({
      id: str(i.id) ?? `item-${index}`,
      position: num(i.position) ?? index,
      type: str(i.type) ?? 'unknown',
      resourceId: str(i.resourceId) ?? '',
      quantity: num(i.quantity) ?? 0,
      status: str(i.status) ?? 'UNKNOWN',
      provider: str(i.provider),
      unitPrice: num(i.unitPrice),
      currency: str(i.currency)
    })),
    providers: objList(body.providers).map((p, index) => ({
      id: str(p.id) ?? `provider-${index}`,
      itemId: str(p.itemId) ?? '',
      provider: str(p.provider) ?? 'Unknown provider',
      status: str(p.status) ?? 'UNKNOWN',
      operation: str(p.operation) ?? 'UNKNOWN',
      reference: str(p.reference),
      error: str(p.error),
      updatedAt: str(p.updatedAt) ?? ''
    })),
    events: objList(body.events).map((e, index) => ({
      id: str(e.id) ?? `event-${index}`,
      itemId: str(e.itemId),
      fromState: str(e.fromState),
      toState: str(e.toState) ?? 'UNKNOWN',
      detail: isObj(e.detail) ? e.detail : {},
      createdAt: str(e.createdAt) ?? ''
    })),
    locks: Array.isArray(body.locks)
      ? objList(body.locks).map((l, index) => ({
          id: str(l.id) ?? `lock-${index}`,
          itemId: str(l.itemId) ?? '',
          resourceType: str(l.resourceType) ?? 'unknown',
          resourceId: str(l.resourceId) ?? '',
          quantity: num(l.quantity) ?? 0,
          status: str(l.status) ?? 'UNKNOWN',
          expiresAt: str(l.expiresAt) ?? '',
          createdAt: str(l.createdAt) ?? ''
        }))
      : null,
    recoveryRequired: objList(body.recoveryRequired).map(r => ({
      itemId: str(r.itemId) ?? '',
      provider: str(r.provider) ?? 'Unknown provider',
      reference: str(r.reference),
      error: str(r.error)
    })),
    riskAssessment,
    recoveryAdvisory,
    sectionWarnings
  };
}

export function parseTransactionPage(body: unknown): TransactionPage {
  if (!isObj(body) || !Array.isArray(body.transactions)) {
    throw new MalformedResponseError('Transaction list response is missing transactions');
  }
  return {
    total: num(body.total) ?? 0,
    limit: num(body.limit) ?? 20,
    offset: num(body.offset) ?? 0,
    transactions: objList(body.transactions)
      .filter(t => str(t.transactionId))
      .map(t => ({
        transactionId: str(t.transactionId)!,
        state: str(t.state) ?? 'UNKNOWN',
        currency: str(t.currency) ?? 'INR',
        totalAmount: num(t.totalAmount),
        itemCount: num(t.itemCount),
        riskScore: num(t.riskScore),
        riskLevel: str(t.riskLevel),
        recoveryRecommendation: str(t.recoveryRecommendation),
        recoverySeverity: str(t.recoverySeverity),
        createdAt: str(t.createdAt)
      }))
  };
}

export function parseSystemHealth(body: unknown): SystemHealth {
  if (!isObj(body) || !str(body.status)) throw new MalformedResponseError('Health response is missing status');
  const checks = isObj(body.checks) ? body.checks : {};
  const check = (v: unknown): HealthCheckValue =>
    v === 'CONNECTED' || v === 'READY' || v === 'UNAVAILABLE' ? v : 'UNKNOWN';
  return {
    status: str(body.status)!,
    timestamp: str(body.timestamp),
    checks: {
      database: check(checks.database),
      transactionEngine: check(checks.transactionEngine),
      riskEngine: check(checks.riskEngine),
      recoveryEngine: check(checks.recoveryEngine)
    }
  };
}

export function parseDemoScenarios(body: unknown): DemoScenario[] {
  if (!isObj(body) || !Array.isArray(body.scenarios)) {
    throw new MalformedResponseError('Demo scenario response is missing scenarios');
  }
  return objList(body.scenarios)
    .filter(s => str(s.id) && isObj(s.request))
    .map(s => ({
      id: str(s.id)!,
      label: str(s.label) ?? str(s.id)!,
      description: str(s.description) ?? '',
      expectedState: str(s.expectedState) ?? 'UNKNOWN',
      source: str(s.source) ?? '',
      request: s.request as Record<string, unknown>
    }));
}

// ---------- derivations ----------

const TX_STATE_SET = new Set<string>(TRANSACTION_STATES);

export function eventName(event: TxEvent): string {
  return str(event.detail.event) ?? event.toState;
}

/**
 * A transaction-level state transition (as opposed to item, lock or payment activity).
 * Transitions always record fromState, except creation (PENDING). Payment outcome rows are
 * transaction-scoped too (toState PAYMENT or FAILED) but have no fromState.
 */
export function isStageEvent(event: TxEvent): boolean {
  return event.itemId === null
    && TX_STATE_SET.has(event.toState)
    && (event.fromState !== null || event.toState === 'PENDING');
}

export type StepOutcome = 'success' | 'failure' | 'compensated' | 'info';
export type StepKind = 'provider' | 'compensation' | 'payment' | 'lock' | 'other';

export interface TimelineStep {
  eventId: string;
  event: string;
  kind: StepKind;
  outcome: StepOutcome;
  itemId: string | null;
  itemLabel: string | null;
  provider: string | null;
  operation: string | null;
  reference: string | null;
  error: string | null;
  /** Status recorded on the event itself, e.g. VOIDED vs REFUNDED for PAYMENT_REFUNDED. */
  status: string | null;
  at: string;
}

export interface TimelineStage {
  eventId: string;
  state: string;
  fromState: string | null;
  event: string;
  at: string;
  steps: TimelineStep[];
}

// Hidden from the timeline (still listed in the raw event log): start markers carry no outcome.
const TIMELINE_HIDDEN = new Set(['RESERVE_STARTED', 'CONFIRM_STARTED', 'COMPENSATION_STARTED']);

function classifyStep(name: string): { kind: StepKind; outcome: StepOutcome } {
  if (name.startsWith('PAYMENT_')) {
    if (name.endsWith('_FAILED')) return { kind: 'payment', outcome: 'failure' };
    if (name === 'PAYMENT_REFUNDED') return { kind: 'payment', outcome: 'compensated' };
    return { kind: 'payment', outcome: 'success' };
  }
  if (name === 'COMPENSATION_SUCCEEDED') return { kind: 'compensation', outcome: 'compensated' };
  if (name === 'COMPENSATION_FAILED') return { kind: 'compensation', outcome: 'failure' };
  if (name.startsWith('PROVIDER_') && name !== 'PROVIDER_RESERVATION_HOLDS_RESOURCE') {
    return { kind: 'provider', outcome: name.endsWith('_FAILED') ? 'failure' : 'success' };
  }
  if (name.includes('LOCK') || name === 'PROVIDER_RESERVATION_HOLDS_RESOURCE' || name === 'UNPROCESSED_ITEM_RELEASED') {
    return { kind: 'lock', outcome: 'info' };
  }
  return { kind: 'other', outcome: name.endsWith('_FAILED') ? 'failure' : 'info' };
}

export function itemLabelMap(details: Pick<TransactionDetails, 'items'>): Map<string, string> {
  return new Map(details.items.map(i => [i.id, `${i.type} · ${i.resourceId}`]));
}

/** Groups persisted events under the transaction-level stage that was active when they were recorded. */
export function buildSagaTimeline(details: Pick<TransactionDetails, 'events' | 'items'>): TimelineStage[] {
  const labels = itemLabelMap(details);
  const stages: TimelineStage[] = [];
  const orphanSteps: TimelineStep[] = [];

  for (const event of details.events) {
    const name = eventName(event);
    if (isStageEvent(event)) {
      stages.push({ eventId: event.id, state: event.toState, fromState: event.fromState, event: name, at: event.createdAt, steps: [] });
      continue;
    }
    if (TIMELINE_HIDDEN.has(name)) continue;
    const { kind, outcome } = classifyStep(name);
    const step: TimelineStep = {
      eventId: event.id,
      event: name,
      kind,
      outcome,
      itemId: event.itemId,
      itemLabel: event.itemId ? labels.get(event.itemId) ?? event.itemId : null,
      provider: str(event.detail.provider),
      operation: str(event.detail.operation),
      reference: str(event.detail.reference),
      error: str(event.detail.error),
      status: str(event.detail.status),
      at: event.createdAt
    };
    const current = stages[stages.length - 1];
    if (current) current.steps.push(step);
    else orphanSteps.push(step);
  }
  if (orphanSteps.length > 0) {
    stages.unshift({ eventId: 'pre-stage', state: 'UNRECORDED', fromState: null, event: 'EVENTS_BEFORE_FIRST_STAGE', at: orphanSteps[0].at, steps: orphanSteps });
  }
  return stages;
}

/** The set of transaction states this transaction actually passed through, per persisted events. */
export function visitedStates(details: Pick<TransactionDetails, 'events' | 'state'>): Set<string> {
  const visited = new Set<string>();
  for (const e of details.events) if (isStageEvent(e)) visited.add(e.toState);
  visited.add(details.state);
  return visited;
}

export interface ProviderOperationRecord {
  eventId: string;
  itemId: string | null;
  itemLabel: string | null;
  provider: string;
  operation: string;
  status: string;
  outcome: 'success' | 'failure' | 'compensated';
  reference: string | null;
  error: string | null;
  at: string;
}

const TERMINAL_PROVIDER_STATES = new Set(['RESERVED', 'CONFIRMED', 'CANCELLED', 'FAILED']);

/**
 * Provider operation history. booking_transaction_providers keeps only the latest operation per item,
 * so the history (RESERVE → CANCEL etc.) is reconstructed from the terminal operation events.
 */
export function buildProviderOperations(details: Pick<TransactionDetails, 'events' | 'items'>): ProviderOperationRecord[] {
  const labels = itemLabelMap(details);
  const items = new Map(details.items.map(i => [i.id, i]));
  return details.events
    .filter(e => e.itemId !== null && str(e.detail.operation) && TERMINAL_PROVIDER_STATES.has(e.toState))
    .map(e => {
      const operation = str(e.detail.operation)!;
      const outcome: ProviderOperationRecord['outcome'] =
        e.toState === 'FAILED' ? 'failure' : operation === 'CANCEL' ? 'compensated' : 'success';
      return {
        eventId: e.id,
        itemId: e.itemId,
        itemLabel: e.itemId ? labels.get(e.itemId) ?? e.itemId : null,
        provider: str(e.detail.provider) ?? (e.itemId ? items.get(e.itemId)?.provider ?? 'Unknown provider' : 'Unknown provider'),
        operation,
        status: e.toState,
        outcome,
        reference: str(e.detail.reference),
        error: str(e.detail.error),
        at: e.createdAt
      };
    });
}

export type PaymentStepStatus = 'AUTHORIZED' | 'CAPTURED' | 'REFUNDED' | 'VOIDED' | 'FAILED' | 'NOT_RECORDED';

export interface PaymentSummary {
  recorded: boolean;
  currentStatus: PaymentStepStatus;
  authorization: PaymentStepStatus;
  capture: PaymentStepStatus;
  reversal: PaymentStepStatus;
  paymentId: string | null;
  amount: number | null;
  currency: string | null;
  errors: string[];
  events: Array<{ eventId: string; event: string; at: string }>;
}

/** Payment state as persisted in PAYMENT_* transaction events (the payment service itself is not queried). */
export function derivePaymentSummary(details: Pick<TransactionDetails, 'events'>): PaymentSummary {
  const summary: PaymentSummary = {
    recorded: false,
    currentStatus: 'NOT_RECORDED',
    authorization: 'NOT_RECORDED',
    capture: 'NOT_RECORDED',
    reversal: 'NOT_RECORDED',
    paymentId: null,
    amount: null,
    currency: null,
    errors: [],
    events: []
  };
  for (const e of details.events) {
    const name = eventName(e);
    // Stage transitions may cite a payment failure as their cause; only payment rows are counted.
    if (!name.startsWith('PAYMENT_') || isStageEvent(e)) continue;
    summary.recorded = true;
    summary.events.push({ eventId: e.id, event: name, at: e.createdAt });
    summary.paymentId = str(e.detail.paymentId) ?? summary.paymentId;
    const error = str(e.detail.error);
    if (error) summary.errors.push(error);
    switch (name) {
      case 'PAYMENT_AUTHORIZED':
        summary.authorization = 'AUTHORIZED';
        summary.currentStatus = 'AUTHORIZED';
        summary.amount = num(e.detail.amount);
        summary.currency = str(e.detail.currency);
        break;
      case 'PAYMENT_AUTHORIZATION_FAILED':
        summary.authorization = 'FAILED';
        summary.currentStatus = 'FAILED';
        break;
      case 'PAYMENT_CAPTURED':
        summary.capture = 'CAPTURED';
        summary.currentStatus = 'CAPTURED';
        break;
      case 'PAYMENT_CAPTURE_FAILED':
        summary.capture = 'FAILED';
        summary.currentStatus = 'FAILED';
        break;
      case 'PAYMENT_REFUNDED': {
        const status = str(e.detail.status);
        summary.reversal = status === 'VOIDED' ? 'VOIDED' : 'REFUNDED';
        summary.currentStatus = summary.reversal;
        break;
      }
      case 'PAYMENT_REFUND_FAILED':
        summary.reversal = 'FAILED';
        summary.currentStatus = 'FAILED';
        break;
    }
  }
  return summary;
}

/** Locks still CONFIRMED after a failed rollback: capacity stays protected until compensation is verified. */
export function findUnresolvedLocks(details: Pick<TransactionDetails, 'state' | 'locks'>): TxLock[] {
  if (details.state !== 'ROLLBACK_FAILED' || !details.locks) return [];
  return details.locks.filter(l => l.status === 'CONFIRMED');
}

// ---------- Phase 10: customer resolution ----------

export type ResolutionMode = 'CUSTOMER_OPTIONS' | 'OPERATOR_REVIEW' | 'NOT_APPLICABLE';

export interface ResolutionAlternative {
  type: string;
  resourceId: string;
  provider: string;
  description: string;
  location: string;
  date: string | null;
  endDate: string | null;
  time: string | null;
  unitPrice: number;
  currency: string;
  available: number;
  match: 'SAME_DATE' | 'NEAREST_DATE';
}

export interface CustomerResolution {
  transactionId: string;
  state: string;
  mode: ResolutionMode;
  reason: string;
  failedService: { itemId: string; type: string; resourceId: string; provider: string | null; quantity: number; operation: string; error: string | null } | null;
  matchCriteria: string | null;
  alternatives: ResolutionAlternative[];
  alternativesSupported: boolean;
  replacementSupported: boolean;
}

export function parseCustomerResolution(body: unknown): CustomerResolution {
  if (!isObj(body) || !str(body.transactionId) || !str(body.mode) || !Array.isArray(body.alternatives)) {
    throw new MalformedResponseError('Resolution response is missing required fields');
  }
  const mode = str(body.mode)!;
  if (mode !== 'CUSTOMER_OPTIONS' && mode !== 'OPERATOR_REVIEW' && mode !== 'NOT_APPLICABLE') {
    throw new MalformedResponseError(`Unknown resolution mode ${mode}`);
  }
  const f = isObj(body.failedService) ? body.failedService : null;
  return {
    transactionId: str(body.transactionId)!,
    state: str(body.state) ?? 'UNKNOWN',
    mode,
    reason: str(body.reason) ?? '',
    failedService: f
      ? {
          itemId: str(f.itemId) ?? '',
          type: str(f.type) ?? 'unknown',
          resourceId: str(f.resourceId) ?? '',
          provider: str(f.provider),
          quantity: num(f.quantity) ?? 1,
          operation: str(f.operation) ?? '',
          error: str(f.error)
        }
      : null,
    matchCriteria: str(body.matchCriteria),
    alternatives: objList(body.alternatives)
      .filter(a => str(a.resourceId) && num(a.unitPrice) !== null)
      .map(a => ({
        type: str(a.type) ?? 'unknown',
        resourceId: str(a.resourceId)!,
        provider: str(a.provider) ?? 'Unknown provider',
        description: str(a.description) ?? '',
        location: str(a.location) ?? '',
        date: str(a.date),
        endDate: str(a.endDate),
        time: str(a.time),
        unitPrice: num(a.unitPrice)!,
        currency: str(a.currency) ?? 'INR',
        available: num(a.available) ?? 0,
        match: a.match === 'SAME_DATE' ? 'SAME_DATE' : 'NEAREST_DATE'
      })),
    alternativesSupported: body.alternativesSupported === true,
    replacementSupported: body.replacementSupported === true
  };
}

/** The service whose forward (reserve/confirm) operation failed, if any — from recorded provider events. */
export function failedServiceType(details: Pick<TransactionDetails, 'events' | 'items'>): string | null {
  const failed = buildProviderOperations(details).find(o => o.operation !== 'CANCEL' && o.outcome === 'failure');
  if (!failed?.itemId) return null;
  return details.items.find(i => i.id === failed.itemId)?.type ?? null;
}

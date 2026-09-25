import { describe, expect, it } from 'vitest';
import completed from '../components/TransactionOps/__fixtures__/completed.json';
import rolledBack from '../components/TransactionOps/__fixtures__/rolledBack.json';
import paymentFailed from '../components/TransactionOps/__fixtures__/paymentFailed.json';
import rollbackFailed from '../components/TransactionOps/__fixtures__/rollbackFailed.json';
import {
  buildProviderOperations,
  buildSagaTimeline,
  derivePaymentSummary,
  findUnresolvedLocks,
  MalformedResponseError,
  parseTransactionDetails,
  visitedStates
} from './transactionModel';

// Fixtures are real GET /api/transactions/:id responses captured by backend/src/scripts/exportDashboardFixtures.ts.

describe('parseTransactionDetails', () => {
  it('accepts a real response and keeps locks, risk and advisory', () => {
    const d = parseTransactionDetails(rollbackFailed);
    expect(d.state).toBe('ROLLBACK_FAILED');
    expect(d.locks).toHaveLength(3);
    expect(d.riskAssessment?.factors.length).toBe(rollbackFailed.riskAssessment.factors.length);
    expect(d.recoveryAdvisory?.recommendation).toBe('MANUAL_OPERATOR_REVIEW');
    expect(d.sectionWarnings).toEqual([]);
  });

  it('rejects responses without the core transaction shape', () => {
    expect(() => parseTransactionDetails(null)).toThrow(MalformedResponseError);
    expect(() => parseTransactionDetails({ state: 'COMPLETED', items: [], events: [] })).toThrow(MalformedResponseError);
    expect(() => parseTransactionDetails({ transactionId: 'x', state: 'COMPLETED', events: [] })).toThrow(MalformedResponseError);
  });

  it('degrades missing or unreadable optional sections instead of failing', () => {
    const { riskAssessment, recoveryAdvisory, locks, ...core } = rollbackFailed;
    const missing = parseTransactionDetails(core);
    expect(missing.riskAssessment).toBeNull();
    expect(missing.recoveryAdvisory).toBeNull();
    expect(missing.locks).toBeNull();
    expect(missing.sectionWarnings).toEqual([]);

    const unreadable = parseTransactionDetails({ ...core, riskAssessment: { foo: 1 }, recoveryAdvisory: 'bad' });
    expect(unreadable.sectionWarnings).toEqual(['riskAssessment', 'recoveryAdvisory']);
  });

  it('accepts string event ids as returned by node-postgres for BIGSERIAL', () => {
    const d = parseTransactionDetails({ ...completed, events: completed.events.map(e => ({ ...e, id: String(e.id) })) });
    expect(buildSagaTimeline(d).map(s => s.state)).toEqual(['PENDING', 'RESERVING', 'PROCESSING', 'COMPLETED']);
  });
});

describe('buildSagaTimeline', () => {
  it('follows the forward path for a completed saga', () => {
    const stages = buildSagaTimeline(parseTransactionDetails(completed));
    expect(stages.map(s => s.state)).toEqual(['PENDING', 'RESERVING', 'PROCESSING', 'COMPLETED']);
    const steps = stages.flatMap(s => s.steps.map(x => x.event));
    expect(steps.filter(e => e === 'PROVIDER_RESERVED')).toHaveLength(3);
    expect(steps.filter(e => e === 'PROVIDER_CONFIRMED')).toHaveLength(3);
    expect(steps).not.toContain('RESERVE_STARTED');
  });

  it('places compensation under ROLLING_BACK and ends in ROLLBACK_FAILED', () => {
    const stages = buildSagaTimeline(parseTransactionDetails(rollbackFailed));
    expect(stages.map(s => s.state)).toEqual(['PENDING', 'RESERVING', 'ROLLING_BACK', 'ROLLBACK_FAILED']);
    const rollback = stages[2].steps.map(s => `${s.event}:${s.outcome}`);
    expect(rollback).toContain('COMPENSATION_FAILED:failure');
    expect(rollback).toContain('COMPENSATION_SUCCEEDED:compensated');
    expect(rollback).toContain('PAYMENT_REFUNDED:compensated');
  });

  it('keeps stage transitions whose cause is a payment failure', () => {
    const stages = buildSagaTimeline(parseTransactionDetails(paymentFailed));
    expect(stages.map(s => s.state)).toEqual(['PENDING', 'RESERVING', 'ROLLING_BACK', 'ROLLED_BACK']);
    expect(stages[2].event).toBe('PAYMENT_AUTHORIZATION_FAILED');
  });

  it('returns nothing when no events were recorded', () => {
    expect(buildSagaTimeline({ events: [], items: [] })).toEqual([]);
  });

  it('reports visited states only from recorded transitions', () => {
    expect([...visitedStates(parseTransactionDetails(rolledBack))].sort())
      .toEqual(['PENDING', 'RESERVING', 'ROLLED_BACK', 'ROLLING_BACK']);
  });
});

describe('buildProviderOperations', () => {
  it('reconstructs reserve and cancel history in execution order', () => {
    const ops = buildProviderOperations(parseTransactionDetails(rollbackFailed));
    expect(ops.map(o => `${o.provider}:${o.operation}:${o.status}`)).toEqual([
      'Fixture Grand Hotel:RESERVE:RESERVED',
      'Fixture Air:RESERVE:RESERVED',
      'Fixture Transit:RESERVE:FAILED',
      'Fixture Air:CANCEL:FAILED',
      'Fixture Grand Hotel:CANCEL:CANCELLED'
    ]);
    expect(ops[3].error).toBe('injected flight cancellation failure');
  });

  it('is empty when the saga stopped before any provider call', () => {
    expect(buildProviderOperations(parseTransactionDetails(paymentFailed))).toEqual([]);
  });
});

describe('derivePaymentSummary', () => {
  it('captured payment on completion', () => {
    const p = derivePaymentSummary(parseTransactionDetails(completed));
    expect([p.currentStatus, p.authorization, p.capture, p.reversal]).toEqual(['CAPTURED', 'AUTHORIZED', 'CAPTURED', 'NOT_RECORDED']);
    expect(p.amount).toBe(completed.totalAmount);
  });

  it('voided authorization on rollback before capture', () => {
    const p = derivePaymentSummary(parseTransactionDetails(rolledBack));
    expect([p.currentStatus, p.capture, p.reversal]).toEqual(['VOIDED', 'NOT_RECORDED', 'VOIDED']);
  });

  it('authorization failure is counted once, not per stage transition', () => {
    const p = derivePaymentSummary(parseTransactionDetails(paymentFailed));
    expect(p.authorization).toBe('FAILED');
    expect(p.events).toHaveLength(1);
    expect(p.errors).toEqual(['Demo: payment authorization declined']);
  });

  it('reports not recorded when there are no payment events', () => {
    expect(derivePaymentSummary({ events: [] }).recorded).toBe(false);
  });
});

describe('findUnresolvedLocks', () => {
  it('flags CONFIRMED locks only after a failed rollback', () => {
    expect(findUnresolvedLocks(parseTransactionDetails(rollbackFailed)).map(l => l.resourceType)).toEqual(['flight']);
    expect(findUnresolvedLocks(parseTransactionDetails(completed))).toEqual([]);
    expect(findUnresolvedLocks(parseTransactionDetails(rolledBack))).toEqual([]);
  });
});

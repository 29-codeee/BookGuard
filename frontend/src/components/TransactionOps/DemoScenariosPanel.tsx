import React, { useState } from 'react';
import { fetchDemoScenarios, fetchTransactionPage, submitDemoScenario, TransactionApiError } from '../../services/api';
import type { DemoScenario } from '../../services/transactionModel';
import { Mono, StatusBadge, shortId } from './ui';

function newIdempotencyKey(scenarioId: string): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `dashboard-demo-${scenarioId}-${random}`;
}

const DEMO_GUIDE: Record<string, { tag: string; hint: string }> = {
  SUCCESSFUL_BOOKING: { tag: 'Demo 1', hint: 'Expect COMPLETED. No customer resolution is shown.' },
  PROVIDER_FAILURE_ROLLBACK: { tag: 'Demo 2', hint: 'Then use Customer Resolution below: Find Alternative or Get Refund.' },
  ROLLBACK_FAILURE: { tag: 'Demo 3', hint: 'Expect the Action Required notice, a quarantined lock and MANUAL_OPERATOR_REVIEW.' },
  PAYMENT_FAILURE: { tag: 'Additional', hint: 'Customer resolution explains that nothing was charged.' }
};

interface IdempotencyResult {
  key: string;
  first: { transactionId: string; state: string };
  second: { transactionId: string; state: string };
  newTransactions: number;
}

interface Props {
  onCreated: (transactionId: string) => void;
}

/**
 * Demo scenarios submit the backend's deterministic failure-injection requests to the real
 * POST /api/transactions endpoint, only after explicit confirmation. Nothing is simulated here.
 */
export const DemoScenariosPanel: React.FC<Props> = ({ onCreated }) => {
  const [scenarios, setScenarios] = useState<DemoScenario[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<DemoScenario | 'IDEMPOTENCY' | null>(null);
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<{ label: string; transactionId: string; state: string } | null>(null);
  const [idempotency, setIdempotency] = useState<IdempotencyResult | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setScenarios(await fetchDemoScenarios());
    } catch (err) {
      setError(err instanceof TransactionApiError ? err.message : 'Unable to load demo scenarios.');
    } finally {
      setLoading(false);
    }
  };

  const run = async (scenario: DemoScenario) => {
    setRunning(true);
    setError(null);
    try {
      const result = await submitDemoScenario(scenario, newIdempotencyKey(scenario.id));
      setLastResult({ label: scenario.label, ...result });
      setIdempotency(null);
      setPending(null);
      onCreated(result.transactionId);
    } catch (err) {
      setError(err instanceof TransactionApiError ? err.message : 'Scenario submission failed.');
    } finally {
      setRunning(false);
    }
  };

  /** Demo 4: the same request sent twice with one Idempotency-Key; duplicates are measured, not assumed. */
  const runIdempotency = async () => {
    const scenario = scenarios?.find(s => s.id === 'SUCCESSFUL_BOOKING');
    if (!scenario) return;
    setRunning(true);
    setError(null);
    try {
      const key = newIdempotencyKey('IDEMPOTENCY');
      const before = (await fetchTransactionPage(1, 0)).total;
      const first = await submitDemoScenario(scenario, key);
      const second = await submitDemoScenario(scenario, key);
      const after = (await fetchTransactionPage(1, 0)).total;
      setIdempotency({ key, first, second, newTransactions: after - before });
      setLastResult(null);
      setPending(null);
      onCreated(first.transactionId);
    } catch (err) {
      setError(err instanceof TransactionApiError ? err.message : 'Idempotency demo failed.');
    } finally {
      setRunning(false);
    }
  };

  const pendingLabel = pending === 'IDEMPOTENCY' ? 'Idempotency replay' : pending?.label;

  return (
    <section className="txops-section kind-demo" aria-labelledby="txops-demo-title">
      <header className="txops-section-head">
        <div>
          <span className="txops-kind kind-demo">Demo · creates real transactions</span>
          <h3 id="txops-demo-title">Demo scenarios</h3>
          <p className="txops-sub">
            Each scenario submits a request with the backend&apos;s deterministic failure injection (Phase 4 scenarios) to
            POST /api/transactions. Results are real, persisted saga outcomes.
          </p>
        </div>
        {!scenarios && (
          <div className="txops-section-actions">
            <button type="button" className="txops-btn ghost" onClick={load} disabled={loading}>
              {loading ? 'Loading scenarios…' : 'Show scenarios'}
            </button>
          </div>
        )}
      </header>

      {error && <p className="txops-alert tone-fail" role="alert">{error}</p>}

      {scenarios && (
        <ul className="txops-demo-grid">
          {scenarios.map(s => (
            <li key={s.id} className="txops-demo-card">
              {DEMO_GUIDE[s.id] && <span className="txops-demo-tag">{DEMO_GUIDE[s.id].tag}</span>}
              <span className="txops-strong">{s.label}</span>
              <p>{s.description}</p>
              <p className="txops-muted">
                Expected: <StatusBadge status={s.expectedState} /> · source: {s.source}
              </p>
              {DEMO_GUIDE[s.id] && <p className="txops-muted">{DEMO_GUIDE[s.id].hint}</p>}
              <button type="button" className="txops-btn" onClick={() => setPending(s)} disabled={running}>
                Run scenario…
              </button>
            </li>
          ))}
          {scenarios.some(s => s.id === 'SUCCESSFUL_BOOKING') && (
            <li className="txops-demo-card">
              <span className="txops-demo-tag">Demo 4</span>
              <span className="txops-strong">Idempotency replay</span>
              <p>Sends the Demo 1 booking request twice with the same Idempotency-Key.</p>
              <p className="txops-muted">Expect one new transaction; the second response is the stored replay.</p>
              <button type="button" className="txops-btn" onClick={() => setPending('IDEMPOTENCY')} disabled={running}>
                Run idempotency demo…
              </button>
            </li>
          )}
        </ul>
      )}

      {pending && (
        <div className="txops-confirm" role="alertdialog" aria-labelledby="txops-confirm-title" aria-describedby="txops-confirm-desc">
          <h4 id="txops-confirm-title">Run “{pendingLabel}”?</h4>
          <p id="txops-confirm-desc">
            This creates a real transaction through POST /api/transactions. Transaction-engine tables will record it,
            and completed or unresolved outcomes keep CONFIRMED locks that hold capacity. Research dataset tables are
            not modified.
          </p>
          <div className="txops-inline">
            <button type="button" className="txops-btn" onClick={() => (pending === 'IDEMPOTENCY' ? runIdempotency() : run(pending))} disabled={running}>
              {running ? 'Submitting…' : 'Confirm and run'}
            </button>
            <button type="button" className="txops-btn ghost" onClick={() => setPending(null)} disabled={running}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {lastResult && (
        <p className="txops-callout" role="status">
          {lastResult.label}: created transaction <Mono title={lastResult.transactionId}>{shortId(lastResult.transactionId)}</Mono>{' '}
          with state <StatusBadge status={lastResult.state} />. Its details are loaded below.
        </p>
      )}

      {idempotency && (
        <div className="txops-callout" role="status" aria-label="Idempotency demo result">
          <p className="txops-strong">Idempotency replay (key <Mono>{shortId(idempotency.key, 28)}</Mono>)</p>
          <ul className="txops-checklist">
            <li>Request 1 → transaction <Mono title={idempotency.first.transactionId}>{shortId(idempotency.first.transactionId)}</Mono> <StatusBadge status={idempotency.first.state} /></li>
            <li>
              Request 2 → transaction <Mono title={idempotency.second.transactionId}>{shortId(idempotency.second.transactionId)}</Mono>{' '}
              {idempotency.second.transactionId === idempotency.first.transactionId ? '(same transaction — stored response replayed)' : '(different transaction)'}
            </li>
            <li>New transactions created (list total before vs after): <strong>{idempotency.newTransactions}</strong></li>
          </ul>
          <StatusBadge
            status={idempotency.second.transactionId === idempotency.first.transactionId && idempotency.newTransactions === 1 ? 'COMPLETED' : 'FAILED'}
            label={idempotency.second.transactionId === idempotency.first.transactionId && idempotency.newTransactions === 1 ? 'No duplicate transaction' : 'Duplicate detected'}
          />
          <p className="txops-footnote">The count comes from the transaction list total, so concurrent activity by others would also be included.</p>
        </div>
      )}
    </section>
  );
};

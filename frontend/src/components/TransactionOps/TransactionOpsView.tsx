import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchSystemHealth,
  fetchTransactionDetails,
  fetchTransactionPage,
  TransactionApiError
} from '../../services/api';
import {
  buildProviderOperations,
  derivePaymentSummary,
  findUnresolvedLocks,
  type SystemHealth,
  type TransactionDetails,
  type TransactionPage
} from '../../services/transactionModel';
import { SystemHealthPanel } from './SystemHealthPanel';
import { TransactionListTable } from './TransactionListTable';
import { TransactionOverview } from './TransactionOverview';
import { SagaTimeline } from './SagaTimeline';
import { ProviderOperationsTable } from './ProviderOperationsTable';
import { ResourceLocksPanel, UnresolvedLockWarning } from './ResourceLocksPanel';
import { PaymentPanel } from './PaymentPanel';
import { RiskAssessmentCard } from './RiskAssessmentCard';
import { RecoveryAdvisoryCard } from './RecoveryAdvisoryCard';
import { EventLog } from './EventLog';
import { DemoScenariosPanel } from './DemoScenariosPanel';
import { AdvisoryLayers, type CopilotProps } from './AdvisoryLayers';
import { CustomerResolutionPanel } from './CustomerResolutionPanel';
import { StatusBadge, humanize, type Tone } from './ui';
import './transactionOps.css';

const PAGE_SIZE = 10;

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof TransactionApiError) {
    switch (err.kind) {
      case 'NOT_FOUND': return 'Transaction not found.';
      case 'UNREACHABLE': return 'Unable to connect to BookGuard backend.';
      case 'MALFORMED': return 'Received an unexpected transaction response.';
      default: return err.message;
    }
  }
  return fallback;
}

interface RailStep { anchor: string; label: string; value: string; tone: Tone }

/** One summary per research-architecture stage, derived from the loaded transaction only. */
function railSteps(details: TransactionDetails): RailStep[] {
  const ops = buildProviderOperations(details);
  const forward = ops.filter(o => o.operation !== 'CANCEL');
  const cancels = ops.filter(o => o.operation === 'CANCEL');
  const payment = derivePaymentSummary(details);
  const unresolved = findUnresolvedLocks(details);
  const forwardFailed = forward.filter(o => o.outcome === 'failure').length;
  const cancelFailed = cancels.filter(o => o.outcome === 'failure').length;
  const saga = details.state;

  return [
    { anchor: 'txops-overview', label: 'Request', value: `${details.items.length} item${details.items.length === 1 ? '' : 's'}`, tone: 'info' },
    {
      anchor: 'txops-risk', label: 'Risk assessment',
      value: details.riskAssessment ? `${details.riskAssessment.riskLevel} · ${details.riskAssessment.decision}` : 'Not recorded',
      tone: details.riskAssessment ? (details.riskAssessment.riskLevel === 'HIGH' ? 'fail' : details.riskAssessment.riskLevel === 'MEDIUM' ? 'warn' : 'ok') : 'neutral'
    },
    {
      anchor: 'txops-locks', label: 'Resource locks',
      value: details.locks === null ? 'Not returned' : unresolved.length > 0 ? `${unresolved.length} unresolved` : `${details.locks.length} lock${details.locks.length === 1 ? '' : 's'}`,
      tone: unresolved.length > 0 ? 'fail' : 'info'
    },
    {
      anchor: 'txops-providers', label: 'Provider operations',
      value: forward.length === 0 ? 'None' : forwardFailed > 0 ? `${forwardFailed} failed` : `${forward.length} succeeded`,
      tone: forward.length === 0 ? 'neutral' : forwardFailed > 0 ? 'fail' : 'ok'
    },
    {
      anchor: 'txops-payment', label: 'Payment',
      value: payment.recorded ? payment.currentStatus : 'Not recorded',
      tone: payment.currentStatus === 'FAILED' ? 'fail' : payment.currentStatus === 'NOT_RECORDED' ? 'neutral' : payment.currentStatus === 'REFUNDED' || payment.currentStatus === 'VOIDED' ? 'comp' : 'ok'
    },
    {
      anchor: 'txops-timeline', label: 'Saga state', value: saga.replace(/_/g, ' '),
      tone: saga === 'COMPLETED' ? 'ok' : saga === 'ROLLED_BACK' ? 'comp' : saga === 'ROLLING_BACK' ? 'warn' : saga === 'ROLLBACK_FAILED' || saga === 'FAILED' ? 'fail' : 'info'
    },
    {
      anchor: 'txops-providers', label: 'Compensation',
      value: cancels.length === 0 ? 'Not needed' : cancelFailed > 0 ? `${cancelFailed} of ${cancels.length} failed` : `${cancels.length} compensated`,
      tone: cancels.length === 0 ? 'neutral' : cancelFailed > 0 ? 'fail' : 'comp'
    },
    {
      anchor: 'txops-recovery', label: 'Recovery intelligence',
      value: details.recoveryAdvisory ? humanize(details.recoveryAdvisory.recommendation) : 'No advisory',
      tone: details.recoveryAdvisory ? 'warn' : 'neutral'
    }
  ];
}

const ArchitectureRail: React.FC<{ details: TransactionDetails }> = ({ details }) => (
  <nav className="txops-rail" aria-label="Research architecture stages for this transaction">
    <ol>
      {railSteps(details).map((step, i) => (
        <li key={step.label}>
          <a href={`#${step.anchor}-title`} className={`txops-rail-step tone-${step.tone}`}>
            <span className="txops-rail-index" aria-hidden="true">{i + 1}</span>
            <span className="txops-rail-label">{step.label}</span>
            <span className="txops-rail-value">{step.value}</span>
          </a>
        </li>
      ))}
    </ol>
  </nav>
);

export const TransactionOpsView: React.FC<{ copilot?: CopilotProps }> = ({ copilot }) => {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);

  const [page, setPage] = useState<TransactionPage | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<TransactionDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const detailRequest = useRef(0);

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      setHealth(await fetchSystemHealth());
      setHealthError(null);
    } catch (err) {
      setHealthError(errorMessage(err, 'Unable to connect to BookGuard backend.'));
    } finally {
      setHealthLoading(false);
    }
  }, []);

  const loadList = useCallback(async (offset: number) => {
    setListLoading(true);
    try {
      setPage(await fetchTransactionPage(PAGE_SIZE, offset));
      setListError(null);
    } catch (err) {
      setListError(errorMessage(err, 'Unable to load transactions.'));
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadTransaction = useCallback(async (id: string) => {
    const transactionId = id.trim();
    if (!transactionId) {
      setInputError('Enter a transaction ID.');
      return;
    }
    setInputError(null);
    setSelectedId(transactionId);
    setSearchInput(transactionId);
    const requestId = ++detailRequest.current;
    setDetailsLoading(true);
    setDetailsError(null);
    try {
      const result = await fetchTransactionDetails(transactionId);
      if (requestId !== detailRequest.current) return;
      setDetails(result);
    } catch (err) {
      if (requestId !== detailRequest.current) return;
      setDetails(null);
      setDetailsError(errorMessage(err, 'Received an unexpected transaction response.'));
    } finally {
      if (requestId === detailRequest.current) setDetailsLoading(false);
    }
  }, []);

  // Initial read-only load; no polling afterwards — refreshes are explicit.
  useEffect(() => {
    void loadHealth();
    void loadList(0);
  }, [loadHealth, loadList]);

  const handleCreated = (transactionId: string) => {
    void loadTransaction(transactionId);
    void loadList(0);
  };

  return (
    <div className="txops">
      <header className="txops-hero">
        <div>
          <p className="txops-eyebrow">Operations &amp; research dashboard</p>
          <h2>BookGuard Operations</h2>
          <p className="txops-muted">
            Inspect how a multi-provider booking moved through risk assessment, resource locks, provider calls, payment,
            Saga compensation and recovery intelligence. Read-only: the dashboard never releases locks, retries,
            cancels or refunds.
          </p>
        </div>
        <ul className="txops-legend" aria-label="Legend">
          <li><span className="txops-kind kind-fact">System state</span> recorded fact</li>
          <li><span className="txops-kind kind-risk">Risk</span> advisory score</li>
          <li><span className="txops-kind kind-advisory">Recovery advisory</span> not executed</li>
          <li><span className="txops-kind kind-action">Operator action required</span> human needed</li>
        </ul>
      </header>

      <SystemHealthPanel health={health} loading={healthLoading} error={healthError} onRefresh={loadHealth} />

      <form
        className="txops-search"
        role="search"
        onSubmit={e => {
          e.preventDefault();
          void loadTransaction(searchInput);
        }}
      >
        <label htmlFor="txops-search-input">Transaction ID</label>
        <div className="txops-search-row">
          <input
            id="txops-search-input"
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="e.g. 2fafa7fc-a217-4ece-a4b0-7c865759e5fb"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={inputError ? 'true' : undefined}
            aria-describedby={inputError ? 'txops-search-error' : undefined}
          />
          <button type="submit" className="txops-btn" disabled={detailsLoading}>Load</button>
          {details && (
            <button type="button" className="txops-btn ghost" onClick={() => loadTransaction(details.transactionId)} disabled={detailsLoading}>
              Refresh details
            </button>
          )}
          {page && page.transactions.length > 0 && (
            <button type="button" className="txops-btn ghost" onClick={() => loadTransaction(page.transactions[0].transactionId)} disabled={detailsLoading}>
              Load latest
            </button>
          )}
        </div>
        {inputError && <p id="txops-search-error" className="txops-alert tone-fail" role="alert">{inputError}</p>}
      </form>

      <div className="txops-top-grid">
        <TransactionListTable
          page={page}
          loading={listLoading}
          error={listError}
          selectedId={selectedId}
          onSelect={id => void loadTransaction(id)}
          onRefresh={() => void loadList(page?.offset ?? 0)}
          onPage={offset => void loadList(offset)}
        />
        <DemoScenariosPanel onCreated={handleCreated} />
      </div>

      <div aria-live="polite" aria-busy={detailsLoading}>
        {detailsLoading && <p className="txops-loading" role="status">Loading transaction...</p>}
        {detailsError && !detailsLoading && <p className="txops-alert tone-fail" role="alert">{detailsError}</p>}
      </div>

      {details && (
        <div className={`txops-detail${detailsLoading ? ' is-stale' : ''}`} aria-label={`Transaction ${details.transactionId}`}>
          <UnresolvedLockWarning details={details} />
          <CustomerResolutionPanel
            details={details}
            onOpenTransaction={id => {
              void loadTransaction(id);
              void loadList(0);
            }}
          />
          {details.sectionWarnings.length > 0 && (
            <p className="txops-callout">
              Some optional sections could not be interpreted and are hidden: {details.sectionWarnings.join(', ')}.
            </p>
          )}
          <ArchitectureRail details={details} />
          <TransactionOverview details={details} />
          <div className="txops-two-col">
            <SagaTimeline details={details} />
            <div className="txops-stack-lg">
              <RiskAssessmentCard risk={details.riskAssessment} unreadable={details.sectionWarnings.includes('riskAssessment')} />
              <RecoveryAdvisoryCard
                advisory={details.recoveryAdvisory}
                transactionState={details.state}
                unreadable={details.sectionWarnings.includes('recoveryAdvisory')}
              />
            </div>
          </div>
          <ProviderOperationsTable details={details} />
          <div className="txops-two-col">
            <ResourceLocksPanel details={details} />
            <PaymentPanel details={details} />
          </div>
          <EventLog details={details} />
        </div>
      )}

      {!details && !detailsLoading && !detailsError && (
        <p className="txops-empty txops-placeholder">
          Select a transaction from the list, enter an ID, or run a demo scenario to see its full lifecycle.
        </p>
      )}

      <AdvisoryLayers copilot={copilot} />

      <p className="txops-footnote">
        State legend: <StatusBadge status="COMPLETED" /> <StatusBadge status="ROLLED_BACK" />{' '}
        <StatusBadge status="ROLLING_BACK" /> <StatusBadge status="ROLLBACK_FAILED" /> — every badge carries its text label.
      </p>
    </div>
  );
};

import React from 'react';
import type { SystemHealth } from '../../services/transactionModel';
import { StatusBadge, formatTime } from './ui';

interface Props {
  health: SystemHealth | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

const ROWS: Array<{ key: keyof SystemHealth['checks']; label: string }> = [
  { key: 'database', label: 'Database' },
  { key: 'transactionEngine', label: 'Transaction engine' },
  { key: 'riskEngine', label: 'Risk engine' },
  { key: 'recoveryEngine', label: 'Recovery intelligence' }
];

export const SystemHealthPanel: React.FC<Props> = ({ health, loading, error, onRefresh }) => (
  <section className="txops-health" aria-labelledby="txops-health-title">
    <div className="txops-health-head">
      <h2 id="txops-health-title">System health</h2>
      <button type="button" className="txops-btn ghost" onClick={onRefresh} disabled={loading}>
        {loading ? 'Checking…' : 'Re-check'}
      </button>
    </div>
    <div className="txops-health-grid" role="status" aria-live="polite">
      <div className="txops-health-cell">
        <span className="txops-label">Backend</span>
        {loading && !health ? (
          <span className="txops-muted">Checking…</span>
        ) : error ? (
          <StatusBadge status="UNAVAILABLE" label="Unreachable" />
        ) : (
          <StatusBadge status="CONNECTED" />
        )}
      </div>
      {ROWS.map(row => (
        <div key={row.key} className="txops-health-cell">
          <span className="txops-label">{row.label}</span>
          {health && !error ? (
            <StatusBadge status={health.checks[row.key]} tone={health.checks[row.key] === 'UNKNOWN' ? 'neutral' : undefined} />
          ) : (
            <span className="txops-muted">{loading ? 'Checking…' : 'Unknown'}</span>
          )}
        </div>
      ))}
    </div>
    {error && <p className="txops-alert tone-fail" role="alert">{error}</p>}
    {health && !error && (
      <p className="txops-footnote">
        Probed via GET /api/health at {formatTime(health.timestamp)} — database reachability and presence of the
        transaction, risk and recovery tables.
      </p>
    )}
  </section>
);

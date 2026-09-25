import React from 'react';
import type { RiskAssessment } from '../../services/transactionModel';
import { Empty, Mono, Section, StatusBadge, formatTime, humanize } from './ui';

function formatValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  if (value === null || value === undefined) return '—';
  return JSON.stringify(value);
}

export const RiskAssessmentCard: React.FC<{ risk: RiskAssessment | null; unreadable: boolean }> = ({ risk, unreadable }) => (
  <Section
    id="txops-risk"
    kind="risk"
    title="Transaction risk"
    subtitle="Deterministic pre-execution assessment (Phase 6A). Advisory only — it never blocks or alters the saga."
  >
    {!risk ? (
      <Empty>
        {unreadable
          ? 'A risk assessment was returned but could not be interpreted.'
          : 'No risk assessment was recorded for this transaction.'}
      </Empty>
    ) : (
      <>
        <div className="txops-risk-head">
          <div className="txops-risk-score" aria-label={`Risk score ${risk.riskScore} out of 100`}>
            <span className="txops-risk-number">{risk.riskScore}</span>
            <span className="txops-muted">/ 100</span>
          </div>
          <div className="txops-risk-meter" aria-hidden="true">
            <div className="txops-risk-bands"><span /><span /><span /></div>
            <div className="txops-risk-marker" style={{ left: `${Math.min(Math.max(risk.riskScore, 0), 100)}%` }} />
            <div className="txops-risk-scale"><span>0 Low</span><span>40 Medium</span><span>70 High</span></div>
          </div>
          <dl className="txops-kv compact">
            <div><dt>Level</dt><dd><StatusBadge status={risk.riskLevel} /></dd></div>
            <div><dt>Decision</dt><dd><StatusBadge status={risk.decision} /></dd></div>
            <div><dt>Calculated</dt><dd>{formatTime(risk.calculatedAt, true)}</dd></div>
          </dl>
        </div>

        <h4 className="txops-h4">Factors ({risk.factors.length})</h4>
        {risk.factors.length === 0 ? (
          <Empty>No risk factors contributed beyond the baseline.</Empty>
        ) : (
          <ul className="txops-factors">
            {risk.factors.map((factor, i) => (
              <li key={`${factor.code}-${i}`}>
                <div className="txops-factor-head">
                  <StatusBadge status={factor.severity} />
                  <span className="txops-strong">{humanize(factor.code)}</span>
                  <span className="txops-muted">value: {formatValue(factor.value)}</span>
                </div>
                {factor.explanation && <p>{factor.explanation}</p>}
                {factor.evidenceIds.length > 0 && (
                  <p className="txops-evidence">Evidence: {factor.evidenceIds.map(id => <Mono key={id}>{id}</Mono>)}</p>
                )}
              </li>
            ))}
          </ul>
        )}

        {risk.providerAssessments.length > 0 && (
          <details className="txops-details">
            <summary>Provider telemetry used ({risk.providerAssessments.length})</summary>
            <div className="txops-table-wrap">
              <table className="txops-table">
                <caption className="sr-only">Per-provider risk telemetry</caption>
                <thead>
                  <tr>
                    <th scope="col">Provider</th>
                    <th scope="col">Provider score</th>
                    <th scope="col">Reliability</th>
                    <th scope="col">Response</th>
                    <th scope="col">Rollback support</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {risk.providerAssessments.map(p => (
                    <tr key={p.provider}>
                      <td>{p.provider}</td>
                      <td>{p.riskScore ?? '—'}</td>
                      <td>{p.reliabilityScore ?? '—'}</td>
                      <td>{p.responseTimeMs !== null ? `${p.responseTimeMs} ms` : '—'}</td>
                      <td>{p.supportsRollback === null ? '—' : p.supportsRollback ? 'Yes' : 'No'}</td>
                      <td>{p.status ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </>
    )}
  </Section>
);

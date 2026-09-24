import React from 'react';
import type { RecoveryAdvisory } from '../../services/transactionModel';
import { Empty, Mono, Section, StatusBadge, formatTime, humanize, shortId } from './ui';

const FRAMING: Record<string, { headline: string; body: string }> = {
  AUTOMATIC_RETRY: {
    headline: 'Advisor recommends a controlled retry',
    body: 'The failure pattern looks transient. No retry has been performed — an operator decides whether and when to retry.'
  },
  ALTERNATIVE_PROVIDER: {
    headline: 'Advisor recommends evaluating an alternative provider',
    body: 'The current provider looks unsuitable. No re-booking has been performed — alternatives must be evaluated by an operator.'
  },
  MANUAL_OPERATOR_REVIEW: {
    headline: 'Human verification required',
    body: 'The advisor cannot safely recommend an automated path. An operator must verify supplier and payment state before any action.'
  }
};

interface Props {
  advisory: RecoveryAdvisory | null;
  transactionState: string;
  unreadable: boolean;
}

export const RecoveryAdvisoryCard: React.FC<Props> = ({ advisory, transactionState, unreadable }) => {
  const framing = advisory ? FRAMING[advisory.recommendation] : undefined;
  const evidence = advisory ? Array.from(new Set(advisory.reasons.flatMap(r => r.evidenceIds))) : [];

  return (
    <Section
      id="txops-recovery"
      kind="advisory"
      title="Recovery intelligence"
      subtitle="Deterministic failure-recovery recommendation (Phase 6B). Nothing here has been executed."
    >
      {!advisory ? (
        <Empty>
          {unreadable
            ? 'A recovery advisory was returned but could not be interpreted.'
            : transactionState === 'ROLLBACK_FAILED'
              ? 'No recovery advisory was recorded. Advisory generation is non-blocking and may have failed; verify manually.'
              : 'No recovery advisory — advisories are generated only when compensation fails.'}
        </Empty>
      ) : (
        <>
          <div className={`txops-advice ${advisory.recommendation === 'MANUAL_OPERATOR_REVIEW' ? 'is-review' : ''}`}>
            <span className="txops-label">Recommendation</span>
            <div className="txops-advice-rec">
              <span className="txops-advice-code">{advisory.recommendation}</span>
            </div>
            <p className="txops-strong">{framing?.headline ?? humanize(advisory.recommendation)}</p>
            {framing && <p className="txops-muted">{framing.body}</p>}
            <dl className="txops-kv compact">
              <div><dt>Severity</dt><dd><StatusBadge status={advisory.severity} /></dd></div>
              <div><dt>Confidence</dt><dd>{advisory.confidence !== null ? `${advisory.confidence}%` : '—'}</dd></div>
              <div><dt>Generated</dt><dd>{formatTime(advisory.generatedAt, true)}</dd></div>
            </dl>
          </div>

          {advisory.reasons.length > 0 && (
            <>
              <h4 className="txops-h4">Reasons</h4>
              <ul className="txops-reasons">
                {advisory.reasons.map((reason, i) => (
                  <li key={`${reason.code}-${i}`}>
                    <span aria-hidden="true" className="txops-reason-icon">⚠</span>
                    <div>
                      <span className="txops-inline">
                        <span className="txops-strong">{humanize(reason.code)}</span>
                        <StatusBadge status={reason.severity} />
                      </span>
                      <p>{reason.explanation}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {advisory.suggestedActions.length > 0 && (
            <>
              <h4 className="txops-h4">Suggested operator actions <span className="txops-muted">(not executed)</span></h4>
              <ol className="txops-actions">
                {advisory.suggestedActions.map(action => <li key={action}>{action}</li>)}
              </ol>
            </>
          )}

          {advisory.affectedItems.length > 0 && (
            <>
              <h4 className="txops-h4">Affected items</h4>
              <ul className="txops-affected">
                {advisory.affectedItems.map(item => (
                  <li key={`${item.itemId}-${item.provider}`}>
                    <span className="txops-strong">{item.provider}</span> · item <Mono title={item.itemId}>{shortId(item.itemId)}</Mono>
                    {item.reference && <> · ref <Mono title={item.reference}>{shortId(item.reference, 18)}</Mono></>}
                    {item.error && <span className="txops-error-text"> — {item.error}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}

          {evidence.length > 0 && (
            <details className="txops-details">
              <summary>Evidence IDs ({evidence.length})</summary>
              <ul className="txops-evidence-list">
                {evidence.map(id => <li key={id}><Mono>{id}</Mono></li>)}
              </ul>
            </details>
          )}

          <p className="txops-footnote">
            This advisory does not change transaction state, release locks, retry or cancel providers, or re-book.
          </p>
        </>
      )}
    </Section>
  );
};

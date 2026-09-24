import React, { useMemo } from 'react';
import { buildProviderOperations, type TransactionDetails } from '../../services/transactionModel';
import { Empty, Mono, Section, StatusBadge, formatTime, shortId } from './ui';

const OUTCOME_LABEL = { success: 'Success', failure: 'Failed', compensated: 'Compensated' } as const;
const OUTCOME_TONE = { success: 'ok', failure: 'fail', compensated: 'comp' } as const;

export const ProviderOperationsTable: React.FC<{ details: TransactionDetails }> = ({ details }) => {
  const operations = useMemo(() => buildProviderOperations(details), [details]);

  return (
    <Section
      id="txops-providers"
      kind="fact"
      title="Provider operations"
      subtitle="Every completed provider call (reserve, confirm, cancel) in execution order, from operation events."
    >
      {operations.length === 0 ? (
        <Empty>No provider operations were recorded — the transaction ended before any provider was contacted.</Empty>
      ) : (
        <div className="txops-table-wrap">
          <table className="txops-table">
            <caption className="sr-only">Provider operation history</caption>
            <thead>
              <tr>
                <th scope="col">Provider</th>
                <th scope="col">Item</th>
                <th scope="col">Operation</th>
                <th scope="col">Result</th>
                <th scope="col">Reference</th>
                <th scope="col">Error</th>
                <th scope="col">At</th>
              </tr>
            </thead>
            <tbody>
              {operations.map(op => (
                <tr key={op.eventId} className={op.outcome === 'failure' ? 'is-failure' : undefined}>
                  <td>{op.provider}</td>
                  <td>{op.itemLabel ?? '—'}</td>
                  <td><span className="txops-op">{op.operation}</span></td>
                  <td>
                    <span className="txops-inline">
                      <StatusBadge status={op.status} tone={OUTCOME_TONE[op.outcome]} label={OUTCOME_LABEL[op.outcome]} />
                      <span className="txops-muted">{op.status}</span>
                    </span>
                  </td>
                  <td>{op.reference ? <Mono title={op.reference}>{shortId(op.reference, 18)}</Mono> : <span className="txops-muted">—</span>}</td>
                  <td>{op.error ? <span className="txops-error-text">{op.error}</span> : <span className="txops-muted">—</span>}</td>
                  <td>{formatTime(op.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {details.recoveryRequired.length > 0 && (
        <div className="txops-callout tone-fail" role="note">
          <strong>Recovery required (recorded):</strong>{' '}
          {details.recoveryRequired.map(r => `${r.provider} cancellation failed${r.error ? ` — ${r.error}` : ''}`).join('; ')}
        </div>
      )}
    </Section>
  );
};

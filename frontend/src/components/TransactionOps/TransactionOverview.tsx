import React from 'react';
import type { TransactionDetails } from '../../services/transactionModel';
import { Empty, Mono, Section, StatusBadge, formatMoney, formatTime, shortId } from './ui';

export const TransactionOverview: React.FC<{ details: TransactionDetails }> = ({ details }) => {
  const providerByItem = new Map(details.providers.map(p => [p.itemId, p]));
  const risk = details.riskAssessment;
  // After a failed rollback a still-reserved item is a problem, not a success.
  const unresolvedRollback = details.state === 'ROLLBACK_FAILED';

  return (
    <Section id="txops-overview" kind="fact" title="Transaction overview">
      <dl className="txops-kv">
        <div><dt>Transaction ID</dt><dd><Mono>{details.transactionId}</Mono></dd></div>
        <div><dt>State</dt><dd><StatusBadge status={details.state} /></dd></div>
        <div><dt>Currency</dt><dd>{details.currency}</dd></div>
        <div><dt>Total</dt><dd className="txops-strong">{formatMoney(details.totalAmount, details.currency)}</dd></div>
        <div><dt>Created</dt><dd>{formatTime(details.createdAt, true)}</dd></div>
        <div><dt>Last updated</dt><dd>{formatTime(details.updatedAt, true)}</dd></div>
        <div>
          <dt>Risk (advisory)</dt>
          <dd>
            {risk ? (
              <span className="txops-inline">
                <span className="txops-strong">{risk.riskScore} / 100</span>
                <StatusBadge status={risk.riskLevel} />
                <StatusBadge status={risk.decision} />
              </span>
            ) : (
              <span className="txops-muted">Not available</span>
            )}
          </dd>
        </div>
      </dl>

      <h4 className="txops-h4">Items</h4>
      {details.items.length === 0 ? (
        <Empty>No items recorded.</Empty>
      ) : (
        <div className="txops-table-wrap">
          <table className="txops-table">
            <caption className="sr-only">Transaction items and their current provider state</caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Item</th>
                <th scope="col">Type</th>
                <th scope="col">Resource</th>
                <th scope="col">Qty</th>
                <th scope="col">Unit price</th>
                <th scope="col">Item state</th>
                <th scope="col">Provider (latest operation)</th>
              </tr>
            </thead>
            <tbody>
              {details.items.map(item => {
                const provider = providerByItem.get(item.id);
                return (
                  <tr key={item.id}>
                    <td>{item.position + 1}</td>
                    <td><Mono title={item.id}>{shortId(item.id)}</Mono></td>
                    <td className="txops-cap">{item.type}</td>
                    <td><Mono>{item.resourceId}</Mono></td>
                    <td>{item.quantity}</td>
                    <td>{formatMoney(item.unitPrice, item.currency ?? details.currency)}</td>
                    <td>
                      {unresolvedRollback && (item.status === 'RESERVED' || item.status === 'COMPLETED')
                        ? <StatusBadge status={item.status} tone="warn" label={`${item.status} — not released`} />
                        : <StatusBadge status={item.status} />}
                    </td>
                    <td>
                      {provider ? (
                        <div className="txops-stack">
                          <span>{provider.provider}</span>
                          <span className="txops-inline">
                            <span className="txops-muted">{provider.operation}</span>
                            <StatusBadge status={provider.status} />
                          </span>
                          <span className="txops-muted">updated {formatTime(provider.updatedAt)}</span>
                        </div>
                      ) : (
                        <span className="txops-muted">{item.provider ?? 'No provider record'}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
};

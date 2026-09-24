import React from 'react';
import type { TransactionPage } from '../../services/transactionModel';
import { Empty, Mono, StatusBadge, formatMoney, formatTime, humanize, shortId } from './ui';

interface Props {
  page: TransactionPage | null;
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (transactionId: string) => void;
  onRefresh: () => void;
  onPage: (offset: number) => void;
}

export const TransactionListTable: React.FC<Props> = ({ page, loading, error, selectedId, onSelect, onRefresh, onPage }) => {
  const from = page && page.total > 0 ? page.offset + 1 : 0;
  const to = page ? page.offset + page.transactions.length : 0;

  return (
    <section className="txops-section kind-fact" aria-labelledby="txops-list-title">
      <header className="txops-section-head">
        <div>
          <span className="txops-kind kind-fact">System state · recorded fact</span>
          <h3 id="txops-list-title">Recent transactions</h3>
          <p className="txops-sub">Newest first, from GET /api/transactions. Select a row to open its details.</p>
        </div>
        <div className="txops-section-actions">
          <button type="button" className="txops-btn ghost" onClick={onRefresh} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh list'}
          </button>
        </div>
      </header>

      {error && <p className="txops-alert tone-fail" role="alert">{error}</p>}
      {loading && !page && <p className="txops-muted" role="status">Loading transactions…</p>}
      {page && page.transactions.length === 0 && (
        <Empty>No transactions recorded yet. Create one through the booking API or a demo scenario.</Empty>
      )}

      {page && page.transactions.length > 0 && (
        <div className="txops-table-wrap">
          <table className="txops-table">
            <caption className="sr-only">Recent booking transactions</caption>
            <thead>
              <tr>
                <th scope="col">Transaction</th>
                <th scope="col">State</th>
                <th scope="col">Total</th>
                <th scope="col">Risk</th>
                <th scope="col">Recovery</th>
                <th scope="col">Created</th>
              </tr>
            </thead>
            <tbody>
              {page.transactions.map(tx => {
                const selected = tx.transactionId === selectedId;
                return (
                  <tr key={tx.transactionId} className={selected ? 'is-selected' : undefined}>
                    <td>
                      <button
                        type="button"
                        className="txops-link"
                        onClick={() => onSelect(tx.transactionId)}
                        aria-current={selected ? 'true' : undefined}
                        aria-label={`Open transaction ${tx.transactionId}`}
                      >
                        <Mono title={tx.transactionId}>{shortId(tx.transactionId)}</Mono>
                      </button>
                    </td>
                    <td><StatusBadge status={tx.state} /></td>
                    <td>{formatMoney(tx.totalAmount, tx.currency)}</td>
                    <td>
                      {tx.riskLevel ? (
                        <span className="txops-inline">
                          <StatusBadge status={tx.riskLevel} />
                          {tx.riskScore !== null && <span className="txops-muted">{tx.riskScore}/100</span>}
                        </span>
                      ) : (
                        <span className="txops-muted">Not assessed</span>
                      )}
                    </td>
                    <td>
                      {tx.recoveryRecommendation ? (
                        <span className="txops-advisory-chip">Advisory: {humanize(tx.recoveryRecommendation)}</span>
                      ) : (
                        <span className="txops-muted">None</span>
                      )}
                    </td>
                    <td>{formatTime(tx.createdAt, true)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {page && page.total > page.limit && (
        <nav className="txops-pager" aria-label="Transaction list pages">
          <span className="txops-muted">{from}–{to} of {page.total}</span>
          <button type="button" className="txops-btn ghost" disabled={loading || page.offset === 0} onClick={() => onPage(Math.max(page.offset - page.limit, 0))}>
            Previous
          </button>
          <button type="button" className="txops-btn ghost" disabled={loading || to >= page.total} onClick={() => onPage(page.offset + page.limit)}>
            Next
          </button>
        </nav>
      )}
    </section>
  );
};

import React from 'react';
import { findUnresolvedLocks, type TransactionDetails } from '../../services/transactionModel';
import { Empty, Mono, Section, StatusBadge, formatTime, shortId } from './ui';

export const UnresolvedLockWarning: React.FC<{ details: TransactionDetails }> = ({ details }) => {
  const unresolved = findUnresolvedLocks(details);
  if (unresolved.length === 0) return null;
  return (
    <div className="txops-lock-warning" role="alert" aria-labelledby="txops-lock-warning-title">
      <div className="txops-lock-warning-icon" aria-hidden="true">⚠</div>
      <div>
        <span className="txops-kind kind-action">Operator action required</span>
        <h3 id="txops-lock-warning-title">Unresolved resource lock</h3>
        <p>
          The resource remains protected because compensation has not been verified. Automatic release is disabled.
        </p>
        <ul>
          {unresolved.map(lock => (
            <li key={lock.id}>
              <span className="txops-cap">{lock.resourceType}</span> <Mono>{lock.resourceId}</Mono> × {lock.quantity} —{' '}
              <StatusBadge status="CONFIRMED" tone="warn" label="Confirmed (held)" /> (item <Mono title={lock.itemId}>{shortId(lock.itemId)}</Mono>)
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export const ResourceLocksPanel: React.FC<{ details: TransactionDetails }> = ({ details }) => {
  const unresolved = new Set(findUnresolvedLocks(details).map(l => l.id));

  return (
    <Section
      id="txops-locks"
      kind="fact"
      title="Resource locks"
      subtitle="CONFIRMED locks hold capacity; RELEASED locks returned it. The dashboard cannot change lock state."
    >
      {details.locks === null ? (
        <Empty>Lock data is not included in this backend response.</Empty>
      ) : details.locks.length === 0 ? (
        <Empty>No resource locks were acquired for this transaction.</Empty>
      ) : (
        <div className="txops-table-wrap">
          <table className="txops-table">
            <caption className="sr-only">Resource locks for this transaction</caption>
            <thead>
              <tr>
                <th scope="col">Resource</th>
                <th scope="col">Item</th>
                <th scope="col">Qty</th>
                <th scope="col">Status</th>
                <th scope="col">Acquired</th>
                <th scope="col">Expires</th>
              </tr>
            </thead>
            <tbody>
              {details.locks.map(lock => {
                const isUnresolved = unresolved.has(lock.id);
                return (
                  <tr key={lock.id} className={isUnresolved ? 'is-failure' : undefined}>
                    <td><span className="txops-cap">{lock.resourceType}</span> <Mono>{lock.resourceId}</Mono></td>
                    <td><Mono title={lock.itemId}>{shortId(lock.itemId)}</Mono></td>
                    <td>{lock.quantity}</td>
                    <td>
                      {isUnresolved
                        ? <StatusBadge status="CONFIRMED" tone="warn" label="Confirmed — unresolved" />
                        : <StatusBadge status={lock.status} />}
                    </td>
                    <td>{formatTime(lock.createdAt)}</td>
                    <td>
                      <span title={lock.expiresAt}>{formatTime(lock.expiresAt)}</span>
                      {lock.status === 'CONFIRMED' && <span className="txops-muted"> (expiry not applied to confirmed locks)</span>}
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

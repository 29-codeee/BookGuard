import React from 'react';
import { eventName, itemLabelMap, type TransactionDetails } from '../../services/transactionModel';
import { Empty, Mono, Section, formatTime } from './ui';

/** Raw, chronological event log exactly as persisted — the ground truth behind the timeline. */
export const EventLog: React.FC<{ details: TransactionDetails }> = ({ details }) => {
  const labels = itemLabelMap(details);
  return (
    <Section id="txops-events" kind="fact" title="Event log" subtitle={`${details.events.length} persisted events, oldest first.`}>
      {details.events.length === 0 ? (
        <Empty>No events recorded.</Empty>
      ) : (
        <details className="txops-details">
          <summary>Show all events</summary>
          <div className="txops-table-wrap">
            <table className="txops-table txops-table-dense">
              <caption className="sr-only">All persisted transaction events</caption>
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Event</th>
                  <th scope="col">Transition</th>
                  <th scope="col">Scope</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {details.events.map(e => (
                  <tr key={e.id}>
                    <td className="txops-nowrap">{formatTime(e.createdAt)}</td>
                    <td><Mono>{eventName(e)}</Mono></td>
                    <td className="txops-nowrap">{e.fromState ?? '∅'} → {e.toState}</td>
                    <td>{e.itemId ? labels.get(e.itemId) ?? e.itemId : 'transaction'}</td>
                    <td className="txops-detail-cell"><Mono>{JSON.stringify(e.detail)}</Mono></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </Section>
  );
};

import React from 'react';
import { TripState, formatDate, formatInr } from './chatTypes';

const TIER_LABEL = { budget: 'Budget', medium: 'Mid-range', luxury: 'Luxury' } as const;

export function TripPlanPanel({ trip, onReset, busy }: { trip: TripState | null; onReset: () => void; busy: boolean }) {
  const t = trip;
  const dash = <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>Not set</span>;
  const est = t?.estimate;

  return (
    <aside className="glass-panel planner-side" aria-label="Current trip plan">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: '1.05rem' }}>Current Trip Plan</h3>
        <span className="status-pill">{t?.status === 'PLANNED' ? 'Planned' : 'Collecting details'}</span>
      </div>

      <dl className="trip-rows">
        <dt>Destination</dt><dd>{t?.destination?.name ?? dash}</dd>
        <dt>From</dt><dd>{t?.origin?.name ?? dash}</dd>
        <dt>Dates</dt><dd>{t?.startDate ? formatDate(t.startDate) : dash}</dd>
        <dt>Duration</dt><dd>{t?.durationDays ? `${t.durationDays} Day${t.durationDays > 1 ? 's' : ''}` : dash}</dd>
        <dt>Travellers</dt><dd>{t?.travellers ?? dash}</dd>
        <dt>Budget</dt><dd>{t?.budget ? `${TIER_LABEL[t.budget.tier]}${t.budget.amountInr ? ` (${formatInr(t.budget.amountInr)})` : ''}` : t?.status === 'PLANNED' ? 'Mid-range (default)' : dash}</dd>
        <dt>Transport</dt>
        <dd>{t?.transport ? <span title={t.transport.operator}>Selected · {t.transport.mode}</span> : dash}</dd>
        <dt>Stay</dt>
        <dd>{t?.hotel ? <span title={t.hotel.name}>Selected</span> : dash}</dd>
        <dt>Places</dt><dd>{t?.places.length ?? 0}</dd>
      </dl>

      {t?.hotel && <div className="opt-meta">🏨 {t.hotel.name}</div>}
      {t?.transport && <div className="opt-meta">🧭 {t.transport.operator} ({t.transport.code})</div>}

      <div className="trip-total">
        <span className="opt-meta">Estimated cost</span>
        <strong>{est ? formatInr(est.total) : '—'}</strong>
      </div>
      {est && (
        <div className="opt-meta" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 2 }}>
          <span>Transport (round trip)</span><span>{formatInr(est.transport)}</span>
          <span>Stay</span><span>{formatInr(est.stay)}</span>
          <span>Local & sightseeing</span><span>{formatInr(est.localAndSightseeing)}</span>
          <span>Per person</span><span>{formatInr(est.perPerson)}</span>
          {est.withinBudget === false && <span style={{ gridColumn: '1 / -1', color: '#fbbf24' }}>Above your budget</span>}
        </div>
      )}

      {t && t.bookingRequests.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="card-group-title">Booking requests</div>
          {t.bookingRequests.map(b => (
            <div key={b.requestId} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: '0.8rem' }}>
              <span style={{ overflowWrap: 'anywhere' }}>{b.type === 'hotel_booking' ? '🏨' : '🧭'} {b.itemName}</span>
              <span className={`status-pill ${b.status}`}>{b.status}</span>
            </div>
          ))}
        </div>
      )}

      <button className="btn btn-outline" style={{ padding: '8px 14px', fontSize: '0.85rem' }} onClick={onReset} disabled={busy}>
        Start a new trip
      </button>
      <p className="demo-note">
        Demo suggestions: prices and availability come from BookGuard sample data. "Book" creates a demo booking request for the booking modules; no real payment is taken.
      </p>
    </aside>
  );
}

import React, { useEffect, useState } from 'react';
import type { PlannerAction, PlannerTarget } from '../../services/chatApi';
import { TripState, formatDate, formatInr } from './chatTypes';

type HistoricalFareSummary = { observations: number; average_price_inr: number; min_price_inr: number; max_price_inr: number; first_travel_date: string; last_travel_date: string; source: string };

const TIER_LABEL = { budget: 'Budget', medium: 'Mid-range', luxury: 'Luxury' } as const;

export function TripPlanPanel({
  trip,
  onReset,
  busy,
  onAction
}: {
  trip: TripState | null;
  onReset: () => void;
  busy: boolean;
  onAction?: (action: PlannerAction, target: PlannerTarget, itemId?: string, mode?: string) => void;
}) {
  const t = trip;
  const [historicalFare, setHistoricalFare] = useState<HistoricalFareSummary | null>(null);
  useEffect(() => {
    const origin = t?.origin?.code;
    const destination = t?.destination?.code;
    if (!origin || !destination) { setHistoricalFare(null); return; }
    const controller = new AbortController();
    fetch(`${import.meta.env.VITE_API_URL || ''}/api/analytics/historical-fares?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(data => setHistoricalFare(data?.items?.[0] ?? null))
      .catch(() => {});
    return () => controller.abort();
  }, [t?.origin?.code, t?.destination?.code]);
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
        <dt>Priority</dt>
        <dd>
          {t?.bookingPriority ? (
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <span style={{ color: '#38bdf8', fontWeight: 600 }}>{t.bookingPriority.toUpperCase()} first</span>
              {onAction && (
                <button
                  type="button"
                  className="panel-change-btn"
                  disabled={busy}
                  onClick={() => onAction('change', 'priority')}
                  title="Change booking priority"
                >
                  Change
                </button>
              )}
            </span>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <span style={{ color: '#fbbf24' }}>Not set</span>
              {onAction && (
                <button
                  type="button"
                  className="panel-change-btn"
                  disabled={busy}
                  onClick={() => onAction('change', 'priority')}
                  title="Set booking priority"
                >
                  Set
                </button>
              )}
            </span>
          )}
        </dd>
        <dt>Transport</dt>
        <dd>
          {t?.transport ? (
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <span title={t.transport.operator}>Selected · {t.transport.mode}</span>
              {onAction && (
                <button
                  type="button"
                  className="panel-change-btn"
                  disabled={busy}
                  onClick={() => onAction('change', 'transport')}
                  title="Change transport leg"
                >
                  Change
                </button>
              )}
            </span>
          ) : dash}
        </dd>
        <dt>Stay</dt>
        <dd>
          {t?.hotel ? (
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <span title={t.hotel.name}>Selected</span>
              {onAction && (
                <button
                  type="button"
                  className="panel-change-btn"
                  disabled={busy}
                  onClick={() => onAction('change', 'hotel')}
                  title="Change hotel stay"
                >
                  Change
                </button>
              )}
            </span>
          ) : dash}
        </dd>
        <dt>Places</dt>
        <dd>
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            <span>{t?.places.length ?? 0}</span>
            {onAction && (t?.places.length ?? 0) > 0 && (
              <button
                type="button"
                className="panel-change-btn"
                disabled={busy}
                onClick={() => onAction('change', 'place')}
                title="Change places to visit"
              >
                Change
              </button>
            )}
          </span>
        </dd>
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

      {historicalFare && (
        <div className="opt-meta" style={{ borderTop: '1px solid var(--border-color, rgba(255,255,255,.12))', paddingTop: 10 }}>
          <strong>Historical fare reference</strong>
          <div>{formatInr(historicalFare.min_price_inr)}–{formatInr(historicalFare.max_price_inr)} · average {formatInr(historicalFare.average_price_inr)}</div>
          <div>{historicalFare.observations} observations · 14–28 Feb 2022</div>
          <div>Archived Kaggle fares; not current prices or availability.</div>
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

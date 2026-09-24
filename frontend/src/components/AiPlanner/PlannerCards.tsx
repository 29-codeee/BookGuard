import React from 'react';
import type { PlannerAction, PlannerTarget } from '../../services/chatApi';
import {
  BookingRequestRecord,
  DayPlan,
  HotelOption,
  PlaceOption,
  TransportOption,
  TripState,
  formatInr
} from './chatTypes';

type OnAction = (action: PlannerAction, target: PlannerTarget, itemId?: string) => void;

const MODE_ICON: Record<TransportOption['mode'], string> = { flight: '✈️', train: '🚆', bus: '🚌' };

function SourceTag({ source }: { source: 'inventory' | 'demo' }) {
  return source === 'inventory'
    ? <span className="tag live" title="Bookable through BookGuard inventory">Live inventory</span>
    : <span className="tag demo" title="Demo suggestion; booking is queued for the partner module">Demo</span>;
}

export function ItineraryCard({ itinerary, title }: { itinerary: DayPlan[]; title: string }) {
  return (
    <div className="itinerary">
      <div className="card-group-title">{title}</div>
      {itinerary.map(day => (
        <div key={day.day} className="itinerary-day">
          <h4>Day {day.day}: {day.title}</h4>
          <ul>
            {day.activities.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function HotelCards({ hotels, trip, busy, onAction }: { hotels: HotelOption[]; trip: TripState; busy: boolean; onAction: OnAction }) {
  return (
    <div>
      <div className="card-group-title" style={{ marginBottom: 6 }}>Stays</div>
      <div className="card-row">
        {hotels.map(h => {
          const selected = trip.hotel?.id === h.id;
          return (
            <div key={h.id} className={`opt-card${selected ? ' selected' : ''}`}>
              <div className="opt-title">{h.name}</div>
              <div className="opt-meta">{h.area} · ★ {h.rating.toFixed(1)} · {h.tier}</div>
              <div className="opt-price">{formatInr(h.pricePerNight)}<span className="opt-meta"> / night</span></div>
              <div className="opt-tags"><SourceTag source={h.source} /></div>
              <div className="opt-actions">
                {selected ? (
                  <>
                    <button className="btn-sm primary" disabled={busy} onClick={() => onAction('book', 'hotel', h.id)}>Book</button>
                    <button className="btn-sm" disabled={busy} onClick={() => onAction('change', 'hotel')}>Change</button>
                    <button className="btn-sm danger" disabled={busy} onClick={() => onAction('remove', 'hotel')}>Remove</button>
                  </>
                ) : (
                  <>
                    <button className="btn-sm" disabled={busy} onClick={() => onAction('select', 'hotel', h.id)}>Select</button>
                    <button className="btn-sm primary" disabled={busy} onClick={() => onAction('book', 'hotel', h.id)}>Book</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TransportCards({ options, trip, busy, onAction }: { options: TransportOption[]; trip: TripState; busy: boolean; onAction: OnAction }) {
  return (
    <div>
      <div className="card-group-title" style={{ marginBottom: 6 }}>Getting there</div>
      <div className="card-row">
        {options.map(o => {
          const selected = trip.transport?.id === o.id;
          return (
            <div key={o.id} className={`opt-card${selected ? ' selected' : ''}`}>
              <div className="opt-title">{MODE_ICON[o.mode]} {o.operator}</div>
              <div className="opt-meta">{o.code} · {o.departure} → {o.arrival}{o.seatsAvailable != null ? ` · ${o.seatsAvailable} left` : ''}</div>
              <div className="opt-price">{formatInr(o.pricePerPerson)}<span className="opt-meta"> / person</span></div>
              <div className="opt-tags"><span className="tag">{o.mode}</span><SourceTag source={o.source} /></div>
              <div className="opt-actions">
                {selected ? (
                  <>
                    <button className="btn-sm primary" disabled={busy} onClick={() => onAction('book', 'transport', o.id)}>Book</button>
                    <button className="btn-sm" disabled={busy} onClick={() => onAction('change', 'transport')}>Change</button>
                    <button className="btn-sm danger" disabled={busy} onClick={() => onAction('remove', 'transport')}>Remove</button>
                  </>
                ) : (
                  <>
                    <button className="btn-sm" disabled={busy} onClick={() => onAction('select', 'transport', o.id)}>Select</button>
                    <button className="btn-sm primary" disabled={busy} onClick={() => onAction('book', 'transport', o.id)}>Book</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PlaceCards({ places, trip, busy, onAction }: { places: PlaceOption[]; trip: TripState; busy: boolean; onAction: OnAction }) {
  return (
    <div>
      <div className="card-group-title" style={{ marginBottom: 6 }}>Places to visit</div>
      <div className="card-row">
        {places.map(p => {
          const inPlan = trip.places.some(x => x.id === p.id);
          return (
            <div key={p.id} className={`opt-card${inPlan ? ' selected' : ''}`}>
              <div className="opt-title">{p.name}</div>
              <div className="opt-meta">{p.area} · ~{p.durationHrs}h · {p.entryFeeInr ? formatInr(p.entryFeeInr) : 'Free'}</div>
              <div className="opt-meta">{p.description}</div>
              <div className="opt-tags">{p.tags.map(t => <span key={t} className="tag">{t}</span>)}</div>
              <div className="opt-actions">
                {inPlan
                  ? <button className="btn-sm danger" disabled={busy} onClick={() => onAction('remove', 'place', p.id)}>Remove</button>
                  : <button className="btn-sm" disabled={busy} onClick={() => onAction('select', 'place', p.id)}>Add to plan</button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function BookingRequestCard({ record }: { record: BookingRequestRecord }) {
  return (
    <div className="booking-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <strong>Demo booking request · {record.type === 'hotel_booking' ? 'Hotel' : 'Transport'}</strong>
        <span className={`status-pill ${record.status}`}>{record.status}</span>
      </div>
      {record.message && <div className="opt-meta">{record.message}</div>}
      <div className="opt-meta">
        Sent to: <strong>{record.module ?? 'booking module'}</strong>
        {record.bookingId ? <> · booking <code>{record.bookingId}</code></> : null}
      </div>
      <details>
        <summary className="opt-meta" style={{ cursor: 'pointer' }}>Request payload (JSON)</summary>
        <pre>{JSON.stringify(record.request, null, 2)}</pre>
      </details>
      {record.next && <div className="opt-meta">Next: {record.next.note} ({record.next.method} {record.next.endpoint})</div>}
    </div>
  );
}

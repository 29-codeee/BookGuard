import React, { useEffect, useRef, useState } from 'react';
import type { PlannerAction, PlannerTarget } from '../../services/chatApi';
import { confirmBooking, getBookingStatus, releaseHold } from '../../services/api';
import {
  BookingRequestRecord,
  DayPlan,
  HotelOption,
  PlaceOption,
  TransportOption,
  TripState,
  formatInr
} from './chatTypes';

type OnAction = (action: PlannerAction, target: PlannerTarget, itemId?: string, mode?: string) => void;

const MODE_ICON: Record<TransportOption['mode'], string> = { flight: '✈️', train: '🚆', bus: '🚌' };

function SourceTag({ source }: { source: 'inventory' | 'demo' }) {
  return source === 'inventory'
    ? <span className="tag live" title="Bookable through BookGuard inventory">Live inventory</span>
    : <span className="tag demo" title="Demo suggestion; booking is queued for the partner module">Demo</span>;
}

export function BookingPriorityCard({ trip, busy, onAction }: { trip: TripState; busy: boolean; onAction: OnAction }) {
  const priorities: Array<{ mode: 'flight' | 'hotel' | 'train' | 'bus'; label: string; icon: string; desc: string }> = [
    { mode: 'flight', label: 'Flight First', icon: '✈️', desc: 'Lock airline seats before reserving hotel' },
    { mode: 'hotel', label: 'Hotel First', icon: '🏨', desc: 'Lock hotel inventory before booking travel legs' },
    { mode: 'train', label: 'Train First', icon: '🚆', desc: 'Confirm train berths before booking stays' },
    { mode: 'bus', label: 'Bus First', icon: '🚌', desc: 'Lock intercity bus seats before booking stays' },
  ];

  const currentPriority = trip.bookingPriority;

  return (
    <div className="priority-card">
      <div className="priority-head">
        <div>
          <div className="priority-title">⚡ Multi-Provider Booking Priority</div>
          <div className="priority-subtitle">Which component should BookGuard's distributed Saga book and lock first?</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {currentPriority ? (
            <>
              <span className="priority-badge active">✓ {currentPriority.toUpperCase()} FIRST</span>
              <button
                type="button"
                className="btn-priority-change"
                disabled={busy}
                onClick={() => onAction('change', 'priority')}
                title="Change priority"
              >
                Change
              </button>
            </>
          ) : (
            <span className="priority-badge unselected">⚠️ Priority Not Selected</span>
          )}
        </div>
      </div>

      <div className="priority-grid">
        {priorities.map(p => {
          const isSelected = currentPriority === p.mode;
          return (
            <button
              key={p.mode}
              type="button"
              className={`priority-btn${isSelected ? ' selected' : ''}`}
              disabled={busy}
              onClick={() => onAction('select', 'priority', p.mode, p.mode)}
              title={`Set ${p.label} as primary Saga execution priority`}
            >
              <div className="priority-btn-top">
                <span className="priority-icon">{p.icon}</span>
                <span className="priority-label">{p.label}</span>
                {isSelected && <span className="priority-check">✓ Active</span>}
              </div>
              <div className="priority-desc">{p.desc}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
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
      <div className="card-group-title" style={{ marginBottom: 6 }}>Stays (Hotels)</div>
      <div className="card-row">
        {hotels.map(h => {
          const selected = trip.hotel?.id === h.id;
          return (
            <div key={h.id} className={`opt-card${selected ? ' selected' : ''}`}>
              <div className="opt-title">{h.name}</div>
              <div className="opt-meta">{h.area} · ★ {h.rating.toFixed(1)} · {h.tier}</div>
              <div className="opt-price">{formatInr(h.pricePerNight)}<span className="opt-meta"> / night</span></div>
              <div className="opt-tags">
                <SourceTag source={h.source} />
                {selected && <span className="tag live">✓ In Package</span>}
              </div>
              <div className="opt-actions">
                {selected ? (
                  <>
                    <button className="btn-sm primary" disabled={busy} onClick={() => onAction('book', 'hotel', h.id)}>Book</button>
                    <button className="btn-sm" disabled={busy} onClick={() => onAction('change', 'hotel')}>Change</button>
                    <button className="btn-sm danger" disabled={busy} onClick={() => onAction('remove', 'hotel')}>Remove</button>
                  </>
                ) : (
                  <>
                    <button className="btn-sm" disabled={busy} onClick={() => onAction('select', 'hotel', h.id)}>Select for Package</button>
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
  const [filterMode, setFilterMode] = useState<'all' | 'flight' | 'train' | 'bus'>('all');

  const filtered = filterMode === 'all' ? options : options.filter(o => o.mode === filterMode);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
        <div className="card-group-title">Getting there (Flights, Trains & Buses)</div>
        <div className="mode-filter-tabs">
          <button
            type="button"
            className={`mode-tab${filterMode === 'all' ? ' active' : ''}`}
            onClick={() => setFilterMode('all')}
          >
            All ({options.length})
          </button>
          <button
            type="button"
            className={`mode-tab${filterMode === 'flight' ? ' active' : ''}`}
            onClick={() => setFilterMode('flight')}
          >
            ✈️ Flights ({options.filter(o => o.mode === 'flight').length})
          </button>
          <button
            type="button"
            className={`mode-tab${filterMode === 'train' ? ' active' : ''}`}
            onClick={() => setFilterMode('train')}
          >
            🚆 Trains ({options.filter(o => o.mode === 'train').length})
          </button>
          <button
            type="button"
            className={`mode-tab${filterMode === 'bus' ? ' active' : ''}`}
            onClick={() => setFilterMode('bus')}
          >
            🚌 Buses ({options.filter(o => o.mode === 'bus').length})
          </button>
        </div>
      </div>

      <div className="card-row">
        {filtered.map(o => {
          const selected = trip.transport?.id === o.id;
          return (
            <div key={o.id} className={`opt-card${selected ? ' selected' : ''}`}>
              <div className="opt-title">{MODE_ICON[o.mode]} {o.operator}</div>
              <div className="opt-meta">{o.code} · {o.departure} → {o.arrival}{o.seatsAvailable != null ? ` · ${o.seatsAvailable} left` : ''}</div>
              <div className="opt-price">{formatInr(o.pricePerPerson)}<span className="opt-meta"> / person</span></div>
              <div className="opt-tags">
                <span className="tag">{o.mode}</span>
                <SourceTag source={o.source} />
                {selected && <span className="tag live">✓ In Package</span>}
              </div>
              <div className="opt-actions">
                {selected ? (
                  <>
                    <button className="btn-sm primary" disabled={busy} onClick={() => onAction('book', 'transport', o.id)}>Book</button>
                    <button className="btn-sm" disabled={busy} onClick={() => onAction('change', 'transport')}>Change</button>
                    <button className="btn-sm danger" disabled={busy} onClick={() => onAction('remove', 'transport')}>Remove</button>
                  </>
                ) : (
                  <>
                    <button className="btn-sm" disabled={busy} onClick={() => onAction('select', 'transport', o.id)}>Select for Package</button>
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
      <div className="card-group-title" style={{ marginBottom: 6 }}>Places to visit & Activities</div>
      <div className="card-row">
        {places.map(p => {
          const inPlan = trip.places.some(x => x.id === p.id);
          return (
            <div key={p.id} className={`opt-card${inPlan ? ' selected' : ''}`}>
              <div className="opt-title">{p.name}</div>
              <div className="opt-meta">{p.area} · ~{p.durationHrs}h · {p.entryFeeInr ? formatInr(p.entryFeeInr) : 'Free'}</div>
              <div className="opt-meta">{p.description}</div>
              <div className="opt-tags">
                {p.tags.map(t => <span key={t} className="tag">{t}</span>)}
                {inPlan && <span className="tag live">✓ In Package</span>}
              </div>
              <div className="opt-actions">
                {inPlan
                  ? <button className="btn-sm danger" disabled={busy} onClick={() => onAction('remove', 'place', p.id)}>Remove from package</button>
                  : <button className="btn-sm" disabled={busy} onClick={() => onAction('select', 'place', p.id)}>Add to package</button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PackageSummaryCard({ trip, busy, onAction }: { trip: TripState; busy: boolean; onAction: OnAction }) {
  const est = trip.estimate;
  const numTravellers = trip.travellers ?? 1;
  const numDays = trip.durationDays ?? 3;
  const destName = trip.destination?.name ?? 'Trip';

  const transportCost = trip.transport ? trip.transport.pricePerPerson * numTravellers * 2 : 0;
  const hotelCost = trip.hotel ? trip.hotel.pricePerNight * Math.max(1, numDays - 1) : 0;
  const sightseeingCost = trip.places.reduce((acc, p) => acc + (p.entryFeeInr || 0) * numTravellers, 0);

  return (
    <div className="package-card" id="curated-travel-package">
      <div className="package-head">
        <div>
          <span className="package-pill">📦 Curated Travel Package</span>
          <h3 className="package-title">{destName} Custom Package</h3>
          <p className="package-sub">Bundled all-in-one reservation with unified transaction protection</p>
        </div>
        <div className="package-priority-tag">
          <span>Saga Priority Order</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <strong>{trip.bookingPriority ? `${trip.bookingPriority.toUpperCase()} FIRST` : 'Default Order'}</strong>
            <button
              type="button"
              className="btn-priority-change"
              disabled={busy}
              onClick={() => onAction('change', 'priority')}
              title="Change booking priority order"
            >
              Change
            </button>
          </div>
        </div>
      </div>

      <div className="package-components">
        {/* Transport Component */}
        <div className={`package-comp-row ${trip.transport ? 'included' : 'missing'}`}>
          <div className="comp-icon">{trip.transport ? MODE_ICON[trip.transport.mode] : '🧭'}</div>
          <div className="comp-info">
            <div className="comp-name">
              {trip.transport
                ? `${trip.transport.operator} (${trip.transport.mode.toUpperCase()})`
                : 'Transport Leg (Flight, Train or Bus)'}
            </div>
            <div className="comp-detail">
              {trip.transport
                ? `${trip.transport.code} · ${trip.origin?.name ?? 'Origin'} ⇄ ${destName} · Round-trip for ${numTravellers} pax`
                : 'Choose a flight, train, or bus option to bundle into package'}
            </div>
          </div>
          <div className="comp-price">
            {trip.transport ? formatInr(transportCost) : 'Pending selection'}
          </div>
          <div className="comp-actions">
            {trip.transport ? (
              <button
                type="button"
                className="btn-change-opt"
                disabled={busy}
                onClick={() => onAction('change', 'transport')}
                title="Change transport option"
              >
                Change
              </button>
            ) : (
              <button
                type="button"
                className="btn-change-opt primary"
                disabled={busy}
                onClick={() => onAction('show', 'transport')}
                title="Select transport for package"
              >
                + Select
              </button>
            )}
          </div>
        </div>

        {/* Hotel Component */}
        <div className={`package-comp-row ${trip.hotel ? 'included' : 'missing'}`}>
          <div className="comp-icon">🏨</div>
          <div className="comp-info">
            <div className="comp-name">
              {trip.hotel ? trip.hotel.name : 'Accommodation (Stay / Hotel)'}
            </div>
            <div className="comp-detail">
              {trip.hotel
                ? `${trip.hotel.area} · ${trip.hotel.tier.toUpperCase()} · ${Math.max(1, numDays - 1)} night(s)`
                : 'Choose a hotel to bundle into package'}
            </div>
          </div>
          <div className="comp-price">
            {trip.hotel ? formatInr(hotelCost) : 'Pending selection'}
          </div>
          <div className="comp-actions">
            {trip.hotel ? (
              <button
                type="button"
                className="btn-change-opt"
                disabled={busy}
                onClick={() => onAction('change', 'hotel')}
                title="Change stay / hotel"
              >
                Change
              </button>
            ) : (
              <button
                type="button"
                className="btn-change-opt primary"
                disabled={busy}
                onClick={() => onAction('show', 'hotel')}
                title="Select hotel for package"
              >
                + Select
              </button>
            )}
          </div>
        </div>

        {/* Places to Visit Component */}
        <div className={`package-comp-row ${trip.places.length > 0 ? 'included' : 'missing'}`}>
          <div className="comp-icon">📍</div>
          <div className="comp-info">
            <div className="comp-name">
              {trip.places.length > 0
                ? `${trip.places.length} Sightseeing Places & Attractions`
                : 'Places to Visit & Activities'}
            </div>
            <div className="comp-detail">
              {trip.places.length > 0
                ? trip.places.map(p => p.name).join(' · ')
                : 'Select places to visit from recommendations above'}
            </div>
          </div>
          <div className="comp-price">
            {trip.places.length > 0 ? (sightseeingCost > 0 ? formatInr(sightseeingCost) : 'Free entry') : 'Optional'}
          </div>
          <div className="comp-actions">
            <button
              type="button"
              className="btn-change-opt"
              disabled={busy}
              onClick={() => onAction('change', 'place')}
              title="Change sightseeing itinerary"
            >
              Change
            </button>
          </div>
        </div>
      </div>

      {/* Package Total Amount Bar */}
      <div className="package-total-bar">
        <div className="package-total-meta">
          <div className="package-total-label">TOTAL PACKAGE ESTIMATION</div>
          <div className="package-total-sub">
            All inclusive for {numTravellers} traveller{numTravellers > 1 ? 's' : ''} ({numDays} days) · Transport + Stay + Sightseeing
          </div>
        </div>
        <div className="package-total-amount">
          {est ? formatInr(est.total) : '—'}
        </div>
      </div>

      <div className="package-actions">
        <button
          type="button"
          className="btn-package-book"
          disabled={busy || (!trip.hotel && !trip.transport)}
          onClick={() => onAction('book', 'package')}
        >
          {trip.bookingPriority
            ? `⚡ Reserve Package (Priority: ${trip.bookingPriority.toUpperCase()} first)`
            : '⚡ Reserve Complete Package'}
        </button>
      </div>
    </div>
  );
}

export function BookingRequestCard({ record }: { record: BookingRequestRecord }) {
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [method, setMethod] = useState<'WALLET' | 'UPI' | 'CARD'>('UPI');
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState('');
  const expiryChecked = useRef(false);
  const bookingId = record.bookingId;
  const expiresAt = record.booking?.hold?.expiresAt;
  useEffect(() => {
    if (record.status !== 'HELD' || !bookingId || !expiresAt) return;
    expiryChecked.current = false;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setSecondsRemaining(remaining);
      if (remaining === 0 && !expiryChecked.current) {
        expiryChecked.current = true;
        getBookingStatus(bookingId).then(s => {
          if (s.status === 'EXPIRED' || s.status === 'RELEASED') setPaymentMessage('Payment session expired. The backend released the hold.');
          else if (s.status === 'CONFIRMED') setPaymentMessage('Booking confirmed.');
          else setPaymentMessage('The backend is still checking this hold. Refresh booking status before retrying.');
        }).catch(() => setPaymentMessage('Could not verify the hold status. Reconnect before retrying.'));
      }
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [record.status, bookingId, expiresAt]);

  const pay = async () => {
    if (!bookingId) return;
    setPaymentBusy(true); setPaymentMessage('');
    try {
      const { data: body } = await confirmBooking(bookingId, 'BookGuard traveller', `planner-pay-${bookingId}`, 'en', undefined, { method, demo: true });
      if (body.status === 'CONFIRMED') setPaymentMessage('Demo payment successful. Booking confirmed by the backend.');
      else if (body.status === 'RECONCILING') setPaymentMessage('The booking is still being verified. Your inventory remains held while the backend reconciles.');
      else setPaymentMessage(body.message || 'Payment or booking failed. The backend released the hold when appropriate.');
    } catch { setPaymentMessage('Could not reach the booking backend. Check booking status before retrying.'); }
    finally { setPaymentBusy(false); }
  };

  const failPayment = async () => {
    if (!bookingId) return;
    setPaymentBusy(true);
    try {
      const body = await releaseHold(bookingId, 'Demo payment failed; release inventory hold');
      setPaymentMessage(body.success ? 'Demo payment failed. The backend released the hold.' : body.message || 'Could not release this hold. Check booking status.');
    } catch { setPaymentMessage('Could not reach the backend to release the hold. Check booking status.'); }
    finally { setPaymentBusy(false); }
  };

  const request = record.request as Record<string, any>;
  const paymentActive = record.status === 'HELD' && record.booking?.status === 'HELD' && !!expiresAt;
  const timer = `${String(Math.floor(secondsRemaining / 60)).padStart(2, '0')}:${String(secondsRemaining % 60).padStart(2, '0')}`;
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
      {paymentActive && <div style={{ marginTop: 12, padding: 14, borderRadius: 12, border: '1px solid rgba(56,189,248,.25)', background: 'rgba(14,165,233,.08)' }}>
        <strong>Trip payment summary</strong>
        <div className="opt-meta" style={{ marginTop: 6 }}>{request.destination || request.to || request.from || 'Selected travel item'} · {request.checkIn ? `${request.checkIn} – ${request.checkOut}` : request.date || ''} · {request.travellers} traveller(s) · {formatInr(Number(request.estimatedTotal || 0))}</div>
        <div style={{ marginTop: 8, color: secondsRemaining <= 10 ? '#F87171' : '#FBBF24', fontWeight: 800 }}>Complete payment within {timer}</div>
        <div className="opt-meta">Inventory is held by the backend until its database-clock expiry. Demo payment only; no money is processed.</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <label>Method <select value={method} onChange={e => setMethod(e.target.value as typeof method)}><option value="WALLET">Wallet</option><option value="UPI">UPI</option><option value="CARD">Card</option></select></label>
          <button className="btn-sm" disabled={paymentBusy || secondsRemaining <= 0} onClick={() => void pay()}>{paymentBusy ? 'Processing…' : 'Pay & confirm'}</button>
          <button className="btn-sm danger" disabled={paymentBusy || secondsRemaining <= 0} onClick={() => void failPayment()}>Simulate failure</button>
        </div>
        {paymentMessage && <div role="status" className="opt-meta" style={{ marginTop: 8 }}>{paymentMessage}</div>}
      </div>}
      <details>
        <summary className="opt-meta" style={{ cursor: 'pointer' }}>Request payload (JSON)</summary>
        <pre>{JSON.stringify(record.request, null, 2)}</pre>
      </details>
      {record.next && <div className="opt-meta">Next: {record.next.note} ({record.next.method} {record.next.endpoint})</div>}
    </div>
  );
}

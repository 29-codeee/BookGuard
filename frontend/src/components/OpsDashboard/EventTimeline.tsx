import React from 'react';
import { History, ArrowRight, ShieldCheck } from 'lucide-react';

export interface BookingEvent {
  id: string;
  booking_id: string;
  from_state: string;
  to_state: string;
  reason: string;
  evidence?: any;
  operator?: string;
  created_at: string;
}

interface EventTimelineProps {
  events: BookingEvent[];
}

export const EventTimeline: React.FC<EventTimelineProps> = ({ events }) => {
  return (
    <div className="glass-panel" style={{ padding: 24 }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <History size={20} color="#60A5FA" />
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#F8FAFC' }}>
            Live Booking Events Audit Log
          </h3>
        </div>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          (PostgreSQL <code>booking_events</code> table · Append-only)
        </span>
      </div>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        maxHeight: 420,
        overflowY: 'auto',
        paddingRight: 6
      }}>
        {events.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            No booking events recorded yet. Perform a hold or run a test scenario to view live audit traces.
          </div>
        ) : (
          events.slice(0, 50).map((ev) => (
            <div
              key={ev.id}
              style={{
                background: 'rgba(15, 23, 42, 0.65)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '12px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6
              }}
            >
              {/* Event Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <code style={{ fontSize: '0.75rem', color: '#93C5FD', fontWeight: 700 }}>
                    {ev.booking_id}
                  </code>

                  {/* Transition Badge */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: 'rgba(255,255,255,0.06)',
                      color: '#94A3B8'
                    }}>
                      {ev.from_state}
                    </span>
                    <ArrowRight size={12} color="#64748B" />
                    <span style={{
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: ev.to_state === 'CONFIRMED' ? 'rgba(16, 185, 129, 0.2)' : ev.to_state === 'RECONCILING' ? 'rgba(6, 182, 212, 0.2)' : ev.to_state === 'HELD' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                      color: ev.to_state === 'CONFIRMED' ? '#34D399' : ev.to_state === 'RECONCILING' ? '#22D3EE' : ev.to_state === 'HELD' ? '#FBBF24' : '#F87171'
                    }}>
                      {ev.to_state}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  <span>Op: <strong style={{ color: '#E2E8F0' }}>{ev.operator || 'SYSTEM'}</strong></span>
                  <span>{new Date(ev.created_at).toLocaleTimeString()}</span>
                </div>
              </div>

              {/* Reason */}
              <div style={{ fontSize: '0.82rem', color: '#E2E8F0' }}>
                {ev.reason}
              </div>

              {/* Evidence */}
              {ev.evidence && (
                <div style={{
                  fontSize: '0.7rem',
                  fontFamily: 'monospace',
                  color: '#94A3B8',
                  background: 'rgba(0,0,0,0.25)',
                  padding: '4px 8px',
                  borderRadius: 6,
                  overflowX: 'auto',
                  whiteSpace: 'nowrap'
                }}>
                  Evidence: {typeof ev.evidence === 'string' ? ev.evidence : JSON.stringify(ev.evidence)}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

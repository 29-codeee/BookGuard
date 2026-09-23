import React from 'react';
import { BookingState } from '../../types';

interface BookingItem {
  id: string;
  status: BookingState;
  flight_code?: string;
  total_amount?: number;
  traveller_name?: string;
  created_at?: string;
  updated_at?: string;
}

interface LiveStateBoardProps {
  bookings: BookingItem[];
  onSelectBooking?: (id: string) => void;
  selectedBookingId?: string;
}

const COLUMNS: { state: BookingState; label: string; badgeClass: string; color: string }[] = [
  { state: 'PENDING', label: 'Pending', badgeClass: 'badge-expired', color: '#94A3B8' },
  { state: 'HELD', label: 'Held (TTL)', badgeClass: 'badge-held', color: '#FBBF24' },
  { state: 'RECONCILING', label: 'Reconciling', badgeClass: 'badge-reconciling', color: '#22D3EE' },
  { state: 'CONFIRMED', label: 'Confirmed', badgeClass: 'badge-confirmed', color: '#34D399' },
  { state: 'FAILED', label: 'Failed', badgeClass: 'badge-failed', color: '#F87171' },
  { state: 'EXPIRED', label: 'Expired', badgeClass: 'badge-expired', color: '#94A3B8' },
  { state: 'CANCELLED', label: 'Cancelled', badgeClass: 'badge-expired', color: '#94A3B8' },
];

export const LiveStateBoard: React.FC<LiveStateBoardProps> = ({
  bookings,
  onSelectBooking,
  selectedBookingId
}) => {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#F8FAFC' }}>
            Live State Board
          </h3>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            (Strict 7-state machine · Real-time SSE updates)
          </span>
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 12,
        overflowX: 'auto',
        paddingBottom: 8
      }}>
        {COLUMNS.map((col) => {
          const colBookings = bookings.filter((b) => b.status === col.state);
          return (
            <div
              key={col.state}
              style={{
                background: 'rgba(15, 23, 42, 0.5)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: 12,
                minHeight: 220,
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              {/* Column Header */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingBottom: 8,
                borderBottom: `2px solid ${col.color}`,
                marginBottom: 10
              }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: col.color, textTransform: 'uppercase' }}>
                  {col.label}
                </span>
                <span style={{
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  background: 'rgba(255,255,255,0.06)',
                  padding: '1px 7px',
                  borderRadius: 10,
                  color: '#F8FAFC'
                }}>
                  {colBookings.length}
                </span>
              </div>

              {/* Booking Cards in Column */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, overflowY: 'auto', maxHeight: 300 }}>
                {colBookings.length === 0 ? (
                  <div style={{ fontSize: '0.72rem', color: '#475569', textAlign: 'center', padding: '16px 0' }}>
                    No bookings
                  </div>
                ) : (
                  colBookings.slice(0, 10).map((b) => (
                    <div
                      key={b.id}
                      onClick={() => onSelectBooking?.(b.id)}
                      style={{
                        background: selectedBookingId === b.id ? 'rgba(37, 99, 235, 0.25)' : 'rgba(30, 41, 59, 0.7)',
                        border: `1px solid ${selectedBookingId === b.id ? 'var(--primary)' : 'rgba(255,255,255,0.06)'}`,
                        borderRadius: 8,
                        padding: 10,
                        cursor: 'pointer',
                        transition: 'all 0.15s'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <code style={{ fontSize: '0.75rem', color: '#93C5FD', fontWeight: 600 }}>
                          {b.id.substring(0, 14)}...
                        </code>
                      </div>

                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#E2E8F0', marginBottom: 2 }}>
                        {b.traveller_name || 'Traveller'}
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        <span>{b.flight_code || 'IX 6534'}</span>
                        {b.total_amount && <span>₹{Number(b.total_amount).toLocaleString()}</span>}
                      </div>
                    </div>
                  ))
                )}
                {colBookings.length > 10 && (
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                    +{colBookings.length - 10} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

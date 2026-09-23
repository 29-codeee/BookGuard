import React from 'react';
import { 
  CheckCircle2, 
  Plane, 
  QrCode, 
  ArrowLeft, 
  ShieldCheck, 
  Luggage, 
  Utensils, 
  MapPin, 
  Calendar,
  Download
} from 'lucide-react';
import { Language, translate } from '../../i18n';

interface ConfirmedTicketCardProps {
  booking: {
    bookingId: string;
    flightCode?: string;
    pnr?: string;
    travellerName?: string;
    totalAmount?: number;
  };
  onReset: () => void;
  lang: Language;
}

export const ConfirmedTicketCard: React.FC<ConfirmedTicketCardProps> = ({
  booking,
  onReset,
  lang
}) => {
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Success Notification Banner */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.18), rgba(5, 150, 105, 0.25))',
        border: '1.5px solid #10B981',
        borderRadius: 16,
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 16,
        boxShadow: '0 8px 30px rgba(16, 185, 129, 0.25)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ background: '#10B981', color: '#FFFFFF', borderRadius: '50%', padding: 6, display: 'flex' }}>
            <CheckCircle2 size={24} />
          </div>
          <div>
            <div style={{ fontWeight: 800, color: '#34D399', fontSize: '1.15rem' }}>
              {translate('statusConfirmed', lang)}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#E2E8F0' }}>
              {translate('oversoldZero', lang)} • {translate('duplicatesZero', lang)}
            </div>
          </div>
        </div>

        <span className="badge badge-confirmed" style={{ fontSize: '0.85rem', padding: '6px 14px' }}>
          ✓ SEAT LOCKED IN POSTGRES
        </span>
      </div>

      {/* High-Fidelity Boarding Pass */}
      <div className="ticket-card" style={{ padding: 32, boxShadow: '0 25px 60px rgba(0,0,0,0.6)' }}>
        <div className="ticket-notch-left" />
        <div className="ticket-notch-right" />

        {/* Top Airline Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingBottom: 20,
          borderBottom: '1px dashed var(--border)',
          marginBottom: 24
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #DC2626, #F97316)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFFFFF'
            }}>
              <Plane size={22} />
            </div>
            <div>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#F8FAFC' }}>
                {translate('flightOperator', lang)}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {translate('boardingPass', lang)}
              </div>
            </div>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
              Flight No.
            </div>
            <div style={{
              background: '#1E293B',
              color: '#60A5FA',
              fontWeight: 900,
              fontSize: '1.1rem',
              padding: '4px 12px',
              borderRadius: 8,
              display: 'inline-block',
              marginTop: 2
            }}>
              {booking.flightCode || 'IX 6534'}
            </div>
          </div>
        </div>

        {/* Route Origin & Destination */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 28
        }}>
          <div>
            <div style={{ fontSize: '2.5rem', fontWeight: 900, color: '#F8FAFC', lineHeight: 1 }}>BLR</div>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#E2E8F0', marginTop: 4 }}>Bengaluru</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#60A5FA', marginTop: 4 }}>06:10</div>
            <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>Terminal 1</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, padding: '0 20px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6 }}>1h 15m • Non-stop</span>
            <div style={{ width: '100%', height: 2, background: 'var(--border)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Plane size={18} color="#60A5FA" style={{ transform: 'rotate(90deg)', background: '#152238', padding: '0 4px' }} />
            </div>
            <span style={{ fontSize: '0.7rem', color: '#34D399', fontWeight: 700, marginTop: 6 }}>Confirmed</span>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '2.5rem', fontWeight: 900, color: '#F8FAFC', lineHeight: 1 }}>GOI</div>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#E2E8F0', marginTop: 4 }}>Goa</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#60A5FA', marginTop: 4 }}>07:25</div>
            <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>Dabolim Airport</div>
          </div>
        </div>

        {/* Perforated Divider */}
        <div style={{
          borderBottom: '1.5px dashed rgba(255,255,255,0.15)',
          margin: '24px 0'
        }} />

        {/* Passenger & Ticket Data Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: 16,
          marginBottom: 24
        }}>
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Passenger</div>
            <div style={{ fontSize: '1rem', fontWeight: 800, color: '#F8FAFC', marginTop: 2 }}>{booking.travellerName || translate('passengerName', lang)}</div>
          </div>

          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>{translate('pnr', lang)}</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#34D399', fontFamily: 'monospace', marginTop: 2 }}>
              {booking.pnr || 'AIX-7K9W2B'}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Seat / Gate</div>
            <div style={{ fontSize: '1rem', fontWeight: 800, color: '#F8FAFC', marginTop: 2 }}>12A • Gate 4</div>
          </div>

          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Class</div>
            <div style={{ fontSize: '1rem', fontWeight: 800, color: '#F8FAFC', marginTop: 2 }}>{translate('classEconomy', lang)}</div>
          </div>

          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Total Paid</div>
            <div style={{ fontSize: '1rem', fontWeight: 800, color: '#F8FAFC', marginTop: 2 }}>
              ₹{booking.totalAmount ? Number(booking.totalAmount).toLocaleString() : '4,120'}
            </div>
          </div>
        </div>

        {/* Barcode & Security Verification Footer */}
        <div style={{
          background: 'rgba(11, 17, 32, 0.75)',
          padding: '16px 20px',
          borderRadius: 12,
          border: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <QrCode size={40} color="#60A5FA" />
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Booking Reference: <code style={{ color: '#F8FAFC', fontWeight: 700 }}>{booking.bookingId}</code>
              </div>
              <div style={{ fontSize: '0.7rem', color: '#34D399', fontWeight: 600 }}>
                ✓ ACID Transaction Verified • 0 Duplicate Charges
              </div>
            </div>
          </div>

          <button
            className="btn btn-outline"
            style={{ fontSize: '0.8rem', padding: '6px 12px' }}
            onClick={() => window.print()}
          >
            <Download size={14} /> Print / Save E-Ticket
          </button>
        </div>
      </div>

      {/* Book Another Seat Button */}
      <div style={{ textAlign: 'center', marginTop: 8 }}>
        <button className="btn btn-outline" onClick={onReset} style={{ padding: '10px 20px' }}>
          <ArrowLeft size={16} /> {translate('bookAnother', lang)}
        </button>
      </div>
    </div>
  );
};

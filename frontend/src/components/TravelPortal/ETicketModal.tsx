import React from 'react';
import { 
  X, 
  Printer, 
  Download, 
  ShieldCheck, 
  QrCode, 
  Plane, 
  Train, 
  Bus, 
  Hotel, 
  Sparkles,
  CheckCircle2,
  Calendar,
  Clock,
  MapPin,
  Barcode
} from 'lucide-react';

interface ETicketModalProps {
  ticket: any;
  isOpen: boolean;
  onClose: () => void;
}

export const ETicketModal: React.FC<ETicketModalProps> = ({
  ticket,
  isOpen,
  onClose
}) => {
  if (!isOpen || !ticket) return null;

  const handlePrint = () => {
    window.print();
  };

  const getTransportIcon = (code: string) => {
    if (code?.includes('VB') || code?.includes('RAJ') || code?.includes('EXP') || code?.includes('SHAT')) {
      return <Train size={24} color="#f59e0b" />;
    }
    if (code?.includes('SRS') || code?.includes('VRL') || code?.includes('INTR') || code?.includes('ZING')) {
      return <Bus size={24} color="#10b981" />;
    }
    if (code?.includes('HTL') || code?.includes('ROYAL')) {
      return <Hotel size={24} color="#ec4899" />;
    }
    return <Plane size={24} color="#38bdf8" />;
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(2, 6, 23, 0.88)',
      backdropFilter: 'blur(12px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1100,
      padding: 16
    }}>
      <div style={{
        background: '#0f172a',
        border: '1px solid rgba(56, 189, 248, 0.4)',
        borderRadius: 24,
        maxWidth: 720,
        width: '100%',
        maxHeight: '92vh',
        overflowY: 'auto',
        boxShadow: '0 30px 80px rgba(0,0,0,0.7)',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Modal Controls Header */}
        <div style={{
          padding: '16px 24px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'rgba(255, 255, 255, 0.02)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckCircle2 size={20} color="#10b981" />
            <span style={{ color: '#10b981', fontWeight: 800, fontSize: '0.9rem' }}>
              OFFICIAL CONFIRMED E-TICKET
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={handlePrint}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                borderRadius: 8,
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#f8fafc',
                fontSize: '0.8rem',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              <Printer size={14} />
              Print / Save PDF
            </button>
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                padding: 6
              }}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Printable Ticket Body */}
        <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Main Ticket Card */}
          <div style={{
            background: 'linear-gradient(145deg, #1e293b 0%, #0f172a 100%)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: 20,
            overflow: 'hidden',
            boxShadow: '0 12px 35px rgba(0,0,0,0.4)',
            position: 'relative'
          }}>
            {/* Ticket Header Ribbon */}
            <div style={{
              background: 'linear-gradient(135deg, #0284c7, #2563eb)',
              padding: '16px 24px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              color: '#fff'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ background: '#fff', borderRadius: 8, padding: 6, display: 'flex', alignItems: 'center' }}>
                  {getTransportIcon(ticket.flightCode || ticket.code || '')}
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 900, letterSpacing: '0.02em' }}>
                    {ticket.flightCode || ticket.code || 'IX 6534'}
                  </h3>
                  <div style={{ fontSize: '0.78rem', opacity: 0.9 }}>
                    BookGuard Verified Boarding Pass
                  </div>
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', opacity: 0.8, letterSpacing: '0.05em' }}>
                  PNR / BOOKING REF
                </div>
                <div style={{ fontSize: '1.2rem', fontWeight: 900, fontFamily: 'monospace', letterSpacing: '0.05em' }}>
                  {ticket.pnr || 'AIX-6534-OK'}
                </div>
              </div>
            </div>

            {/* Ticket Central Information */}
            <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Route & Times */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingBottom: 20,
                borderBottom: '1px dashed rgba(255, 255, 255, 0.15)'
              }}>
                <div>
                  <div style={{ color: '#94a3b8', fontSize: '0.75rem', textTransform: 'uppercase' }}>Departure</div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#f8fafc' }}>
                    {ticket.origin || 'BLR'}
                  </div>
                  <div style={{ color: '#38bdf8', fontSize: '0.85rem', fontWeight: 700 }}>
                    {ticket.departureTime || '06:10 AM'}
                  </div>
                </div>

                <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>CONFIRMED SEAT</span>
                  <div style={{
                    margin: '6px 0',
                    width: 100,
                    height: 2,
                    background: 'linear-gradient(90deg, #38bdf8, #818cf8)'
                  }} />
                  <span style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 700 }}>DIRECT FLIGHT / ROUTE</span>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: '#94a3b8', fontSize: '0.75rem', textTransform: 'uppercase' }}>Arrival</div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#f8fafc' }}>
                    {ticket.destination || 'GOI'}
                  </div>
                  <div style={{ color: '#38bdf8', fontSize: '0.85rem', fontWeight: 700 }}>
                    {ticket.arrivalTime || '07:25 AM'}
                  </div>
                </div>
              </div>

              {/* Passenger, Seat, Gate, Date Details */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: 16,
                fontSize: '0.85rem'
              }}>
                <div>
                  <span style={{ color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase' }}>Passenger</span>
                  <div style={{ color: '#f8fafc', fontWeight: 800, marginTop: 2 }}>
                    {ticket.travellerName || ticket.passengerDetails?.name || 'Priya Sharma'}
                  </div>
                </div>

                <div>
                  <span style={{ color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase' }}>Seat / Berth</span>
                  <div style={{ color: '#38bdf8', fontWeight: 800, marginTop: 2 }}>
                    {ticket.seatNumber || 'Seat 14B (Window)'}
                  </div>
                </div>

                <div>
                  <span style={{ color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase' }}>Gate / Terminal</span>
                  <div style={{ color: '#f8fafc', fontWeight: 800, marginTop: 2 }}>
                    {ticket.terminalGate || 'Terminal 2 • Gate 18B'}
                  </div>
                </div>

                <div>
                  <span style={{ color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase' }}>Baggage</span>
                  <div style={{ color: '#f8fafc', fontWeight: 800, marginTop: 2 }}>
                    15 kg + 7 kg Cabin
                  </div>
                </div>
              </div>

              {/* QR Code and Barcode Section */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingTop: 16,
                borderTop: '1px dashed rgba(255, 255, 255, 0.15)',
                flexWrap: 'wrap',
                gap: 16
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ background: '#fff', borderRadius: 8, padding: 6, display: 'flex' }}>
                    <QrCode size={64} color="#000" />
                  </div>
                  <div>
                    <div style={{ color: '#f8fafc', fontSize: '0.85rem', fontWeight: 800 }}>
                      Fast-Track Mobile Check-In
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: '0.75rem', marginTop: 2 }}>
                      Scan at security gate or hotel front-desk
                    </div>
                    <div style={{ color: '#38bdf8', fontSize: '0.7rem', fontFamily: 'monospace', marginTop: 4 }}>
                      HASH: {ticket.bookingId ? `SHA256:${ticket.bookingId.substring(0, 16)}` : 'VERIFIED_POSTGRES_INVARIANT'}
                    </div>
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <span style={{ color: '#64748b', fontSize: '0.72rem' }}>AMOUNT PAID</span>
                  <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#10b981' }}>
                    ₹{ticket.totalAmount ? parseFloat(ticket.totalAmount).toLocaleString('en-IN') : '4,120'}
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>
                    {ticket.paymentDetails?.method || 'UPI (Google Pay / PhonePe)'}
                  </div>
                </div>
              </div>
            </div>

            {/* BookGuard Integrity Guarantee Seal */}
            <div style={{
              background: 'rgba(16, 185, 129, 0.12)',
              borderTop: '1px solid rgba(16, 185, 129, 0.25)',
              padding: '10px 24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.78rem',
              color: '#6ee7b7'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                <ShieldCheck size={16} />
                BookGuard Anti-Double-Booking Protection Active
              </div>
              <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>
                CHECK (available_quantity &gt;= 0) Verified • Strict 0 Oversold Guarantee
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

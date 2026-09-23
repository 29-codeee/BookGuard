import React, { useState, useEffect } from 'react';
import { 
  Clock, 
  ShieldCheck, 
  CheckCircle2, 
  User, 
  Phone, 
  Mail, 
  Plane, 
  Lock, 
  Sparkles,
  Info,
  CreditCard
} from 'lucide-react';
import { Language, translate } from '../../i18n';

interface HoldCountdownCardProps {
  hold: {
    bookingId: string;
    holdId: string;
    expiresAt: string;
    ttlSeconds: number;
    totalAmount: number;
    flightCode?: string;
  };
  onConfirm: () => void;
  isConfirming: boolean;
  lang: Language;
}

export const HoldCountdownCard: React.FC<HoldCountdownCardProps> = ({
  hold,
  onConfirm,
  isConfirming,
  lang
}) => {
  const [secondsRemaining, setSecondsRemaining] = useState<number>(() => {
    const diff = Math.max(0, Math.floor((new Date(hold.expiresAt).getTime() - Date.now()) / 1000));
    return diff || hold.ttlSeconds;
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const diff = Math.max(0, Math.floor((new Date(hold.expiresAt).getTime() - Date.now()) / 1000));
      setSecondsRemaining(diff);
      if (diff <= 0) {
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [hold.expiresAt]);

  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = secondsRemaining % 60;
  const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const isUrgent = secondsRemaining < 60;

  const baseFare = Math.round(hold.totalAmount * 0.9);
  const taxes = hold.totalAmount - baseFare;

  return (
    <div style={{ maxWidth: 840, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      
      {/* 1. URGENT COUNTDOWN LOCK RIBBON */}
      <div style={{
        background: isUrgent ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(185, 28, 28, 0.25))' : 'linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(217, 119, 6, 0.2))',
        border: `2px solid ${isUrgent ? '#EF4444' : '#F59E0B'}`,
        borderRadius: 16,
        padding: '20px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 16,
        boxShadow: isUrgent ? '0 0 30px rgba(239, 68, 68, 0.25)' : '0 0 25px rgba(245, 158, 11, 0.2)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            background: isUrgent ? '#EF4444' : '#F59E0B',
            color: '#FFFFFF',
            borderRadius: 12,
            padding: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Clock size={24} />
          </div>
          <div>
            <div style={{ fontSize: '0.78rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: isUrgent ? '#FCA5A5' : '#FDE68A' }}>
              {translate('seatHeld', lang)}
            </div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#F8FAFC' }}>
              {translate('leftToConfirm', lang)}
            </div>
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div style={{
            fontSize: '3rem',
            fontWeight: 900,
            fontFamily: 'monospace',
            letterSpacing: '0.05em',
            color: isUrgent ? '#EF4444' : '#FBBF24',
            lineHeight: 1
          }}>
            {formattedTime}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#CBD5E1', marginTop: 4 }}>
            Redis TTL Hold: <code style={{ color: '#F8FAFC' }}>hold:{hold.holdId.substring(0, 10)}...</code>
          </div>
        </div>
      </div>

      {/* 2. MAIN CHECKOUT GRID */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20 }}>
        
        {/* Left Column: Flight Summary & Passenger Details */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Flight Summary Card */}
          <div className="glass-panel" style={{ padding: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Plane size={18} color="#60A5FA" />
                <span style={{ fontSize: '0.95rem', fontWeight: 800 }}>{translate('flightDetails', lang)}</span>
              </div>
              <span style={{
                background: '#1E293B',
                color: '#60A5FA',
                fontWeight: 700,
                fontSize: '0.78rem',
                padding: '3px 8px',
                borderRadius: 6
              }}>
                {hold.flightCode || 'IX 6534'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0' }}>
              <div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800 }}>06:10</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>BLR (Bengaluru)</div>
              </div>

              <div style={{ textAlign: 'center', fontSize: '0.72rem', color: '#94A3B8' }}>
                <div>1h 15m</div>
                <div style={{ width: 80, height: 2, background: 'var(--border)', margin: '4px auto' }} />
                <div style={{ color: '#34D399' }}>{translate('directFlight', lang)}</div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '1.3rem', fontWeight: 800 }}>07:25</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>GOI (Goa)</div>
              </div>
            </div>

            <div style={{ fontSize: '0.75rem', color: '#94A3B8', marginTop: 8 }}>
              {translate('dateValue', lang)} • Air India Express • {translate('classEconomy', lang)}
            </div>
          </div>

          {/* Passenger Details Card */}
          <div className="glass-panel" style={{ padding: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <User size={18} color="#60A5FA" />
              <span style={{ fontSize: '0.95rem', fontWeight: 800 }}>{translate('traveller', lang)}</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{
                background: 'rgba(30, 41, 59, 0.6)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Passenger Name:</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#F8FAFC' }}>{translate('passengerName', lang)}</div>
              </div>

              <div style={{
                background: 'rgba(30, 41, 59, 0.6)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{translate('contact', lang)}:</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#F8FAFC' }}>+91 98765 43210</div>
              </div>

              <div style={{
                background: 'rgba(30, 41, 59, 0.6)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{translate('email', lang)}:</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#F8FAFC' }}>priya.sharma@example.com</div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Fare Breakdown & Action */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Fare Summary Card */}
          <div className="glass-panel" style={{ padding: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <CreditCard size={18} color="#60A5FA" />
              <span style={{ fontSize: '0.95rem', fontWeight: 800 }}>{translate('fareSummary', lang)}</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#CBD5E1' }}>
                <span>{translate('baseFare', lang)} (1 Traveller)</span>
                <span>₹{baseFare.toLocaleString()}</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#CBD5E1' }}>
                <span>{translate('taxesFees', lang)}</span>
                <span>₹{taxes.toLocaleString()}</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#34D399', fontSize: '0.8rem' }}>
                <span>Instant Seat Hold Fee</span>
                <span>FREE (₹0)</span>
              </div>

              <div style={{
                borderTop: '1px solid rgba(255,255,255,0.1)',
                paddingTop: 12,
                marginTop: 6,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline'
              }}>
                <span style={{ fontSize: '1rem', fontWeight: 700, color: '#F8FAFC' }}>{translate('totalPayable', lang)}</span>
                <span style={{ fontSize: '1.6rem', fontWeight: 900, color: '#F8FAFC' }}>
                  ₹{hold.totalAmount.toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          {/* BookGuard Idempotency & Safety Reassurance */}
          <div style={{
            background: 'rgba(37, 99, 235, 0.12)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            borderRadius: 12,
            padding: '14px 18px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12
          }}>
            <Lock size={20} color="#60A5FA" style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: '0.78rem', color: '#CBD5E1', lineHeight: 1.5 }}>
              <strong style={{ color: '#93C5FD' }}>{translate('idempotencyProtected', lang)}</strong>
              <div style={{ marginTop: 2 }}>
                Every confirmation carries an atomic idempotency key. Safe against accidental double clicks or flaky mobile connections.
              </div>
            </div>
          </div>

          {/* Confirm Button */}
          <button
            id="btn-confirm-booking"
            className="btn btn-success"
            style={{
              width: '100%',
              padding: '16px',
              fontSize: '1.05rem',
              fontWeight: 800,
              boxShadow: '0 6px 20px rgba(16, 185, 129, 0.35)'
            }}
            onClick={onConfirm}
            disabled={isConfirming || secondsRemaining <= 0}
          >
            {isConfirming ? (
              <>
                <Sparkles size={18} /> {translate('confirmingInProgress', lang)}
              </>
            ) : (
              <>
                <CheckCircle2 size={18} /> {translate('confirmBooking', lang)}
              </>
            )}
          </button>

          <div style={{ textAlign: 'center', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
            {translate('holdExpiresAuto', lang)}
          </div>
        </div>

      </div>
    </div>
  );
};

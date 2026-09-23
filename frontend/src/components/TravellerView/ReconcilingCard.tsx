import React from 'react';
import { Loader2, ShieldCheck, Clock, Radio, Info } from 'lucide-react';
import { Language, translate } from '../../i18n';

interface ReconcilingCardProps {
  bookingId: string;
  lang: Language;
}

export const ReconcilingCard: React.FC<ReconcilingCardProps> = ({
  bookingId,
  lang
}) => {
  return (
    <div className="glass-panel" style={{ padding: 40, maxWidth: 680, margin: '0 auto', textAlign: 'center', background: 'rgba(15, 23, 42, 0.9)' }}>
      {/* Animated Radar Pulse */}
      <div style={{
        position: 'relative',
        width: 90,
        height: 90,
        margin: '0 auto 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          background: 'rgba(6, 182, 212, 0.15)',
          animation: 'pulse 1.8s ease-in-out infinite'
        }} />
        <div style={{
          position: 'absolute',
          width: '70%',
          height: '70%',
          borderRadius: '50%',
          border: '2px solid rgba(6, 182, 212, 0.4)',
          animation: 'spin 4s linear infinite'
        }} />
        <Loader2 size={44} color="#06B6D4" style={{ animation: 'spin 2s linear infinite' }} />
      </div>

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>

      {/* Honest Title & Explanation */}
      <h2 style={{ fontSize: '1.6rem', fontWeight: 800, color: '#F8FAFC', marginBottom: 12 }}>
        {translate('reconcilingTitle', lang)}
      </h2>

      <p style={{
        fontSize: '1rem',
        color: '#E2E8F0',
        lineHeight: 1.6,
        maxWidth: 520,
        margin: '0 auto 24px'
      }}>
        {translate('reconcilingMsg', lang)}
      </p>

      {/* Status Box */}
      <div style={{
        background: 'rgba(30, 41, 59, 0.6)',
        borderRadius: 14,
        padding: '16px 24px',
        border: '1.5px solid rgba(6, 182, 212, 0.35)',
        marginBottom: 24,
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 8,
        minWidth: 320,
        textAlign: 'left'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{translate('status', lang)}:</span>
          <span className="badge badge-reconciling">{translate('statusReconciling', lang)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Booking Reference:</span>
          <code style={{ fontSize: '0.9rem', color: '#67E8F9', fontWeight: 700 }}>{bookingId}</code>
        </div>
      </div>

      {/* Safe Honest Notice */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        fontSize: '0.85rem',
        color: '#CBD5E1',
        marginBottom: 16
      }}>
        <ShieldCheck size={18} color="#10B981" />
        <span>{translate('reconcilingAdvice', lang)}</span>
      </div>

      {/* SSE Live Sync Status */}
      <div style={{
        fontSize: '0.78rem',
        color: '#94A3B8',
        background: 'rgba(30, 41, 59, 0.4)',
        padding: '10px 18px',
        borderRadius: 10,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8
      }}>
        <Radio size={14} color="#06B6D4" />
        <span>Live SSE Channel Active: Screen will flip automatically upon operator confirmation.</span>
      </div>
    </div>
  );
};

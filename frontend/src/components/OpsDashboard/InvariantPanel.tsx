import React from 'react';
import { ShieldCheck, AlertOctagon, CheckCircle2, Lock, RefreshCw, Layers } from 'lucide-react';

interface InvariantData {
  totalUnits: number;
  availableUnits: number;
  heldUnits: number;
  confirmedUnits: number;
  invariantValid: boolean;
  equation: string;
}

interface AuditCounters {
  oversold: number;
  duplicateBookings: number;
  duplicatesPrevented: number;
  activeHolds: number;
  reconcilingBookings: number;
  confirmedBookings: number;
  failedBookings: number;
  expiredHolds: number;
}

interface InvariantPanelProps {
  inventory: InvariantData | null;
  counters: AuditCounters | null;
  onRefresh: () => void;
}

export const InvariantPanel: React.FC<InvariantPanelProps> = ({
  inventory,
  counters,
  onRefresh
}) => {
  const oversold = counters?.oversold ?? 0;
  const duplicates = counters?.duplicateBookings ?? 0;
  const isInvariantValid = inventory?.invariantValid ?? true;

  return (
    <div style={{ marginBottom: 28 }}>
      {/* Pinned Big Invariant Ribbon */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(19, 30, 54, 0.9))',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: '20px 24px',
        marginBottom: 20,
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 20
      }}>
        {/* Oversold & Duplicates Hero Badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          {/* OVERSOLD COUNTER */}
          <div style={{
            background: oversold === 0 ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.25)',
            border: `2px solid ${oversold === 0 ? '#10B981' : '#EF4444'}`,
            borderRadius: 14,
            padding: '12px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            boxShadow: oversold === 0 ? '0 0 25px rgba(16, 185, 129, 0.2)' : '0 0 30px rgba(239, 68, 68, 0.4)'
          }}>
            <ShieldCheck size={36} color={oversold === 0 ? '#34D399' : '#EF4444'} />
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Oversold Seats
              </div>
              <div style={{
                fontSize: '2.4rem',
                fontWeight: 900,
                lineHeight: 1,
                color: oversold === 0 ? '#34D399' : '#EF4444',
                fontFamily: 'monospace'
              }}>
                {oversold}
              </div>
            </div>
          </div>

          {/* DUPLICATE BOOKINGS COUNTER */}
          <div style={{
            background: duplicates === 0 ? 'rgba(59, 130, 246, 0.12)' : 'rgba(239, 68, 68, 0.25)',
            border: `2px solid ${duplicates === 0 ? '#3B82F6' : '#EF4444'}`,
            borderRadius: 14,
            padding: '12px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 16
          }}>
            <Lock size={36} color={duplicates === 0 ? '#60A5FA' : '#EF4444'} />
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Duplicate Bookings
              </div>
              <div style={{
                fontSize: '2.4rem',
                fontWeight: 900,
                lineHeight: 1,
                color: duplicates === 0 ? '#60A5FA' : '#EF4444',
                fontFamily: 'monospace'
              }}>
                {duplicates}
              </div>
            </div>
          </div>
        </div>

        {/* Database Invariant Equation */}
        <div style={{
          background: 'rgba(15, 23, 42, 0.7)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '12px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              PostgreSQL Invariant Rule:
            </span>
            <span style={{
              fontSize: '0.72rem',
              fontWeight: 800,
              background: isInvariantValid ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
              color: isInvariantValid ? '#34D399' : '#EF4444',
              padding: '2px 8px',
              borderRadius: 6
            }}>
              {isInvariantValid ? 'CHECK (available >= 0) SATISFIED' : 'VIOLATION DETECTED'}
            </span>
          </div>

          <div style={{
            fontSize: '0.95rem',
            fontWeight: 700,
            fontFamily: 'monospace',
            color: '#F8FAFC',
            letterSpacing: '0.02em'
          }}>
            {inventory?.equation || 'available + held + confirmed = total'}
          </div>

          <div style={{ fontSize: '0.7rem', color: '#64748B' }}>
            Enforced by PostgreSQL transactions & row locks. Never drifts.
          </div>
        </div>

        {/* Refresh button */}
        <button className="btn btn-outline" onClick={onRefresh} style={{ padding: '8px 12px' }}>
          <RefreshCw size={14} /> Sync DB
        </button>
      </div>

      {/* Grid of 4 Core Counters */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 16
      }}>
        <div className="glass-panel" style={{ padding: 18 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
            Available Seats
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#34D399', margin: '4px 0' }}>
            {inventory?.availableUnits ?? 0}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Ready for immediate hold</div>
        </div>

        <div className="glass-panel" style={{ padding: 18 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
            Active Holds (TTL)
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#FBBF24', margin: '4px 0' }}>
            {counters?.activeHolds ?? 0}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Reserved in Redis + Postgres</div>
        </div>

        <div className="glass-panel" style={{ padding: 18 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
            Confirmed Bookings
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#60A5FA', margin: '4px 0' }}>
            {counters?.confirmedBookings ?? 0}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Provider ticket issued</div>
        </div>

        <div className="glass-panel" style={{ padding: 18 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
            Total Inventory
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#F8FAFC', margin: '4px 0' }}>
            {inventory?.totalUnits ?? 0}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Total capacity across routes</div>
        </div>
      </div>
    </div>
  );
};

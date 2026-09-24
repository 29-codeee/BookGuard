import React from 'react';
import { ShieldCheck, Lock, RefreshCw, Box, Activity, Database, CheckCircle, Server, ActivitySquare } from 'lucide-react';

interface InvariantPanelProps {
  snapshot: any;
  onRefresh: () => void;
}

export const InvariantPanel: React.FC<InvariantPanelProps> = ({ snapshot, onRefresh }) => {
  const selected = snapshot?.selectedInventory;
  const sys = snapshot?.systemMetrics;

  return (
    <div style={{ marginBottom: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* HEADER & REFRESH */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ActivitySquare size={24} color="#6366F1" />
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#F8FAFC' }}>
            Live System State
          </h2>
        </div>
        <button className="btn btn-outline" onClick={onRefresh} style={{ padding: '6px 12px', fontSize: '0.75rem' }}>
          <RefreshCw size={14} /> Sync DB
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
        
        {/* SELECTED RESOURCE METRICS */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(23, 37, 84, 0.6))',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: 20,
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 12 }}>
            <Box size={18} color="#38BDF8" />
            <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: '#38BDF8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Selected Resource
            </h3>
          </div>

          {selected ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Resource ID: <code style={{ color: '#94A3B8' }}>{selected.id}</code></span>
                <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#F8FAFC' }}>{selected.name} ({selected.code})</span>
                <span style={{ fontSize: '0.75rem', color: '#CBD5E1' }}>{selected.origin} → {selected.destination}</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ background: 'rgba(0,0,0,0.3)', padding: 12, borderRadius: 8 }}>
                  <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 800 }}>Available</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#34D399' }}>{selected.available}</div>
                </div>
                <div style={{ background: 'rgba(0,0,0,0.3)', padding: 12, borderRadius: 8 }}>
                  <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 800 }}>Active Holds</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#FBBF24' }}>{selected.held}</div>
                </div>
                <div style={{ background: 'rgba(0,0,0,0.3)', padding: 12, borderRadius: 8 }}>
                  <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 800 }}>Confirmed</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#60A5FA' }}>{selected.confirmed}</div>
                </div>
                <div style={{ background: 'rgba(0,0,0,0.3)', padding: 12, borderRadius: 8 }}>
                  <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 800 }}>Total</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#F8FAFC' }}>{selected.total}</div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontStyle: 'italic' }}>
              No resource selected. Click a flight or hotel in the booking view.
            </div>
          )}
        </div>

        {/* SYSTEM WIDE METRICS */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(15, 23, 42, 0.6))',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: 20,
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 12 }}>
            <Activity size={18} color="#A78BFA" />
            <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: '#A78BFA', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              System Metrics
            </h3>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
             {/* Oversold */}
             <div style={{
              background: sys?.systemOversold === 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.2)',
              border: `1px solid ${sys?.systemOversold === 0 ? '#10B981' : '#EF4444'}`,
              padding: 12, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12
            }}>
              <ShieldCheck size={24} color={sys?.systemOversold === 0 ? '#34D399' : '#EF4444'} />
              <div>
                <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 800 }}>Oversold</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 900, color: sys?.systemOversold === 0 ? '#34D399' : '#EF4444' }}>{sys?.systemOversold ?? 0}</div>
              </div>
            </div>

            {/* Duplicates */}
            <div style={{
              background: sys?.duplicatesPrevented === 0 ? 'rgba(59, 130, 246, 0.1)' : 'rgba(239, 68, 68, 0.2)',
              border: `1px solid ${sys?.duplicatesPrevented === 0 ? '#3B82F6' : '#EF4444'}`,
              padding: 12, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12
            }}>
              <Lock size={24} color={sys?.duplicatesPrevented === 0 ? '#60A5FA' : '#EF4444'} />
              <div>
                <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 800 }}>Duplicates Prevented</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 900, color: sys?.duplicatesPrevented === 0 ? '#60A5FA' : '#EF4444' }}>{sys?.duplicatesPrevented ?? 0}</div>
              </div>
            </div>
          </div>

          {/* Health statuses */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(0,0,0,0.2)', padding: '6px 12px', borderRadius: 6 }}>
              <span style={{ fontSize: '0.75rem', color: '#CBD5E1', display: 'flex', alignItems: 'center', gap: 6 }}><Database size={12}/> PostgreSQL</span>
              <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#34D399' }}>{sys?.health?.postgres || 'HEALTHY'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(0,0,0,0.2)', padding: '6px 12px', borderRadius: 6 }}>
              <span style={{ fontSize: '0.75rem', color: '#CBD5E1', display: 'flex', alignItems: 'center', gap: 6 }}><Database size={12}/> Redis</span>
              <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#34D399' }}>{sys?.health?.redis || 'HEALTHY'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(0,0,0,0.2)', padding: '6px 12px', borderRadius: 6 }}>
              <span style={{ fontSize: '0.75rem', color: '#CBD5E1', display: 'flex', alignItems: 'center', gap: 6 }}><Server size={12}/> SSE Stream</span>
              <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#34D399' }}>{sys?.health?.sse || 'CONNECTED'}</span>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

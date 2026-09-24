import React, { useState, useMemo } from 'react';
import { Activity, Server, Database, Box, CheckCircle, XCircle, Clock, Zap, Shield, Key } from 'lucide-react';

export interface TraceEvent {
  traceId: string;
  timestamp: string;
  type: 'HOLD' | 'CONFIRM' | 'EXPIRY' | 'CANCEL';
  stage: string;
  message: string;
  status: 'running' | 'success' | 'failed' | 'info';
  resourceId?: string;
  bookingId?: string;
  holdId?: string;
  data?: any;
}

interface TraceLiveFeedProps {
  traces: TraceEvent[];
}

export const TraceLiveFeed: React.FC<TraceLiveFeedProps> = ({ traces }) => {
  const [filter, setFilter] = useState<'ALL' | 'HOLD' | 'CONFIRM' | 'EXPIRY'>('ALL');

  const filteredTraces = useMemo(() => {
    return traces.filter(t => filter === 'ALL' || t.type === filter);
  }, [traces, filter]);

  // Group traces by traceId to form transactions
  const transactionGroups = useMemo(() => {
    const groups: Record<string, TraceEvent[]> = {};
    const order: string[] = [];
    
    // Process traces chronologically reverse (newest first in list)
    // We want the newest transaction on top, and steps within it ordered chronologically.
    filteredTraces.forEach(t => {
      if (!groups[t.traceId]) {
        groups[t.traceId] = [];
        order.push(t.traceId);
      }
      groups[t.traceId].unshift(t); // Keep steps chronological inside the group
    });
    
    return order.map(id => ({
      traceId: id,
      type: groups[id][0]?.type || 'UNKNOWN',
      traces: groups[id],
      isSuccess: groups[id].some(t => t.stage === 'OPERATION_COMPLETED' || t.stage === 'TRANSACTION_COMMITTED'),
      isFailed: groups[id].some(t => t.status === 'failed' || t.stage.includes('ERROR') || t.stage === 'FAILED')
    }));
  }, [filteredTraces]);

  const getStageCategory = (stage: string) => {
    if (stage.includes('REQUEST') || stage.includes('TRIGGER')) return 'REQUEST';
    if (stage.includes('IDEMPOTENCY') || stage.includes('VALIDATION')) return 'VALIDATION';
    if (stage.includes('LOCK')) return 'DATABASE';
    if (stage.includes('INVENTORY')) return 'INVENTORY';
    if (stage.includes('STATE') || stage.includes('BOOKING') || stage.includes('HOLD_')) return 'STATE';
    if (stage.includes('REDIS')) return 'REDIS';
    if (stage.includes('PROVIDER')) return 'PROVIDER';
    if (stage.includes('COMMIT')) return 'COMMIT';
    if (stage.includes('ERROR') || stage.includes('FAILED')) return 'ERROR';
    return 'RESULT';
  };

  const getCategoryIcon = (category: string, status: string) => {
    if (status === 'failed') return <XCircle size={14} color="#EF4444" />;
    switch (category) {
      case 'REQUEST': return <Activity size={14} color="#6366F1" />;
      case 'VALIDATION': return <Shield size={14} color="#F59E0B" />;
      case 'DATABASE': return <Database size={14} color="#8B5CF6" />;
      case 'INVENTORY': return <Box size={14} color="#10B981" />;
      case 'STATE': return <CheckCircle size={14} color="#34D399" />;
      case 'REDIS': return <Zap size={14} color="#EF4444" />;
      case 'PROVIDER': return <Server size={14} color="#06B6D4" />;
      case 'COMMIT': return <CheckCircle size={14} color="#10B981" />;
      case 'ERROR': return <XCircle size={14} color="#EF4444" />;
      default: return <Clock size={14} color="#9CA3AF" />;
    }
  };

  const renderEvidence = (t: TraceEvent) => {
    if (!t.data) return null;
    
    // Specific evidence formats
    if (t.stage.includes('INVENTORY') && t.data.before && t.data.after) {
      return (
        <div style={{ background: 'rgba(0,0,0,0.4)', padding: '8px 12px', borderRadius: 6, display: 'flex', gap: 16, marginTop: 4 }}>
          <div style={{ borderRight: '1px solid rgba(255,255,255,0.1)', paddingRight: 16 }}>
            <div style={{ fontSize: '0.65rem', color: '#94A3B8', textTransform: 'uppercase', marginBottom: 4 }}>Before</div>
            <div style={{ fontSize: '0.75rem', color: '#F8FAFC' }}>Avail: {t.data.before.available}</div>
            <div style={{ fontSize: '0.75rem', color: '#F8FAFC' }}>Held: {t.data.before.held}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.65rem', color: '#94A3B8', textTransform: 'uppercase', marginBottom: 4 }}>After</div>
            <div style={{ fontSize: '0.75rem', color: '#34D399' }}>Avail: {t.data.after.available}</div>
            <div style={{ fontSize: '0.75rem', color: '#FBBF24' }}>Held: {t.data.after.held}</div>
          </div>
        </div>
      );
    }
    
    if (t.stage === 'IDEMPOTENCY_CHECK' && t.data.key) {
      return (
        <div style={{ background: 'rgba(0,0,0,0.4)', padding: '6px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <Key size={12} color="#F59E0B" />
          <code style={{ fontSize: '0.7rem', color: '#F59E0B' }}>{t.data.key}</code>
          {t.data.cached && <span style={{ fontSize: '0.65rem', background: '#F59E0B', color: '#000', padding: '2px 6px', borderRadius: 4, fontWeight: 800 }}>CACHE HIT</span>}
        </div>
      );
    }
    
    if (t.stage.includes('LOCK')) {
      return (
        <div style={{ fontSize: '0.7rem', color: '#8B5CF6', background: 'rgba(139, 92, 246, 0.1)', padding: '4px 8px', borderRadius: 4, display: 'inline-block', marginTop: 4 }}>
          FOR UPDATE lock acquired
        </div>
      );
    }

    if (t.stage === 'REDIS_TTL_SET' || t.stage === 'REDIS_EXPIRY') {
      return (
        <div style={{ fontSize: '0.7rem', color: '#EF4444', background: 'rgba(239, 68, 68, 0.1)', padding: '4px 8px', borderRadius: 4, display: 'inline-block', marginTop: 4 }}>
          TTL: {t.data.ttlSeconds}s | Key: {t.data.redisKey}
        </div>
      );
    }

    return (
      <pre style={{ margin: '4px 0 0 0', background: 'rgba(0,0,0,0.4)', padding: 8, borderRadius: 6, fontSize: '0.65rem', color: '#94A3B8', overflowX: 'auto' }}>
        {JSON.stringify(t.data, null, 2)}
      </pre>
    );
  };

  return (
    <div className="glass-panel" style={{ padding: 24, marginBottom: 28 }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Activity size={20} color="#6366F1" />
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#F8FAFC', margin: 0 }}>
            Live Transaction Trace
          </h3>
        </div>
        
        <div style={{ display: 'flex', gap: 8 }}>
          {['ALL', 'HOLD', 'CONFIRM', 'EXPIRY'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f as any)}
              style={{
                background: filter === f ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                border: `1px solid ${filter === f ? '#6366F1' : 'transparent'}`,
                color: filter === f ? '#818CF8' : '#94A3B8',
                padding: '4px 12px',
                borderRadius: 20,
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        maxHeight: 500,
        overflowY: 'auto',
        paddingRight: 6
      }}>
        {transactionGroups.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            No trace events yet. Perform an action to see real-time backend execution.
          </div>
        ) : (
          transactionGroups.map(group => (
            <div
              key={group.traceId}
              style={{
                background: 'rgba(15, 23, 42, 0.6)',
                border: `1px solid ${group.isFailed ? 'rgba(239, 68, 68, 0.3)' : group.isSuccess ? 'rgba(16, 185, 129, 0.3)' : 'rgba(99, 102, 241, 0.3)'}`,
                borderRadius: 12,
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 12
              }}
            >
              {/* Transaction Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ 
                    fontSize: '0.75rem', fontWeight: 800, padding: '4px 10px', borderRadius: 6,
                    background: group.type === 'HOLD' ? 'rgba(245, 158, 11, 0.15)' : group.type === 'CONFIRM' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                    color: group.type === 'HOLD' ? '#FBBF24' : group.type === 'CONFIRM' ? '#34D399' : '#EF4444'
                  }}>
                    {group.type} TRANSACTION
                  </span>
                  <code style={{ fontSize: '0.7rem', color: '#64748B' }}>{group.traceId}</code>
                </div>
                <span style={{ fontSize: '0.7rem', color: '#64748B' }}>
                  {new Date(group.traces[0].timestamp).toLocaleTimeString()}
                </span>
              </div>

              {/* Steps */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {group.traces.map((trace, i) => {
                  const category = getStageCategory(trace.stage);
                  const isLast = i === group.traces.length - 1;
                  
                  return (
                    <div key={`${trace.traceId}-${i}`} style={{ display: 'flex', gap: 12 }}>
                      {/* Timeline Line */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 20 }}>
                        <div style={{ 
                          width: 20, height: 20, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: trace.status === 'failed' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255,255,255,0.05)'
                        }}>
                          {getCategoryIcon(category, trace.status)}
                        </div>
                        {!isLast && <div style={{ width: 2, flex: 1, background: 'rgba(255,255,255,0.1)', margin: '4px 0' }} />}
                      </div>

                      {/* Content */}
                      <div style={{ paddingBottom: isLast ? 0 : 16, flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: trace.status === 'failed' ? '#EF4444' : '#E2E8F0' }}>
                            {trace.stage.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#CBD5E1', marginTop: 2 }}>
                          {trace.message}
                        </div>
                        
                        {renderEvidence(trace)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

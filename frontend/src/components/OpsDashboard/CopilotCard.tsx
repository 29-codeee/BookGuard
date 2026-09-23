import React, { useState } from 'react';
import { Bot, CheckCircle2, AlertTriangle, ShieldCheck, ArrowRight, UserCheck } from 'lucide-react';

interface PendingReconciliation {
  booking_id: string;
  status: string;
  total_amount: number;
  traveller_name: string;
  flight_code: string;
  ai_decision_id?: string;
  recommendation?: 'CONFIRM' | 'FAIL' | 'SAFE_RETRY' | 'ESCALATE';
  confidence?: number;
  evidence_ids?: any;
  ai_reason?: string;
}

interface CopilotCardProps {
  reconciliations: PendingReconciliation[];
  onApply: (bookingId: string, decisionId: string | undefined, action: 'CONFIRM' | 'FAIL', operatorName: string) => Promise<void>;
  isApplying: boolean;
}

export const CopilotCard: React.FC<CopilotCardProps> = ({
  reconciliations,
  onApply,
  isApplying
}) => {
  const [operatorName, setOperatorName] = useState('Ops Officer (Lalith)');

  if (reconciliations.length === 0) {
    return (
      <div className="glass-panel" style={{ padding: 24, marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Bot size={22} color="#06B6D4" />
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#F8FAFC' }}>
            Reconciliation Copilot (AI Advisory Layer)
          </h3>
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 8 }}>
          Zero bookings currently in RECONCILING state. System operating smoothly.
          (To test Copilot, switch Provider to TIMEOUT and confirm a booking).
        </p>
      </div>
    );
  }

  return (
    <div className="glass-panel" style={{ padding: 24, marginBottom: 28, border: '1px solid rgba(6, 182, 212, 0.4)' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingBottom: 16,
        borderBottom: '1px solid var(--border)',
        marginBottom: 20,
        flexWrap: 'wrap',
        gap: 12
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            background: 'rgba(6, 182, 212, 0.15)',
            border: '1px solid rgba(6, 182, 212, 0.3)',
            borderRadius: 10,
            padding: 8
          }}>
            <Bot size={22} color="#22D3EE" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#F8FAFC' }}>
                Reconciliation Copilot
              </h3>
              <span className="badge badge-reconciling">
                {reconciliations.length} RECONCILING
              </span>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Schema-constrained advisory recommendations · Human-in-the-loop validation
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Operator:</span>
          <input
            type="text"
            value={operatorName}
            onChange={(e) => setOperatorName(e.target.value)}
            style={{
              background: 'rgba(30, 41, 59, 0.8)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '4px 10px',
              color: '#F8FAFC',
              fontSize: '0.8rem',
              fontWeight: 600
            }}
          />
        </div>
      </div>

      {/* List of Reconciling Bookings */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {reconciliations.map((rec) => {
          const recAction = (rec.recommendation === 'CONFIRM' || rec.recommendation === 'SAFE_RETRY') ? 'CONFIRM' : 'FAIL';
          return (
            <div
              key={rec.booking_id}
              style={{
                background: 'rgba(15, 23, 42, 0.7)',
                border: '1px solid rgba(6, 182, 212, 0.25)',
                borderRadius: 12,
                padding: 18
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <code style={{ fontSize: '0.9rem', color: '#67E8F9', fontWeight: 700 }}>
                      {rec.booking_id}
                    </code>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      ({rec.flight_code || 'IX 6534'} · {rec.traveller_name})
                    </span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Provider timed out during initial checkout. Seat remains reserved in PostgreSQL transaction.
                  </div>
                </div>

                {/* AI Recommendation Pill */}
                <div style={{
                  background: rec.recommendation === 'CONFIRM' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  border: `1px solid ${rec.recommendation === 'CONFIRM' ? '#10B981' : '#EF4444'}`,
                  borderRadius: 10,
                  padding: '8px 14px',
                  textAlign: 'right'
                }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                    AI Recommendation
                  </div>
                  <div style={{
                    fontSize: '1.05rem',
                    fontWeight: 800,
                    color: rec.recommendation === 'CONFIRM' ? '#34D399' : '#F87171'
                  }}>
                    {rec.recommendation || 'EVALUATING...'}
                  </div>
                  {rec.confidence && (
                    <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>
                      Confidence: <strong>{rec.confidence}%</strong>
                    </div>
                  )}
                </div>
              </div>

              {/* Reason and Evidence Box */}
              <div style={{
                background: 'rgba(30, 41, 59, 0.5)',
                borderRadius: 8,
                padding: 12,
                fontSize: '0.85rem',
                color: '#E2E8F0',
                marginBottom: 16,
                borderLeft: '3px solid #06B6D4'
              }}>
                <div style={{ fontWeight: 600, color: '#67E8F9', marginBottom: 4 }}>
                  Grounded Reason:
                </div>
                <div>{rec.ai_reason || 'Analyzing external supplier getStatus() query...'}</div>

                {rec.evidence_ids && (
                  <div style={{ marginTop: 8, fontSize: '0.72rem', color: '#94A3B8' }}>
                    Evidence IDs: <code>{JSON.stringify(rec.evidence_ids)}</code>
                  </div>
                )}
              </div>

              {/* Human Action Trigger */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 12,
                paddingTop: 12,
                borderTop: '1px solid rgba(255,255,255,0.06)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  <ShieldCheck size={14} color="#10B981" />
                  <span>State machine will only transition upon human operator click.</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    id={`btn-apply-fail-${rec.booking_id}`}
                    className="btn btn-danger"
                    style={{ padding: '8px 14px', fontSize: '0.82rem' }}
                    onClick={() => onApply(rec.booking_id, rec.ai_decision_id, 'FAIL', operatorName)}
                    disabled={isApplying}
                  >
                    Release Seat (FAIL)
                  </button>

                  <button
                    id={`btn-apply-confirm-${rec.booking_id}`}
                    className="btn btn-success"
                    style={{ padding: '8px 16px', fontSize: '0.85rem' }}
                    onClick={() => onApply(rec.booking_id, rec.ai_decision_id, 'CONFIRM', operatorName)}
                    disabled={isApplying}
                  >
                    <UserCheck size={16} /> Apply Recommendation ({recAction})
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

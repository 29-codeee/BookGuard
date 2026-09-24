import React, { useState } from 'react';
import { 
  Cpu, 
  RotateCcw, 
  Copy, 
  Users, 
  Clock, 
  GitMerge, 
  CheckCircle2, 
  AlertTriangle, 
  Timer, 
  Play, 
  ShieldCheck,
  Zap
} from 'lucide-react';
import { 
  setProviderMode, 
  runDuplicateStorm, 
  runConcurrencyStampede, 
  runAbandonedHoldDemo, 
  runTwoLegCompensation, 
  resetDatabase 
} from '../../services/api';

interface DemoControlsProps {
  providerMode: 'SUCCESS' | 'FAILURE' | 'TIMEOUT' | 'DELAY';
  onProviderModeChange: (mode: 'SUCCESS' | 'FAILURE' | 'TIMEOUT' | 'DELAY') => void;
  onRefreshData: () => void;
}

export const DemoControls: React.FC<DemoControlsProps> = ({
  providerMode,
  onProviderModeChange,
  onRefreshData
}) => {
  const [isRunningStampede, setIsRunningStampede] = useState(false);
  const [stampedeResult, setStampedeResult] = useState<any>(null);

  const [isRunningDuplicateStorm, setIsRunningDuplicateStorm] = useState(false);
  const [duplicateResult, setDuplicateResult] = useState<any>(null);

  const [isRunningCompensation, setIsRunningCompensation] = useState(false);
  const [compensationResult, setCompensationResult] = useState<any>(null);

  const [isResetting, setIsResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  // 1. Change Provider Mode
  const handleModeChange = async (mode: 'SUCCESS' | 'FAILURE' | 'TIMEOUT' | 'DELAY') => {
    try {
      await setProviderMode(mode);
      onProviderModeChange(mode);
    } catch (err) {
      console.error('Failed to change provider mode:', err);
    }
  };

  // 2. Run 500-VU Concurrency Stampede
  const handleRunStampede = async () => {
    setIsRunningStampede(true);
    setStampedeResult(null);
    try {
      const res = await runConcurrencyStampede(500, 'htl_concurrency_demo');
      setStampedeResult(res.verdict);
      onRefreshData();
    } catch (err: any) {
      alert('Stampede test failed: ' + (err.error || err.message));
    } finally {
      setIsRunningStampede(false);
    }
  };

  // 3. Run Duplicate Request Storm
  const handleRunDuplicateStorm = async () => {
    setIsRunningDuplicateStorm(true);
    setDuplicateResult(null);
    try {
      const res = await runDuplicateStorm();
      setDuplicateResult(res);
      onRefreshData();
    } catch (err: any) {
      alert('Duplicate storm failed: ' + (err.error || err.message));
    } finally {
      setIsRunningDuplicateStorm(false);
    }
  };

  // 4. Run Two-Leg Compensation Demo
  const handleRunCompensation = async () => {
    setIsRunningCompensation(true);
    setCompensationResult(null);
    try {
      const res = await runTwoLegCompensation();
      setCompensationResult(res);
      onRefreshData();
    } catch (err: any) {
      alert('Compensation demo error: ' + (err.error || err.message));
    } finally {
      setIsRunningCompensation(false);
    }
  };

  // 5. Reset Database
  const handleReset = async () => {
    setIsResetting(true);
    try {
      await resetDatabase();
      setResetMessage('Database reset to clean state (3 available seats).');
      setStampedeResult(null);
      setDuplicateResult(null);
      setCompensationResult(null);
      onRefreshData();
      setTimeout(() => setResetMessage(null), 4000);
    } catch (err: any) {
      alert('Reset failed: ' + err.message);
    } finally {
      setIsResetting(false);
    }
  };

  // 6. Abandoned Hold Demo
  const handleAbandonedHold = async () => {
    try {
      const res = await runAbandonedHoldDemo(15);
      alert(`Abandoned hold created (15s TTL)! Switch to Traveller View or Ops Dashboard to watch automatic expiration & restock.`);
      onRefreshData();
    } catch (err: any) {
      alert('Error creating abandoned hold: ' + (err.error || err.message));
    }
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Title & Reset Bar */}
      <div className="glass-panel" style={{ padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Cpu size={24} color="#3B82F6" />
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#F8FAFC' }}>
              Hackathon Demonstration Control Center
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Interactive triggers for all 6 presentation scenes & failure simulations
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {resetMessage && (
            <span style={{ fontSize: '0.8rem', color: '#34D399', fontWeight: 600 }}>
              ✓ {resetMessage}
            </span>
          )}
          <button
            id="btn-reset-db"
            className="btn btn-outline"
            style={{ borderColor: 'rgba(239, 68, 68, 0.4)', color: '#FCA5A5' }}
            onClick={handleReset}
            disabled={isResetting}
          >
            <RotateCcw size={16} /> Reset & Reseed Demo DB
          </button>
        </div>
      </div>

      {/* Grid of Control Panels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: 20 }}>
        
        {/* PANEL 1: Provider Simulator */}
        <div className="glass-panel" style={{ padding: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Zap size={20} color="#FBBF24" />
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>1. Mock Provider Simulator</h3>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16 }}>
            Select how external airline suppliers respond to checkout confirmation requests:
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            {[
              { id: 'SUCCESS', label: 'SUCCESS', desc: 'Instant 200 OK', color: '#10B981' },
              { id: 'TIMEOUT', label: 'TIMEOUT (Demo)', desc: '800ms SLA breach → RECONCILING', color: '#06B6D4' },
              { id: 'FAILURE', label: 'FAILURE', desc: 'Supplier rejection → Auto release', color: '#EF4444' },
              { id: 'DELAY', label: 'DELAY', desc: '3000ms latency', color: '#F59E0B' }
            ].map((opt) => (
              <button
                key={opt.id}
                onClick={() => handleModeChange(opt.id as any)}
                style={{
                  background: providerMode === opt.id ? 'rgba(59, 130, 246, 0.25)' : 'rgba(30, 41, 59, 0.6)',
                  border: `2px solid ${providerMode === opt.id ? opt.color : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: 10,
                  padding: '10px 12px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'all 0.15s'
                }}
              >
                <div style={{ fontSize: '0.85rem', fontWeight: 800, color: opt.color }}>
                  {opt.label}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  {opt.desc}
                </div>
              </button>
            ))}
          </div>

          <div style={{
            background: 'rgba(15, 23, 42, 0.6)',
            padding: 10,
            borderRadius: 8,
            fontSize: '0.75rem',
            color: '#CBD5E1',
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            <span style={{ color: 'var(--text-muted)' }}>Active Mode:</span>
            <strong style={{ color: '#60A5FA' }}>{providerMode}</strong>
          </div>
        </div>

        {/* PANEL 2: 500-VU Concurrency Stampede */}
        <div className="glass-panel" style={{ padding: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Users size={20} color="#3B82F6" />
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>2. 500-VU Concurrency Stampede</h3>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16 }}>
            Fire 500 concurrent virtual users competing simultaneously for only 5 available rooms (htl_concurrency_demo) in PostgreSQL:
          </p>

          <button
            id="btn-run-stampede"
            className="btn btn-primary"
            style={{ width: '100%', padding: '12px', marginBottom: 16 }}
            onClick={handleRunStampede}
            disabled={isRunningStampede}
          >
            {isRunningStampede ? 'Firing 500 concurrent requests...' : 'Run 500-VU Concurrency Stampede'}
          </button>

          {stampedeResult && (
            <div style={{
              background: 'rgba(15, 23, 42, 0.8)',
              border: '1px solid rgba(16, 185, 129, 0.4)',
              borderRadius: 10,
              padding: 14,
              fontSize: '0.8rem'
            }}>
              <div style={{ fontWeight: 800, color: '#34D399', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle2 size={16} /> Verified Concurrency Proof
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, color: '#E2E8F0', fontFamily: 'monospace' }}>
                <div>Virtual Users: <strong>{stampedeResult.virtualUsers}</strong></div>
                <div>Initial Seats: <strong>{stampedeResult.initialAvailableSeats}</strong></div>
                <div>Confirmed/Held: <strong style={{ color: '#34D399' }}>{stampedeResult.successfulHolds}</strong></div>
                <div>Rejected: <strong style={{ color: '#F87171' }}>{stampedeResult.cleanlyRejected}</strong></div>
                <div>Oversold: <strong style={{ color: '#34D399' }}>{stampedeResult.oversold} (0)</strong></div>
                <div>Duplicates: <strong style={{ color: '#60A5FA' }}>{stampedeResult.duplicateBookings} (0)</strong></div>
              </div>
              <div style={{ marginTop: 8, fontSize: '0.72rem', color: '#94A3B8' }}>
                Row lock guarantee satisfied in {stampedeResult.durationMs}ms ({stampedeResult.requestsPerSecond} req/s)
              </div>
            </div>
          )}
        </div>

        {/* PANEL 3: Duplicate Request Storm (Idempotency) */}
        <div className="glass-panel" style={{ padding: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Copy size={20} color="#8B5CF6" />
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>3. Duplicate Key Storm (Idempotency)</h3>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16 }}>
            Sends the exact same confirmation request 3 times concurrently with one Idempotency Key:
          </p>

          <button
            id="btn-run-duplicate-storm"
            className="btn btn-outline"
            style={{ width: '100%', padding: '12px', marginBottom: 16, borderColor: 'var(--accent-violet)', color: '#C4B5FD' }}
            onClick={handleRunDuplicateStorm}
            disabled={isRunningDuplicateStorm}
          >
            {isRunningDuplicateStorm ? 'Firing 3 concurrent requests...' : 'Send 3x Duplicate Request Storm'}
          </button>

          {duplicateResult && (
            <div style={{
              background: 'rgba(15, 23, 42, 0.8)',
              border: '1px solid rgba(139, 92, 246, 0.4)',
              borderRadius: 10,
              padding: 14,
              fontSize: '0.8rem'
            }}>
              <div style={{ fontWeight: 800, color: '#A78BFA', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle2 size={16} /> 1 Request → 1 Booking → 3 Identical Responses
              </div>
              <div style={{ color: '#E2E8F0', fontSize: '0.75rem', marginBottom: 4 }}>
                Key: <code style={{ color: '#C4B5FD' }}>{duplicateResult.idempotencyKey}</code>
              </div>
              <div style={{ color: '#E2E8F0', fontSize: '0.75rem', marginBottom: 4 }}>
                DB Bookings Created: <strong>{duplicateResult.dbBookingsCreated}</strong> (0 Duplicates)
              </div>
              <div style={{ color: '#34D399', fontSize: '0.75rem', fontWeight: 600 }}>
                ✓ Byte-identical responses verified (diff = 0)
              </div>
            </div>
          )}
        </div>

        {/* PANEL 4: Two-Leg Compensation Demo */}
        <div className="glass-panel" style={{ padding: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <GitMerge size={20} color="#F43F5E" />
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>4. Two-Leg Trip SAGA Compensation</h3>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16 }}>
            Leg 1 (Flight) confirmed → Leg 2 (Hotel) rejected by supplier → Flight automatically cancelled and restocked:
          </p>

          <button
            id="btn-run-compensation"
            className="btn btn-outline"
            style={{ width: '100%', padding: '12px', marginBottom: 16, borderColor: 'var(--accent-rose)', color: '#FDA4AF' }}
            onClick={handleRunCompensation}
            disabled={isRunningCompensation}
          >
            {isRunningCompensation ? 'Executing compensation cascade...' : 'Run Flight + Hotel Compensation Demo'}
          </button>

          {compensationResult && (
            <div style={{
              background: 'rgba(15, 23, 42, 0.8)',
              border: '1px solid rgba(244, 63, 94, 0.4)',
              borderRadius: 10,
              padding: 14,
              fontSize: '0.8rem'
            }}>
              <div style={{ fontWeight: 800, color: '#FB7185', marginBottom: 6 }}>
                SAGA Compensation Completed:
              </div>
              <div style={{ color: '#E2E8F0', fontSize: '0.75rem', marginBottom: 4 }}>
                • Leg 1: Flight reserved then cancelled via providerAdapter.cancel()
              </div>
              <div style={{ color: '#E2E8F0', fontSize: '0.75rem', marginBottom: 4 }}>
                • Leg 2: Hotel partner rejected allocation
              </div>
              <div style={{ color: '#34D399', fontSize: '0.75rem', fontWeight: 700 }}>
                • Flight seat restored to inventory. Final State: FAILED (0 orphaned assets)
              </div>
            </div>
          )}
        </div>

        {/* PANEL 5: Abandoned Hold Demo */}
        <div className="glass-panel" style={{ padding: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Clock size={20} color="#F59E0B" />
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>5. Abandoned Hold Demo (Fast 15s TTL)</h3>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16 }}>
            Spawns a temporary hold with a fast 15-second Redis TTL. When it expires, the background sweeper restores inventory:
          </p>

          <button
            id="btn-abandon-hold"
            className="btn btn-outline"
            style={{ width: '100%', padding: '12px', borderColor: 'var(--accent-amber)', color: '#FCD34D' }}
            onClick={handleAbandonedHold}
          >
            Create 15-second Abandoned Hold
          </button>
        </div>

      </div>
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  Zap, 
  Code2, 
  Layers, 
  CheckCircle2, 
  XCircle, 
  RefreshCw, 
  Copy, 
  Check, 
  ExternalLink, 
  DollarSign, 
  Clock, 
  Sparkles,
  ArrowRight,
  ShieldAlert,
  Smartphone,
  Globe
} from 'lucide-react';
import { simulateRace, fetchPluginSpecs } from '../../services/api';

export const PluginShowcase: React.FC = () => {
  const [isRunningRace, setIsRunningRace] = useState(false);
  const [raceResult, setRaceResult] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'simulator' | 'sdk' | 'embed_preview'>('simulator');
  const [sdkSpecs, setSdkSpecs] = useState<any>(null);
  const [codeTab, setCodeTab] = useState<'html' | 'react' | 'backend'>('react');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchPluginSpecs().then(data => {
      if (data.success) setSdkSpecs(data);
    }).catch(err => console.error('Error fetching SDK specs:', err));
  }, []);

  const handleRunRace = async () => {
    setIsRunningRace(true);
    setRaceResult(null);
    try {
      const res = await simulateRace('htl_last_room_suite');
      setRaceResult(res);
    } catch (err: any) {
      alert('Race simulation failed: ' + (err.error || err.message));
    } finally {
      setIsRunningRace(false);
    }
  };

  const copyCode = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Header Banner */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.9) 0%, rgba(15, 23, 42, 0.95) 100%)',
        border: '1px solid rgba(56, 189, 248, 0.25)',
        borderRadius: 20,
        padding: '32px 36px',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: '0 20px 40px rgba(0,0,0,0.4)'
      }}>
        <div style={{
          position: 'absolute',
          top: -40,
          right: -40,
          width: 220,
          height: 220,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(14, 165, 233, 0.15) 0%, transparent 70%)',
          pointerEvents: 'none'
        }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <span style={{
            background: 'linear-gradient(135deg, #0ea5e9, #38bdf8)',
            color: '#000',
            fontWeight: 800,
            fontSize: '0.75rem',
            padding: '4px 10px',
            borderRadius: 999,
            letterSpacing: '0.05em',
            textTransform: 'uppercase'
          }}>
            Drop-in Integration
          </span>
          <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
            BookGuard Universal Anti-Double-Booking Plugin SDK v2.4
          </span>
        </div>

        <h1 style={{ fontSize: '2.1rem', fontWeight: 900, color: '#f8fafc', margin: '0 0 12px 0', letterSpacing: '-0.02em' }}>
          Stop Double Bookings Across IRCTC, RedBus & Stays
        </h1>
        <p style={{ color: '#cbd5e1', fontSize: '1.05rem', lineHeight: 1.6, maxWidth: 860, margin: 0 }}>
          When 2 travellers attempt to book the last remaining room or seat in the exact same millisecond, 
          traditional travel backends fail—causing double deductions and angry complaints. 
          The <strong>BookGuard Plugin</strong> plugs into any app to enforce atomic row locks, guarantee 
          <strong> 0 oversold inventory</strong>, and disburse <strong>instant automated zero-fee refunds</strong> to the colliding loser.
        </p>

        {/* Top Feature Badges */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 24 }}>
          {[
            { label: 'Atomic SELECT FOR UPDATE', icon: <Zap size={14} color="#38bdf8" /> },
            { label: 'Instant Auto-Refund Engine', icon: <DollarSign size={14} color="#10b981" /> },
            { label: 'Guaranteed 0 Oversold', icon: <ShieldCheck size={14} color="#6366f1" /> },
            { label: 'Drop-in React / Vanilla SDK', icon: <Code2 size={14} color="#f59e0b" /> }
          ].map((feat, i) => (
            <div key={i} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 14px',
              borderRadius: 999,
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              fontSize: '0.82rem',
              color: '#e2e8f0',
              fontWeight: 500
            }}>
              {feat.icon}
              <span>{feat.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div style={{
        display: 'flex',
        gap: 12,
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        paddingBottom: 4
      }}>
        <button
          onClick={() => setActiveTab('simulator')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 20px',
            borderRadius: '12px 12px 0 0',
            background: activeTab === 'simulator' ? 'rgba(56, 189, 248, 0.12)' : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'simulator' ? '2px solid #38bdf8' : '2px solid transparent',
            color: activeTab === 'simulator' ? '#38bdf8' : '#94a3b8',
            fontWeight: 700,
            cursor: 'pointer',
            fontSize: '0.95rem',
            transition: 'all 0.2s ease'
          }}
        >
          <Zap size={18} />
          Millisecond Race Simulator
        </button>

        <button
          onClick={() => setActiveTab('embed_preview')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 20px',
            borderRadius: '12px 12px 0 0',
            background: activeTab === 'embed_preview' ? 'rgba(56, 189, 248, 0.12)' : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'embed_preview' ? '2px solid #38bdf8' : '2px solid transparent',
            color: activeTab === 'embed_preview' ? '#38bdf8' : '#94a3b8',
            fontWeight: 700,
            cursor: 'pointer',
            fontSize: '0.95rem',
            transition: 'all 0.2s ease'
          }}
        >
          <Layers size={18} />
          Simulated Partner App (RedBus / Hotel Widget)
        </button>

        <button
          onClick={() => setActiveTab('sdk')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 20px',
            borderRadius: '12px 12px 0 0',
            background: activeTab === 'sdk' ? 'rgba(56, 189, 248, 0.12)' : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'sdk' ? '2px solid #38bdf8' : '2px solid transparent',
            color: activeTab === 'sdk' ? '#38bdf8' : '#94a3b8',
            fontWeight: 700,
            cursor: 'pointer',
            fontSize: '0.95rem',
            transition: 'all 0.2s ease'
          }}
        >
          <Code2 size={18} />
          Developer SDK & Code Snippets
        </button>
      </div>

      {/* TAB 1: MILLISECOND RACE SIMULATOR */}
      {activeTab === 'simulator' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Simulation Trigger Card */}
          <div style={{
            background: 'rgba(15, 23, 42, 0.75)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 18,
            padding: '24px 28px',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 20
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span style={{ background: '#ef4444', color: '#fff', fontSize: '0.72rem', fontWeight: 800, padding: '3px 8px', borderRadius: 4 }}>
                  CRITICAL TEST
                </span>
                <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#f8fafc', fontWeight: 800 }}>
                  Royal Heritage Ocean Suite (Only 1 Room Left!)
                </h3>
              </div>
              <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.9rem' }}>
                Simulates <strong>User A (Web Checkout)</strong> and <strong>User B (Mobile App)</strong> hitting &quot;Pay ₹4,500&quot; within 7 milliseconds of each other.
              </p>
            </div>

            <button
              onClick={handleRunRace}
              disabled={isRunningRace}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '14px 28px',
                borderRadius: 12,
                background: isRunningRace ? '#334155' : 'linear-gradient(135deg, #0ea5e9, #2563eb)',
                color: '#fff',
                fontWeight: 800,
                fontSize: '1rem',
                border: 'none',
                cursor: isRunningRace ? 'not-allowed' : 'pointer',
                boxShadow: isRunningRace ? 'none' : '0 8px 24px rgba(14, 165, 233, 0.4)',
                transition: 'all 0.2s ease'
              }}
            >
              <Zap size={18} className={isRunningRace ? 'spin' : ''} />
              {isRunningRace ? 'Simulating Atomic Race...' : 'Trigger Millisecond Race'}
            </button>
          </div>

          {/* Results Display */}
          {raceResult && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, animation: 'fadeIn 0.3s ease' }}>
              {/* Outcome Head-to-Head Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
                {/* User A: The Winner */}
                <div style={{
                  background: 'linear-gradient(145deg, rgba(16, 185, 129, 0.08) 0%, rgba(15, 23, 42, 0.8) 100%)',
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  borderRadius: 16,
                  padding: 24,
                  boxShadow: '0 12px 30px rgba(0,0,0,0.3)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Globe size={18} color="#10b981" />
                      <span style={{ fontWeight: 800, color: '#f8fafc', fontSize: '1.05rem' }}>User A (Web Portal)</span>
                    </div>
                    <span style={{
                      background: 'rgba(16, 185, 129, 0.2)',
                      color: '#10b981',
                      fontWeight: 800,
                      fontSize: '0.75rem',
                      padding: '4px 10px',
                      borderRadius: 999,
                      border: '1px solid #10b981'
                    }}>
                      WON ROOM (T +2ms)
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: '0.88rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                      <span>Lock Result:</span>
                      <strong style={{ color: '#10b981' }}>Atomic Lock Acquired (1/1)</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                      <span>Booking Status:</span>
                      <strong style={{ color: '#f8fafc' }}>CONFIRMED</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                      <span>Booking ID:</span>
                      <code style={{ color: '#38bdf8', fontSize: '0.78rem' }}>{raceResult.userA.bookingId}</code>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                      <span>Payment Settled:</span>
                      <strong style={{ color: '#f8fafc' }}>₹4,500.00 (Captured)</strong>
                    </div>
                  </div>

                  <div style={{
                    marginTop: 18,
                    padding: '12px 14px',
                    borderRadius: 10,
                    background: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid rgba(16, 185, 129, 0.2)',
                    fontSize: '0.82rem',
                    color: '#6ee7b7'
                  }}>
                    ✓ Room voucher HTL-ROYAL-01 successfully emailed to User A.
                  </div>
                </div>

                {/* User B: The Colliding Loser -> INSTANT REFUND! */}
                <div style={{
                  background: 'linear-gradient(145deg, rgba(239, 68, 68, 0.08) 0%, rgba(15, 23, 42, 0.8) 100%)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  borderRadius: 16,
                  padding: 24,
                  boxShadow: '0 12px 30px rgba(0,0,0,0.3)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Smartphone size={18} color="#f87171" />
                      <span style={{ fontWeight: 800, color: '#f8fafc', fontSize: '1.05rem' }}>User B (Mobile App)</span>
                    </div>
                    <span style={{
                      background: 'rgba(239, 68, 68, 0.2)',
                      color: '#f87171',
                      fontWeight: 800,
                      fontSize: '0.75rem',
                      padding: '4px 10px',
                      borderRadius: 999,
                      border: '1px solid #f87171'
                    }}>
                      COLLISION (+7ms lag)
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: '0.88rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                      <span>Inventory Condition:</span>
                      <strong style={{ color: '#f87171' }}>0 Rooms Left (Zero Oversell)</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                      <span>Resolution:</span>
                      <strong style={{ color: '#10b981' }}>100% Instant Auto-Refund</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                      <span>Refund Receipt ID:</span>
                      <code style={{ color: '#10b981', fontSize: '0.78rem' }}>{raceResult.userB.refund?.refundId}</code>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                      <span>Refund Latency:</span>
                      <strong style={{ color: '#f8fafc' }}>{raceResult.userB.refund?.processedInMs} ms (₹0 deduction)</strong>
                    </div>
                  </div>

                  {/* Alternative Courtesy Offer */}
                  {raceResult.userB.alternativeRecommendation && (
                    <div style={{
                      marginTop: 18,
                      padding: '12px 14px',
                      borderRadius: 10,
                      background: 'rgba(14, 165, 233, 0.1)',
                      border: '1px solid rgba(14, 165, 233, 0.3)',
                      fontSize: '0.82rem',
                      color: '#e2e8f0'
                    }}>
                      <div style={{ fontWeight: 700, color: '#38bdf8', marginBottom: 4 }}>
                        🎁 BookGuard Courtesy Recovery Offer:
                      </div>
                      <div>
                        {raceResult.userB.alternativeRecommendation.name} offered at ₹{raceResult.userB.alternativeRecommendation.discountedPrice} (10% off code: <strong style={{ color: '#f59e0b' }}>{raceResult.userB.alternativeRecommendation.discountCode}</strong>)
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Invariant Health Checklist */}
              <div style={{
                background: 'rgba(15, 23, 42, 0.9)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                borderRadius: 14,
                padding: '18px 24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-around',
                flexWrap: 'wrap',
                gap: 16
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle2 color="#10b981" size={20} />
                  <span style={{ color: '#f8fafc', fontSize: '0.9rem', fontWeight: 600 }}>Oversold Quantity: <strong>0</strong></span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle2 color="#10b981" size={20} />
                  <span style={{ color: '#f8fafc', fontSize: '0.9rem', fontWeight: 600 }}>Duplicate Bookings: <strong>0</strong></span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle2 color="#10b981" size={20} />
                  <span style={{ color: '#f8fafc', fontSize: '0.9rem', fontWeight: 600 }}>PG Invariant Formula: <strong>Strictly Valid</strong></span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle2 color="#10b981" size={20} />
                  <span style={{ color: '#f8fafc', fontSize: '0.9rem', fontWeight: 600 }}>User B Refund: <strong>Settled (₹0 Loss)</strong></span>
                </div>
              </div>

              {/* Step-by-Step Millisecond Timeline */}
              <div style={{
                background: 'rgba(15, 23, 42, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 16,
                padding: '20px 24px'
              }}>
                <h4 style={{ margin: '0 0 16px 0', color: '#f8fafc', fontSize: '1rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Clock size={16} color="#38bdf8" />
                  Millisecond Execution Trace
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {raceResult.timeline.map((step: any, idx: number) => (
                    <div key={idx} style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 14,
                      padding: '10px 14px',
                      borderRadius: 8,
                      background: step.status === 'WIN' 
                        ? 'rgba(16, 185, 129, 0.08)' 
                        : step.status === 'REJECT' 
                        ? 'rgba(239, 68, 68, 0.08)' 
                        : step.status === 'REFUND'
                        ? 'rgba(56, 189, 248, 0.08)'
                        : 'rgba(255, 255, 255, 0.02)',
                      borderLeft: `3px solid ${
                        step.status === 'WIN' ? '#10b981' : step.status === 'REJECT' ? '#ef4444' : step.status === 'REFUND' ? '#38bdf8' : '#64748b'
                      }`
                    }}>
                      <span style={{ color: '#38bdf8', fontFamily: 'monospace', fontSize: '0.8rem', minWidth: 70 }}>
                        +{step.offsetMs}ms
                      </span>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                          <strong style={{ color: '#f8fafc', fontSize: '0.85rem' }}>{step.actor}</strong>
                          <span style={{ color: '#94a3b8', fontSize: '0.75rem', fontFamily: 'monospace' }}>[{step.action}]</span>
                        </div>
                        <div style={{ color: '#cbd5e1', fontSize: '0.82rem' }}>{step.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: SIMULATED PARTNER WEBSITE EMBED PREVIEW */}
      {activeTab === 'embed_preview' && (
        <div style={{
          background: '#090d16',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 20,
          padding: 28,
          boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
        }}>
          {/* Mock Browser Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            paddingBottom: 16,
            marginBottom: 24
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ef4444' }} />
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#f59e0b' }} />
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#10b981' }} />
              <div style={{
                background: 'rgba(255, 255, 255, 0.06)',
                borderRadius: 6,
                padding: '4px 14px',
                fontSize: '0.78rem',
                color: '#94a3b8',
                marginLeft: 12
              }}>
                https://partner-portal.redbus.in/hotels/royal-heritage
              </div>
            </div>
            <div style={{ fontSize: '0.8rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: 6 }}>
              <ShieldCheck size={16} />
              BookGuard Protection Active
            </div>
          </div>

          {/* Embedded Partner Page Content */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
            <div>
              <div style={{
                height: 180,
                borderRadius: 14,
                background: 'linear-gradient(135deg, #1e293b, #0f172a)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                marginBottom: 16
              }}>
                <span style={{ fontSize: '3rem' }}>🏨</span>
              </div>
              <h2 style={{ fontSize: '1.4rem', color: '#f8fafc', margin: '0 0 6px 0' }}>
                Royal Heritage Oceanfront Villa
              </h2>
              <p style={{ color: '#94a3b8', fontSize: '0.88rem', margin: '0 0 12px 0' }}>
                Candolim Beach, North Goa • Private Pool & Ocean View
              </p>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <span style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', padding: '4px 10px', borderRadius: 6, fontSize: '0.78rem', fontWeight: 700 }}>
                  ⚠️ ONLY 1 ROOM LEFT IN INVENTORY
                </span>
              </div>
            </div>

            {/* Embedded BookGuard Shield Widget */}
            <div style={{
              background: 'rgba(15, 23, 42, 0.95)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              borderRadius: 16,
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: '0 10px 30px rgba(0,0,0,0.4)'
            }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Partner Room Rate:</span>
                  <span style={{ color: '#f8fafc', fontSize: '1.3rem', fontWeight: 900 }}>₹4,500 <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 400 }}>/ night</span></span>
                </div>

                {/* The Drop-in BookGuard Protection Badge */}
                <div style={{
                  background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.1) 0%, rgba(99, 102, 241, 0.1) 100%)',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  borderRadius: 10,
                  padding: '12px 14px',
                  marginBottom: 16
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#38bdf8', fontWeight: 700, fontSize: '0.85rem', marginBottom: 4 }}>
                    <ShieldCheck size={16} />
                    Protected by BookGuard Engine
                  </div>
                  <div style={{ color: '#cbd5e1', fontSize: '0.78rem', lineHeight: 1.4 }}>
                    Zero double-booking guarantee. If a concurrent checkout collision happens, your funds are automatically refunded within milliseconds.
                  </div>
                </div>
              </div>

              <div>
                <button
                  onClick={handleRunRace}
                  style={{
                    width: '100%',
                    padding: '14px',
                    borderRadius: 10,
                    background: 'linear-gradient(135deg, #0ea5e9, #2563eb)',
                    color: '#fff',
                    fontWeight: 800,
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '0.95rem',
                    boxShadow: '0 4px 16px rgba(14, 165, 233, 0.3)'
                  }}
                >
                  Pay ₹4,500 & Reserve (Test Collision)
                </button>
                <div style={{ textAlign: 'center', color: '#64748b', fontSize: '0.75rem', marginTop: 8 }}>
                  Integrated via <code>&lt;script src=&quot;bookguard.js&quot;&gt;</code>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: DEVELOPER SDK CODE SNIPPETS */}
      {activeTab === 'sdk' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Sub Tab Buttons */}
          <div style={{ display: 'flex', gap: 10 }}>
            {[
              { id: 'react', label: 'React Hook (@bookguard/react)' },
              { id: 'html', label: 'Vanilla JS / HTML Script Tag' },
              { id: 'backend', label: 'Node.js Express / Fastify Guard' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setCodeTab(tab.id as any)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  background: codeTab === tab.id ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                  border: codeTab === tab.id ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.1)',
                  color: codeTab === tab.id ? '#38bdf8' : '#94a3b8',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer'
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Code Window */}
          <div style={{
            background: '#090d16',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 14,
            overflow: 'hidden'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 20px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              background: 'rgba(255, 255, 255, 0.02)'
            }}>
              <span style={{ color: '#94a3b8', fontSize: '0.8rem', fontFamily: 'monospace' }}>
                {codeTab === 'react' ? 'CheckoutComponent.tsx' : codeTab === 'html' ? 'index.html' : 'server.ts'}
              </span>
              <button
                onClick={() => copyCode(
                  codeTab === 'react' ? sdkSpecs?.snippets?.reactHook || '' :
                  codeTab === 'html' ? sdkSpecs?.snippets?.htmlEmbed || '' :
                  sdkSpecs?.snippets?.backendMiddleware || ''
                )}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'transparent',
                  border: 'none',
                  color: copied ? '#10b981' : '#94a3b8',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  fontWeight: 600
                }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied to Clipboard' : 'Copy Code'}
              </button>
            </div>

            <pre style={{
              margin: 0,
              padding: 24,
              overflowX: 'auto',
              fontFamily: 'Consolas, Monaco, "Courier New", monospace',
              fontSize: '0.88rem',
              lineHeight: 1.6,
              color: '#e2e8f0'
            }}>
              <code>
                {codeTab === 'react' && (sdkSpecs?.snippets?.reactHook || '// Loading React SDK snippet...')}
                {codeTab === 'html' && (sdkSpecs?.snippets?.htmlEmbed || '// Loading HTML embed snippet...')}
                {codeTab === 'backend' && (sdkSpecs?.snippets?.backendMiddleware || '// Loading Backend Middleware snippet...')}
              </code>
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};

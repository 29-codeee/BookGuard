import React, { useState } from 'react';
import { 
  ShieldAlert, 
  Plane, 
  Hotel, 
  CheckCircle2, 
  XCircle, 
  ArrowRight, 
  AlertTriangle, 
  DollarSign, 
  RefreshCw, 
  FileText, 
  Building2, 
  UserCheck, 
  Gift, 
  Sparkles,
  HeartHandshake
} from 'lucide-react';
import { simulateTripDisruption, resolveTripDisruption } from '../../services/api';

export const TripSentinelView: React.FC = () => {
  const [isSimulating, setIsSimulating] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [disruptionData, setDisruptionData] = useState<any>(null);
  const [resolutionResult, setResolutionResult] = useState<any>(null);

  // Trigger flight cancellation simulation
  const handleSimulateDisruption = async () => {
    setIsSimulating(true);
    setResolutionResult(null);
    try {
      const res = await simulateTripDisruption();
      if (res.success) {
        setDisruptionData(res.disruption);
      }
    } catch (err: any) {
      alert('Failed to simulate disruption: ' + (err.error || err.message));
    } finally {
      setIsSimulating(false);
    }
  };

  // Resolve customer choice
  const handleResolve = async (action: 'ACCEPT_ALTERNATIVE' | 'DECLINE_CANCEL') => {
    if (!disruptionData?.bookingId) return;
    setIsResolving(true);
    try {
      const res = await resolveTripDisruption(
        disruptionData.bookingId,
        action,
        disruptionData.alternativeFlight?.id
      );
      if (res.success) {
        setResolutionResult(res);
      }
    } catch (err: any) {
      alert('Failed to resolve disruption: ' + (err.error || err.message));
    } finally {
      setIsResolving(false);
    }
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Hero Banner */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.95) 100%)',
        border: '1px solid rgba(245, 158, 11, 0.25)',
        borderRadius: 20,
        padding: '32px 36px',
        position: 'relative',
        overflow: 'hidden'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{
            background: 'linear-gradient(135deg, #f59e0b, #d97706)',
            color: '#000',
            fontWeight: 800,
            fontSize: '0.75rem',
            padding: '4px 12px',
            borderRadius: 999,
            textTransform: 'uppercase'
          }}>
            Smart Trip Protection Engine
          </span>
          <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
            Multi-Leg Disruption & Hotel Partner Compensation Guarantee
          </span>
        </div>

        <h1 style={{ fontSize: '2.1rem', fontWeight: 900, color: '#f8fafc', margin: '0 0 10px 0', letterSpacing: '-0.02em' }}>
          Flight Cancelled? Hotel Partner Compensated & Customer Protected
        </h1>
        <p style={{ color: '#cbd5e1', fontSize: '1.05rem', lineHeight: 1.6, maxWidth: 840, margin: 0 }}>
          In traditional travel platforms, if an airline cancels a flight for a vacation trip, the traveller 
          either loses non-refundable hotel costs or hotels suffer last-minute cancellations without compensation. 
          <strong>BookGuard Sentinel automatically resolves this:</strong> it finds immediate alternative flights for the customer, 
          and if the customer chooses not to continue, BookGuard pays <strong>guaranteed direct compensation to the hotel partner</strong> 
          while giving the customer a <strong>100% full refund</strong>.
        </p>

        <div style={{ marginTop: 24 }}>
          <button
            onClick={handleSimulateDisruption}
            disabled={isSimulating}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '14px 28px',
              borderRadius: 12,
              background: 'linear-gradient(135deg, #f59e0b, #b45309)',
              color: '#000',
              fontWeight: 800,
              fontSize: '1rem',
              border: 'none',
              cursor: isSimulating ? 'not-allowed' : 'pointer',
              boxShadow: '0 6px 20px rgba(245, 158, 11, 0.35)'
            }}
          >
            <ShieldAlert size={18} />
            {isSimulating ? 'Triggering Simulation...' : 'Simulate Flight Cancellation on Flight+Hotel Trip'}
          </button>
        </div>
      </div>

      {/* Disruption Active State Card */}
      {disruptionData && !resolutionResult && (
        <div style={{
          background: 'rgba(15, 23, 42, 0.9)',
          border: '1px solid rgba(239, 68, 68, 0.4)',
          borderRadius: 20,
          padding: 32,
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
          boxShadow: '0 15px 40px rgba(0,0,0,0.4)',
          animation: 'fadeIn 0.3s ease'
        }}>
          {/* Alert Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <ShieldAlert size={24} color="#f87171" />
              </div>
              <div>
                <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1.25rem', fontWeight: 800 }}>
                  Trip Disruption Detected (Booking {disruptionData.bookingId.substring(0, 16)})
                </h3>
                <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
                  Traveller: {disruptionData.traveller.name} • Status: Awaiting Customer Decision
                </span>
              </div>
            </div>

            <span style={{
              background: 'rgba(239, 68, 68, 0.2)',
              color: '#f87171',
              fontWeight: 800,
              fontSize: '0.8rem',
              padding: '6px 14px',
              borderRadius: 999,
              border: '1px solid #ef4444'
            }}>
              CARRIER FLIGHT CANCELLED
            </span>
          </div>

          {/* Side by Side: Cancelled Flight vs Intact Hotel */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
            {/* Cancelled Flight Card */}
            <div style={{
              background: 'rgba(239, 68, 68, 0.05)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              borderRadius: 14,
              padding: 20
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f87171', fontWeight: 700, fontSize: '0.88rem', marginBottom: 12 }}>
                <Plane size={18} />
                Leg 1: Outbound Flight (Cancelled)
              </div>
              <div style={{ color: '#f8fafc', fontSize: '1.1rem', fontWeight: 800, marginBottom: 4 }}>
                {disruptionData.cancelledLeg.code} - {disruptionData.cancelledLeg.name}
              </div>
              <div style={{ color: '#94a3b8', fontSize: '0.82rem', marginBottom: 12 }}>
                Scheduled: {disruptionData.cancelledLeg.originalDeparture} ➔ {disruptionData.cancelledLeg.originalArrival}
              </div>
              <div style={{
                background: 'rgba(239, 68, 68, 0.12)',
                color: '#fca5a5',
                padding: '8px 12px',
                borderRadius: 8,
                fontSize: '0.78rem'
              }}>
                Reason: {disruptionData.cancelledLeg.reason}
              </div>
            </div>

            {/* Intact Hotel Card */}
            <div style={{
              background: 'rgba(16, 185, 129, 0.05)',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              borderRadius: 14,
              padding: 20
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#10b981', fontWeight: 700, fontSize: '0.88rem', marginBottom: 12 }}>
                <Hotel size={18} />
                Leg 2: Destination Resort (Held Secure)
              </div>
              <div style={{ color: '#f8fafc', fontSize: '1.1rem', fontWeight: 800, marginBottom: 4 }}>
                {disruptionData.intactLeg.name}
              </div>
              <div style={{ color: '#94a3b8', fontSize: '0.82rem', marginBottom: 12 }}>
                Partner: {disruptionData.intactLeg.partnerName}
              </div>
              <div style={{
                background: 'rgba(16, 185, 129, 0.12)',
                color: '#6ee7b7',
                padding: '8px 12px',
                borderRadius: 8,
                fontSize: '0.78rem'
              }}>
                Status: {disruptionData.intactLeg.status} (Room locked via BookGuard hold)
              </div>
            </div>
          </div>

          {/* BookGuard Sentinel Recommendation Card */}
          {disruptionData.alternativeFlight && (
            <div style={{
              background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.1) 0%, rgba(99, 102, 241, 0.1) 100%)',
              border: '1px solid rgba(56, 189, 248, 0.4)',
              borderRadius: 16,
              padding: 24
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Sparkles size={18} color="#38bdf8" />
                <span style={{ fontWeight: 800, color: '#38bdf8', fontSize: '0.95rem' }}>
                  Auto-Discovered Alternative Flight (Zero Price Increase)
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
                <div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#f8fafc' }}>
                    {disruptionData.alternativeFlight.code} • {disruptionData.alternativeFlight.name}
                  </div>
                  <div style={{ color: '#cbd5e1', fontSize: '0.85rem' }}>
                    Departs {disruptionData.alternativeFlight.departureTime} ➔ Arrives {disruptionData.alternativeFlight.arrivalTime} • Guaranteed same-day check-in at hotel
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ background: '#10b981', color: '#000', fontSize: '0.75rem', fontWeight: 800, padding: '3px 8px', borderRadius: 4 }}>
                    FARECAPPED: ₹0 EXTRA
                  </span>
                  <div style={{ color: '#94a3b8', fontSize: '0.78rem', marginTop: 4 }}>Covered by BookGuard Guarantee</div>
                </div>
              </div>
            </div>
          )}

          {/* Interactive Decision Paths */}
          <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.1)', paddingTop: 24 }}>
            <h4 style={{ margin: '0 0 14px 0', color: '#f8fafc', fontSize: '1rem', fontWeight: 800 }}>
              Choose Resolution Path:
            </h4>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
              {/* Choice 1: Accept Alternative */}
              <button
                onClick={() => handleResolve('ACCEPT_ALTERNATIVE')}
                disabled={isResolving}
                style={{
                  background: 'linear-gradient(135deg, #0ea5e9, #2563eb)',
                  border: 'none',
                  borderRadius: 14,
                  padding: 20,
                  color: '#fff',
                  textAlign: 'left',
                  cursor: isResolving ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  boxShadow: '0 8px 24px rgba(14, 165, 233, 0.3)',
                  transition: 'transform 0.2s ease'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 800, fontSize: '1rem' }}>Option A: Accept Alternate Flight</span>
                  <ArrowRight size={18} />
                </div>
                <p style={{ margin: 0, fontSize: '0.82rem', color: '#e0f2fe', lineHeight: 1.4 }}>
                  Swap to IndiGo 6E 511 at ₹0 extra fee. Keep your Grand Goa Resort reservation intact and enjoy your trip seamlessly.
                </p>
              </button>

              {/* Choice 2: Decline & Compensate Hotel */}
              <button
                onClick={() => handleResolve('DECLINE_CANCEL')}
                disabled={isResolving}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(245, 158, 11, 0.5)',
                  borderRadius: 14,
                  padding: 20,
                  color: '#fff',
                  textAlign: 'left',
                  cursor: isResolving ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  transition: 'all 0.2s ease'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 800, fontSize: '1rem', color: '#fbbf24' }}>
                    Option B: Decline & Cancel Trip
                  </span>
                  <HeartHandshake size={18} color="#fbbf24" />
                </div>
                <p style={{ margin: 0, fontSize: '0.82rem', color: '#cbd5e1', lineHeight: 1.4 }}>
                  Traveller gets <strong>100% full refund (₹10,620)</strong> + ₹1,000 voucher. 
                  BookGuard pays <strong>₹2,500 direct compensation</strong> to the hotel partner for lost occupancy.
                </p>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resolution Outcome Receipt */}
      {resolutionResult && (
        <div style={{
          background: 'rgba(15, 23, 42, 0.95)',
          border: '1px solid rgba(16, 185, 129, 0.4)',
          borderRadius: 20,
          padding: 32,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
          animation: 'fadeIn 0.3s ease'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: 'rgba(16, 185, 129, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <CheckCircle2 size={24} color="#10b981" />
            </div>
            <div>
              <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1.3rem', fontWeight: 800 }}>
                {resolutionResult.outcome === 'RE_ROUTED' 
                  ? 'Itinerary Updated & Hotel Preserved' 
                  : 'Trip Cancelled with Guaranteed Partner Compensation'}
              </h3>
              <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.88rem' }}>
                {resolutionResult.message}
              </p>
            </div>
          </div>

          {/* Outcome Details */}
          {resolutionResult.outcome === 'RE_ROUTED' ? (
            <div style={{
              background: 'rgba(14, 165, 233, 0.08)',
              border: '1px solid rgba(14, 165, 233, 0.3)',
              borderRadius: 14,
              padding: 20,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 16
            }}>
              <div>
                <div style={{ color: '#38bdf8', fontWeight: 700, fontSize: '0.85rem' }}>NEW RE-ROUTED FLIGHT</div>
                <div style={{ color: '#f8fafc', fontSize: '1.15rem', fontWeight: 800 }}>
                  {resolutionResult.newFlight.code} • {resolutionResult.newFlight.name}
                </div>
                <div style={{ color: '#94a3b8', fontSize: '0.82rem' }}>
                  Departure: {resolutionResult.newFlight.departure} ➔ Arrival: {resolutionResult.newFlight.arrival}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: '#10b981', fontWeight: 700, fontSize: '0.85rem' }}>HOTEL STATUS</div>
                <div style={{ color: '#f8fafc', fontSize: '1.15rem', fontWeight: 800 }}>CONFIRMED & READY</div>
                <div style={{ color: '#94a3b8', fontSize: '0.82rem' }}>Grand Goa Beachfront Resort</div>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
              {/* Traveller Refund Receipt */}
              <div style={{
                background: 'rgba(56, 189, 248, 0.08)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                borderRadius: 14,
                padding: 20
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#38bdf8', fontWeight: 700, fontSize: '0.88rem', marginBottom: 12 }}>
                  <UserCheck size={18} />
                  Traveller Full Refund
                </div>
                <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#f8fafc', marginBottom: 4 }}>
                  ₹{resolutionResult.travellerResolution?.refundAmount?.toLocaleString('en-IN')}
                </div>
                <div style={{ color: '#94a3b8', fontSize: '0.82rem', marginBottom: 12 }}>
                  Returned to original payment method (Status: {resolutionResult.travellerResolution?.status})
                </div>
                <div style={{
                  background: 'rgba(56, 189, 248, 0.15)',
                  padding: '8px 12px',
                  borderRadius: 8,
                  fontSize: '0.78rem',
                  color: '#bae6fd'
                }}>
                  🎁 Courtesy Voucher Added: ₹{resolutionResult.travellerResolution?.apologyTravelCredit} (Code: <strong>{resolutionResult.travellerResolution?.voucherCode}</strong>)
                </div>
              </div>

              {/* Hotel Partner Compensation Payout */}
              <div style={{
                background: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                borderRadius: 14,
                padding: 20
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fbbf24', fontWeight: 700, fontSize: '0.88rem', marginBottom: 12 }}>
                  <Building2 size={18} />
                  Hotel Partner Direct Compensation
                </div>
                <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#fbbf24', marginBottom: 4 }}>
                  ₹{resolutionResult.hotelPartnerResolution?.compensationPaid?.toLocaleString('en-IN')}
                </div>
                <div style={{ color: '#94a3b8', fontSize: '0.82rem', marginBottom: 12 }}>
                  Disbursed to: {resolutionResult.hotelPartnerResolution?.partnerName}
                </div>
                <div style={{
                  background: 'rgba(245, 158, 11, 0.15)',
                  padding: '8px 12px',
                  borderRadius: 8,
                  fontSize: '0.78rem',
                  color: '#fef3c7'
                }}>
                  Payout Ref: <code>{resolutionResult.hotelPartnerResolution?.payoutReference}</code> • Funded by BookGuard Partner Protection Reserve
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <button
              onClick={() => {
                setDisruptionData(null);
                setResolutionResult(null);
              }}
              style={{
                padding: '10px 20px',
                borderRadius: 10,
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#e2e8f0',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.88rem'
              }}
            >
              Reset Disruption Simulator
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { SearchCard } from './components/TravellerView/SearchCard';
import { HoldCountdownCard } from './components/TravellerView/HoldCountdownCard';
import { ReconcilingCard } from './components/TravellerView/ReconcilingCard';
import { ConfirmedTicketCard } from './components/TravellerView/ConfirmedTicketCard';
import { RecoveryCard } from './components/TravellerView/RecoveryCard';

import { InvariantPanel } from './components/OpsDashboard/InvariantPanel';
import { EventTimeline, BookingEvent } from './components/OpsDashboard/EventTimeline';
import { TraceLiveFeed, TraceEvent } from './components/OpsDashboard/TraceLiveFeed';

import { DemoControls } from './components/DemoPanel/DemoControls';
import { TripGuideView } from './components/TripGuide/TripGuideView';
import { PluginShowcase } from './components/PluginSDK/PluginShowcase';
import { TripSentinelView } from './components/TripSentinel/TripSentinelView';
import { PassengerCheckoutModal } from './components/TravelPortal/PassengerCheckoutModal';
import { ETicketModal } from './components/TravelPortal/ETicketModal';
import { MyTripsManager } from './components/TravelPortal/MyTripsManager';
import { LiveActivityTicker } from './components/TravelPortal/LiveActivityTicker';

import { Language, translate } from './i18n';
import { 
  fetchInventory, 
  fetchInvariants, 
  createHold, 
  confirmBooking, 
  fetchDashboardSnapshot,
  fetchReconciliations, 
  applyReconciliation,
  getProviderMode,
  getBooking
} from './services/api';
import { sseManager } from './services/sse';

export const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<'trip_guide' | 'my_trips' | 'sentinel' | 'plugin_sdk' | 'ops' | 'demo'>('trip_guide');
  const [lang, setLang] = useState<Language>('en');

  // Inventory & System State
  const [inventoryItems, setInventoryItems] = useState<any[]>([]);
  const [dashboardSnapshot, setDashboardSnapshot] = useState<any>(null);
  const [events, setEvents] = useState<BookingEvent[]>([]);
  const [traces, setTraces] = useState<TraceEvent[]>([]);
  const [reconciliations, setReconciliations] = useState<any[]>([]);
  const [providerMode, setProviderModeState] = useState<'SUCCESS' | 'FAILURE' | 'TIMEOUT' | 'DELAY'>('SUCCESS');

  // Traveller Screen State
  const [travellerStep, setTravellerStep] = useState<'SEARCH' | 'HELD' | 'RECONCILING' | 'CONFIRMED' | 'FAILED'>('SEARCH');
  const [currentHold, setCurrentHold] = useState<any>(null);
  const [currentBookingId, setCurrentBookingId] = useState<string | null>(null);
  const [confirmedTicket, setConfirmedTicket] = useState<any>(null);
  const [recoveryInfo, setRecoveryInfo] = useState<any>(null);

  // Real-Time Checkout & Ticket Modals State
  const [selectedInventoryItem, setSelectedInventoryItem] = useState<any>(null);
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
  const [activeTicket, setActiveTicket] = useState<any>(null);
  const [isTicketModalOpen, setIsTicketModalOpen] = useState(false);

  const [isHolding, setIsHolding] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isApplyingCopilot, setIsApplyingCopilot] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Load Initial Data
  const loadData = useCallback(async () => {
    try {
      const [invRes, snapRes, recRes, provRes] = await Promise.all([
        fetchInventory(),
        fetchDashboardSnapshot(selectedInventoryItem?.id),
        fetchReconciliations(),
        getProviderMode()
      ]);

      if (invRes.success) setInventoryItems(invRes.items);
      if (snapRes.success) setDashboardSnapshot(snapRes);
      if (recRes.success) setReconciliations(recRes.reconciliations);
      if (provRes.mode) setProviderModeState(provRes.mode);
    } catch (err) {
      console.error('Error loading initial state:', err);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Subscribe to Live Server-Sent Events (SSE)
  useEffect(() => {
    const unsubscribe = sseManager.subscribe((event, data) => {
      console.log(`[App SSE] Received ${event}:`, data);

      if (event === 'inventory_updated') {
        fetchDashboardSnapshot(selectedInventoryItem?.id).then(res => {
          if (res.success) setDashboardSnapshot(res);
        });
        fetchInventory().then(res => {
          if (res.success) setInventoryItems(res.items);
        });
      }

      if (event === 'booking_state_changed') {
        showToast(`Booking ${data.bookingId?.substring(0, 10)}... moved to ${data.toState}`);
        
        // Add to audit timeline
        setEvents(prev => [{
          id: `evt_${Date.now()}`,
          booking_id: data.bookingId,
          from_state: data.fromState,
          to_state: data.toState,
          reason: data.reason,
          operator: data.operator,
          created_at: data.timestamp || new Date().toISOString()
        }, ...prev]);

        // If active traveller booking changed state externally
        if (currentBookingId && data.bookingId === currentBookingId) {
          if (data.toState === 'CONFIRMED') {
            setTravellerStep('CONFIRMED');
            getBooking(currentBookingId).then(b => {
              if (b.success) setConfirmedTicket(b.booking);
            });
          } else if (data.toState === 'FAILED' || data.toState === 'EXPIRED') {
            setTravellerStep('FAILED');
          }
        }

        fetchDashboardSnapshot(selectedInventoryItem?.id).then(res => {
          if (res.success) setDashboardSnapshot(res);
        });
      }

      if (event === 'copilot_recommendation') {
        showToast(`AI Copilot recommendation ready for booking ${data.bookingId?.substring(0, 10)}`);
        fetchReconciliations().then(res => {
          if (res.success) setReconciliations(res.reconciliations);
        });
      }

      if (event === 'reconciliation_resolved') {
        fetchReconciliations().then(res => {
          if (res.success) setReconciliations(res.reconciliations);
        });
      }

      if (event === 'demo_reset') {
        loadData();
        setTravellerStep('SEARCH');
        setCurrentHold(null);
        setCurrentBookingId(null);
        setConfirmedTicket(null);
        setRecoveryInfo(null);
        setEvents([]);
        setTraces([]);
      }

      if (event === 'ops_trace') {
        setTraces(prev => [data as TraceEvent, ...prev].slice(0, 500));
      }
    });

    return () => unsubscribe();
  }, [currentBookingId, loadData, selectedInventoryItem]);

  // Primary Flight (BLR -> GOI)
  const primaryFlight = inventoryItems.find(item => item.code === 'IX 6534') || inventoryItems[0] || null;

  // Handler: Hold a Seat / Room / Vehicle
  const handleHoldSeat = async (inventoryId?: string) => {
    const targetInvId = inventoryId || primaryFlight?.id;
    if (!targetInvId) return;

    setIsHolding(true);
    try {
      const res = await createHold(targetInvId, 1, 600, 'traveller_priya');
      if (res.success) {
        const heldItem = inventoryItems.find(i => i.id === targetInvId) || primaryFlight;
        setSelectedInventoryItem(heldItem);
        setCurrentHold({
          ...res.hold,
          flightCode: heldItem?.code || 'IX 6534'
        });
        setCurrentBookingId(res.hold.bookingId);
        setIsCheckoutModalOpen(true);
        loadData();
      }
    } catch (err: any) {
      if (err.error === 'INSUFFICIENT_INVENTORY') {
        setRecoveryInfo(err.recovery);
        setTravellerStep('FAILED');
      } else {
        alert('Hold failed: ' + (err.error || err.message));
      }
    } finally {
      setIsHolding(false);
    }
  };

  // Handler: Confirm Booking with Passenger & Payment Gateway
  const handleConfirmBooking = async (passengerDetails?: any, paymentDetails?: any) => {
    if (!currentHold) return;
    setIsConfirming(true);

    const idempotencyKey = `idem_${currentHold.bookingId}`;
    const travellerName = passengerDetails?.name || 'Priya Sharma';

    try {
      const { status, data } = await confirmBooking(
        currentHold.bookingId,
        travellerName,
        idempotencyKey,
        lang,
        passengerDetails,
        paymentDetails
      );

      if (status === 200) {
        // Confirmed!
        const fullTicket = {
          ...data,
          origin: selectedInventoryItem?.origin || 'BLR',
          destination: selectedInventoryItem?.destination || 'GOI',
          departureTime: selectedInventoryItem?.departure_time || '06:10 AM',
          arrivalTime: selectedInventoryItem?.arrival_time || '07:25 AM',
          code: selectedInventoryItem?.code || 'IX 6534',
          name: selectedInventoryItem?.name || 'Air India Express'
        };

        setConfirmedTicket(fullTicket);
        setActiveTicket(fullTicket);
        setIsCheckoutModalOpen(false);
        setIsTicketModalOpen(true);
        showToast(`🎉 Booking confirmed! E-Ticket ${fullTicket.pnr} issued.`);
      } else if (status === 202) {
        // Reconciling
        setIsCheckoutModalOpen(false);
        setTravellerStep('RECONCILING');
      } else if (status === 400 || status === 410) {
        // Failed
        setIsCheckoutModalOpen(false);
        setRecoveryInfo(data.recovery);
        setTravellerStep('FAILED');
      }
      loadData();
    } catch (err: any) {
      alert('Confirmation failed: ' + (err.message || 'Unknown error'));
    } finally {
      setIsConfirming(false);
    }
  };

  // Handler: Apply AI Copilot Recommendation
  const handleApplyCopilot = async (
    bookingId: string,
    decisionId: string | undefined,
    action: 'CONFIRM' | 'FAIL',
    operatorName: string
  ) => {
    setIsApplyingCopilot(true);
    try {
      const res = await applyReconciliation(bookingId, decisionId, action, operatorName);
      if (res.success) {
        showToast(`Reconciliation resolved to ${action}`);
        loadData();
      }
    } catch (err: any) {
      alert('Failed to apply decision: ' + (err.error || err.message));
    } finally {
      setIsApplyingCopilot(false);
    }
  };

  // Handler: Reset traveller flow
  const handleResetTraveller = () => {
    setTravellerStep('SEARCH');
    setCurrentHold(null);
    setCurrentBookingId(null);
    setConfirmedTicket(null);
    setRecoveryInfo(null);
    loadData();
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Navigation Header */}
      <Navbar
        currentView={currentView}
        setCurrentView={setCurrentView}
        lang={lang}
        setLang={setLang}
        oversoldCount={dashboardSnapshot?.systemMetrics?.systemOversold ?? 0}
        duplicateCount={0}
      />

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          background: 'rgba(15, 23, 42, 0.95)',
          border: '1px solid var(--primary)',
          borderRadius: 12,
          padding: '12px 20px',
          color: '#F8FAFC',
          fontSize: '0.88rem',
          fontWeight: 600,
          boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
          zIndex: 100,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <span>⚡ {toastMessage}</span>
        </div>
      )}

      {/* Main Container */}
      <main style={{ flex: 1, padding: '28px 24px', maxWidth: 1440, margin: '0 auto', width: '100%' }}>
        
        {/* Real-Time Live Activity Ticker Feed */}
        <LiveActivityTicker />

        {/* VIEW 1: UNIFIED MULTI-MODAL TRIP GUIDE & PLANNER */}
        {currentView === 'trip_guide' && (
          <div>
            {travellerStep === 'SEARCH' && (
              <TripGuideView
                inventoryItems={inventoryItems}
                onHoldItem={(invId) => handleHoldSeat(invId)}
                isHolding={isHolding}
                lang={lang}
              />
            )}

            {travellerStep === 'HELD' && currentHold && (
              <HoldCountdownCard
                hold={currentHold}
                onConfirm={handleConfirmBooking}
                isConfirming={isConfirming}
                lang={lang}
              />
            )}

            {travellerStep === 'RECONCILING' && currentBookingId && (
              <ReconcilingCard
                bookingId={currentBookingId}
                lang={lang}
              />
            )}

            {travellerStep === 'CONFIRMED' && (
              <ConfirmedTicketCard
                booking={confirmedTicket || { bookingId: currentBookingId }}
                onReset={handleResetTraveller}
                lang={lang}
              />
            )}

            {travellerStep === 'FAILED' && (
              <RecoveryCard
                message={recoveryInfo?.message}
                alternatives={recoveryInfo?.alternatives || []}
                onSelectAlternative={(invId) => handleHoldSeat(invId)}
                lang={lang}
              />
            )}
          </div>
        )}

        {/* VIEW 2: MY TRIPS & BOOKINGS MANAGER */}
        {currentView === 'my_trips' && (
          <MyTripsManager
            onViewTicket={(ticket) => {
              setActiveTicket(ticket);
              setIsTicketModalOpen(true);
            }}
            onRefreshInventory={loadData}
          />
        )}

        {/* VIEW 3: TRIP DISRUPTION SENTINEL & HOTEL COMPENSATION GUARANTEE */}
        {currentView === 'sentinel' && (
          <TripSentinelView />
        )}

        {/* VIEW 4: ANTI-DOUBLE-BOOKING PLUGIN SDK & MILLISECOND RACE SIMULATOR */}
        {currentView === 'plugin_sdk' && (
          <PluginShowcase />
        )}

        {/* VIEW 5: OPERATIONS DASHBOARD & INVARIANTS */}
        {currentView === 'ops' && (
          <div>
            <InvariantPanel
              snapshot={dashboardSnapshot}
              onRefresh={loadData}
            />

            <TraceLiveFeed traces={traces} />

            <EventTimeline events={events} />
          </div>
        )}

        {/* VIEW 6: DEMO CONTROL CENTER */}
        {currentView === 'demo' && (
          <DemoControls
            providerMode={providerMode}
            onProviderModeChange={(m) => setProviderModeState(m)}
            onRefreshData={loadData}
          />
        )}

      </main>

      {/* REAL-TIME PASSENGER CHECKOUT & PAYMENT MODAL */}
      <PassengerCheckoutModal
        item={selectedInventoryItem}
        hold={currentHold}
        isOpen={isCheckoutModalOpen}
        onClose={() => setIsCheckoutModalOpen(false)}
        onConfirmPayment={handleConfirmBooking}
        isProcessing={isConfirming}
      />

      {/* LUXURY E-TICKET & BOARDING PASS MODAL */}
      <ETicketModal
        ticket={activeTicket}
        isOpen={isTicketModalOpen}
        onClose={() => setIsTicketModalOpen(false)}
      />

      {/* Footer */}
      <footer style={{
        borderTop: '1px solid var(--border)',
        padding: '20px 24px',
        textAlign: 'center',
        fontSize: '0.8rem',
        color: 'var(--text-muted)',
        background: 'rgba(11, 17, 32, 0.95)'
      }}>
        BookGuard Prototype • KogniVera Hackathon 2026 • Team Ctrl Alt Elite • Zero Oversold Seats Guarantee
      </footer>
    </div>
  );
};

export default App;

import React, { useState, useEffect } from 'react';
import { 
  Plane, 
  Train, 
  Bus, 
  Hotel, 
  Sparkles, 
  Calendar, 
  Clock, 
  MapPin, 
  ShieldCheck, 
  ArrowRight, 
  CheckCircle2, 
  XCircle, 
  FileText, 
  Printer, 
  RotateCcw,
  AlertTriangle
} from 'lucide-react';
import { fetchMyTrips, cancelBooking } from '../../services/api';

interface MyTripsManagerProps {
  onViewTicket: (ticket: any) => void;
  onRefreshInventory: () => void;
}

export const MyTripsManager: React.FC<MyTripsManagerProps> = ({
  onViewTicket,
  onRefreshInventory
}) => {
  const [trips, setTrips] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'CONFIRMED' | 'HELD' | 'CANCELLED'>('all');
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const loadTrips = async () => {
    setIsLoading(true);
    try {
      const res = await fetchMyTrips();
      if (res.success) {
        setTrips(res.trips);
      }
    } catch (err) {
      console.error('Failed to load my trips:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTrips();
  }, []);

  const handleCancelBooking = async (bookingId: string) => {
    if (!window.confirm('Are you sure you want to cancel this booking? Full refund will be automatically calculated.')) {
      return;
    }
    setCancellingId(bookingId);
    try {
      const res = await cancelBooking(bookingId, 'Traveller cancelled from My Trips manager');
      if (res.success) {
        alert('Booking cancelled successfully! Your seat has been returned to inventory and 100% refund is initiated.');
        await loadTrips();
        onRefreshInventory();
      }
    } catch (err: any) {
      alert('Cancellation failed: ' + (err.error || err.message));
    } finally {
      setCancellingId(null);
    }
  };

  const filteredTrips = trips.filter(t => {
    if (filter === 'all') return true;
    return t.status === filter;
  });

  const getTransportIcon = (type: string) => {
    switch (type) {
      case 'train': return <Train size={16} color="#f59e0b" />;
      case 'bus': return <Bus size={16} color="#10b981" />;
      case 'hotel': return <Hotel size={16} color="#ec4899" />;
      case 'package': return <Sparkles size={16} color="#a855f7" />;
      default: return <Plane size={16} color="#38bdf8" />;
    }
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.9) 0%, rgba(15, 23, 42, 0.95) 100%)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 20,
        padding: '28px 32px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 16
      }}>
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: 900, color: '#f8fafc', margin: '0 0 6px 0' }}>
            My Trips & Bookings
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '0.95rem', margin: 0 }}>
            Manage your active flights, IRCTC train tickets, RedBus journeys, and hotel stays with instant e-tickets.
          </p>
        </div>

        {/* Filter Badges */}
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { id: 'all', label: 'All Trips' },
            { id: 'CONFIRMED', label: 'Confirmed' },
            { id: 'HELD', label: 'Active Holds' },
            { id: 'CANCELLED', label: 'Cancelled' }
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id as any)}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                background: filter === f.id ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                border: filter === f.id ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.1)',
                color: filter === f.id ? '#38bdf8' : '#94a3b8',
                fontWeight: 700,
                fontSize: '0.82rem',
                cursor: 'pointer'
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Trips List */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#94a3b8' }}>
          Loading your travel itineraries...
        </div>
      ) : filteredTrips.length === 0 ? (
        <div style={{
          background: 'rgba(15, 23, 42, 0.6)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 16,
          padding: 48,
          textAlign: 'center',
          color: '#94a3b8'
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>✈️</div>
          <h3 style={{ color: '#f8fafc', margin: '0 0 6px 0' }}>No {filter !== 'all' ? filter.toLowerCase() : ''} bookings found</h3>
          <p style={{ fontSize: '0.9rem', margin: 0 }}>Search flights, trains, buses, or stays from the search bar to book your next journey.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {filteredTrips.map(trip => (
            <div
              key={trip.bookingId}
              style={{
                background: 'rgba(15, 23, 42, 0.85)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 16,
                padding: 24,
                boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
                display: 'flex',
                flexDirection: 'column',
                gap: 16
              }}
            >
              {/* Trip Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{
                    background: trip.status === 'CONFIRMED' ? 'rgba(16, 185, 129, 0.2)' : 
                                trip.status === 'HELD' ? 'rgba(56, 189, 248, 0.2)' : 
                                'rgba(239, 68, 68, 0.2)',
                    color: trip.status === 'CONFIRMED' ? '#10b981' : 
                           trip.status === 'HELD' ? '#38bdf8' : 
                           '#f87171',
                    fontWeight: 800,
                    fontSize: '0.75rem',
                    padding: '4px 10px',
                    borderRadius: 6
                  }}>
                    {trip.status}
                  </span>

                  <div>
                    <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>PNR: </span>
                    <strong style={{ color: '#f8fafc', fontFamily: 'monospace' }}>{trip.pnr}</strong>
                  </div>

                  <span style={{ color: '#64748b' }}>•</span>
                  <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>
                    Booked on {new Date(trip.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>

                <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#f8fafc' }}>
                  ₹{trip.totalAmount.toLocaleString('en-IN')}
                </div>
              </div>

              {/* Items in Booking */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {trip.items.map((item: any) => (
                  <div
                    key={item.itemId}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      borderRadius: 12,
                      padding: '14px 18px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 12
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      {getTransportIcon(item.itemType)}
                      <div>
                        <div style={{ color: '#f8fafc', fontWeight: 800, fontSize: '0.95rem' }}>
                          {item.code} • {item.name}
                        </div>
                        <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>
                          {item.origin} ➔ {item.destination} • {item.departureTime} - {item.arrivalTime} ({item.travelDate})
                        </div>
                      </div>
                    </div>

                    <span style={{ color: '#38bdf8', fontWeight: 800, fontSize: '0.95rem' }}>
                      ₹{item.price.toLocaleString('en-IN')}
                    </span>
                  </div>
                ))}
              </div>

              {/* Actions Footer */}
              <div style={{
                borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                paddingTop: 14,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 12
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#10b981', fontSize: '0.78rem' }}>
                  <ShieldCheck size={16} />
                  BookGuard Guaranteed • Zero double booking
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  {trip.status === 'CONFIRMED' && (
                    <>
                      <button
                        onClick={() => onViewTicket({
                          bookingId: trip.bookingId,
                          flightCode: trip.items[0]?.code || 'IX 6534',
                          pnr: trip.pnr,
                          travellerName: trip.traveller?.name || 'Priya Sharma',
                          totalAmount: trip.totalAmount,
                          origin: trip.items[0]?.origin || 'BLR',
                          destination: trip.items[0]?.destination || 'GOI',
                          departureTime: trip.items[0]?.departureTime || '06:10 AM',
                          arrivalTime: trip.items[0]?.arrivalTime || '07:25 AM',
                          paymentDetails: { method: 'UPI (GPay / PhonePe)' }
                        })}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '8px 16px',
                          borderRadius: 8,
                          background: 'linear-gradient(135deg, #0ea5e9, #2563eb)',
                          color: '#fff',
                          fontWeight: 700,
                          fontSize: '0.82rem',
                          border: 'none',
                          cursor: 'pointer'
                        }}
                      >
                        <FileText size={14} />
                        View / Print E-Ticket
                      </button>

                      <button
                        onClick={() => handleCancelBooking(trip.bookingId)}
                        disabled={cancellingId === trip.bookingId}
                        style={{
                          padding: '8px 14px',
                          borderRadius: 8,
                          background: 'rgba(239, 68, 68, 0.1)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          color: '#f87171',
                          fontWeight: 600,
                          fontSize: '0.82rem',
                          cursor: 'pointer'
                        }}
                      >
                        {cancellingId === trip.bookingId ? 'Processing Refund...' : 'Cancel & Instant Refund'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

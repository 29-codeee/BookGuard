import React, { useState } from 'react';
import { 
  Plane, 
  Calendar, 
  ArrowRightLeft, 
  ShieldCheck, 
  Clock, 
  Luggage, 
  Check, 
  Users, 
  Sparkles, 
  ChevronRight,
  Flame,
  ArrowRight
} from 'lucide-react';
import { Language, translate } from '../../i18n';

interface SearchCardProps {
  flight: {
    id: string;
    code: string;
    name: string;
    origin: string;
    destination: string;
    travel_date: string;
    departure_time: string;
    arrival_time: string;
    price: number | string;
    available_quantity: number;
  } | null;
  allFlights?: any[];
  onHold: (inventoryId?: string) => void;
  isHolding: boolean;
  lang: Language;
}

export const SearchCard: React.FC<SearchCardProps> = ({
  flight,
  allFlights = [],
  onHold,
  isHolding,
  lang
}) => {
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'direct' | 'morning'>('all');

  if (!flight) {
    return (
      <div className="glass-panel" style={{ padding: 48, textAlign: 'center' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.05rem' }}>Loading live flight inventory...</p>
      </div>
    );
  }

  const availableSeats = flight.available_quantity;
  const isSoldOut = availableSeats <= 0;

  // Filter flights list
  const displayFlights = allFlights.length > 0 ? allFlights.filter(f => f.resource_type === 'flight') : [flight];

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
      
      {/* 1. PROFESSIONAL FLIGHT SEARCH & ROUTE BAR */}
      <div className="glass-panel" style={{ padding: '24px 28px', background: 'rgba(15, 23, 42, 0.85)' }}>
        {/* Trip Type & Passenger Strip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18, fontSize: '0.82rem', color: '#CBD5E1', fontWeight: 600 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#60A5FA', background: 'rgba(37, 99, 235, 0.15)', padding: '3px 10px', borderRadius: 20, border: '1px solid rgba(59, 130, 246, 0.3)' }}>
            ● {translate('tripType', lang)}
          </span>
          <span>{translate('passengers', lang)}</span>
          <span>•</span>
          <span>{translate('classEconomy', lang)}</span>
        </div>

        {/* Search Inputs Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
          alignItems: 'center'
        }}>
          {/* FROM */}
          <div style={{
            background: 'rgba(30, 41, 59, 0.7)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: '12px 16px',
            position: 'relative'
          }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
              {translate('from', lang)}
            </div>
            <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#F8FAFC', marginTop: 2 }}>
              {translate('fromCity', lang)}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>
              {translate('fromAirport', lang)}
            </div>
          </div>

          {/* SWAP ICON */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 38,
            height: 38,
            borderRadius: '50%',
            background: 'rgba(37, 99, 235, 0.2)',
            border: '1px solid rgba(59, 130, 246, 0.4)',
            color: '#60A5FA',
            margin: '0 auto',
            cursor: 'default'
          }}>
            <ArrowRightLeft size={16} />
          </div>

          {/* TO */}
          <div style={{
            background: 'rgba(30, 41, 59, 0.7)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: '12px 16px'
          }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
              {translate('to', lang)}
            </div>
            <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#F8FAFC', marginTop: 2 }}>
              {translate('toCity', lang)}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>
              {translate('toAirport', lang)}
            </div>
          </div>

          {/* DEPARTURE DATE */}
          <div style={{
            background: 'rgba(30, 41, 59, 0.7)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: '12px 16px'
          }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
              {translate('departureDate', lang)}
            </div>
            <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#F8FAFC', marginTop: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Calendar size={18} color="#60A5FA" />
              <span>{translate('dateValue', lang)}</span>
            </div>
            <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>
              Confirmed Schedule
            </div>
          </div>
        </div>

        {/* Integrity Trust Banner */}
        <div style={{
          marginTop: 18,
          paddingTop: 14,
          borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          fontSize: '0.76rem',
          color: '#94A3B8'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#34D399', fontWeight: 600 }}>
            <ShieldCheck size={16} />
            <span>{translate('integrityGuarantee', lang)}:</span>
            <span style={{ color: '#E2E8F0', fontWeight: 400 }}>{translate('integrityBullets', lang)}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#FBBF24' }}>
            <Users size={14} />
            <span>3 {translate('viewingFlight', lang)}</span>
          </div>
        </div>
      </div>

      {/* 2. FILTER & SORT STRIP */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setSelectedFilter('all')}
            style={{
              padding: '6px 14px',
              borderRadius: 20,
              fontSize: '0.78rem',
              fontWeight: 600,
              cursor: 'pointer',
              border: selectedFilter === 'all' ? '1px solid #3B82F6' : '1px solid var(--border)',
              background: selectedFilter === 'all' ? 'rgba(37, 99, 235, 0.2)' : 'rgba(15, 23, 42, 0.5)',
              color: selectedFilter === 'all' ? '#60A5FA' : 'var(--text-muted)',
              transition: 'all 0.15s'
            }}
          >
            {translate('filterAll', lang)} ({displayFlights.length})
          </button>

          <button
            onClick={() => setSelectedFilter('direct')}
            style={{
              padding: '6px 14px',
              borderRadius: 20,
              fontSize: '0.78rem',
              fontWeight: 600,
              cursor: 'pointer',
              border: selectedFilter === 'direct' ? '1px solid #3B82F6' : '1px solid var(--border)',
              background: selectedFilter === 'direct' ? 'rgba(37, 99, 235, 0.2)' : 'rgba(15, 23, 42, 0.5)',
              color: selectedFilter === 'direct' ? '#60A5FA' : 'var(--text-muted)'
            }}
          >
            {translate('filterDirect', lang)}
          </button>

          <button
            onClick={() => setSelectedFilter('morning')}
            style={{
              padding: '6px 14px',
              borderRadius: 20,
              fontSize: '0.78rem',
              fontWeight: 600,
              cursor: 'pointer',
              border: selectedFilter === 'morning' ? '1px solid #3B82F6' : '1px solid var(--border)',
              background: selectedFilter === 'morning' ? 'rgba(37, 99, 235, 0.2)' : 'rgba(15, 23, 42, 0.5)',
              color: selectedFilter === 'morning' ? '#60A5FA' : 'var(--text-muted)'
            }}
          >
            {translate('filterMorning', lang)}
          </button>
        </div>

        <div style={{ fontSize: '0.75rem', color: '#94A3B8' }}>
          {translate('flightCountSub', lang)}
        </div>
      </div>

      {/* 3. FLIGHT CARDS LIST */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {displayFlights.map((flt, index) => {
          const seats = flt.available_quantity;
          const soldOut = seats <= 0;
          const isPrimary = flt.code === 'IX 6534';

          return (
            <div
              key={flt.id || index}
              className="glass-panel"
              style={{
                padding: '24px 28px',
                background: isPrimary ? 'rgba(19, 30, 54, 0.85)' : 'rgba(15, 23, 42, 0.75)',
                border: isPrimary ? '1.5px solid rgba(59, 130, 246, 0.45)' : '1px solid var(--border)',
                borderRadius: 16,
                position: 'relative',
                overflow: 'hidden'
              }}
            >
              {/* Primary Featured Tag */}
              {isPrimary && (
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: 28,
                  background: 'linear-gradient(135deg, #2563EB, #06B6D4)',
                  color: '#FFFFFF',
                  fontSize: '0.68rem',
                  fontWeight: 800,
                  padding: '3px 12px',
                  borderBottomLeftRadius: 6,
                  borderBottomRightRadius: 6,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase'
                }}>
                  ★ Hackathon Target Flight (3 Seats Prototype)
                </div>
              )}

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 20,
                alignItems: 'center',
                marginTop: isPrimary ? 8 : 0
              }}>
                {/* Airline & Schedule Left Column */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                    {/* Airline Logo Mark */}
                    <div style={{
                      width: 44,
                      height: 44,
                      borderRadius: 10,
                      background: flt.name?.includes('Air India') ? 'linear-gradient(135deg, #DC2626, #F97316)' : flt.name?.includes('IndiGo') ? 'linear-gradient(135deg, #1D4ED8, #3B82F6)' : 'linear-gradient(135deg, #EA580C, #FBBF24)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#FFFFFF',
                      fontWeight: 900,
                      fontSize: '1rem',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                    }}>
                      <Plane size={22} />
                    </div>

                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: '1.05rem', fontWeight: 800, color: '#F8FAFC' }}>
                          {flt.name || translate('flightOperator', lang)}
                        </span>
                        <span style={{
                          background: '#1E293B',
                          color: '#60A5FA',
                          fontWeight: 700,
                          fontSize: '0.78rem',
                          padding: '2px 8px',
                          borderRadius: 6
                        }}>
                          {flt.code}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#94A3B8' }}>
                        {translate('aircraft', lang)} • {translate('directFlight', lang)}
                      </div>
                    </div>
                  </div>

                  {/* Flight Timeline */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                    <div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#F8FAFC' }}>
                        {flt.departure_time}
                      </div>
                      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#CBD5E1' }}>BLR</div>
                      <div style={{ fontSize: '0.7rem', color: '#94A3B8' }}>Bengaluru</div>
                    </div>

                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 10px' }}>
                      <span style={{ fontSize: '0.72rem', color: '#94A3B8', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={12} /> {translate('duration', lang)}
                      </span>
                      <div style={{ width: '100%', height: 2, background: 'var(--border)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: '#3B82F6',
                          position: 'absolute',
                          left: 0
                        }} />
                        <Plane size={14} color="#60A5FA" style={{ transform: 'rotate(90deg)', background: '#131E36', padding: '0 2px' }} />
                        <div style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: '#3B82F6',
                          position: 'absolute',
                          right: 0
                        }} />
                      </div>
                      <span style={{ fontSize: '0.68rem', color: '#34D399', fontWeight: 600, marginTop: 4 }}>
                        {translate('directFlight', lang)}
                      </span>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#F8FAFC' }}>
                        {flt.arrival_time}
                      </div>
                      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#CBD5E1' }}>GOI</div>
                      <div style={{ fontSize: '0.7rem', color: '#94A3B8' }}>Goa Dabolim</div>
                    </div>
                  </div>

                  {/* Amenities Row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 14, fontSize: '0.72rem', color: '#94A3B8' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Luggage size={13} color="#60A5FA" /> {translate('baggage', lang)}
                    </span>
                    <span>•</span>
                    <span style={{ color: '#34D399' }}>✓ Free Seat Hold</span>
                  </div>
                </div>

                {/* Right Price & Hold Action Column */}
                <div style={{
                  borderLeft: '1px solid rgba(255,255,255,0.08)',
                  paddingLeft: 24,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 16
                }}>
                  {/* Seat Invariant & Scarcity Notice */}
                  <div>
                    {soldOut ? (
                      <div style={{
                        background: 'rgba(239, 68, 68, 0.15)',
                        border: '1px solid rgba(239, 68, 68, 0.4)',
                        color: '#F87171',
                        padding: '6px 12px',
                        borderRadius: 8,
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}>
                        <span>SOLD OUT</span>
                      </div>
                    ) : (
                      <div style={{
                        background: seats <= 3 ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                        border: `1px solid ${seats <= 3 ? 'rgba(245, 158, 11, 0.4)' : 'rgba(16, 185, 129, 0.4)'}`,
                        color: seats <= 3 ? '#FBBF24' : '#34D399',
                        padding: '6px 12px',
                        borderRadius: 8,
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}>
                        <Flame size={15} color={seats <= 3 ? '#F59E0B' : '#10B981'} />
                        <span>{translate('urgentSeats', lang, { n: seats })}</span>
                      </div>
                    )}
                    <div style={{ fontSize: '0.7rem', color: '#94A3B8', marginTop: 4, fontFamily: 'monospace' }}>
                      {translate('verifiedAcid', lang)}
                    </div>
                  </div>

                  {/* Price */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={{ fontSize: '2rem', fontWeight: 900, color: '#F8FAFC', letterSpacing: '-0.02em' }}>
                        ₹{Number(flt.price).toLocaleString()}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {translate('perTraveller', lang)}
                    </div>
                  </div>

                  {/* Hold Button */}
                  <button
                    id={isPrimary ? 'btn-hold-seat' : `btn-hold-${flt.id}`}
                    className="btn btn-primary"
                    style={{
                      padding: '14px 20px',
                      fontSize: '0.95rem',
                      fontWeight: 700,
                      width: '100%',
                      boxShadow: '0 6px 20px rgba(37, 99, 235, 0.4)'
                    }}
                    onClick={() => onHold(flt.id)}
                    disabled={isHolding || soldOut}
                  >
                    {isHolding ? translate('holdingInProgress', lang) : soldOut ? 'Sold Out' : translate('holdThisSeat', lang)}
                    <ArrowRight size={17} />
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

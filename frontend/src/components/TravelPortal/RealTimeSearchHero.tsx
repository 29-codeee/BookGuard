import React, { useState } from 'react';
import { 
  Plane, 
  Train, 
  Bus, 
  Hotel, 
  Sparkles, 
  Search, 
  ArrowLeftRight, 
  Calendar, 
  Users, 
  MapPin, 
  ShieldCheck,
  TrendingUp,
  Tag
} from 'lucide-react';

interface RealTimeSearchHeroProps {
  onSearch: (params: {
    resource_type: string;
    origin: string;
    destination: string;
    date: string;
    passengers: number;
    travelClass: string;
  }) => void;
  activeCategory: string;
  onCategoryChange: (cat: string) => void;
}

const CITIES = [
  { code: 'BLR', name: 'Bengaluru (BLR)', airport: 'Kempegowda Intl / SBC Station' },
  { code: 'GOI', name: 'Goa (GOI/MAO)', airport: 'Dabolim / Mopa / Madgaon' },
  { code: 'DEL', name: 'New Delhi (DEL)', airport: 'Indira Gandhi Intl / NDLS' },
  { code: 'BOM', name: 'Mumbai (BOM)', airport: 'Chhatrapati Shivaji Intl / CSMT' },
  { code: 'HYD', name: 'Hyderabad (HYD)', airport: 'Rajiv Gandhi Intl / Secunderabad' },
  { code: 'JAI', name: 'Jaipur (JAI)', airport: 'Jaipur Intl / Jaipur Junction' },
  { code: 'COK', name: 'Kochi / Kerala (COK)', airport: 'Cochin Intl / Ernakulam' },
  { code: 'MAA', name: 'Chennai (MAA)', airport: 'Chennai Intl / Chennai Central' }
];

export const RealTimeSearchHero: React.FC<RealTimeSearchHeroProps> = ({
  onSearch,
  activeCategory,
  onCategoryChange
}) => {
  const [origin, setOrigin] = useState('BLR');
  const [destination, setDestination] = useState('GOI');
  const [travelDate, setTravelDate] = useState('2026-09-25');
  const [passengers, setPassengers] = useState(1);
  const [travelClass, setTravelClass] = useState('Economy / Standard');

  const handleSwap = () => {
    const temp = origin;
    setOrigin(destination);
    setDestination(temp);
    onSearch({
      resource_type: activeCategory,
      origin: destination,
      destination: origin,
      date: travelDate,
      passengers,
      travelClass
    });
  };

  const handleTabClick = (catId: string) => {
    onCategoryChange(catId);
    onSearch({
      resource_type: catId,
      origin,
      destination,
      date: travelDate,
      passengers,
      travelClass
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch({
      resource_type: activeCategory,
      origin,
      destination,
      date: travelDate,
      passengers,
      travelClass
    });
  };

  const handleQuickRoute = (orig: string, dest: string, cat?: string) => {
    const targetCat = cat || activeCategory;
    setOrigin(orig);
    setDestination(dest);
    onCategoryChange(targetCat);
    onSearch({
      resource_type: targetCat,
      origin: orig,
      destination: dest,
      date: travelDate,
      passengers,
      travelClass
    });
  };

  return (
    <div style={{
      background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.98) 0%, rgba(30, 41, 59, 0.95) 100%)',
      border: '1px solid rgba(56, 189, 248, 0.25)',
      borderRadius: 24,
      padding: '36px 36px 28px',
      boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Background glow circle */}
      <div style={{
        position: 'absolute',
        top: -60,
        right: -60,
        width: 300,
        height: 300,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(14, 165, 233, 0.18) 0%, transparent 70%)',
        pointerEvents: 'none'
      }} />

      {/* Brand Hero Heading */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{
              background: 'linear-gradient(135deg, #0ea5e9, #38bdf8)',
              color: '#000',
              fontWeight: 800,
              fontSize: '0.72rem',
              padding: '4px 10px',
              borderRadius: 999,
              letterSpacing: '0.04em',
              textTransform: 'uppercase'
            }}>
              Real-Time Travel Engine
            </span>
            <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
              Instant Booking • Zero Double Bookings • Full Compensation Guarantee
            </span>
          </div>
          <h1 style={{ fontSize: '2.4rem', fontWeight: 900, color: '#f8fafc', margin: '0 0 6px 0', letterSpacing: '-0.02em' }}>
            Where would you like to travel today?
          </h1>
          <p style={{ color: '#cbd5e1', fontSize: '1rem', margin: 0 }}>
            Search flights, IRCTC trains, RedBus sleepers, and luxury stays across India with live inventory locks.
          </p>
        </div>

        {/* Live Integrity Trust Badge */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'rgba(16, 185, 129, 0.12)',
          border: '1px solid rgba(16, 185, 129, 0.35)',
          padding: '10px 16px',
          borderRadius: 14
        }}>
          <ShieldCheck size={22} color="#10b981" />
          <div>
            <div style={{ color: '#10b981', fontSize: '0.78rem', fontWeight: 800 }}>BOOKGUARD ACTIVE</div>
            <div style={{ color: '#e2e8f0', fontSize: '0.75rem' }}>0 Oversold • Guaranteed Seats</div>
          </div>
        </div>
      </div>

      {/* Search Category Tabs */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 10,
        marginBottom: 24,
        background: 'rgba(15, 23, 42, 0.7)',
        padding: 6,
        borderRadius: 16,
        border: '1px solid rgba(255, 255, 255, 0.08)',
        width: 'fit-content'
      }}>
        {[
          { id: 'all', label: 'All Modes', icon: <MapPin size={16} /> },
          { id: 'flight', label: 'Flights', icon: <Plane size={16} /> },
          { id: 'train', label: 'IRCTC Trains', icon: <Train size={16} /> },
          { id: 'bus', label: 'RedBus Buses', icon: <Bus size={16} /> },
          { id: 'hotel', label: 'Hotels & Stays', icon: <Hotel size={16} /> },
          { id: 'package', label: 'Holiday Bundles', icon: <Sparkles size={16} /> }
        ].map(cat => (
          <button
            key={cat.id}
            type="button"
            onClick={() => handleTabClick(cat.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 20px',
              borderRadius: 12,
              background: activeCategory === cat.id ? 'linear-gradient(135deg, #0ea5e9, #2563eb)' : 'transparent',
              color: activeCategory === cat.id ? '#ffffff' : '#94a3b8',
              fontWeight: activeCategory === cat.id ? 800 : 600,
              fontSize: '0.88rem',
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.18s ease',
              boxShadow: activeCategory === cat.id ? '0 4px 14px rgba(14, 165, 233, 0.35)' : 'none'
            }}
          >
            {cat.icon}
            {cat.label}
          </button>
        ))}
      </div>

      {/* Interactive Search Console Form */}
      <form onSubmit={handleSubmit} style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr)) 60px 1fr 140px 180px 140px',
        gap: 12,
        alignItems: 'center',
        background: 'rgba(2, 6, 23, 0.8)',
        border: '1.5px solid rgba(56, 189, 248, 0.3)',
        borderRadius: 18,
        padding: '16px 20px'
      }}>
        {/* Origin Selector */}
        <div>
          <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>
            {activeCategory === 'hotel' ? 'Origin City' : 'From (Origin)'}
          </label>
          <select
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              color: '#f8fafc',
              fontSize: '1rem',
              fontWeight: 800,
              cursor: 'pointer',
              outline: 'none'
            }}
          >
            {CITIES.map(c => (
              <option key={c.code} value={c.code} style={{ background: '#0f172a', color: '#fff' }}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Swap Button */}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <button
            type="button"
            onClick={handleSwap}
            title="Swap Origin & Destination"
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: '#38bdf8',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'transform 0.2s ease'
            }}
          >
            <ArrowLeftRight size={16} />
          </button>
        </div>

        {/* Destination Selector */}
        <div>
          <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>
            {activeCategory === 'hotel' ? 'Hotel Destination City' : 'To (Destination)'}
          </label>
          <select
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              color: '#f8fafc',
              fontSize: '1rem',
              fontWeight: 800,
              cursor: 'pointer',
              outline: 'none'
            }}
          >
            {CITIES.map(c => (
              <option key={c.code} value={c.code} style={{ background: '#0f172a', color: '#fff' }}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Travel Date */}
        <div>
          <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>
            Departure Date
          </label>
          <input
            type="date"
            value={travelDate}
            onChange={(e) => setTravelDate(e.target.value)}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              color: '#f8fafc',
              fontSize: '0.92rem',
              fontWeight: 700,
              outline: 'none',
              cursor: 'pointer'
            }}
          />
        </div>

        {/* Passengers / Guests */}
        <div>
          <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>
            Travellers / Class
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <select
              value={passengers}
              onChange={(e) => setPassengers(parseInt(e.target.value, 10))}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#f8fafc',
                fontSize: '0.92rem',
                fontWeight: 700,
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value={1} style={{ background: '#0f172a', color: '#fff' }}>1 Passenger</option>
              <option value={2} style={{ background: '#0f172a', color: '#fff' }}>2 Passengers</option>
              <option value={3} style={{ background: '#0f172a', color: '#fff' }}>3 Passengers</option>
              <option value={4} style={{ background: '#0f172a', color: '#fff' }}>4+ Group</option>
            </select>
          </div>
        </div>

        {/* Submit Search Button */}
        <div>
          <button
            type="submit"
            style={{
              width: '100%',
              padding: '14px 20px',
              borderRadius: 12,
              background: 'linear-gradient(135deg, #0ea5e9, #2563eb)',
              color: '#fff',
              fontWeight: 800,
              fontSize: '0.95rem',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              boxShadow: '0 4px 20px rgba(14, 165, 233, 0.4)'
            }}
          >
            <Search size={18} />
            Search
          </button>
        </div>
      </form>

      {/* Quick Indian Popular Route Chips */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
        <span style={{ color: '#94a3b8', fontSize: '0.78rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
          <TrendingUp size={14} color="#38bdf8" />
          POPULAR SECTORS:
        </span>

        {[
          { orig: 'BLR', dest: 'GOI', label: 'Bengaluru ➔ Goa (Flights & Stays)', cat: 'all' },
          { orig: 'DEL', dest: 'BOM', label: 'Delhi ➔ Mumbai (Vistara & Rajdhani)', cat: 'flight' },
          { orig: 'BOM', dest: 'GOI', label: 'Mumbai ➔ Goa (Shatabdi & Beach)', cat: 'all' },
          { orig: 'DEL', dest: 'JAI', label: 'Delhi ➔ Jaipur (RedBus Sleeper)', cat: 'bus' },
          { orig: 'BLR', dest: 'COK', label: 'Bengaluru ➔ Kerala (Backwaters)', cat: 'package' }
        ].map((rt, i) => (
          <button
            key={i}
            type="button"
            onClick={() => handleQuickRoute(rt.orig, rt.dest, rt.cat)}
            style={{
              padding: '5px 12px',
              borderRadius: 999,
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#cbd5e1',
              fontSize: '0.78rem',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            {rt.label}
          </button>
        ))}
      </div>
    </div>
  );
};

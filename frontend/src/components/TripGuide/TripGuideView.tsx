import React, { useState } from 'react';
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
  Check, 
  Plus, 
  Trash2,
  Tag,
  Star,
  Users
} from 'lucide-react';
import { Language, translate } from '../../i18n';
import { RealTimeSearchHero } from '../TravelPortal/RealTimeSearchHero';

interface TripGuideViewProps {
  inventoryItems: any[];
  onHoldItem: (inventoryId: string) => void;
  isHolding: boolean;
  lang: Language;
}

export const TripGuideView: React.FC<TripGuideViewProps> = ({
  inventoryItems,
  onHoldItem,
  isHolding,
  lang
}) => {
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchFilter, setSearchFilter] = useState<{ origin?: string; destination?: string } | null>(null);
  const [sortBy, setSortBy] = useState<'default' | 'price_asc' | 'price_desc' | 'available_desc'>('default');
  const [tripCart, setTripCart] = useState<any[]>([]);

  // Intelligent multi-modal filtering
  let filteredItems = inventoryItems.filter(item => {
    // 1. Category Filter
    if (activeCategory !== 'all' && item.resource_type !== activeCategory) {
      return false;
    }

    // 2. Hotel Destination Matching (Hotels are stays located in destination city)
    if (item.resource_type === 'hotel') {
      if (searchFilter?.destination && searchFilter.destination !== 'all') {
        const targetCity = searchFilter.destination.toUpperCase();
        return item.destination.toUpperCase() === targetCity || item.origin.toUpperCase() === targetCity;
      }
      return true;
    }

    // 3. Travel Route Matching (Flights, Trains, Buses, Packages)
    if (searchFilter?.origin && searchFilter.origin !== 'all') {
      if (item.origin.toUpperCase() !== searchFilter.origin.toUpperCase()) {
        return false;
      }
    }
    if (searchFilter?.destination && searchFilter.destination !== 'all') {
      if (item.destination.toUpperCase() !== searchFilter.destination.toUpperCase()) {
        return false;
      }
    }
    return true;
  });

  // Check for alternative travel options on the same route in other modes
  const sameRouteOtherModes = (searchFilter && filteredItems.length === 0) ? inventoryItems.filter(item => {
    if (item.resource_type === 'hotel') return false;
    const matchOrigin = !searchFilter.origin || searchFilter.origin === 'all' || item.origin.toUpperCase() === searchFilter.origin.toUpperCase();
    const matchDest = !searchFilter.destination || searchFilter.destination === 'all' || item.destination.toUpperCase() === searchFilter.destination.toUpperCase();
    return matchOrigin && matchDest;
  }) : [];

  // If no exact items and no other modes, fallback list shows all items for active category
  const isFallbackActive = filteredItems.length === 0;
  const itemsToDisplay = filteredItems.length > 0 
    ? filteredItems 
    : sameRouteOtherModes.length > 0 
      ? sameRouteOtherModes 
      : inventoryItems.filter(item => activeCategory === 'all' || item.resource_type === activeCategory);

  // Sort items
  if (sortBy === 'price_asc') {
    itemsToDisplay.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
  } else if (sortBy === 'price_desc') {
    itemsToDisplay.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
  } else if (sortBy === 'available_desc') {
    itemsToDisplay.sort((a, b) => b.available_quantity - a.available_quantity);
  }

  const handleSearch = (params: { resource_type: string; origin: string; destination: string }) => {
    setActiveCategory(params.resource_type);
    setSearchFilter({ origin: params.origin, destination: params.destination });
  };

  const handleClearFilters = () => {
    setActiveCategory('all');
    setSearchFilter(null);
  };

  const addToCart = (item: any) => {
    if (!tripCart.some(c => c.id === item.id)) {
      setTripCart(prev => [...prev, item]);
    }
  };

  const removeFromCart = (id: string) => {
    setTripCart(prev => prev.filter(c => c.id !== id));
  };

  const cartTotal = tripCart.reduce((sum, item) => sum + parseFloat(item.price), 0);

  const getCategoryIcon = (type: string) => {
    switch (type) {
      case 'flight': return <Plane size={16} color="#38bdf8" />;
      case 'train': return <Train size={16} color="#f59e0b" />;
      case 'bus': return <Bus size={16} color="#10b981" />;
      case 'hotel': return <Hotel size={16} color="#ec4899" />;
      case 'package': return <Sparkles size={16} color="#a855f7" />;
      default: return <MapPin size={16} color="#94a3b8" />;
    }
  };

  const getCategoryBadge = (type: string) => {
    switch (type) {
      case 'flight': return { text: 'Airlines', bg: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' };
      case 'train': return { text: 'IRCTC Railway', bg: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' };
      case 'bus': return { text: 'RedBus Verified', bg: 'rgba(16, 185, 129, 0.15)', color: '#10b981' };
      case 'hotel': return { text: 'Resort & Stay', bg: 'rgba(236, 72, 153, 0.15)', color: '#ec4899' };
      case 'package': return { text: 'All-in-One Trip', bg: 'rgba(168, 85, 247, 0.15)', color: '#a855f7' };
      default: return { text: type, bg: 'rgba(255, 255, 255, 0.1)', color: '#fff' };
    }
  };

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Real-Time Search Hero Console */}
      <RealTimeSearchHero
        onSearch={handleSearch}
        activeCategory={activeCategory}
        onCategoryChange={(cat) => {
          setActiveCategory(cat);
          setSearchFilter(null);
        }}
      />

      {/* Intelligent Route & Fallback Notice if exact category direct route is alternate */}
      {isFallbackActive && searchFilter && sameRouteOtherModes.length > 0 && (
        <div style={{
          background: 'rgba(14, 165, 233, 0.12)',
          border: '1px solid rgba(56, 189, 248, 0.35)',
          borderRadius: 14,
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12
        }}>
          <div>
            <div style={{ color: '#38bdf8', fontWeight: 800, fontSize: '0.95rem' }}>
              💡 Alternate Modes Available for {searchFilter.origin} ➔ {searchFilter.destination}
            </div>
            <div style={{ color: '#cbd5e1', fontSize: '0.84rem', marginTop: 2 }}>
              No direct {activeCategory} services found for this sector, but we found {sameRouteOtherModes.length} high-demand options in other modes below!
            </div>
          </div>
          <button
            onClick={() => setActiveCategory('all')}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              background: 'linear-gradient(135deg, #0ea5e9, #2563eb)',
              color: '#fff',
              fontWeight: 800,
              fontSize: '0.82rem',
              border: 'none',
              cursor: 'pointer'
            }}
          >
            Show All Modes
          </button>
        </div>
      )}

      {isFallbackActive && searchFilter && sameRouteOtherModes.length === 0 && (
        <div style={{
          background: 'rgba(245, 158, 11, 0.12)',
          border: '1px solid rgba(245, 158, 11, 0.35)',
          borderRadius: 14,
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12
        }}>
          <div>
            <div style={{ color: '#fbbf24', fontWeight: 800, fontSize: '0.95rem' }}>
              Showing All Popular Available Routes Across India
            </div>
            <div style={{ color: '#cbd5e1', fontSize: '0.84rem', marginTop: 2 }}>
              No direct services currently scheduled between {searchFilter.origin} and {searchFilter.destination}. Explore our active verified sectors below.
            </div>
          </div>
          <button
            onClick={handleClearFilters}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#fff',
              fontWeight: 700,
              fontSize: '0.82rem',
              cursor: 'pointer'
            }}
          >
            Clear Search Filter ✕
          </button>
        </div>
      )}

      {/* Results Header with Sorting and Filter Status */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 16,
        padding: '0 4px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
            {activeCategory === 'all' ? 'All Available Travel & Stays' : 
             activeCategory === 'flight' ? 'Available Flights' :
             activeCategory === 'train' ? 'IRCTC Express Trains' :
             activeCategory === 'bus' ? 'RedBus Verified Sleepers' :
             activeCategory === 'hotel' ? 'Luxury Resorts & Hotels' : 'Curated Vacation Packages'}
          </h2>
          <span style={{
            background: 'rgba(56, 189, 248, 0.15)',
            color: '#38bdf8',
            fontSize: '0.8rem',
            fontWeight: 800,
            padding: '3px 10px',
            borderRadius: 999
          }}>
            {itemsToDisplay.length} options found
          </span>

          {searchFilter && (
            <button
              onClick={handleClearFilters}
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                border: 'none',
                color: '#94a3b8',
                padding: '4px 10px',
                borderRadius: 6,
                fontSize: '0.75rem',
                cursor: 'pointer'
              }}
            >
              Clear Route Filter ✕
            </button>
          )}
        </div>

        {/* Sort Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: '#94a3b8', fontSize: '0.82rem', fontWeight: 600 }}>Sort by:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            style={{
              background: 'rgba(15, 23, 42, 0.9)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: 8,
              padding: '6px 12px',
              color: '#f8fafc',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              outline: 'none'
            }}
          >
            <option value="default">Recommended</option>
            <option value="price_asc">Price: Low to High</option>
            <option value="price_desc">Price: High to Low</option>
            <option value="available_desc">Highest Availability</option>
          </select>
        </div>
      </div>

      {/* Main Grid: Inventory Items + Trip Builder Sidebar */}
      <div style={{ display: 'grid', gridTemplateColumns: tripCart.length > 0 ? '1fr 340px' : '1fr', gap: 24, alignItems: 'start' }}>
        {/* Inventory Cards Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 20 }}>
          {itemsToDisplay.map(item => {
            const badge = getCategoryBadge(item.resource_type);
            const inCart = tripCart.some(c => c.id === item.id);

            return (
              <div
                key={item.id}
                style={{
                  background: 'rgba(15, 23, 42, 0.85)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 16,
                  padding: 24,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
                  transition: 'transform 0.2s ease, border-color 0.2s ease',
                  position: 'relative'
                }}
              >
                <div>
                  {/* Top Bar */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <span style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      background: badge.bg,
                      color: badge.color,
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      padding: '4px 10px',
                      borderRadius: 6
                    }}>
                      {getCategoryIcon(item.resource_type)}
                      {badge.text}
                    </span>

                    <span style={{
                      color: item.available_quantity <= 1 ? '#f87171' : '#10b981',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      background: item.available_quantity <= 1 ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                      padding: '3px 8px',
                      borderRadius: 4
                    }}>
                      {item.available_quantity === 1 ? '🔥 ONLY 1 LEFT' : `${item.available_quantity} available`}
                    </span>
                  </div>

                  {/* Title & Route */}
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#f8fafc', margin: '0 0 6px 0' }}>
                    {item.name}
                  </h3>
                  <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>{item.code}</span>
                    <span>•</span>
                    <span>{item.origin} ➔ {item.destination}</span>
                  </div>

                  {/* Schedule Details */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: 10,
                    background: 'rgba(255, 255, 255, 0.03)',
                    marginBottom: 16,
                    fontSize: '0.82rem'
                  }}>
                    <div>
                      <div style={{ color: '#64748b' }}>Departure / Check-in</div>
                      <strong style={{ color: '#f8fafc' }}>{item.departure_time}</strong>
                    </div>
                    <div>
                      <div style={{ color: '#64748b' }}>Arrival / Check-out</div>
                      <strong style={{ color: '#f8fafc' }}>{item.arrival_time}</strong>
                    </div>
                    <div>
                      <div style={{ color: '#64748b' }}>Date</div>
                      <strong style={{ color: '#f8fafc' }}>{item.travel_date}</strong>
                    </div>
                  </div>
                </div>

                {/* Price & Action */}
                <div style={{
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                  paddingTop: 16,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div>
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Price per seat/room</span>
                    <div style={{ fontSize: '1.35rem', fontWeight: 900, color: '#f8fafc' }}>
                      ₹{parseFloat(item.price).toLocaleString('en-IN')}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => inCart ? removeFromCart(item.id) : addToCart(item)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 10,
                        background: inCart ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 255, 255, 0.08)',
                        border: inCart ? '1px solid #ef4444' : '1px solid rgba(255, 255, 255, 0.15)',
                        color: inCart ? '#ef4444' : '#e2e8f0',
                        fontWeight: 600,
                        fontSize: '0.82rem',
                        cursor: 'pointer'
                      }}
                      title={inCart ? 'Remove from custom trip bundle' : 'Add to custom trip bundle'}
                    >
                      {inCart ? <Trash2 size={16} /> : <Plus size={16} />}
                    </button>

                    <button
                      onClick={() => onHoldItem(item.id)}
                      disabled={isHolding || item.available_quantity < 1}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '10px 18px',
                        borderRadius: 10,
                        background: item.available_quantity < 1 
                          ? '#334155' 
                          : 'linear-gradient(135deg, #0ea5e9, #2563eb)',
                        color: '#fff',
                        fontWeight: 800,
                        fontSize: '0.88rem',
                        border: 'none',
                        cursor: item.available_quantity < 1 ? 'not-allowed' : 'pointer',
                        boxShadow: item.available_quantity < 1 ? 'none' : '0 4px 12px rgba(14, 165, 233, 0.3)'
                      }}
                    >
                      <span>Book Direct</span>
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Custom Multi-Leg Trip Builder Sidebar */}
        {tripCart.length > 0 && (
          <div style={{
            background: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            borderRadius: 16,
            padding: 24,
            boxShadow: '0 15px 40px rgba(0,0,0,0.4)',
            position: 'sticky',
            top: 24
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Sparkles size={18} color="#38bdf8" />
                <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#f8fafc', fontWeight: 800 }}>
                  Custom Trip Bundle
                </h3>
              </div>
              <span style={{ background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8', fontSize: '0.75rem', fontWeight: 800, padding: '3px 8px', borderRadius: 999 }}>
                {tripCart.length} Legs
              </span>
            </div>

            {/* Cart Items */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {tripCart.map(c => (
                <div key={c.id} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.06)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {getCategoryIcon(c.resource_type)}
                    <div>
                      <div style={{ color: '#f8fafc', fontSize: '0.85rem', fontWeight: 700 }}>{c.code}</div>
                      <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>{c.name.substring(0, 20)}...</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ color: '#38bdf8', fontWeight: 800, fontSize: '0.85rem' }}>
                      ₹{parseFloat(c.price).toLocaleString('en-IN')}
                    </span>
                    <button
                      onClick={() => removeFromCart(c.id)}
                      style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 0 }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Total and Checkout */}
            <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.1)', paddingTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Bundle Total</span>
                <span style={{ color: '#f8fafc', fontSize: '1.35rem', fontWeight: 900 }}>
                  ₹{cartTotal.toLocaleString('en-IN')}
                </span>
              </div>

              <div style={{
                background: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.2)',
                borderRadius: 8,
                padding: '8px 12px',
                color: '#6ee7b7',
                fontSize: '0.75rem',
                marginBottom: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}>
                <ShieldCheck size={14} />
                Multi-leg SAGA guarantee: full compensation if any leg disrupted
              </div>

              <button
                onClick={() => onHoldItem(tripCart[0]?.id)}
                disabled={isHolding}
                style={{
                  width: '100%',
                  padding: '14px',
                  borderRadius: 10,
                  background: 'linear-gradient(135deg, #10b981, #059669)',
                  color: '#fff',
                  fontWeight: 800,
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '0.95rem',
                  boxShadow: '0 4px 16px rgba(16, 185, 129, 0.3)'
                }}
              >
                Hold Bundle & Check Out
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

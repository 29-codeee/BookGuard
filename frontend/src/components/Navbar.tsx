import React from 'react';
import { ShieldCheck, Plane, LayoutDashboard, Cpu, Globe, Check, Database } from 'lucide-react';
import { Language, translate } from '../i18n';

interface NavbarProps {
  currentView: 'trip_guide' | 'ai_planner' | 'data_catalog' | 'my_trips' | 'sentinel' | 'plugin_sdk' | 'ops' | 'demo';
  setCurrentView: (view: 'trip_guide' | 'ai_planner' | 'data_catalog' | 'my_trips' | 'sentinel' | 'plugin_sdk' | 'ops' | 'demo') => void;
  lang: Language;
  setLang: (lang: Language) => void;
  oversoldCount: number;
  duplicateCount: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentView,
  setCurrentView,
  lang,
  setLang,
  oversoldCount,
  duplicateCount
}) => {
  return (
    <header style={{
      borderBottom: '1px solid var(--border)',
      background: 'rgba(11, 17, 32, 0.94)',
      backdropFilter: 'blur(16px)',
      position: 'sticky',
      top: 0,
      zIndex: 50,
      padding: '12px 24px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.4)'
    }}>
      <div style={{
        maxWidth: 1440,
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 16
      }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => setCurrentView('trip_guide')}>
          <div style={{
            background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
            padding: 9,
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 20px rgba(14, 165, 233, 0.4)'
          }}>
            <ShieldCheck size={26} color="#FFFFFF" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="brand-title" style={{ fontSize: '1.45rem', fontWeight: 900, color: '#F8FAFC', letterSpacing: '-0.02em' }}>
                {translate('brand', lang)}
              </span>
              <span style={{
                fontSize: '0.68rem',
                fontWeight: 800,
                background: 'rgba(14, 165, 233, 0.25)',
                color: '#38bdf8',
                padding: '2px 8px',
                borderRadius: 12,
                border: '1px solid rgba(56, 189, 248, 0.35)',
                letterSpacing: '0.04em'
              }}>
                TRAVEL & INTEGRITY
              </span>
            </div>
            <p style={{ fontSize: '0.78rem', color: '#94A3B8', fontWeight: 500, margin: 0 }}>
              Zero Oversold Guarantee • Indian Sectors • Partner Protection Reserve
            </p>
          </div>
        </div>

        {/* Primary View Switcher */}
        <nav style={{
          display: 'flex',
          background: 'rgba(15, 23, 42, 0.85)',
          padding: 4,
          borderRadius: 12,
          border: '1px solid var(--border)',
          gap: 4,
          flexWrap: 'wrap',
          maxWidth: '100%'
        }}>
          <button
            id="nav-trips"
            onClick={() => setCurrentView('trip_guide')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 8,
              border: 'none',
              background: currentView === 'trip_guide' ? 'linear-gradient(135deg, #0ea5e9, #2563eb)' : 'transparent',
              color: currentView === 'trip_guide' ? '#FFFFFF' : '#94A3B8',
              fontWeight: 700,
              fontSize: '0.84rem',
              cursor: 'pointer',
              transition: 'all 0.18s'
            }}
          >
            <span>🌴</span>
            <span>Explore & Book</span>
          </button>

          <button
            id="nav-ai-planner"
            onClick={() => setCurrentView('ai_planner')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 8,
              border: 'none',
              background: currentView === 'ai_planner' ? 'linear-gradient(135deg, #0ea5e9, #2563eb)' : 'transparent',
              color: currentView === 'ai_planner' ? '#FFFFFF' : '#94A3B8',
              fontWeight: 700,
              fontSize: '0.84rem',
              cursor: 'pointer',
              transition: 'all 0.18s'
            }}
          >
            <span>🤖</span>
            <span>AI Planner</span>
          </button>

          <button
            id="nav-data-catalog"
            onClick={() => setCurrentView('data_catalog')}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8,
              border: 'none', background: currentView === 'data_catalog' ? 'linear-gradient(135deg, #0ea5e9, #2563eb)' : 'transparent',
              color: currentView === 'data_catalog' ? '#FFFFFF' : '#94A3B8', fontWeight: 700, fontSize: '0.84rem',
              cursor: 'pointer', transition: 'all 0.18s'
            }}
          >
            <Database size={15} />
            <span>Data Library</span>
          </button>

          <button
            id="nav-mytrips"
            onClick={() => setCurrentView('my_trips')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 8,
              border: 'none',
              background: currentView === 'my_trips' ? 'linear-gradient(135deg, #0ea5e9, #2563eb)' : 'transparent',
              color: currentView === 'my_trips' ? '#FFFFFF' : '#94A3B8',
              fontWeight: 700,
              fontSize: '0.84rem',
              cursor: 'pointer',
              transition: 'all 0.18s'
            }}
          >
            <span>🧳</span>
            <span>My Trips</span>
          </button>

          <button
            id="nav-sentinel"
            onClick={() => setCurrentView('sentinel')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 8,
              border: 'none',
              background: currentView === 'sentinel' ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'transparent',
              color: currentView === 'sentinel' ? '#000' : '#94A3B8',
              fontWeight: 700,
              fontSize: '0.84rem',
              cursor: 'pointer',
              transition: 'all 0.18s'
            }}
          >
            <span>⚡</span>
            <span>Trip Sentinel</span>
          </button>

          <button
            id="nav-ops"
            onClick={() => setCurrentView('ops')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 8,
              border: 'none',
              background: currentView === 'ops' ? 'linear-gradient(135deg, #0ea5e9, #2563eb)' : 'transparent',
              color: currentView === 'ops' ? '#FFFFFF' : '#94A3B8',
              fontWeight: 700,
              fontSize: '0.84rem',
              cursor: 'pointer',
              transition: 'all 0.18s'
            }}
          >
            <LayoutDashboard size={15} />
            <span>Ops & Invariants</span>
          </button>
        </nav>

        {/* Invariant Counter Pills & Multilingual Language Switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* Oversold Pinned Badge */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: oversoldCount === 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.25)',
            border: `1.5px solid ${oversoldCount === 0 ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.6)'}`,
            padding: '5px 14px',
            borderRadius: 20
          }}>
            <span style={{ fontSize: '0.72rem', color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase' }}>Oversold</span>
            <span style={{
              fontSize: '0.95rem',
              fontWeight: 900,
              color: oversoldCount === 0 ? '#34D399' : '#EF4444'
            }}>
              {oversoldCount}
            </span>
          </div>

          {/* Duplicates Pinned Badge */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'rgba(59, 130, 246, 0.15)',
            border: '1.5px solid rgba(59, 130, 246, 0.35)',
            padding: '5px 14px',
            borderRadius: 20
          }}>
            <span style={{ fontSize: '0.72rem', color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase' }}>Duplicates</span>
            <span style={{ fontSize: '0.95rem', fontWeight: 900, color: '#60A5FA' }}>
              {duplicateCount}
            </span>
          </div>

          {/* Professional Multilingual Language Switcher */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            background: 'rgba(15, 23, 42, 0.85)',
            padding: '3px 4px',
            borderRadius: 10,
            border: '1.5px solid rgba(59, 130, 246, 0.35)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
          }}>
            <div style={{ padding: '0 6px', display: 'flex', alignItems: 'center' }}>
              <Globe size={15} color="#60A5FA" />
            </div>

            {[
              { code: 'en', label: 'English', short: 'EN' },
              { code: 'hi', label: 'हिन्दी', short: 'हिन्दी' },
              { code: 'kn', label: 'ಕನ್ನಡ', short: 'ಕನ್ನಡ' }
            ].map((item) => (
              <button
                key={item.code}
                id={`lang-btn-${item.code}`}
                onClick={() => setLang(item.code as Language)}
                style={{
                  background: lang === item.code ? 'linear-gradient(135deg, #2563EB, #1D4ED8)' : 'transparent',
                  color: lang === item.code ? '#FFFFFF' : '#94A3B8',
                  border: 'none',
                  padding: '5px 10px',
                  borderRadius: 7,
                  fontSize: '0.78rem',
                  fontWeight: lang === item.code ? 800 : 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  boxShadow: lang === item.code ? '0 2px 8px rgba(37, 99, 235, 0.4)' : 'none'
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
};

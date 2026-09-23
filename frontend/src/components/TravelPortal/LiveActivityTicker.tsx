import React, { useState, useEffect } from 'react';
import { Sparkles, Users, ShieldCheck, Flame } from 'lucide-react';
import { fetchLiveActivity } from '../../services/api';

export const LiveActivityTicker: React.FC = () => {
  const [activity, setActivity] = useState<any>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    fetchLiveActivity().then(data => {
      if (data.success) setActivity(data);
    }).catch(err => console.error('Error fetching live activity:', err));

    const interval = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % 5);
    }, 4500);

    return () => clearInterval(interval);
  }, []);

  if (!activity || !activity.tickerFeed || activity.tickerFeed.length === 0) return null;

  const currentItem = activity.tickerFeed[currentIndex % activity.tickerFeed.length];

  return (
    <div style={{
      background: 'rgba(15, 23, 42, 0.95)',
      border: '1px solid rgba(56, 189, 248, 0.25)',
      borderRadius: 14,
      padding: '8px 18px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      fontSize: '0.82rem',
      flexWrap: 'wrap',
      gap: 12,
      boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      marginBottom: 20
    }}>
      {/* Live Ticker Item */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: '1rem' }}>{currentItem.icon}</span>
        <span style={{ color: '#f8fafc', fontWeight: 600 }}>
          {currentItem.message}
        </span>
        <span style={{ color: '#38bdf8', fontSize: '0.72rem', background: 'rgba(56, 189, 248, 0.15)', padding: '2px 6px', borderRadius: 4 }}>
          {currentItem.timeAgo}
        </span>
      </div>

      {/* Online Users Pill */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
        <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>
          <strong style={{ color: '#f8fafc' }}>{activity.activeViewersOnline} travellers</strong> booking right now
        </span>
        <span style={{ color: '#64748b' }}>•</span>
        <span style={{ color: '#10b981', fontSize: '0.78rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
          <ShieldCheck size={14} /> 0 Oversold Guarantee
        </span>
      </div>
    </div>
  );
};

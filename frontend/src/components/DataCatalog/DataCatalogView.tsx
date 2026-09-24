import React, { useEffect, useState } from 'react';

type Category = 'hotel' | 'stay' | 'airbnb' | 'bus' | 'train';
type Item = { id: string; category: Category; name: string; city?: string; location?: string; origin?: string; destination?: string; details: Record<string, unknown>; source: string };
type Summary = { category: Category; count: number; sources: string[]; status: string };
const labels: Record<Category, string> = { hotel: 'Hotels', stay: 'Stays', airbnb: 'Airbnb', bus: 'Buses', train: 'Trains' };
const base = import.meta.env.VITE_API_URL || '';

export function DataCatalogView() {
  const [summary, setSummary] = useState<Summary[]>([]);
  const [category, setCategory] = useState<Category>('hotel');
  const [items, setItems] = useState<Item[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`${base}/api/reference-data/summary`).then(r => r.json()).then(d => setSummary(d.categories ?? [])).catch(() => setSummary([]));
  }, []);

  const load = async (cat = category, q = '') => {
    setBusy(true);
    try {
      const params = new URLSearchParams({ category: cat, limit: '80' });
      if (q.trim()) params.set('q', q.trim());
      const response = await fetch(`${base}/api/reference-data?${params}`);
      const data = await response.json(); setItems(data.items ?? []);
    } catch { setItems([]); } finally { setBusy(false); }
  };

  useEffect(() => { load(category); }, [category]);

  return <section style={{ maxWidth: 1100, margin: '0 auto' }}>
    <div style={{ marginBottom: 22 }}>
      <div className="eyebrow">SOURCE ATTRIBUTED · REFERENCE DATA</div>
      <h1 style={{ margin: '8px 0' }}>Travel Data Library</h1>
      <p style={{ color: 'var(--text-muted)', maxWidth: 760 }}>Explore hotel, stay, Airbnb, bus, and train datasets. These records are for discovery and analysis; static snapshots do not confirm current prices, schedules, or availability.</p>
    </div>
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
      {summary.map(s => <button key={s.category} className={`btn ${category === s.category ? 'btn-primary' : 'btn-outline'}`} onClick={() => setCategory(s.category)}>
        {labels[s.category]} <span style={{ opacity: .72, marginLeft: 5 }}>{s.count}</span>
      </button>)}
    </div>
    <form onSubmit={e => { e.preventDefault(); load(category, search); }} style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search names, cities, stations, or routes" aria-label="Search reference data" style={{ flex: 1, minWidth: 180, padding: 12, borderRadius: 10, background: 'var(--panel, #111827)', border: '1px solid var(--border)', color: 'inherit' }} />
      <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Loading…' : 'Search'}</button>
    </form>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: 12 }}>
      {items.map(item => <article key={item.id} className="glass-panel" style={{ padding: 16 }}>
        <div className="opt-title">{item.name}</div>
        <div className="opt-meta">{item.city || item.location || [item.origin, item.destination].filter(Boolean).join(' → ') || labels[item.category]}</div>
        {item.category === 'train' && <div className="opt-meta">{item.details.departure ? `Departs ${item.details.departure}` : ''}{item.details.arrival ? ` · Arrives ${item.details.arrival}` : ''}{item.details.distance ? ` · ${item.details.distance} km` : ''}</div>}
        {item.category === 'hotel' && <div className="opt-meta">{String(item.details.month ?? '')}{item.details.rating ? ` · Rating ${item.details.rating}` : ''}{item.details.reviewCount ? ` · ${item.details.reviewCount} reviews` : ''}</div>}
        {item.category === 'bus' && <div className="opt-meta">{String(item.details.busCount ?? 'Count unavailable')} buses · {String(item.details.terminals ?? '—')} terminals · {String(item.details.stops ?? '—')} stops</div>}
        <details style={{ marginTop: 8 }}><summary className="opt-meta" style={{ cursor: 'pointer' }}>Dataset details</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 11, color: 'var(--text-muted)' }}>{JSON.stringify(item.details, null, 2)}</pre></details>
        <div className="opt-meta" style={{ marginTop: 8, fontSize: 11 }}>{item.source}</div>
        <span className="tag demo" style={{ marginTop: 8 }}>Reference only · not bookable</span>
      </article>)}
    </div>
    {!busy && items.length === 0 && <div className="glass-panel" style={{ padding: 20, color: 'var(--text-muted)' }}>
      {category === 'airbnb' ? 'No Airbnb rows are available. The imported CC0 sample has global examples only and no India listings.' : `No ${labels[category].toLowerCase()} records loaded yet.`}
    </div>}
  </section>;
}

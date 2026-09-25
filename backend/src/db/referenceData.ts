import fs from 'fs';
import path from 'path';
import { query } from './client.js';

const csvValue = (line: string): string[] => {
  const result: string[] = []; let value = ''; let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i += 1; } else quoted = !quoted;
    } else if (c === ',' && !quoted) { result.push(value.trim()); value = ''; } else value += c;
  }
  result.push(value.trim()); return result;
};

type ReferenceRow = { id: string; category: string; name: string; city?: string | null; location?: string | null; origin?: string | null; destination?: string | null; details: Record<string, unknown>; source: string };

async function insertRows(rows: ReferenceRow[]): Promise<number> {
  for (let start = 0; start < rows.length; start += 300) {
    const batch = rows.slice(start, start + 300); const params: unknown[] = [];
    const values = batch.map(row => {
      const data = [row.id, row.category, row.name, row.city ?? null, row.location ?? null, row.origin ?? null, row.destination ?? null, JSON.stringify(row.details), row.source];
      const offset = params.length; params.push(...data);
      return `(${data.map((_, i) => `$${offset + i + 1}`).join(', ')})`;
    });
    await query(`INSERT INTO travel_reference_data (id, category, name, city, location, origin, destination, details, source) VALUES ${values.join(', ')} ON CONFLICT (id) DO NOTHING`, params);
  }
  return rows.length;
}

function findData(name: string): string | null {
  const candidates = [path.resolve(process.cwd(), `../db/${name}`), path.resolve(process.cwd(), `./db/${name}`), path.resolve(__dirname, `../../../../db/${name}`)];
  return candidates.find(fs.existsSync) ?? null;
}

export async function importReferenceData(): Promise<void> {
  const goaHotels = findData('goa-hotels-source/hotels_cleaned.csv');
  if (goaHotels) {
    const lines = fs.readFileSync(goaHotels, 'utf8').split(/\r?\n/).filter(Boolean);
    const hotels = lines.slice(1).map((line, i) => {
      const [id, month, name, area, price, rating, reviews] = csvValue(line);
      return { id: `goa-hotel-${id || i}`, category: 'hotel', name, city: 'Goa', location: area, details: { month, reportedPrice: Number(price) || null, currency: 'unspecified_in_source', rating: Number(rating) || null, reviewCount: Number(reviews) || 0 }, source: 'Kaggle: viveknakrani/goa-hotels-dataset (CC0; historical snapshot)' };
    }).filter(row => row.name);
    const hotelCount = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM travel_reference_data WHERE category = 'hotel' AND source = $1`, [hotels[0]?.source]);
    if (Number(hotelCount.rows[0]?.count ?? 0) === 0) {
      await insertRows(hotels);
      console.log(`[DB] Imported ${hotels.length} Goa hotel reference rows from Kaggle.`);
    }
    const stayCount = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM travel_reference_data WHERE category = 'stay' AND source = $1`, [hotels[0]?.source]);
    if (Number(stayCount.rows[0]?.count ?? 0) === 0) {
      await insertRows(hotels.map(row => ({ ...row, id: row.id.replace('goa-hotel-', 'goa-stay-'), category: 'stay', details: { ...row.details, subtype: 'Hotel stay reference' } })));
      console.log(`[DB] Imported ${hotels.length} Goa stay reference rows from Kaggle.`);
    }
  }

  const trainFile = findData('railway_routes_reference.json');
  if (trainFile) {
    const source = 'Kaggle: sripaadsrinivasan/indian-railways-dataset (CC0; schedule snapshot)';
    const count = await query<{ count: string }>('SELECT COUNT(*)::text AS count FROM travel_reference_data WHERE source = $1', [source]);
    if (Number(count.rows[0]?.count ?? 0) === 0) {
      const routes = JSON.parse(fs.readFileSync(trainFile, 'utf8')) as Array<Record<string, unknown>>;
      const rows = routes.map((r, i) => ({
        id: `rail-${String(r.number ?? i)}-${String(r.from_station_code ?? '')}-${String(r.to_station_code ?? '')}`,
        category: 'train', name: String(r.name ?? 'Train service'),
        location: `${String(r.from_station_name ?? '')} → ${String(r.to_station_name ?? '')}`,
        origin: String(r.from_station_code ?? ''), destination: String(r.to_station_code ?? ''),
        details: r, source
      }));
      await insertRows(rows);
      console.log(`[DB] Imported ${rows.length} Indian train route references from Kaggle.`);
    }
  }

  const extraFile = findData('travel_reference_extra.json');
  if (extraFile) {
    const rows = JSON.parse(fs.readFileSync(extraFile, 'utf8')) as ReferenceRow[];
    const sources = [...new Set(rows.map(row => row.source))];
    for (const source of sources) {
      const existing = await query<{ count: string }>('SELECT COUNT(*)::text AS count FROM travel_reference_data WHERE source = $1', [source]);
      if (Number(existing.rows[0]?.count ?? 0) === 0) await insertRows(rows.filter(row => row.source === source));
    }
    console.log(`[DB] Imported ${rows.length} additional travel reference records.`);
  }
}

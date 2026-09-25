import fs from 'fs';
import path from 'path';
import { query } from './client.js';

const DATASET_SOURCE = 'Kaggle: dhairya903/Flights in India (CC0), collected 2022-02-05';

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(value.trim()); value = '';
    } else value += char;
  }
  values.push(value.trim());
  return values;
}

function durationMinutes(value: string): number {
  const hours = Number(value.match(/(\d+)\s*h/i)?.[1] ?? 0);
  const minutes = Number(value.match(/(\d+)\s*m/i)?.[1] ?? 0);
  return hours * 60 + minutes;
}

export async function importKaggleFlightFares(): Promise<number> {
  const candidates = [
    path.resolve(process.cwd(), '../db/kaggle_flights_india_2022.csv'),
    path.resolve(process.cwd(), './db/kaggle_flights_india_2022.csv'),
    path.resolve(__dirname, '../../../../db/kaggle_flights_india_2022.csv')
  ];
  const csvPath = candidates.find(candidate => fs.existsSync(candidate));
  if (!csvPath) {
    console.warn('[DB] Kaggle flight fare CSV not found; skipping historical fare import.');
    return 0;
  }

  const alreadyImported = await query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM historical_flight_fares WHERE source = $1', [DATASET_SOURCE]
  );
  if (Number(alreadyImported.rows[0]?.count ?? 0) > 0) return Number(alreadyImported.rows[0].count);

  const lines = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const expected = ['Origin', 'Destination', 'Company', 'Departure Time', 'Arrival Time', 'Duration Time', 'Flight Price', 'Date', 'Cabin Class'];
  if (!lines.length || parseCsvLine(lines[0]).join('|') !== expected.join('|')) {
    throw new Error(`[DB] Unexpected Kaggle CSV columns in ${csvPath}`);
  }

  const rows = lines.slice(1).map((line, index) => {
    const [origin, destination, company, departure, arrival, duration, rawPrice, rawDate, cabin] = parseCsvLine(line);
    const dateMatch = rawDate.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    const price = Number(rawPrice.replace(/[^\d.]/g, ''));
    if (!origin || !destination || !company || !dateMatch || !Number.isFinite(price) || !durationMinutes(duration)) {
      throw new Error(`[DB] Invalid Kaggle CSV row ${index + 2}`);
    }
    return [origin, destination, company, departure, arrival, durationMinutes(duration), price,
      `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`, cabin, DATASET_SOURCE];
  });

  const batchSize = 300;
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const params: unknown[] = [];
    const tuples = batch.map(row => {
      const offset = params.length;
      params.push(...row);
      return `(${row.map((_, i) => `$${offset + i + 1}`).join(', ')})`;
    });
    await query(
      `INSERT INTO historical_flight_fares
       (origin, destination, company, departure_time, arrival_time, duration_minutes, price_inr, travel_date, cabin_class, source)
       VALUES ${tuples.join(', ')} ON CONFLICT DO NOTHING`,
      params
    );
  }

  console.log(`[DB] Imported ${rows.length} historical fare observations from Kaggle (not bookable inventory).`);
  return rows.length;
}

/**
 * Recommendation catalog: merges BookGuard's real inventory (source of truth for
 * anything bookable) with demo data for gaps. Read-only.
 */
import { query } from '../db/client.js';
import { DESTINATIONS, ORIGIN_CITIES, Destination, City, demoTransportOptions } from './demoData.js';
import type { BudgetTier, HotelOption, PlaceOption, TransportMode, TransportOption } from './types.js';

// Demo race-simulator room; not a real recommendation.
const EXCLUDED_INVENTORY = new Set(['htl_last_room_suite']);

function normalise(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

function matchesAlias(text: string, alias: string): boolean {
  return normalise(text).includes(` ${alias} `);
}

export function resolveDestination(text: string | null | undefined): Destination | null {
  if (!text) return null;
  return DESTINATIONS.find(d => d.aliases.some(a => matchesAlias(text, a)) || matchesAlias(text, d.id)) ?? null;
}

export function resolveCity(text: string | null | undefined): City | null {
  if (!text) return null;
  return ORIGIN_CITIES.find(c => c.aliases.some(a => matchesAlias(text, a))) ?? null;
}

export function destinationById(id: string): Destination | null {
  return DESTINATIONS.find(d => d.id === id) ?? null;
}

export function listDestinations(): Array<{ id: string; name: string; state: string; summary: string; idealDays: number }> {
  return DESTINATIONS.map(d => ({ id: d.id, name: d.name, state: d.state, summary: d.summary, idealDays: d.idealDays }));
}

function tierForPrice(price: number): BudgetTier {
  if (price >= 6000) return 'luxury';
  if (price >= 3000) return 'medium';
  return 'budget';
}

export async function listHotels(dest: Destination): Promise<HotelOption[]> {
  const res = await query<{ id: string; code: string; name: string; price: string; available_quantity: number }>(
    `SELECT id, code, name, price, available_quantity FROM inventory
     WHERE resource_type = 'hotel' AND origin = $1 ORDER BY price ASC`,
    [dest.code]
  );
  const fromInventory: HotelOption[] = res.rows
    .filter(r => !EXCLUDED_INVENTORY.has(r.id))
    .map(r => ({
      id: r.id,
      name: r.name,
      tier: tierForPrice(Number(r.price)),
      pricePerNight: Number(r.price),
      rating: 4.6,
      area: dest.name,
      amenities: ['BookGuard inventory', `${r.available_quantity} room(s) left`],
      inventoryId: r.id,
      source: 'inventory' as const
    }));
  return [...dest.demoHotels, ...fromInventory].sort((a, b) => a.pricePerNight - b.pricePerNight);
}

export async function listTransport(fromCode: string, toCode: string): Promise<TransportOption[]> {
  if (fromCode === toCode) return [];
  const res = await query<{
    id: string;
    resource_type: TransportMode;
    code: string;
    name: string;
    departure_time: string;
    arrival_time: string;
    price: string;
    available_quantity: number;
  }>(
    `SELECT id, resource_type, code, name, departure_time, arrival_time, price, available_quantity
     FROM inventory
     WHERE resource_type IN ('flight', 'train', 'bus') AND origin = $1 AND destination = $2
     ORDER BY price ASC`,
    [fromCode, toCode]
  );
  if (res.rows.length === 0) return demoTransportOptions(fromCode, toCode);
  return res.rows.map(r => ({
    id: r.id,
    mode: r.resource_type,
    operator: r.name,
    code: r.code,
    fromCode,
    toCode,
    departure: r.departure_time,
    arrival: r.arrival_time,
    pricePerPerson: Number(r.price),
    seatsAvailable: r.available_quantity,
    inventoryId: r.id,
    source: 'inventory' as const
  }));
}

export function listPlaces(dest: Destination, preferences: string[] = []): PlaceOption[] {
  if (preferences.length === 0) return [...dest.places];
  const score = (p: PlaceOption) => p.tags.filter(t => preferences.includes(t)).length;
  // Stable sort: preferred tags first, original (geographic) order otherwise.
  return dest.places
    .map((p, i) => ({ p, i, s: score(p) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(x => x.p);
}

/** Orders hotels so the best match for the budget tier comes first. */
export function rankHotels(hotels: HotelOption[], tier: BudgetTier): HotelOption[] {
  const order: Record<BudgetTier, BudgetTier[]> = {
    budget: ['budget', 'medium', 'luxury'],
    medium: ['medium', 'budget', 'luxury'],
    luxury: ['luxury', 'medium', 'budget']
  };
  const rank = (h: HotelOption) => order[tier].indexOf(h.tier);
  return [...hotels].sort((a, b) =>
    rank(a) - rank(b) || (tier === 'luxury' ? b.pricePerNight - a.pricePerNight : a.pricePerNight - b.pricePerNight)
  );
}

/** Orders transport by preferred mode, then by what suits the budget. */
export function rankTransport(options: TransportOption[], tier: BudgetTier, mode: TransportMode | null): TransportOption[] {
  const modeRank = (o: TransportOption) => (mode && o.mode === mode ? 0 : 1);
  const tierModes: Record<BudgetTier, TransportMode[]> = {
    budget: ['train', 'bus', 'flight'],
    medium: ['flight', 'train', 'bus'],
    luxury: ['flight', 'train', 'bus']
  };
  const tierRank = (o: TransportOption) => tierModes[tier].indexOf(o.mode);
  return [...options].sort(
    (a, b) => modeRank(a) - modeRank(b) || tierRank(a) - tierRank(b) || a.pricePerPerson - b.pricePerPerson
  );
}

/**
 * TRAVEL-PLAN STATE: pure planning helpers (no I/O except catalog reads).
 * The orchestrator applies intents to a TripState; this module derives
 * what is missing, the itinerary, recommendations and the cost estimate.
 */
import { LOCAL_COST_PER_PERSON_DAY, Destination } from './demoData.js';
import { destinationById, listHotels, listPlaces, listTransport, rankHotels, rankTransport } from './catalog.js';
import type { BudgetTier, CostEstimate, DayPlan, PlanField, PlaceOption, Recommendations, TripState } from './types.js';

export const MAX_TRAVELLERS = 20;
export const MAX_DURATION_DAYS = 21;

export function emptyTrip(): TripState {
  return {
    destination: null,
    origin: null,
    startDate: null,
    durationDays: null,
    travellers: null,
    budget: null,
    preferences: [],
    preferredTransportMode: null,
    bookingPriority: null,
    itinerary: null,
    hotel: null,
    transport: null,
    places: [],
    removed: { hotel: false, transport: false },
    cursor: { hotel: 0, transport: 0 },
    shown: { hotel: [], transport: [] },
    lastShown: null,
    askedFor: [],
    pendingField: null,
    estimate: null,
    bookingRequests: [],
    status: 'COLLECTING'
  };
}

/** Required before an itinerary can be generated, in the order we ask for them. */
const REQUIRED: PlanField[] = ['destination', 'origin', 'startDate', 'durationDays', 'travellers'];

export function missingFields(trip: TripState): PlanField[] {
  const missing = REQUIRED.filter(f => {
    if (f === 'destination') return !trip.destination;
    if (f === 'origin') return !trip.origin;
    return trip[f] == null;
  });
  // Budget is optional: asked once alongside other questions, then defaulted to mid-range.
  if (!trip.budget && !trip.askedFor.includes('budget')) missing.push('budget');
  return missing;
}

export function requiredMissing(trip: TripState): PlanField[] {
  return missingFields(trip).filter(f => f !== 'budget');
}

export function budgetTier(trip: TripState): BudgetTier {
  return trip.budget?.tier ?? 'medium';
}

export function roomsFor(travellers: number): number {
  return Math.max(1, Math.ceil(travellers / 2));
}

export function nightsFor(durationDays: number): number {
  return Math.max(1, durationDays - 1);
}

export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Tier implied by a total INR budget (per person per day). */
export function tierFromAmount(amount: number, travellers: number | null, days: number | null): BudgetTier {
  const perPersonDay = amount / Math.max(1, travellers ?? 2) / Math.max(1, days ?? 3);
  if (perPersonDay < 3500) return 'budget';
  if (perPersonDay < 9000) return 'medium';
  return 'luxury';
}

/**
 * Greedy day-by-day itinerary: light arrival day, fuller middle days, short last day.
 * Places come pre-sorted by preference and geography.
 */
export function buildItinerary(dest: Destination, days: number, preferences: string[]): { itinerary: DayPlan[]; places: PlaceOption[] } {
  const queue = listPlaces(dest, preferences);
  const used: PlaceOption[] = [];
  const itinerary: DayPlan[] = [];

  for (let day = 1; day <= days; day++) {
    const isFirst = day === 1;
    const isLast = day === days && days > 1;
    let capacity = isFirst ? (days === 1 ? 6 : 4) : isLast ? 3 : 8;
    const activities: string[] = [];
    const placeIds: string[] = [];
    if (isFirst) activities.push(`Arrive in ${dest.name} and check in`);

    for (let i = 0; i < queue.length && capacity > 0; ) {
      const p = queue[i];
      const fits = p.durationHrs <= capacity || (!isFirst && !isLast && placeIds.length === 0);
      if (fits) {
        activities.push(p.name);
        placeIds.push(p.id);
        used.push(p);
        capacity -= p.durationHrs;
        queue.splice(i, 1);
      } else {
        i++;
      }
    }
    if (placeIds.length === 0 && !isLast) activities.push('Leisure time: local cafes, markets and relaxing');
    if (isLast || days === 1) activities.push('Check out and depart');

    const title = isFirst ? 'Arrival & first sights' : isLast ? 'Final sights & departure' : `Explore ${dest.name}`;
    itinerary.push({ day, title, activities, placeIds });
  }
  return { itinerary, places: used };
}

export async function recommendationsFor(trip: TripState, limit = 4): Promise<Recommendations> {
  const dest = trip.destination ? destinationById(trip.destination.id) : null;
  if (!dest) return { hotels: [], transport: [], places: [] };
  const tier = budgetTier(trip);
  const hotels = rankHotels(await listHotels(dest), tier).slice(0, limit);
  const transport = trip.origin
    ? rankTransport(await listTransport(trip.origin.code, dest.code), tier, trip.preferredTransportMode).slice(0, limit)
    : [];
  return { hotels, transport, places: listPlaces(dest, trip.preferences) };
}

export function computeEstimate(trip: TripState): CostEstimate | null {
  if (!trip.destination || !trip.travellers || !trip.durationDays) return null;
  const travellers = trip.travellers;
  const days = trip.durationDays;
  const tier = budgetTier(trip);

  // Return journey is estimated at the outbound fare (demo simplification).
  const transport = trip.transport ? trip.transport.pricePerPerson * travellers * 2 : 0;
  const stay = trip.hotel ? trip.hotel.pricePerNight * roomsFor(travellers) * nightsFor(days) : 0;
  const entryFees = trip.places.reduce((sum, p) => sum + p.entryFeeInr, 0) * travellers;
  const localAndSightseeing = LOCAL_COST_PER_PERSON_DAY[tier] * travellers * days + entryFees;
  const total = Math.round(transport + stay + localAndSightseeing);
  return {
    transport: Math.round(transport),
    stay: Math.round(stay),
    localAndSightseeing: Math.round(localAndSightseeing),
    total,
    perPerson: Math.round(total / travellers),
    withinBudget: trip.budget?.amountInr ? total <= trip.budget.amountInr : null,
    currency: 'INR'
  };
}

export function formatInr(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

export function formatDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

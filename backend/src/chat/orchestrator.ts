/**
 * CHAT ORCHESTRATOR
 *
 *   user message ─▶ intent extraction (LLM, or demo extractor as fallback)
 *                ─▶ applyIntent(): update TripState incrementally (never restart)
 *                ─▶ ask for missing info | build itinerary | show options | create booking request
 *                ─▶ ChatTurnResult for the UI
 *
 * The LLM only interprets language. Every fact shown to the user (places, hotels,
 * fares, availability, booking status) comes from the catalog, the planner or the
 * booking gateway, so the assistant cannot hallucinate prices or confirmations.
 */
import crypto from 'crypto';
import { DESTINATIONS, ORIGIN_CITIES } from './demoData.js';
import {
  destinationById,
  listHotels,
  listPlaces,
  listTransport,
  rankHotels,
  rankTransport,
  resolveCity,
  resolveDestination
} from './catalog.js';
import { extractIntentDemo, pendingFieldLabel } from './demoExtractor.js';
import { AiServiceError, extractIntentWithLlm, isLlmConfigured, ExtractInput } from './llmExtractor.js';
import {
  MAX_DURATION_DAYS,
  MAX_TRAVELLERS,
  addDaysIso,
  budgetTier,
  buildItinerary,
  computeEstimate,
  emptyTrip,
  formatDate,
  formatInr,
  missingFields,
  recommendationsFor,
  requiredMissing,
  tierFromAmount
} from './planner.js';
import {
  BookingRequestError,
  BookingRequestRecord,
  buildHotelRequest,
  buildTransportRequest,
  getBookingRequest,
  submitBookingRequest
} from './bookingGateway.js';
import type {
  ChatMessage,
  ChatTurnResult,
  HotelOption,
  PlanField,
  PlanTarget,
  Recommendations,
  TransportMode,
  TransportOption,
  TravelIntent,
  TripState
} from './types.js';

const MAX_MESSAGE_LENGTH = 1000;
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_SESSIONS = 2000;

export const DEMO_DATA_NOTICE =
  'Demo suggestions: places, prices and availability come from BookGuard sample data, not live travel APIs. Bookings are demo requests; no real payment is taken.';

// ---------------------------------------------------------------------------
// Sessions (in-memory; the trip state is also returned to the client on every turn)
// ---------------------------------------------------------------------------

interface Session {
  id: string;
  trip: TripState;
  history: ChatMessage[];
  updatedAt: number;
}

const sessions = new Map<string, Session>();

function pruneSessions() {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.updatedAt > SESSION_TTL_MS) sessions.delete(id);
  while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value as string);
}

export function getOrCreateSession(sessionId?: string | null): Session {
  pruneSessions();
  if (sessionId && /^[A-Za-z0-9_-]{8,64}$/.test(sessionId)) {
    const existing = sessions.get(sessionId);
    if (existing) return existing;
    const created: Session = { id: sessionId, trip: emptyTrip(), history: [], updatedAt: Date.now() };
    sessions.set(sessionId, created);
    return created;
  }
  const id = `chat_${crypto.randomUUID().replace(/-/g, '')}`;
  const created: Session = { id, trip: emptyTrip(), history: [], updatedAt: Date.now() };
  sessions.set(id, created);
  return created;
}

export function findSession(sessionId: string): Session | null {
  return sessions.get(sessionId) ?? null;
}

export async function getSessionView(sessionId: string) {
  const s = findSession(sessionId);
  if (!s) return null;
  await refreshBookingStatuses(s.trip);
  return { sessionId: s.id, trip: s.trip, history: s.history, aiMode: currentAiMode() };
}

export function resetSession(sessionId: string): Session {
  const s = getOrCreateSession(sessionId);
  s.trip = emptyTrip();
  s.history = [];
  s.updatedAt = Date.now();
  return s;
}

// ---------------------------------------------------------------------------
// AI service selection (LLM when configured, demo extractor otherwise / on failure)
// ---------------------------------------------------------------------------

type Extractor = (input: ExtractInput) => Promise<TravelIntent>;
let llmOverride: Extractor | null = null;

/** Tests inject a fake LLM here; production uses Claude via llmExtractor.ts. */
export function setLlmExtractorForTests(fn: Extractor | null) {
  llmOverride = fn;
}

export function currentAiMode(): 'llm' | 'demo' {
  return llmOverride || isLlmConfigured() ? 'llm' : 'demo';
}

function today(): string {
  return process.env.CHAT_TODAY || new Date().toISOString().slice(0, 10);
}

async function understand(message: string, session: Session): Promise<{ intent: TravelIntent; aiMode: 'llm' | 'demo'; notice: string | null }> {
  const input: ExtractInput = { message, history: session.history, trip: session.trip, today: today() };
  if (currentAiMode() === 'llm') {
    try {
      const intent = await (llmOverride ?? extractIntentWithLlm)(input);
      return { intent: normaliseIntent(intent), aiMode: 'llm', notice: null };
    } catch (err) {
      const reason = err instanceof AiServiceError ? err.reason : 'unexpected';
      console.warn(`[Chat] AI service failed (${reason}); using demo understanding for this turn`);
      return {
        intent: extractIntentDemo(message, session.trip, input.today),
        aiMode: 'demo',
        notice: 'The AI service is unavailable right now, so I used offline demo understanding for this message.'
      };
    }
  }
  return { intent: extractIntentDemo(message, session.trip, input.today), aiMode: 'demo', notice: null };
}

/** Defensive cleanup of model output before it touches state. */
function normaliseIntent(i: TravelIntent): TravelIntent {
  const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
  return {
    ...i,
    durationDays: int(i.durationDays),
    durationDelta: int(i.durationDelta),
    travellers: int(i.travellers),
    travellersDelta: int(i.travellersDelta),
    optionIndex: int(i.optionIndex),
    budgetAmount: typeof i.budgetAmount === 'number' && i.budgetAmount > 0 ? i.budgetAmount : null,
    startDate: i.startDate && /^\d{4}-\d{2}-\d{2}$/.test(i.startDate) ? i.startDate : null,
    preferences: Array.isArray(i.preferences) ? i.preferences.map(p => String(p).toLowerCase()).slice(0, 8) : [],
    missingInformation: Array.isArray(i.missingInformation) ? i.missingInformation : []
  };
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export async function handleChatMessage(sessionId: string | null | undefined, raw: unknown): Promise<ChatTurnResult> {
  const session = getOrCreateSession(sessionId);
  const message = typeof raw === 'string' ? raw.trim() : '';

  if (!message) {
    return finish(session, new Turn('Please type a message, for example "Plan a 3-day trip to Goa for 2 people".'), null, currentAiMode(), null);
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return finish(session, new Turn(`That message is a bit long. Please keep it under ${MAX_MESSAGE_LENGTH} characters.`), null, currentAiMode(), null);
  }

  session.history.push({ role: 'user', text: message, at: new Date().toISOString() });
  const { intent, aiMode, notice } = await understand(message, session);
  const turn = await applyIntent(session, intent);
  return finish(session, turn, intent, aiMode, notice);
}

export type UiAction = 'select' | 'book' | 'remove' | 'change' | 'cheaper' | 'add' | 'show';

/** Card buttons (Select / Book / Change / Remove) skip NLU but go through the same state logic. */
export async function handleUiAction(
  sessionId: string,
  body: { action: UiAction; target: PlanTarget; itemId?: string | null; mode?: TransportMode | null }
): Promise<ChatTurnResult> {
  const session = getOrCreateSession(sessionId);
  const intent = blankIntent();
  intent.target = body.target;
  intent.optionId = body.itemId ?? null;
  intent.transportMode = body.mode ?? null;
  const labels: Record<UiAction, string> = {
    select: 'Select',
    book: 'Book',
    remove: 'Remove',
    change: 'Change',
    cheaper: 'Cheaper options',
    add: 'Add',
    show: 'Show'
  };
  switch (body.action) {
    case 'select': intent.intent = 'select_option'; break;
    case 'book': intent.intent = 'book'; intent.action = 'create_booking_request'; break;
    case 'remove': intent.intent = 'remove_item'; break;
    case 'change': intent.intent = 'show_options'; intent.optionWhich = 'next'; break;
    case 'cheaper': intent.intent = 'show_options'; intent.optionWhich = 'cheaper'; break;
    case 'add': intent.intent = 'add_item'; break;
    case 'show': intent.intent = 'show_options'; break;
    default:
      return finish(session, new Turn('That action is not supported.'), null, currentAiMode(), null);
  }
  const itemName = body.itemId ? await optionName(session.trip, body.target, body.itemId) : null;
  session.history.push({
    role: 'user',
    text: `[${labels[body.action]}${itemName ? `: ${itemName}` : body.target ? ` ${body.target}` : ''}]`,
    at: new Date().toISOString()
  });
  const turn = await applyIntent(session, intent);
  return finish(session, turn, intent, 'demo', null);
}

/** Structured planning without chat (POST /api/travel-plan). */
export async function buildTravelPlan(input: {
  sessionId?: string;
  destination: string;
  origin?: string;
  startDate?: string;
  durationDays?: number;
  travellers?: number;
  budget?: 'budget' | 'medium' | 'luxury';
  budgetAmount?: number;
  preferences?: string[];
  transportMode?: TransportMode;
}): Promise<ChatTurnResult> {
  const session = getOrCreateSession(input.sessionId);
  const intent = blankIntent();
  Object.assign(intent, {
    intent: 'plan_trip',
    destination: input.destination ?? null,
    origin: input.origin ?? null,
    startDate: input.startDate ?? null,
    durationDays: input.durationDays ?? null,
    travellers: input.travellers ?? null,
    budgetTier: input.budget ?? null,
    budgetAmount: input.budgetAmount ?? null,
    preferences: input.preferences ?? [],
    transportMode: input.transportMode ?? null
  });
  if (!session.trip.askedFor.includes('budget')) session.trip.askedFor.push('budget');
  const turn = await applyIntent(session, intent);
  return finish(session, turn, intent, 'demo', null);
}

// ---------------------------------------------------------------------------
// Turn assembly
// ---------------------------------------------------------------------------

class Turn {
  lines: string[] = [];
  show = new Set<ChatTurnResult['show'][number]>();
  hotels: HotelOption[] | null = null;
  transport: TransportOption[] | null = null;
  bookingRequest: BookingRequestRecord | null = null;
  constructor(first?: string) {
    if (first) this.lines.push(first);
  }
  say(line: string) {
    this.lines.push(line);
  }
}

async function finish(
  session: Session,
  turn: Turn,
  intent: TravelIntent | null,
  aiMode: 'llm' | 'demo',
  notice: string | null
): Promise<ChatTurnResult> {
  const trip = session.trip;
  trip.estimate = computeEstimate(trip);
  const reply = turn.lines.join(' ').replace(/\s+/g, ' ').trim() || 'How else can I help with your trip?';
  if (intent) session.history.push({ role: 'assistant', text: reply, at: new Date().toISOString() });
  session.history = session.history.slice(-40);
  session.updatedAt = Date.now();

  let recommendations: Recommendations | null = null;
  if (turn.show.has('hotels') || turn.show.has('transport') || turn.show.has('places')) {
    const base = await recommendationsFor(trip);
    recommendations = {
      hotels: turn.show.has('hotels') ? turn.hotels ?? base.hotels : [],
      transport: turn.show.has('transport') ? turn.transport ?? base.transport : [],
      places: turn.show.has('places') ? base.places : []
    };
    if (recommendations.hotels.length) trip.shown.hotel = recommendations.hotels.map(h => h.id);
    if (recommendations.transport.length) trip.shown.transport = recommendations.transport.map(t => t.id);
  }

  return {
    sessionId: session.id,
    reply,
    trip,
    missingInformation: missingFields(trip),
    recommendations,
    show: [...turn.show],
    bookingRequest: turn.bookingRequest,
    intent,
    aiMode,
    aiNotice: notice,
    suggestions: suggestionsFor(trip),
    demoDataNotice: DEMO_DATA_NOTICE
  };
}

function suggestionsFor(trip: TripState): string[] {
  if (!trip.destination) {
    return ['I want to visit Goa for 3 days with 2 friends', 'Plan a trip to Manali for 4 people', 'I want a budget trip to Hyderabad', 'Show me hotels in Goa'];
  }
  const missing = requiredMissing(trip);
  if (missing.length > 0) {
    const s: string[] = [];
    if (missing.includes('origin')) s.push('From Bengaluru');
    if (missing.includes('startDate')) s.push('Next Friday');
    if (missing.includes('durationDays')) s.push('3 days');
    if (missing.includes('travellers')) s.push('We are 2 people');
    if (!trip.budget) s.push('Mid-range budget');
    return s.slice(0, 4);
  }
  if (trip.bookingRequests.length > 0) {
    return ['Book the transport', 'Show cheaper hotels', 'Make the trip 4 days instead', 'Start over'];
  }
  return ['Show cheaper hotels', 'Add a train', 'Make the trip 4 days instead', 'Book the recommended hotel'];
}

function blankIntent(): TravelIntent {
  return {
    intent: 'unknown', destination: null, origin: null, startDate: null, durationDays: null, durationDelta: null,
    travellers: null, travellersDelta: null, budgetTier: null, budgetAmount: null, preferences: [], target: null,
    transportMode: null, optionIndex: null, optionId: null, optionWhich: null, pendingField: null,
    missingInformation: [], action: 'none', reply: null
  };
}

// ---------------------------------------------------------------------------
// Core: apply one intent to the trip
// ---------------------------------------------------------------------------

const TIER_LABEL = { budget: 'budget', medium: 'mid-range', luxury: 'luxury' } as const;

const SUPPORTED_DESTINATIONS = DESTINATIONS.map(d => d.name.replace(/ \(.*\)$/, '')).join(', ').replace(/, ([^,]*)$/, ' and $1');

async function applyIntent(session: Session, intent: TravelIntent): Promise<Turn> {
  const turn = new Turn();
  const trip = session.trip;

  if (intent.intent === 'reset') {
    session.trip = emptyTrip();
    turn.say('No problem, let us start fresh! Where would you like to go?');
    return turn;
  }

  const wasPlanned = trip.status === 'PLANNED';
  const changes = applyFieldChanges(trip, intent, turn);
  if (changes.blocked) return turn;

  // "Change my travel date" without a value -> ask for it and remember what we asked.
  if (intent.pendingField && !changes.changed.has(intent.pendingField)) {
    trip.pendingField = intent.pendingField;
    turn.say(`Sure. What ${pendingFieldLabel(intent.pendingField)} would you like instead?`);
    return turn;
  }
  if (trip.pendingField && changes.changed.has(trip.pendingField)) trip.pendingField = null;

  // (Re)build the itinerary once everything required is known.
  let planBuilt = false;
  if (requiredMissing(trip).length === 0) {
    const dest = destinationById(trip.destination!.id)!;
    if (!trip.itinerary || changes.changed.has('destination') || changes.changed.has('durationDays') || changes.changed.has('preferences')) {
      const { itinerary, places } = buildItinerary(dest, trip.durationDays!, trip.preferences);
      trip.itinerary = itinerary;
      trip.places = places;
      planBuilt = true;
    }
    const reselect = planBuilt && !wasPlanned
      ? true
      : ['destination', 'budget', 'origin', 'mode'].some(f => changes.changed.has(f));
    if (reselect) await autoSelect(trip, changes.changed);
    trip.status = 'PLANNED';
  }

  // Intent-specific actions
  switch (intent.intent) {
    case 'show_options':
      await showOptions(trip, intent, turn);
      break;
    case 'select_option':
      await selectOption(trip, intent, turn);
      break;
    case 'remove_item':
      removeItem(trip, intent, turn);
      break;
    case 'add_item':
      await addItem(trip, intent, turn);
      break;
    case 'book':
      await book(session, intent, turn);
      break;
    default:
      break;
  }

  const actionIntent = ['show_options', 'select_option', 'remove_item', 'add_item', 'book'].includes(intent.intent);

  // Small talk that changed nothing gets a direct answer, not a questionnaire.
  const conversational = ['greeting', 'general_question', 'unknown'].includes(intent.intent) && changes.changed.size === 0;

  if (conversational) {
    // handled below
  } else if (requiredMissing(trip).length > 0) {
    if (intent.intent !== 'book') askForMissing(trip, turn, changes.changed.has('destination') && intent.intent === 'plan_trip', actionIntent);
  } else if (planBuilt && !wasPlanned) {
    describeNewPlan(trip, turn);
  } else if (changes.changed.size > 0) {
    describeChanges(trip, changes.changed, planBuilt, turn);
  }

  if (turn.lines.length === 0) {
    if (intent.reply) turn.say(intent.reply);
    else if (intent.intent === 'general_question') {
      turn.say(
        `I can't answer general questions like that in demo mode, but I can plan trips to ${SUPPORTED_DESTINATIONS}: itineraries, stays, transport and demo booking requests.`
      );
    }
    else if (trip.status === 'PLANNED') {
      turn.say('I am not sure I understood that. You can ask me to change the hotel, show cheaper options, add a train, change the dates or number of people, or book an option.');
    } else {
      turn.say(`I can plan trips to ${SUPPORTED_DESTINATIONS}. Try "Plan a 3-day Goa trip from Bengaluru for 3 people".`);
    }
  }
  return turn;
}

// ---------------------------------------------------------------------------
// Field changes (validation + incremental update)
// ---------------------------------------------------------------------------

function titleCase(s: string) {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

function applyFieldChanges(trip: TripState, intent: TravelIntent, turn: Turn): { changed: Set<string>; blocked: boolean } {
  const changed = new Set<string>();
  const now = today();

  if (intent.destination) {
    const dest = resolveDestination(intent.destination);
    if (!dest) {
      const knownCity = resolveCity(intent.destination);
      turn.say(
        knownCity
          ? `I have travel connections from ${knownCity.name}, but no sightseeing data for it yet. I can plan trips to ${SUPPORTED_DESTINATIONS}.`
          : `Sorry, I can't plan trips to ${titleCase(intent.destination)} yet in this demo. I can help with ${SUPPORTED_DESTINATIONS}.`
      );
      return { changed, blocked: true };
    }
    if (trip.destination?.id !== dest.id) {
      trip.destination = { id: dest.id, name: dest.name, code: dest.code };
      trip.hotel = null;
      trip.transport = null;
      trip.itinerary = null;
      trip.places = [];
      trip.removed = { hotel: false, transport: false };
      trip.cursor = { hotel: 0, transport: 0 };
      trip.shown = { hotel: [], transport: [] };
      trip.lastShown = null;
      if (trip.origin?.code === dest.code) trip.origin = null;
      changed.add('destination');
    }
  }

  if (intent.origin) {
    const city = resolveCity(intent.origin);
    if (!city) {
      turn.say(`I don't have routes from ${titleCase(intent.origin)} yet. Could you start from one of: ${ORIGIN_CITIES.map(c => c.name).join(', ')}?`);
      if (!trip.askedFor.includes('origin')) trip.askedFor.push('origin');
    } else if (trip.destination && city.code === trip.destination.code) {
      turn.say(`You are already in ${city.name}! Which city will you be travelling from?`);
    } else if (trip.origin?.code !== city.code) {
      trip.origin = { code: city.code, name: city.name };
      trip.transport = null;
      trip.cursor.transport = 0;
      changed.add('origin');
    }
  }

  if (intent.startDate) {
    const maxDate = addDaysIso(now, 365);
    if (intent.startDate < now) {
      turn.say(`${formatDate(intent.startDate)} has already passed. Which upcoming date would you like to travel?`);
      if (!trip.askedFor.includes('startDate')) trip.askedFor.push('startDate');
    } else if (intent.startDate > maxDate) {
      turn.say('I can only plan up to a year ahead. Could you pick an earlier date?');
    } else if (trip.startDate !== intent.startDate) {
      trip.startDate = intent.startDate;
      changed.add('startDate');
    }
  }

  let newDuration: number | null = null;
  if (intent.durationDays != null) newDuration = intent.durationDays;
  else if (intent.durationDelta != null && trip.durationDays != null) newDuration = trip.durationDays + intent.durationDelta;
  if (newDuration != null) {
    if (newDuration < 1 || newDuration > MAX_DURATION_DAYS) {
      turn.say(`Trips can be between 1 and ${MAX_DURATION_DAYS} days. How many days would you like?`);
    } else if (newDuration !== trip.durationDays) {
      trip.durationDays = newDuration;
      changed.add('durationDays');
    }
  }

  let newTravellers: number | null = null;
  if (intent.travellers != null) newTravellers = intent.travellers;
  else if (intent.travellersDelta != null) {
    if (trip.travellers == null) {
      turn.say('How many people are travelling in total?');
    } else newTravellers = trip.travellers + intent.travellersDelta;
  }
  if (newTravellers != null) {
    if (newTravellers < 1) turn.say('There needs to be at least 1 traveller. How many people are going?');
    else if (newTravellers > MAX_TRAVELLERS) turn.say(`I can plan for up to ${MAX_TRAVELLERS} travellers in this demo. How many people are going?`);
    else if (newTravellers !== trip.travellers) {
      trip.travellers = newTravellers;
      changed.add('travellers');
    }
  }

  if (intent.budgetTier || intent.budgetAmount) {
    const amount = intent.budgetAmount ?? (intent.budgetTier ? null : trip.budget?.amountInr ?? null);
    const tier = intent.budgetTier ?? (amount ? tierFromAmount(amount, trip.travellers, trip.durationDays) : 'medium');
    if (!trip.budget || trip.budget.tier !== tier || trip.budget.amountInr !== amount) {
      trip.budget = { tier, amountInr: amount };
      changed.add('budget');
    }
  }

  const newPrefs = intent.preferences.filter(p => !trip.preferences.includes(p));
  if (newPrefs.length > 0) {
    trip.preferences.push(...newPrefs);
    changed.add('preferences');
  }

  if (intent.transportMode && ['plan_trip', 'modify_trip', 'provide_info'].includes(intent.intent)) {
    if (trip.preferredTransportMode !== intent.transportMode) {
      trip.preferredTransportMode = intent.transportMode;
      trip.removed.transport = false;
      changed.add('mode');
    }
  }

  return { changed, blocked: false };
}

// ---------------------------------------------------------------------------
// Asking and describing
// ---------------------------------------------------------------------------

function joinParts(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

const QUESTION: Record<PlanField, string> = {
  destination: 'where you would like to go',
  origin: 'which city you will be starting from',
  startDate: 'when you would like to travel',
  durationDays: 'how many days the trip should be',
  travellers: 'how many people are going',
  budget: 'your approximate budget (budget, mid-range or luxury)'
};

function askForMissing(trip: TripState, turn: Turn, justStarted: boolean, afterAction: boolean) {
  const missing = missingFields(trip);
  const required = missing.filter(f => f !== 'budget');
  if (required.length === 0) return;
  const fields = missing.includes('budget') ? [...required, 'budget' as PlanField] : required;
  for (const f of fields) if (!trip.askedFor.includes(f)) trip.askedFor.push(f);

  const opener = justStarted && trip.destination ? `Sure! I can help plan your ${trip.destination.name} trip. ` : afterAction ? 'To build the full plan, ' : '';
  const question = joinParts(fields.map(f => QUESTION[f]));
  turn.say(
    afterAction && !justStarted
      ? `${opener}tell me ${question}.`
      : `${opener}Could you tell me ${question}?`
  );
}

function transportLabel(t: TransportOption): string {
  return `${t.operator} (${t.mode}${t.code ? ` ${t.code}` : ''})`;
}

function estimateLine(trip: TripState): string {
  const est = computeEstimate(trip);
  if (!est) return '';
  let line = `Estimated total: ${formatInr(est.total)} (${formatInr(est.perPerson)} per person).`;
  if (est.withinBudget === false && trip.budget?.amountInr) {
    line += ` That is above your ${formatInr(trip.budget.amountInr)} budget; try "show cheaper hotels" or "make it a budget trip".`;
  }
  return line;
}

function describeNewPlan(trip: TripState, turn: Turn) {
  const d = trip.destination!;
  turn.say(
    `Here is your ${trip.durationDays}-day ${d.name} plan for ${trip.travellers} traveller${trip.travellers === 1 ? '' : 's'} from ${trip.origin!.name}, starting ${formatDate(trip.startDate!)}.`
  );
  if (!trip.budget) turn.say('I assumed a mid-range budget; say "budget trip" or "luxury" to change it.');
  const picks = [
    trip.hotel ? `${trip.hotel.name} for your stay` : null,
    trip.transport ? `${transportLabel(trip.transport)} to get there` : null
  ].filter(Boolean) as string[];
  if (picks.length) turn.say(`I have pre-selected ${joinParts(picks)}.`);
  turn.say(estimateLine(trip));
  turn.say('Tap Select on any option to change it, or just tell me what to adjust.');
  turn.show.add('itinerary');
  turn.show.add('hotels');
  turn.show.add('transport');
  turn.show.add('places');
}

function describeChanges(trip: TripState, changed: Set<string>, rebuilt: boolean, turn: Turn) {
  const parts: string[] = [];
  if (changed.has('destination')) parts.push(`destination is now ${trip.destination!.name}`);
  if (changed.has('origin')) parts.push(`starting from ${trip.origin!.name}`);
  if (changed.has('startDate')) parts.push(`travel date is ${formatDate(trip.startDate!)}`);
  if (changed.has('durationDays')) parts.push(`trip is now ${trip.durationDays} days`);
  if (changed.has('travellers')) parts.push(`${trip.travellers} traveller${trip.travellers === 1 ? '' : 's'}`);
  if (changed.has('budget')) {
    parts.push(`${TIER_LABEL[budgetTier(trip)]} trip${trip.budget?.amountInr ? ` (budget ${formatInr(trip.budget.amountInr)})` : ''}`);
  }
  if (changed.has('preferences')) parts.push(`focusing on ${trip.preferences.join(', ')}`);
  if (changed.has('mode') && trip.preferredTransportMode) parts.push(`preferring ${trip.preferredTransportMode} travel`);
  if (parts.length === 0) return;

  turn.say(`Updated your plan: ${joinParts(parts)}.`);
  if (changed.has('budget') || changed.has('destination') || changed.has('origin') || changed.has('mode')) {
    const picks = [trip.hotel ? trip.hotel.name : null, trip.transport ? transportLabel(trip.transport) : null].filter(Boolean) as string[];
    if (picks.length) turn.say(`Recommended now: ${joinParts(picks)}.`);
    turn.show.add('hotels');
    turn.show.add('transport');
  }
  if (rebuilt) turn.show.add('itinerary');
  turn.say(estimateLine(trip));

  const active = trip.bookingRequests.filter(r => ['HELD', 'PENDING_MODULE', 'RECEIVED'].includes(r.status));
  if (active.length && ['destination', 'startDate', 'durationDays', 'travellers', 'origin'].some(f => changed.has(f))) {
    turn.say('Note: your earlier booking request used the previous details; book again to send an updated request.');
  }
}

// ---------------------------------------------------------------------------
// Options: rank, select, remove, add
// ---------------------------------------------------------------------------

async function hotelOptions(trip: TripState): Promise<HotelOption[]> {
  const dest = trip.destination ? destinationById(trip.destination.id) : null;
  return dest ? rankHotels(await listHotels(dest), budgetTier(trip)) : [];
}

async function transportOptions(trip: TripState, mode: TransportMode | null): Promise<TransportOption[]> {
  if (!trip.destination || !trip.origin) return [];
  const all = rankTransport(await listTransport(trip.origin.code, trip.destination.code), budgetTier(trip), mode ?? trip.preferredTransportMode);
  return mode ? all.filter(o => o.mode === mode) : all;
}

async function autoSelect(trip: TripState, changed: Set<string>) {
  if (!trip.removed.hotel && (!trip.hotel || changed.has('budget') || changed.has('destination'))) {
    trip.hotel = (await hotelOptions(trip))[0] ?? null;
    trip.cursor.hotel = 0;
  }
  if (!trip.removed.transport && (!trip.transport || changed.has('budget') || changed.has('origin') || changed.has('mode') || changed.has('destination'))) {
    trip.transport = (await transportOptions(trip, null))[0] ?? null;
    trip.cursor.transport = 0;
  }
}

async function optionName(trip: TripState, target: PlanTarget, id: string): Promise<string | null> {
  if (target === 'hotel') return (await hotelOptions(trip)).find(h => h.id === id)?.name ?? null;
  if (target === 'transport') {
    const t = (await transportOptions(trip, null)).find(o => o.id === id);
    return t ? transportLabel(t) : null;
  }
  if (target === 'place' && trip.destination) {
    return destinationById(trip.destination.id)?.places.find(p => p.id === id)?.name ?? null;
  }
  return null;
}

function inferTarget(trip: TripState, intent: TravelIntent): PlanTarget | null {
  if (intent.target && intent.target !== 'trip') return intent.target;
  if (intent.optionId) {
    if (/^(flt_|trn_|bus_|demo-tr-)/.test(intent.optionId)) return 'transport';
    if (/^(htl_|demo-)/.test(intent.optionId)) return 'hotel';
    if (/^(goa|manali|hyd|jai|ker)-/.test(intent.optionId)) return 'place';
  }
  if (intent.transportMode) return 'transport';
  return trip.lastShown;
}

/** Picks an option from a ranked list by id, 1-based index into what was shown, or "current". */
function pickOption<T extends { id: string }>(all: T[], shownIds: string[], intent: TravelIntent, current: T | null): T | null {
  if (intent.optionId) return all.find(o => o.id === intent.optionId) ?? null;
  if (intent.optionIndex) {
    const id = shownIds[intent.optionIndex - 1];
    return (id ? all.find(o => o.id === id) : all[intent.optionIndex - 1]) ?? null;
  }
  return current ?? all[0] ?? null;
}

async function showOptions(trip: TripState, intent: TravelIntent, turn: Turn) {
  const target = inferTarget(trip, intent) ?? 'hotel';
  if (!trip.destination) {
    turn.say('Which destination should I look at?');
    return;
  }

  if (target === 'itinerary') {
    if (trip.itinerary) {
      turn.say(`Here is your ${trip.durationDays}-day itinerary.`);
      turn.show.add('itinerary');
    }
    return;
  }

  if (target === 'place') {
    trip.lastShown = 'place';
    turn.say(`Here are places to visit in ${trip.destination.name}. Tap Select to add one to your itinerary.`);
    turn.show.add('places');
    return;
  }

  if (target === 'hotel') {
    const all = await hotelOptions(trip);
    trip.lastShown = 'hotel';
    if (all.length === 0) {
      turn.say(`I couldn't retrieve hotels for ${trip.destination.name} right now. Please try again in a moment.`);
      return;
    }
    const current = trip.hotel;
    let list = all;
    if (intent.optionWhich === 'cheaper') {
      const base = current?.pricePerNight ?? Infinity;
      list = all.filter(h => h.pricePerNight < base).sort((a, b) => b.pricePerNight - a.pricePerNight);
      if (list.length === 0) {
        turn.say(`${current ? current.name : 'This'} is already the most affordable stay I have in ${trip.destination.name}.`);
        list = all;
      } else {
        trip.hotel = list[0];
        trip.removed.hotel = false;
        turn.say(`Switched to a cheaper stay: ${list[0].name} at ${formatInr(list[0].pricePerNight)}/night. Other cheaper options are below.`);
      }
    } else if (intent.optionWhich === 'better') {
      const base = current?.pricePerNight ?? 0;
      list = all.filter(h => h.pricePerNight > base).sort((a, b) => a.pricePerNight - b.pricePerNight);
      if (list.length === 0) {
        turn.say('That is already the most premium stay I have there.');
        list = all;
      } else {
        trip.hotel = list[0];
        trip.removed.hotel = false;
        turn.say(`Upgraded your stay to ${list[0].name} at ${formatInr(list[0].pricePerNight)}/night.`);
      }
    } else if (intent.optionWhich === 'next') {
      const idx = current ? all.findIndex(h => h.id === current.id) : -1;
      const next = all[(idx + 1) % all.length];
      trip.hotel = next;
      trip.removed.hotel = false;
      trip.cursor.hotel = (idx + 1) % all.length;
      list = [...all.slice(trip.cursor.hotel), ...all.slice(0, trip.cursor.hotel)];
      turn.say(`How about ${next.name} (${next.area}, ${formatInr(next.pricePerNight)}/night) instead? I've updated your plan.`);
    } else {
      turn.say(`Here are stays in ${trip.destination.name} for a ${TIER_LABEL[budgetTier(trip)]} trip:`);
    }
    turn.hotels = list.slice(0, 4);
    turn.show.add('hotels');
    if (trip.status === 'PLANNED' && intent.optionWhich && intent.optionWhich !== 'current') turn.say(estimateLine(trip));
    return;
  }

  // transport
  if (!trip.origin) {
    turn.say('Which city will you be starting from? Then I can show transport options.');
    if (!trip.askedFor.includes('origin')) trip.askedFor.push('origin');
    return;
  }
  trip.lastShown = 'transport';
  const all = await transportOptions(trip, intent.transportMode);
  if (all.length === 0) {
    const modes = [...new Set((await transportOptions(trip, null)).map(o => o.mode))];
    turn.say(
      intent.transportMode
        ? `There are no ${intent.transportMode}s from ${trip.origin.name} to ${trip.destination.name} in the demo data. Available: ${modes.join(', ') || 'none'}.`
        : `I couldn't retrieve transport options right now. You can continue with the rest of the plan.`
    );
    return;
  }
  const current = trip.transport;
  let list = all;
  if (intent.optionWhich === 'cheaper') {
    const base = current?.pricePerPerson ?? Infinity;
    list = all.filter(o => o.pricePerPerson < base).sort((a, b) => b.pricePerPerson - a.pricePerPerson);
    if (list.length === 0) {
      turn.say('Your current transport is already the cheapest option on this route.');
      list = all;
    } else {
      trip.transport = list[0];
      trip.removed.transport = false;
      turn.say(`Switched to ${transportLabel(list[0])} at ${formatInr(list[0].pricePerPerson)} per person.`);
    }
  } else if (intent.optionWhich === 'next') {
    const idx = current ? all.findIndex(o => o.id === current.id) : -1;
    const next = all[(idx + 1) % all.length];
    trip.transport = next;
    trip.removed.transport = false;
    trip.cursor.transport = (idx + 1) % all.length;
    list = [...all.slice(trip.cursor.transport), ...all.slice(0, trip.cursor.transport)];
    turn.say(`How about ${transportLabel(next)}, departing ${next.departure}, at ${formatInr(next.pricePerPerson)} per person? I've updated your plan.`);
  } else {
    turn.say(`Here are ways to get from ${trip.origin.name} to ${trip.destination.name}:`);
  }
  turn.transport = list.slice(0, 4);
  turn.show.add('transport');
  if (trip.status === 'PLANNED' && intent.optionWhich && intent.optionWhich !== 'current') turn.say(estimateLine(trip));
}

async function selectOption(trip: TripState, intent: TravelIntent, turn: Turn) {
  const target = inferTarget(trip, intent);
  if (!target || target === 'itinerary') {
    turn.say('Which would you like to select: a hotel, transport, or a place to visit?');
    return;
  }
  if (!trip.destination) {
    turn.say('Tell me your destination first, and I will show you options.');
    return;
  }

  if (target === 'place') {
    const dest = destinationById(trip.destination.id)!;
    const shownPlaces = listPlaces(dest, trip.preferences);
    const p = intent.optionId
      ? dest.places.find(x => x.id === intent.optionId)
      : intent.optionIndex ? shownPlaces[intent.optionIndex - 1] : undefined;
    if (!p) {
      turn.say('Which place would you like to add? Here are the options:');
      turn.show.add('places');
      return;
    }
    if (trip.places.some(x => x.id === p.id)) {
      turn.say(`${p.name} is already in your itinerary.`);
      return;
    }
    trip.places.push(p);
    if (trip.itinerary && trip.itinerary.length > 0) {
      const middle = trip.itinerary.length > 2 ? trip.itinerary.slice(1, -1) : trip.itinerary;
      const day = middle.reduce((a, b) => (b.placeIds.length < a.placeIds.length ? b : a));
      day.activities.splice(Math.max(0, day.activities.length - (day === trip.itinerary[trip.itinerary.length - 1] ? 1 : 0)), 0, p.name);
      day.placeIds.push(p.id);
      turn.say(`Added ${p.name} to day ${day.day} of your itinerary.`);
      turn.show.add('itinerary');
    } else {
      turn.say(`Added ${p.name} to your list of places.`);
    }
    return;
  }

  if (target === 'hotel') {
    const all = await hotelOptions(trip);
    const choice = pickOption(all, trip.shown.hotel, intent, null);
    if (!choice) {
      turn.say("I couldn't find that hotel option. Here are the available stays:");
      turn.show.add('hotels');
      return;
    }
    trip.hotel = choice;
    trip.removed.hotel = false;
    trip.lastShown = 'hotel';
    turn.say(`Selected ${choice.name} (${formatInr(choice.pricePerNight)}/night) for your stay.`);
  } else {
    if (!trip.origin) {
      turn.say('Which city will you be starting from?');
      return;
    }
    const all = await transportOptions(trip, intent.transportMode);
    const choice = pickOption(all, trip.shown.transport, intent, null);
    if (!choice) {
      turn.say("I couldn't find that transport option. Here are the available ones:");
      turn.show.add('transport');
      return;
    }
    trip.transport = choice;
    trip.removed.transport = false;
    trip.lastShown = 'transport';
    turn.say(`Selected ${transportLabel(choice)} at ${formatInr(choice.pricePerPerson)} per person.`);
  }
  if (trip.status === 'PLANNED') turn.say(estimateLine(trip));
}

function removeItem(trip: TripState, intent: TravelIntent, turn: Turn) {
  const target = inferTarget(trip, intent);
  if (target === 'hotel') {
    if (!trip.hotel) {
      turn.say('There is no hotel in your plan right now.');
      return;
    }
    const name = trip.hotel.name;
    trip.hotel = null;
    trip.removed.hotel = true;
    turn.say(`Removed ${name} from your plan. Say "add a hotel" if you change your mind.`);
  } else if (target === 'transport') {
    if (!trip.transport) {
      turn.say('There is no transport in your plan right now.');
      return;
    }
    if (intent.transportMode && trip.transport.mode !== intent.transportMode) {
      turn.say(`Your plan doesn't include a ${intent.transportMode}; it has ${transportLabel(trip.transport)}. Say "remove the transport" to drop it.`);
      return;
    }
    const label = transportLabel(trip.transport);
    trip.transport = null;
    trip.removed.transport = true;
    if (trip.preferredTransportMode === intent.transportMode) trip.preferredTransportMode = null;
    turn.say(`Removed ${label} from your plan. You can arrange travel yourself or say "add a train" / "add a flight".`);
  } else if (target === 'place') {
    const p = intent.optionId ? trip.places.find(x => x.id === intent.optionId) : null;
    if (!p) {
      turn.say('Which place should I remove from the itinerary?');
      turn.show.add('itinerary');
      return;
    }
    trip.places = trip.places.filter(x => x.id !== p.id);
    for (const day of trip.itinerary ?? []) {
      day.placeIds = day.placeIds.filter(id => id !== p.id);
      day.activities = day.activities.filter(a => a !== p.name);
    }
    turn.say(`Removed ${p.name} from your itinerary.`);
    turn.show.add('itinerary');
    return;
  } else {
    turn.say('What should I remove: the hotel, the transport, or a place?');
    return;
  }
  if (trip.status === 'PLANNED') turn.say(estimateLine(trip));
}

async function addItem(trip: TripState, intent: TravelIntent, turn: Turn) {
  const target = inferTarget(trip, intent);
  if (!trip.destination) {
    turn.say('Tell me where you are going first.');
    return;
  }
  if (target === 'hotel') {
    trip.removed.hotel = false;
    trip.hotel = (await hotelOptions(trip))[0] ?? null;
    if (trip.hotel) turn.say(`Added ${trip.hotel.name} to your plan.`);
    turn.show.add('hotels');
  } else if (target === 'transport') {
    if (!trip.origin) {
      turn.say('Which city will you be starting from?');
      if (!trip.askedFor.includes('origin')) trip.askedFor.push('origin');
      return;
    }
    const options = await transportOptions(trip, intent.transportMode);
    if (options.length === 0) {
      const modes = [...new Set((await transportOptions(trip, null)).map(o => o.mode))];
      turn.say(`There are no ${intent.transportMode ?? 'transport'} options from ${trip.origin.name} to ${trip.destination.name} in the demo data. Available: ${modes.join(', ') || 'none'}.`);
      return;
    }
    trip.removed.transport = false;
    if (intent.transportMode) trip.preferredTransportMode = intent.transportMode;
    trip.transport = options[0];
    trip.lastShown = 'transport';
    turn.say(`Added ${transportLabel(options[0])}, departing ${options[0].departure}, at ${formatInr(options[0].pricePerPerson)} per person.`);
    turn.transport = options.slice(0, 4);
    turn.show.add('transport');
  } else if (target === 'place') {
    await selectOption(trip, intent, turn);
    return;
  } else {
    turn.say('What would you like to add: a hotel, transport (flight, train or bus), or a place to visit?');
    return;
  }
  if (trip.status === 'PLANNED') turn.say(estimateLine(trip));
}

// ---------------------------------------------------------------------------
// Booking hand-off
// ---------------------------------------------------------------------------

async function book(session: Session, intent: TravelIntent, turn: Turn) {
  const trip = session.trip;
  const missing = requiredMissing(trip);
  if (missing.length > 0) {
    for (const f of missing) if (!trip.askedFor.includes(f)) trip.askedFor.push(f);
    turn.say(`Before I can create a booking request, tell me ${joinParts(missing.map(f => QUESTION[f]))}.`);
    return;
  }

  let targets: Array<'hotel' | 'transport'>;
  const explicit = inferTarget(trip, { ...intent, target: intent.target === 'trip' ? null : intent.target });
  if (intent.target === 'trip') targets = ['transport', 'hotel'];
  else if (explicit === 'hotel' || explicit === 'transport') targets = [explicit];
  else if (trip.hotel && !trip.transport) targets = ['hotel'];
  else if (trip.transport && !trip.hotel) targets = ['transport'];
  else {
    turn.say('Should I book the hotel, the transport, or both? (Say "book the hotel", "book the train" or "book everything".)');
    return;
  }

  for (const target of targets) {
    try {
      let record: BookingRequestRecord;
      if (target === 'hotel') {
        const all = await hotelOptions(trip);
        const hotel = intent.optionId || intent.optionIndex ? pickOption(all, trip.shown.hotel, intent, null) : trip.hotel ?? all[0] ?? null;
        if (!hotel) {
          turn.say("I couldn't find that hotel. Please pick one of the options below.");
          turn.show.add('hotels');
          continue;
        }
        trip.hotel = hotel;
        trip.removed.hotel = false;
        record = await submitBookingRequest(buildHotelRequest(trip, hotel, session.id));
      } else {
        const all = await transportOptions(trip, intent.transportMode);
        const current = trip.transport && (!intent.transportMode || trip.transport.mode === intent.transportMode) ? trip.transport : null;
        const option = intent.optionId || intent.optionIndex ? pickOption(all, trip.shown.transport, intent, null) : current ?? all[0] ?? null;
        if (!option) {
          turn.say(`I couldn't find a ${intent.transportMode ?? 'transport'} option to book on this route.`);
          turn.show.add('transport');
          continue;
        }
        trip.transport = option;
        trip.removed.transport = false;
        record = await submitBookingRequest(buildTransportRequest(trip, option, session.id));
      }
      recordBooking(trip, record);
      turn.bookingRequest = record;
      turn.show.add('booking_request');
      turn.say(describeBooking(record));
      if (record.status === 'REJECTED') turn.show.add(target === 'hotel' ? 'hotels' : 'transport');
    } catch (err) {
      if (err instanceof BookingRequestError) turn.say(`I couldn't create that booking request: ${err.message}.`);
      else {
        console.error('[Chat] Booking hand-off failed:', err);
        turn.say("I couldn't reach the booking module right now. You can try again, or pick another option.");
      }
    }
  }
}

function recordBooking(trip: TripState, r: BookingRequestRecord) {
  const req = r.request as any;
  const summary = {
    requestId: r.requestId,
    type: r.type,
    itemId: r.type === 'hotel_booking' ? req.hotelId : req.optionId,
    itemName: r.type === 'hotel_booking' ? req.hotelName : `${req.operator} (${req.mode})`,
    status: r.status,
    bookingId: r.bookingId,
    createdAt: r.createdAt
  };
  trip.bookingRequests = [summary, ...trip.bookingRequests.filter(b => b.requestId !== r.requestId)].slice(0, 20);
}

function describeBooking(r: BookingRequestRecord): string {
  const req = r.request as any;
  const what = r.type === 'hotel_booking' ? `${req.hotelName} (${req.rooms} room${req.rooms > 1 ? 's' : ''}, ${req.checkIn} to ${req.checkOut})` : `${req.operator} for ${req.travellers} on ${req.date}`;
  if (r.duplicate) return `You already have a booking request for ${what} (status: ${r.status}).`;
  switch (r.status) {
    case 'HELD':
      return `Demo booking request created for ${what}. The booking module reserved it for 10 minutes (booking ${r.bookingId}). The next step is the demo payment; nothing has been charged.`;
    case 'PENDING_MODULE':
      return `Demo booking request created for ${what} and sent to the ${r.module}. This is a demo option, so no real booking has been made yet.`;
    case 'REJECTED':
      return `I couldn't reserve ${what}: ${r.message}. You can try another option below.`;
    default:
      return `Booking request for ${what} is ${r.status}.`;
  }
}

async function refreshBookingStatuses(trip: TripState) {
  for (const b of trip.bookingRequests) {
    try {
      const fresh = await getBookingRequest(b.requestId);
      if (fresh) b.status = fresh.status;
    } catch {
      // keep last known status
    }
  }
}

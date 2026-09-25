/**
 * DEMO / FALLBACK intent extractor.
 *
 * Used when no AI key is configured or the AI service fails. It is a compact
 * rule-based parser (not a list of canned sentences) that produces the same
 * TravelIntent shape as the LLM, so the rest of the pipeline is identical.
 */
import { resolveCity, resolveDestination } from './catalog.js';
import type {
  BudgetTier,
  IntentName,
  PlanField,
  PlanTarget,
  TransportMode,
  TravelIntent,
  TripState
} from './types.js';

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, single: 1, two: 2, couple: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12
};
const NUM = '(\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';

function toNumber(token: string | undefined): number | null {
  if (!token) return null;
  if (/^\d+$/.test(token)) return parseInt(token, 10);
  return NUMBER_WORDS[token] ?? null;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12
};
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Resolves "10 Oct", "October 10th", "2026-10-10", "10/10", "tomorrow", "next friday"... */
export function parseDate(text: string, today: string): string | null {
  const now = new Date(`${today}T00:00:00Z`);
  const isoMatch = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    const d = new Date(Date.UTC(+isoMatch[1], +isoMatch[2] - 1, +isoMatch[3]));
    return Number.isNaN(d.getTime()) ? null : iso(d);
  }

  const monthNames = Object.keys(MONTHS).join('|');
  const dm = text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?(${monthNames})\\b(?:\\s*,?\\s*(20\\d{2}))?`));
  const md = text.match(new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s*,?\\s*(20\\d{2}))?`));
  const slash = text.match(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](20\d{2}))?\b/);

  let day: number | null = null;
  let month: number | null = null;
  let year: number | null = null;
  if (dm) [day, month, year] = [+dm[1], MONTHS[dm[2]], dm[3] ? +dm[3] : null];
  else if (md) [day, month, year] = [+md[2], MONTHS[md[1]], md[3] ? +md[3] : null];
  else if (slash) [day, month, year] = [+slash[1], +slash[2], slash[3] ? +slash[3] : null]; // Indian dd/mm

  if (day && month) {
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    let y = year ?? now.getUTCFullYear();
    let d = new Date(Date.UTC(y, month - 1, day));
    if (d.getUTCMonth() !== month - 1) return null; // e.g. 31 Feb
    if (!year && d < now) {
      y += 1;
      d = new Date(Date.UTC(y, month - 1, day));
    }
    return iso(d);
  }

  if (/\btoday\b/.test(text)) return iso(now);
  if (/\bday after tomorrow\b/.test(text)) return iso(addDays(now, 2));
  if (/\btomorrow\b/.test(text)) return iso(addDays(now, 1));
  if (/\bnext week\b/.test(text)) return iso(addDays(now, 7));
  if (/\bnext month\b/.test(text)) {
    return iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)));
  }
  if (/\b(this|next|coming) weekend\b/.test(text)) {
    const toSat = (6 - now.getUTCDay() + 7) % 7 || 7;
    return iso(addDays(now, /\bnext weekend\b/.test(text) ? toSat + 7 : toSat));
  }
  const wd = text.match(/\b(?:on|next|this|coming)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (wd) {
    const target = WEEKDAYS.indexOf(wd[1]);
    const delta = (target - now.getUTCDay() + 7) % 7 || 7;
    return iso(addDays(now, delta));
  }
  const inDays = text.match(new RegExp(`\\bin\\s+${NUM}\\s+(days?|weeks?)\\b`));
  if (inDays) {
    const n = toNumber(inDays[1]);
    if (n) return iso(addDays(now, inDays[2].startsWith('week') ? n * 7 : n));
  }
  return null;
}

function parseBudgetAmount(text: string): number | null {
  const m =
    text.match(/(?:₹|rs\.?|inr|rupees)\s*([\d,]+(?:\.\d+)?)\s*(k|lakh|lakhs|l)?\b/) ||
    text.match(/\b([\d,]+(?:\.\d+)?)\s*(k|lakh|lakhs|thousand)\b/) ||
    text.match(/\b([\d,]{4,})\s*(?:rupees|rs|inr|budget)\b/) ||
    text.match(/\b(?:budget|under|within|below|max|upto|up to)\s*(?:of\s*|is\s*)?(?:₹|rs\.?)?\s*([\d,]{4,})\b/);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ''));
  const unit = m[2];
  if (unit === 'k' || unit === 'thousand') n *= 1000;
  if (unit === 'lakh' || unit === 'lakhs' || unit === 'l') n *= 100000;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

const PREFERENCE_KEYWORDS: Array<[RegExp, string]> = [
  [/\bbeach(es)?\b|\bsea\b/, 'beach'],
  [/\bheritage|histor(y|ic|ical)|forts?\b|palaces?\b|monuments?/, 'heritage'],
  [/\bfood|cuisine|biryani|street food|foodie/, 'food'],
  [/\bnightlife|party|parties|clubs?\b|pubs?\b/, 'nightlife'],
  [/\badventure|trek(king)?|paragliding|rafting|snow\b/, 'adventure'],
  [/\bnature|hills?\b|mountains?|waterfalls?|backwaters?|scenic/, 'nature'],
  [/\bshopping|markets?\b|bazaars?/, 'shopping'],
  [/\bculture|cultural|temples?\b|museums?/, 'culture']
];

function detectTarget(t: string): { target: PlanTarget | null; mode: TransportMode | null } {
  let mode: TransportMode | null = null;
  if (/\b(flights?|fly|flying|plane|airline)\b/.test(t)) mode = 'flight';
  else if (/\b(trains?|rail|railway)\b/.test(t)) mode = 'train';
  else if (/\b(bus|buses|volvo|coach)\b/.test(t)) mode = 'bus';

  if (/\b(hotels?|stays?|accommodation|rooms?|resorts?|hostels?|homestays?|place to stay)\b/.test(t)) {
    return { target: 'hotel', mode };
  }
  if (mode || /\b(transport|travel options?|tickets?|commute|how to get|getting there)\b/.test(t)) {
    return { target: 'transport', mode };
  }
  if (/\b(places|sightseeing|attractions?|things to do|spots|places to visit)\b/.test(t)) {
    return { target: 'place', mode };
  }
  if (/\b(itinerary|day plan|schedule)\b/.test(t)) return { target: 'itinerary', mode };
  return { target: null, mode };
}

function detectOptionIndex(t: string): number | null {
  const ordinals: Array<[RegExp, number]> = [
    [/\b(first|1st)\b/, 1],
    [/\b(second|2nd)\b/, 2],
    [/\b(third|3rd)\b/, 3],
    [/\b(fourth|4th)\b/, 4],
    [/\b(fifth|5th)\b/, 5]
  ];
  for (const [re, n] of ordinals) if (re.test(t)) return n;
  const m = t.match(/\b(?:option|number|no\.?|#)\s*(\d+)\b/);
  return m ? parseInt(m[1], 10) : null;
}

/** Captures "trip to X", "visit X"... so unsupported destinations can be reported by name. */
function rawDestinationPhrase(t: string): string | null {
  const m = t.match(
    /\b(?:visit(?:ing)?|trip to|go(?:ing)? to|travel(?:ling)? to|holiday (?:in|to)|vacation (?:in|to)|plan (?:a )?trip to|hotels? in|fly to|head(?:ing)? to)\s+([a-z][a-z ]{1,30}?)(?=\s+(?:for|with|from|on|in|next|this|by|and|under|starting)\b|[,.!?]|$)/
  );
  if (!m) return null;
  const phrase = m[1].replace(/^(the|a|an)\s+/, '').trim();
  if (!phrase || /^(a|the|my|somewhere|trip|holiday)$/.test(phrase)) return null;
  return phrase;
}

export function extractIntentDemo(message: string, trip: TripState, today: string): TravelIntent {
  const t = ` ${message.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim()} `;
  const intent: TravelIntent = {
    intent: 'unknown',
    destination: null,
    origin: null,
    startDate: null,
    durationDays: null,
    durationDelta: null,
    travellers: null,
    travellersDelta: null,
    budgetTier: null,
    budgetAmount: null,
    preferences: [],
    target: null,
    transportMode: null,
    bookingPriority: null,
    optionIndex: null,
    optionId: null,
    optionWhich: null,
    pendingField: null,
    missingInformation: [],
    action: 'none',
    reply: null
  };

  // --- Origin: "from X", "starting from X", "I'm in X" ---
  let rest = t;
  const originMatch = t.match(/\b(?:from|starting (?:from|in)|leaving from|departing from|i'?m in|i am in|i live in|based in)\s+([a-z][a-z ]{1,25}?)(?=\s+(?:to|on|for|with|and|in|next|this|by|starting)\b|[,.!?]|\s*$)/);
  if (originMatch) {
    const city = resolveCity(originMatch[1]);
    intent.origin = city ? city.name : originMatch[1].trim();
    rest = t.replace(originMatch[0], ' ');
  }

  // --- Destination ---
  const dest = resolveDestination(rest);
  const raw = rawDestinationPhrase(rest);
  if (dest) intent.destination = dest.name;
  else if (raw && !resolveCity(raw)) intent.destination = raw;
  else if (raw && resolveCity(raw)) intent.destination = raw; // a city we know only as an origin

  // A bare city as an answer: "Bengaluru" when we asked where they start from.
  const bareCity = message.trim().split(/\s+/).length <= 3 ? resolveCity(message) : null;
  if (!intent.origin && bareCity && trip.destination && !trip.origin) {
    intent.origin = bareCity.name;
    if (intent.destination && resolveDestination(intent.destination)?.id === trip.destination.id) intent.destination = null;
    if (intent.destination?.toLowerCase() === bareCity.name.toLowerCase()) intent.destination = null;
  }

  // --- Duration ---
  const dur = t.match(new RegExp(`\\b${NUM}\\s*-?\\s*(days?|nights?)\\b`));
  if (/\b(a|one) week\b/.test(t)) intent.durationDays = 7;
  else if (/\blong weekend\b/.test(t)) intent.durationDays = 3;
  else if (/\bweekend (trip|getaway)\b/.test(t)) intent.durationDays = 2;
  if (dur && !/\bin\s+\S+\s+days?\b/.test(t.slice(Math.max(0, (dur.index ?? 0) - 4), (dur.index ?? 0) + dur[0].length))) {
    const n = toNumber(dur[1]);
    if (n) intent.durationDays = dur[2].startsWith('night') ? n + 1 : n;
  }
  const moreDays = t.match(new RegExp(`\\b(?:add|extend(?: it| the trip)? by|${NUM} more)\\s*${NUM}?\\s*(?:more\\s+)?days?\\b`));
  if (/\b(one|a|1) more day\b|\badd (a|one) day\b|\bextend (it |the trip )?by (a|one) day\b/.test(t)) {
    intent.durationDelta = 1;
    intent.durationDays = null;
  } else if (moreDays && /\b(add|extend|more)\b/.test(moreDays[0])) {
    const n = toNumber(moreDays[1]) ?? toNumber(moreDays[2]);
    if (n) {
      intent.durationDelta = n;
      intent.durationDays = null;
    }
  }
  if (/\b(one|a|1) day (less|shorter)\b|\b(reduce|shorten)( it| the trip)? by (a|one) day\b/.test(t)) {
    intent.durationDelta = -1;
    intent.durationDays = null;
  }

  // --- Travellers ---
  const addPeople = t.match(new RegExp(`\\badd\\s+${NUM}\\s+(?:more\\s+)?(people|persons|travell?ers|friends|adults|members|guests)\\b`));
  const lessPeople = t.match(new RegExp(`\\b(?:remove|minus|less|drop)\\s+${NUM}\\s+(people|persons|travell?ers|friends|adults|members|guests|person)\\b`));
  const withFriends = t.match(new RegExp(`\\bwith\\s+(?:my\\s+)?${NUM}\\s+(friends|colleagues|kids|children|others|people|family members)\\b`));
  const forPeople = t.match(new RegExp(`\\b(?:for|we are|we're|group of|family of|party of|total(?: of)?)\\s+${NUM}\\s*(people|persons|pax|travell?ers|adults|of us|members|guests)?\\b`));
  const nPeople = t.match(new RegExp(`\\b${NUM}\\s+(people|persons|pax|travell?ers|adults|guests)\\b`));
  if (addPeople) intent.travellersDelta = toNumber(addPeople[1]);
  else if (lessPeople) intent.travellersDelta = -(toNumber(lessPeople[1]) ?? 0) || null;
  else if (withFriends) intent.travellers = (toNumber(withFriends[1]) ?? 0) + 1;
  else if (forPeople && (forPeople[2] || /\b(we are|we're|group of|family of|party of)\b/.test(forPeople[0]))) {
    intent.travellers = toNumber(forPeople[1]);
  } else if (nPeople) intent.travellers = toNumber(nPeople[1]);
  else if (/\b(my (wife|husband|partner|girlfriend|boyfriend|spouse)|as a couple|honeymoon|the two of us|both of us)\b/.test(t)) {
    intent.travellers = 2;
  } else if (/\b(solo|alone|just me|only me|by myself)\b/.test(t)) intent.travellers = 1;
  else if (/\bwith (a|my) friend\b/.test(t)) intent.travellers = 2;
  // Bare number answer to "how many people?"
  if (intent.travellers == null && intent.travellersDelta == null && /^\s*\d{1,2}\s*$/.test(message) && trip.askedFor.includes('travellers') && !trip.travellers) {
    intent.travellers = parseInt(message, 10);
  }

  // --- Dates ---
  intent.startDate = parseDate(t, today);

  // --- Budget ---
  intent.budgetAmount = parseBudgetAmount(t);
  let tier: BudgetTier | null = null;
  if (/\b(budget|cheap|cheaper|low[- ]cost|affordable|backpack(er|ing)?|economical|save money)\b/.test(t)) tier = 'budget';
  if (/\b(luxury|luxurious|premium|5[- ]star|five[- ]star|lavish|splurge)\b/.test(t)) tier = 'luxury';
  if (/\b(mid[- ]range|moderate|medium|comfortable|standard)\b/.test(t)) tier = 'medium';
  // "cheaper hotels" is an option request, not a trip-wide budget change
  if (tier === 'budget' && /\bcheaper\b/.test(t) && !/\b(budget|cheap) trip\b/.test(t)) tier = null;
  intent.budgetTier = tier;

  // --- Preferences ---
  for (const [re, tag] of PREFERENCE_KEYWORDS) if (re.test(t)) intent.preferences.push(tag);

  // --- Target / option references ---
  const { target, mode } = detectTarget(t);
  intent.target = target;
  intent.transportMode = mode;
  intent.optionIndex = detectOptionIndex(t);
  if (/\b(cheaper|less expensive|lower price|cheapest)\b/.test(t)) intent.optionWhich = 'cheaper';
  else if (/\b(better|nicer|upgrade|more luxurious|fancier)\b/.test(t)) intent.optionWhich = 'better';
  else if (/\b(another|different|other|next|change the|swap the|replace the)\b/.test(t)) intent.optionWhich = 'next';
  else if (/\b(this one|that one|this|recommended|suggested|current|it)\b/.test(t)) intent.optionWhich = 'current';

  // --- Booking Priority: flight, hotel, train, or bus first ---
  if (/\b(?:flight|flights|fly|plane|air) (?:first|1st|priority|firstly)\b|\b(?:book|reserve|prioriti[sz]e)\s+(?:the\s+)?(?:flight|flights|plane)\s*(?:first|1st)?\b/i.test(t)) {
    intent.bookingPriority = 'flight';
  } else if (/\b(?:hotel|hotels|stay|room|rooms) (?:first|1st|priority|firstly)\b|\b(?:book|reserve|prioriti[sz]e)\s+(?:the\s+)?(?:hotel|hotels|stay|room)\s*(?:first|1st)?\b/i.test(t)) {
    intent.bookingPriority = 'hotel';
  } else if (/\b(?:train|trains|rail|railway) (?:first|1st|priority|firstly)\b|\b(?:book|reserve|prioriti[sz]e)\s+(?:the\s+)?(?:train|trains|rail)\s*(?:first|1st)?\b/i.test(t)) {
    intent.bookingPriority = 'train';
  } else if (/\b(?:bus|buses|sleeper) (?:first|1st|priority|firstly)\b|\b(?:book|reserve|prioriti[sz]e)\s+(?:the\s+)?(?:bus|buses)\s*(?:first|1st)?\b/i.test(t)) {
    intent.bookingPriority = 'bus';
  } else if (/^\s*(flight|flights|plane)\s*$/i.test(message)) {
    intent.bookingPriority = 'flight';
  } else if (/^\s*(hotel|hotels|stay)\s*$/i.test(message)) {
    intent.bookingPriority = 'hotel';
  } else if (/^\s*(train|trains|rail)\s*$/i.test(message)) {
    intent.bookingPriority = 'train';
  } else if (/^\s*(bus|buses)\s*$/i.test(message)) {
    intent.bookingPriority = 'bus';
  }

  // --- Pending field changes without a value ---
  const wantsChange = /\b(change|update|modify|different|shift|move|reschedule)\b/.test(t);
  if (wantsChange && /\b(date|dates|day of travel|travel date)\b/.test(t) && !intent.startDate) intent.pendingField = 'startDate';
  if (wantsChange && /\b(number of (people|travell?ers)|headcount|people)\b/.test(t) && intent.travellers == null && intent.travellersDelta == null) intent.pendingField = 'travellers';
  if (wantsChange && /\b(duration|length)\b/.test(t) && !intent.durationDays && !intent.durationDelta) intent.pendingField = 'durationDays';
  if (wantsChange && /\b(destination)\b/.test(t) && !intent.destination) intent.pendingField = 'destination';
  if (wantsChange && /\b(origin|starting (city|point|location))\b/.test(t) && !intent.origin) intent.pendingField = 'origin';
  if (wantsChange && /\b(priority|booking priority|first priority|what to book first)\b/.test(t) && !intent.bookingPriority) intent.pendingField = 'priority';

  // --- Intent classification (most specific first) ---
  const hasPlanFields =
    intent.origin || intent.startDate || intent.durationDays || intent.durationDelta || intent.travellers ||
    intent.travellersDelta || intent.budgetTier || intent.budgetAmount || intent.bookingPriority || intent.preferences.length > 0;
  const hasTripAlready = Boolean(trip.destination);
  const choose = (name: IntentName) => (intent.intent = name);

  if (/\b(book|reserve) (everything|all|the (whole|entire) trip|both)\b/.test(t)) intent.target = 'trip';

  if (/\b(start over|reset|new trip|clear (the |my )?(plan|trip)|forget (it|everything))\b/.test(t)) choose('reset');
  else if (/\b(book|reserve)\b/.test(t) && !/\bbooking (options|status)\b/.test(t)) choose('book');
  else if (/\b(remove|drop|delete|no need for|don'?t need|do not need|skip|without)\b/.test(t) && target && target !== 'trip' && intent.travellersDelta == null) choose('remove_item');
  else if (/\badd\b/.test(t) && (target === 'transport' || target === 'hotel' || target === 'place') && intent.travellersDelta == null && intent.durationDelta == null) choose('add_item');
  else if (/\b(select|choose|pick|go with|i'?ll take|take the|prefer the|i like the)\b/.test(t) && (target || intent.optionIndex)) choose('select_option');
  else if (
    (/\b(show|list|see|find|suggest|recommend|options?|cheaper|another|alternatives?|different|what are|which)\b/.test(t) &&
      (target || (intent.optionWhich !== null && intent.optionWhich !== 'current'))) ||
    /\bchange the (hotel|stay|train|flight|bus|transport)\b/.test(t)
  ) choose('show_options');
  else if (intent.pendingField || (hasTripAlready && (hasPlanFields || (intent.destination && resolveDestination(intent.destination)?.id !== trip.destination?.id)) && /\b(change|make|instead|extend|increase|reduce|add|switch|update|actually|want a|shift)\b/.test(t))) choose('modify_trip');
  else if (intent.destination && (!hasTripAlready || resolveDestination(intent.destination)?.id !== trip.destination?.id)) choose('plan_trip');
  else if (hasPlanFields || intent.destination) choose(hasTripAlready ? 'provide_info' : 'plan_trip');
  else if (/^\s*(hi|hello|hey|namaste|hola|good (morning|afternoon|evening))\b/.test(t)) choose('greeting');
  else if (target) choose('show_options');
  else if (/\?\s*$/.test(t) || /^\s*(what|how|when|where|why|is|can|do|does)\b/.test(t)) choose('general_question');

  if (intent.intent === 'greeting') {
    intent.reply = 'Hi! Tell me where you would like to go, and I will put together a trip plan for you.';
  }
  if (intent.intent === 'general_question') {
    intent.reply = null; // orchestrator answers with what it can do in demo mode
  }
  intent.action =
    intent.intent === 'book' ? 'create_booking_request'
      : intent.intent === 'show_options' ? 'show_recommendations'
        : intent.intent === 'greeting' || intent.intent === 'general_question' ? 'answer'
          : 'update_plan';
  return intent;
}

export function pendingFieldLabel(field: PlanField): string {
  return {
    destination: 'destination',
    origin: 'starting city',
    startDate: 'travel date',
    durationDays: 'trip length',
    travellers: 'number of travellers',
    budget: 'budget',
    priority: 'first booking priority (flight, hotel, train, or bus)'
  }[field] ?? field;
}

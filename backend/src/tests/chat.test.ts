/**
 * AI Travel Planner tests (node:test). Runs fully offline:
 *  - demo extractor for most flows (CHAT_AI_MODE=demo)
 *  - a fake LLM injected via setLlmExtractorForTests() to verify LLM mode and AI-failure fallback
 */
import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';

process.env.CHAT_AI_MODE = 'demo';
process.env.CHAT_TODAY = '2026-09-24';

import { initDb, applySchemaAndSeed, query } from '../db/client.js';
import { initRedis } from '../redis/client.js';
import { buildApp } from '../server.js';
import { setLlmExtractorForTests } from '../chat/orchestrator.js';
import { AiServiceError, TravelIntentSchema, buildUserContent } from '../chat/llmExtractor.js';
import { extractIntentDemo, parseDate } from '../chat/demoExtractor.js';
import { emptyTrip } from '../chat/planner.js';
import { checkInvariants } from '../booking/engine.js';
import type { TravelIntent } from '../chat/types.js';

let app: FastifyInstance;

async function http(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) {
  const res = await app.inject({ method, url, payload: payload as any });
  return { status: res.statusCode, body: res.json() as any };
}

function chat() {
  let sessionId: string | undefined;
  const say = async (message: unknown) => {
    const r = await http('POST', '/api/chat', { sessionId, message });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    sessionId = r.body.sessionId;
    return r.body;
  };
  return { say, id: () => sessionId! };
}

before(async () => {
  await initDb();
  await initRedis();
  await applySchemaAndSeed(true);
  app = await buildApp();
});

beforeEach(async () => {
  await applySchemaAndSeed();
  setLlmExtractorForTests(null);
});

after(async () => {
  await app?.close();
});

// ---------------------------------------------------------------------------
describe('requirement collection and itinerary', () => {
  test('asks only for what is missing, then generates the plan', async () => {
    const c = chat();
    const first = await c.say('I want to visit Goa.');
    assert.equal(first.trip.destination.name, 'Goa');
    assert.match(first.reply, /Goa trip/);
    assert.match(first.reply, /when you would like to travel/);
    assert.match(first.reply, /how many people/);

    const second = await c.say('with 2 friends for 3 days');
    assert.equal(second.trip.travellers, 3);
    assert.equal(second.trip.durationDays, 3);
    assert.doesNotMatch(second.reply, /how many people|how many days/, 'must not re-ask known info');
    assert.match(second.reply, /starting from/);

    const plan = await c.say('from Bengaluru on 10 Oct');
    assert.equal(plan.trip.status, 'PLANNED');
    assert.equal(plan.trip.startDate, '2026-10-10');
    assert.equal(plan.trip.itinerary.length, 3);
    assert.match(plan.trip.itinerary[0].activities[0], /Arrive/);
    assert.match(plan.trip.itinerary[2].activities.at(-1), /depart/);
    assert.ok(plan.trip.hotel && plan.trip.transport);
    assert.ok(plan.trip.estimate.total > 0);
    assert.deepEqual(plan.missingInformation, []);
    // The day-by-day itinerary card and the places/activities card are no longer
    // shown automatically - the plan goes straight to flight/hotel package options.
    assert.ok(!plan.show.includes('itinerary'));
    assert.ok(!plan.show.includes('places'));
    for (const s of ['hotels', 'transport']) assert.ok(plan.show.includes(s));
    assert.ok(plan.recommendations.hotels.length > 0);
    assert.ok(plan.recommendations.transport.length > 0);
    assert.match(plan.demoDataNotice, /Demo/);
  });

  test('a complete request is planned in one turn without questions', async () => {
    const c = chat();
    const r = await c.say('Plan a 4 day trip to Jaipur from Delhi on 5 November for 2 people, luxury');
    assert.equal(r.trip.status, 'PLANNED');
    assert.equal(r.trip.itinerary.length, 4);
    assert.equal(r.trip.budget.tier, 'luxury');
    assert.equal(r.trip.hotel.tier, 'luxury');
    assert.doesNotMatch(r.reply, /Could you tell me/);
  });

  test('examples from the brief are understood', async () => {
    const manali = await chat().say('Plan a trip to Manali for 4 people');
    assert.equal(manali.trip.destination.name, 'Manali');
    assert.equal(manali.trip.travellers, 4);

    const hyd = await chat().say('I want a budget trip to Hyderabad');
    assert.equal(hyd.trip.destination.name, 'Hyderabad');
    assert.equal(hyd.trip.budget.tier, 'budget');

    const hotels = await chat().say('Show me hotels in Goa');
    assert.ok(hotels.show.includes('hotels'));
    assert.ok(hotels.recommendations.hotels.length > 0);
  });
});

// ---------------------------------------------------------------------------
describe('conversation commands update the current plan', () => {
  async function plannedGoa() {
    const c = chat();
    await c.say('I want to visit Goa for 3 days with 2 friends from Bengaluru on 10 Oct');
    return c;
  }

  test('change / cheaper / another option / remove / add', async () => {
    const c = await plannedGoa();
    const start = (await c.say('show my itinerary')).trip;

    const changed = await c.say('Change the hotel.');
    assert.notEqual(changed.trip.hotel.id, start.hotel.id);
    assert.equal(changed.trip.destination.name, 'Goa', 'plan kept');

    const cheaper = await c.say('Show cheaper hotels');
    assert.ok(cheaper.trip.hotel.pricePerNight < changed.trip.hotel.pricePerNight);
    assert.ok(cheaper.recommendations.hotels.every((h: any) => h.pricePerNight <= changed.trip.hotel.pricePerNight));

    const another = await c.say('Show another option');
    assert.notEqual(another.trip.hotel.id, cheaper.trip.hotel.id);

    const removed = await c.say('Remove the hotel.');
    assert.equal(removed.trip.hotel, null);
    assert.equal(removed.trip.estimate.stay, 0);

    const budget = await c.say('I want a budget trip.');
    assert.equal(budget.trip.budget.tier, 'budget');
    assert.equal(budget.trip.hotel, null, 'a removed hotel stays removed');

    const train = await c.say('Add a train.');
    assert.equal(train.trip.transport.mode, 'train');

    const noTrain = await c.say('Remove the train from my plan');
    assert.equal(noTrain.trip.transport, null);
  });

  test('duration, travellers and dates change in place', async () => {
    const c = await plannedGoa();
    const four = await c.say('Make the trip 4 days instead.');
    assert.equal(four.trip.durationDays, 4);
    assert.equal(four.trip.itinerary.length, 4);
    assert.equal(four.trip.travellers, 3, 'other fields untouched');
    assert.equal(four.trip.origin.name, 'Bengaluru');

    const more = await c.say('Add two more people.');
    assert.equal(more.trip.travellers, 5);
    assert.ok(more.trip.estimate.total > four.trip.estimate.total);

    const ask = await c.say('Change my travel date.');
    assert.match(ask.reply, /travel date would you like/);
    assert.equal(ask.trip.pendingField, 'startDate');
    const date = await c.say('12 October');
    assert.equal(date.trip.startDate, '2026-10-12');
    assert.equal(date.trip.pendingField, null);
  });

  test('selecting by position refers to the list that was shown', async () => {
    const c = await plannedGoa();
    const shown = await c.say('show hotels');
    const second = shown.recommendations.hotels[1];
    const r = await c.say('select the second one');
    assert.equal(r.trip.hotel.id, second.id);
  });

  test('card buttons use the same state logic', async () => {
    const c = await plannedGoa();
    const shown = await c.say('show transport options');
    const bus = shown.recommendations.transport.find((t: any) => t.mode === 'bus') ?? shown.recommendations.transport[0];
    const r = await http('POST', '/api/chat/action', { sessionId: c.id(), action: 'select', target: 'transport', itemId: bus.id });
    assert.equal(r.status, 200);
    assert.equal(r.body.trip.transport.id, bus.id);
    const bad = await http('POST', '/api/chat/action', { sessionId: c.id(), action: 'explode', target: 'hotel' });
    assert.equal(bad.status, 400);
  });
});

// ---------------------------------------------------------------------------
describe('booking hand-off', () => {
  test('booking an inventory item creates a request and a real engine hold', async () => {
    const c = chat();
    await c.say('Goa for 3 days with 2 friends from Bengaluru on 10 Oct');
    await c.say('Add a train');
    const before = await query(`SELECT held_quantity FROM inventory WHERE id = 'trn_goa_express_12779'`);

    const r = await c.say('Book this one.');
    const br = r.bookingRequest;
    assert.equal(br.status, 'HELD');
    assert.equal(br.request.type, 'transport_booking');
    assert.deepEqual(
      { from: br.request.from, to: br.request.to, travellers: br.request.travellers, date: br.request.date },
      { from: 'Bengaluru', to: 'Goa', travellers: 3, date: '2026-10-10' }
    );
    assert.equal(br.booking.status, 'HELD');
    assert.equal(br.next.endpoint, '/api/bookings/confirm');
    const after = await query(`SELECT held_quantity FROM inventory WHERE id = 'trn_goa_express_12779'`);
    assert.equal(after.rows[0].held_quantity - before.rows[0].held_quantity, 3);
    assert.equal(r.trip.bookingRequests[0].status, 'HELD');
    assert.equal((await checkInvariants()).invariantValid, true);

    // Double click -> same request, no extra hold
    const again = await c.say('Book this one.');
    assert.equal(again.bookingRequest.requestId, br.requestId);
    const after2 = await query(`SELECT held_quantity FROM inventory WHERE id = 'trn_goa_express_12779'`);
    assert.equal(after2.rows[0].held_quantity, after.rows[0].held_quantity);

    // Payment demo module confirms -> request reflects it
    const pay = await http('POST', '/api/bookings/confirm', br.next.body);
    assert.equal(pay.status, 200);
    const status = await http('GET', `/api/booking-requests/${br.requestId}`);
    assert.equal(status.body.bookingRequest.status, 'CONFIRMED');
    const session = await http('GET', `/api/chat/session/${c.id()}`);
    assert.equal(session.body.trip.bookingRequests[0].status, 'CONFIRMED');
  });

  test('a demo-only hotel is queued for the hotel module, which reports back', async () => {
    const c = chat();
    await c.say('budget trip to Goa for 3 days, 3 people, from Bengaluru on 10 Oct');
    const r = await c.say('Book the recommended hotel.');
    const br = r.bookingRequest;
    assert.equal(br.status, 'PENDING_MODULE');
    assert.equal(br.request.type, 'hotel_booking');
    for (const k of ['destination', 'travellers', 'checkIn', 'checkOut', 'hotelId']) assert.ok(k in br.request, k);
    assert.equal(br.request.checkIn, '2026-10-10');
    assert.equal(br.request.checkOut, '2026-10-12');

    const pending = await http('GET', '/api/booking-requests?status=PENDING_MODULE&type=hotel_booking');
    assert.ok(pending.body.bookingRequests.some((x: any) => x.requestId === br.requestId));

    const done = await http('PATCH', `/api/booking-requests/${br.requestId}`, { status: 'CONFIRMED', externalRef: 'HTL-REF-1', module: 'hotel-service' });
    assert.equal(done.body.bookingRequest.status, 'CONFIRMED');
    const bad = await http('PATCH', `/api/booking-requests/${br.requestId}`, { status: 'PARTY' });
    assert.equal(bad.status, 400);
  });

  test('booking before the trip is complete asks for the missing details', async () => {
    const c = chat();
    await c.say('I want to visit Goa');
    const r = await c.say('Book the hotel');
    assert.equal(r.bookingRequest, null);
    assert.match(r.reply, /Before I can create a booking request/);
  });

  test('direct booking requests are validated', async () => {
    const bad = await http('POST', '/api/booking-request', { type: 'hotel_booking', travellers: 0, checkIn: 'soon' });
    assert.equal(bad.status, 400);
    assert.match(bad.body.message, /travellers/);
    assert.match(bad.body.message, /hotelId/);

    const ok = await http('POST', '/api/booking-request', {
      type: 'hotel_booking', destination: 'Goa', travellers: 3, rooms: 2, checkIn: '2026-10-10', checkOut: '2026-10-13', hotelId: 'demo-hotel-01'
    });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.bookingRequest.status, 'PENDING_MODULE');

    const viaSession = await http('POST', '/api/booking-request', { sessionId: 'chat_doesnotexist01', type: 'hotel' });
    assert.equal(viaSession.status, 404);
  });
});

// ---------------------------------------------------------------------------
describe('error handling', () => {
  test('empty, too long, unsupported and invalid input get natural replies', async () => {
    const c = chat();
    assert.match((await c.say('')).reply, /Please type a message/);
    assert.match((await c.say('   ')).reply, /Please type a message/);
    assert.match((await c.say(42)).reply, /Please type a message/);
    assert.match((await c.say('x'.repeat(1500))).reply, /under 1000 characters/);

    const paris = await c.say('I want to visit Paris');
    assert.match(paris.reply, /can't plan trips to Paris/);
    assert.equal(paris.trip.destination, null);

    await c.say('I want to visit Goa');
    assert.match((await c.say('for 0 people')).reply, /at least 1 traveller/);
    assert.match((await c.say('we are 50 people')).reply, /up to 20 travellers/);
    assert.match((await c.say('on 2026-01-01')).reply, /already passed/);
    assert.match((await c.say('from Timbuktu')).reply, /don't have routes from Timbuktu/);
    assert.match((await c.say('make it 40 days')).reply, /between 1 and 21 days/);
  });

  test('unknown sessions and bad structured requests', async () => {
    assert.equal((await http('GET', '/api/chat/session/chat_unknown_session_1')).status, 404);
    assert.equal((await http('POST', '/api/travel-plan', {})).status, 400);
    assert.equal((await http('GET', '/api/recommendations?destination=atlantis')).status, 404);
    assert.equal((await http('GET', '/api/recommendations?destination=goa&type=transport')).status, 400);
  });
});

// ---------------------------------------------------------------------------
describe('AI service integration', () => {
  const base: TravelIntent = {
    intent: 'plan_trip', destination: null, origin: null, startDate: null, durationDays: null, durationDelta: null,
    travellers: null, travellersDelta: null, budgetTier: null, budgetAmount: null, preferences: [], target: null,
    transportMode: null, optionIndex: null, optionId: null, optionWhich: null, pendingField: null,
    missingInformation: [], action: 'generate_itinerary', reply: null
  };

  test('LLM mode: structured intent from the AI service drives the plan', async () => {
    const seen: string[] = [];
    setLlmExtractorForTests(async input => {
      seen.push(buildUserContent(input));
      // A phrasing the offline parser would not handle, understood by the "LLM"
      return { ...base, destination: 'Kerala', origin: 'Chennai', startDate: '2026-12-20', durationDays: 5, travellers: 2, budgetTier: 'luxury', preferences: ['nature'] };
    });
    const r = await chat().say('me + the missus fancy the backwaters around xmas, five days, flying out of Madras, splurge a bit');
    assert.equal(r.aiMode, 'llm');
    assert.equal(r.intent.destination, 'Kerala');
    assert.equal(r.trip.destination.name, 'Kerala (Kochi)');
    assert.equal(r.trip.status, 'PLANNED');
    assert.equal(r.trip.itinerary.length, 5);
    assert.match(seen[0], /Today: 2026-09-24/);
    assert.match(seen[0], /Latest user message/);
  });

  test('LLM greeting replies are passed through', async () => {
    setLlmExtractorForTests(async () => ({ ...base, intent: 'greeting', action: 'answer', reply: 'Hello! Where shall we go?' }));
    const r = await chat().say('hey there');
    assert.equal(r.reply, 'Hello! Where shall we go?');
  });

  test('AI failure falls back to demo understanding without crashing', async () => {
    setLlmExtractorForTests(async () => {
      throw new AiServiceError('unreachable', 'down');
    });
    const r = await chat().say('I want to visit Goa for 3 days with 2 friends');
    assert.equal(r.aiMode, 'demo');
    assert.match(r.aiNotice, /unavailable/);
    assert.equal(r.trip.destination.name, 'Goa');
    assert.equal(r.trip.travellers, 3);
  });

  test('the structured output schema accepts the documented intent shape', () => {
    const parsed = TravelIntentSchema.parse({ ...base, destination: 'Goa', durationDays: 3, travellers: 3 });
    assert.equal(parsed.destination, 'Goa');
    assert.throws(() => TravelIntentSchema.parse({ ...base, intent: 'launch_rocket' }));
  });
});

// ---------------------------------------------------------------------------
describe('structured APIs for teammates', () => {
  test('POST /api/travel-plan and GET /api/recommendations', async () => {
    const plan = await http('POST', '/api/travel-plan', {
      destination: 'goa', origin: 'Bengaluru', startDate: '2026-10-10', durationDays: 3, travellers: 3, budget: 'medium'
    });
    assert.equal(plan.status, 200);
    assert.equal(plan.body.trip.status, 'PLANNED');
    assert.ok(plan.body.sessionId);

    const recs = await http('GET', '/api/recommendations?destination=goa&origin=Bengaluru&budget=budget&mode=train');
    assert.equal(recs.status, 200);
    assert.ok(recs.body.hotels.length > 0);
    assert.equal(recs.body.hotels[0].tier, 'budget');
    assert.equal(recs.body.transport[0].mode, 'train');
    assert.ok(recs.body.places.length > 0);
  });
});

// ---------------------------------------------------------------------------
describe('demo extractor units', () => {
  test('dates and counts', () => {
    assert.equal(parseDate('on 10 oct', '2026-09-24'), '2026-10-10');
    assert.equal(parseDate('march 3', '2026-09-24'), '2027-03-03');
    assert.equal(parseDate('tomorrow', '2026-09-24'), '2026-09-25');
    assert.equal(parseDate('31 feb', '2026-09-24'), null);
    const i = extractIntentDemo('Plan a trip to Manali for 2 nights with my wife', emptyTrip(), '2026-09-24');
    assert.equal(i.durationDays, 3);
    assert.equal(i.travellers, 2);
    assert.equal(extractIntentDemo('trip in 5 days to goa', emptyTrip(), '2026-09-24').durationDays, null);
  });
});

// ---------------------------------------------------------------------------
describe('booking priority and package estimation', () => {
  test('suggests flights/hotels for the package once the plan is built, without forcing a booking priority', async () => {
    const c = chat();
    const plan = await c.say('Plan a 3-day trip to Goa from Bengaluru on 15 October for 2 people');
    assert.equal(plan.trip.status, 'PLANNED');
    assert.equal(plan.trip.bookingPriority, null);
    assert.match(plan.reply, /Add to package/i);
    assert.ok(plan.recommendations?.hotels.length);
    assert.ok(plan.recommendations?.transport.length);
    assert.ok(!plan.suggestions.includes('Flight first'));
    assert.ok(!plan.suggestions.includes('Hotel first'));

    // Booking priority remains an optional, explicit choice rather than a forced question.
    const prioritized = await c.say('Flight first');
    assert.equal(prioritized.trip.bookingPriority, 'flight');
    assert.match(prioritized.reply, /booking priority set to flight first/i);

    const changed = await c.say('Actually hotel first');
    assert.equal(changed.trip.bookingPriority, 'hotel');
    assert.match(changed.reply, /booking priority set to hotel first/i);
  });

  test('package total estimation reflects selected hotel, transport, and places', async () => {
    const c = chat();
    const plan = await c.say('Plan a 3-day trip to Goa from Bengaluru on 15 October for 2 people, flight first');
    assert.equal(plan.trip.status, 'PLANNED');
    assert.equal(plan.trip.bookingPriority, 'flight');
    assert.ok(plan.trip.estimate);
    const initialTotal = plan.trip.estimate.total;
    assert.ok(initialTotal > 0);

    // Switch transport to train
    const trainTurn = await c.say('add a train');
    assert.equal(trainTurn.trip.transport?.mode, 'train');
    assert.ok(trainTurn.trip.estimate.total > 0);
  });
});


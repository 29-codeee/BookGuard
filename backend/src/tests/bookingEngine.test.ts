/**
 * Booking engine tests (node:test).
 *
 *   npm test                                   # embedded PGlite (serialised connection)
 *   DATABASE_URL=postgres://... npm test       # real PostgreSQL: true parallel row-lock contention
 *
 * WARNING: the suite drops and recreates the schema. Point DATABASE_URL at a throwaway database.
 */
import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { initDb, query, applySchemaAndSeed } from '../db/client.js';
import { initRedis } from '../redis/client.js';
import { buildApp } from '../server.js';
import { mockAirlineProvider } from '../providers/mockProvider.js';
import {
  holdInventory,
  confirmBooking,
  cancelBooking,
  expireHold,
  sweepExpiredHolds,
  checkInvariants
} from '../booking/engine.js';

let app: FastifyInstance;

const FLIGHT = 'flt_blr_goi_ix6534'; // 4 seats in seed
const TRAIN = 'trn_vande_bharat_20641'; // 4 seats in seed, BLR -> GOI 2026-09-25

interface Counts {
  total: number;
  available: number;
  held: number;
  confirmed: number;
}

async function counts(inventoryId: string): Promise<Counts> {
  const r = await query<{ t: number; a: number; h: number; c: number }>(
    `SELECT total_quantity t, available_quantity a, held_quantity h, confirmed_quantity c FROM inventory WHERE id = $1`,
    [inventoryId]
  );
  const row = r.rows[0];
  return { total: row.t, available: row.a, held: row.h, confirmed: row.c };
}

/** Inventory invariant + hold ledger + no duplicate confirmations, system-wide. */
async function assertInvariants(): Promise<void> {
  const check = await checkInvariants();
  assert.equal(check.invariantValid, true, `invariant violations: ${JSON.stringify(check.violations)}`);
  assert.equal(check.ledger.consistent, true, `ledger mismatches: ${JSON.stringify(check.ledger.mismatches)}`);
  assert.equal(check.duplicateConfirmations, 0);
}

async function setCapacity(inventoryId: string, total: number): Promise<void> {
  await query(
    `UPDATE inventory SET total_quantity = $2, available_quantity = $2, held_quantity = 0, confirmed_quantity = 0 WHERE id = $1`,
    [inventoryId, total]
  );
}

/** Moves a hold's expiry into the past (deterministic "time travel" instead of sleeping). */
async function forceExpire(holdId: string): Promise<void> {
  await query(`UPDATE holds SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = $1`, [holdId]);
}

async function http(method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown, headers: Record<string, string> = {}) {
  const res = await app.inject({ method, url, payload: payload as any, headers });
  return { status: res.statusCode, body: res.json() as any, headers: res.headers, raw: res.payload };
}

async function holdViaApi(inventoryId = FLIGHT, quantity = 1, headers: Record<string, string> = {}) {
  return http('POST', '/api/bookings/hold', { travellerId: 'traveller_priya', inventoryId, quantity, ttlSeconds: 600 }, headers);
}

before(async () => {
  await initDb();
  await initRedis();
  await applySchemaAndSeed(true);
  app = await buildApp();
});

beforeEach(async () => {
  await applySchemaAndSeed();
  mockAirlineProvider.setMode('SUCCESS', 'CONFIRMED');
});

after(async () => {
  await app?.close();
});

// ---------------------------------------------------------------------------
describe('concurrent allocation', () => {
  test('one available item + 50 simultaneous hold requests -> exactly one winner', async () => {
    await setCapacity(FLIGHT, 1);
    const results = await Promise.all(Array.from({ length: 50 }, () => holdViaApi(FLIGHT)));

    const winners = results.filter(r => r.status === 201);
    const losers = results.filter(r => r.status === 409);
    assert.equal(winners.length, 1);
    assert.equal(losers.length, 49);
    assert.ok(losers.every(r => r.body.error === 'INSUFFICIENT_INVENTORY'));
    assert.deepEqual(await counts(FLIGHT), { total: 1, available: 0, held: 1, confirmed: 0 });
    await assertInvariants();
  });

  test('200 concurrent engine holds never exceed seeded capacity', async () => {
    const before = await counts(FLIGHT);
    const settled = await Promise.allSettled(
      Array.from({ length: 200 }, () => holdInventory({ travellerId: 'traveller_arjun', inventoryId: FLIGHT, ttlSeconds: 600 }))
    );
    const granted = settled.filter(s => s.status === 'fulfilled').length;
    const rejected = settled.filter(s => s.status === 'rejected');
    assert.equal(granted, before.available);
    assert.ok(rejected.every(s => (s as PromiseRejectedResult).reason.message === 'INSUFFICIENT_INVENTORY'));
    const after = await counts(FLIGHT);
    assert.equal(after.available, 0);
    assert.equal(after.held, before.available);
    await assertInvariants();
  });

  test('multi-unit requests: 3 seats, 20 concurrent requests for 2 -> only one fits', async () => {
    await setCapacity(FLIGHT, 3);
    const results = await Promise.all(Array.from({ length: 20 }, () => holdViaApi(FLIGHT, 2)));
    assert.equal(results.filter(r => r.status === 201).length, 1);
    assert.deepEqual(await counts(FLIGHT), { total: 3, available: 1, held: 2, confirmed: 0 });
    await assertInvariants();
  });

  test('invalid quantities, TTLs and unknown ids are rejected without touching inventory', async () => {
    const before = await counts(FLIGHT);
    for (const quantity of [0, -1, 1.5, 100, 'two']) {
      const r = await http('POST', '/api/bookings/hold', { inventoryId: FLIGHT, quantity });
      assert.equal(r.status, 400, `quantity ${quantity}`);
      assert.equal(r.body.error, 'INVALID_QUANTITY');
    }
    assert.equal((await http('POST', '/api/bookings/hold', { inventoryId: FLIGHT, ttlSeconds: 0 })).status, 400);
    assert.equal((await http('POST', '/api/bookings/hold', { inventoryId: 'nope' })).status, 404);
    assert.equal(
      (await http('POST', '/api/bookings/hold', { inventoryId: FLIGHT, travellerId: 'ghost' })).body.error,
      'TRAVELLER_NOT_FOUND'
    );
    assert.deepEqual(await counts(FLIGHT), before);
  });

  test('the database itself rejects a write that would break the invariant', async () => {
    await assert.rejects(query(`UPDATE inventory SET available_quantity = available_quantity + 1 WHERE id = $1`, [FLIGHT]));
    await assert.rejects(
      query(`UPDATE inventory SET available_quantity = -1, held_quantity = held_quantity + available_quantity + 1 WHERE id = $1`, [FLIGHT])
    );
    await assertInvariants();
  });
});

// ---------------------------------------------------------------------------
describe('idempotency', () => {
  test('retrying a hold with the same Idempotency-Key never creates a second booking', async () => {
    const headers = { 'idempotency-key': 'hold-retry-1' };
    const results = await Promise.all(Array.from({ length: 10 }, () => holdViaApi(FLIGHT, 1, headers)));

    assert.ok(results.every(r => r.status === 201));
    const ids = new Set(results.map(r => r.body.hold.bookingId));
    assert.equal(ids.size, 1);
    assert.equal(new Set(results.map(r => r.raw)).size, 1, 'all responses byte-identical');
    assert.equal(results.filter(r => r.headers['x-cache-idempotent'] === 'HIT').length, 9);
    assert.equal((await counts(FLIGHT)).held, 1);
    await assertInvariants();
  });

  test('same key with a different payload is rejected with 422', async () => {
    const headers = { 'idempotency-key': 'hold-reuse-1' };
    assert.equal((await holdViaApi(FLIGHT, 1, headers)).status, 201);
    const r = await holdViaApi(FLIGHT, 2, headers);
    assert.equal(r.status, 422);
    assert.equal(r.body.error, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal((await counts(FLIGHT)).held, 1);
  });

  test('a failed hold frees its key so a later retry is re-evaluated', async () => {
    await setCapacity(FLIGHT, 1);
    const blocker = await holdViaApi(FLIGHT);
    const headers = { 'idempotency-key': 'hold-after-sellout' };
    assert.equal((await holdViaApi(FLIGHT, 1, headers)).status, 409);
    await http('POST', `/api/bookings/${blocker.body.hold.bookingId}/release`, {});
    assert.equal((await holdViaApi(FLIGHT, 1, headers)).status, 201);
    await assertInvariants();
  });

  test('duplicate confirm storm with one key -> one confirmation, identical responses', async () => {
    const hold = (await holdViaApi()).body.hold;
    const confirm = () =>
      http('POST', '/api/bookings/confirm', { bookingId: hold.bookingId, travellerName: 'Priya' }, { 'idempotency-key': 'confirm-storm' });
    const results = await Promise.all(Array.from({ length: 5 }, confirm));

    assert.ok(results.every(r => r.status === 200));
    assert.equal(new Set(results.map(r => r.raw)).size, 1);
    const prov = await query(`SELECT COUNT(*)::int AS n FROM provider_reservations WHERE booking_id = $1`, [hold.bookingId]);
    assert.equal(prov.rows[0].n, 1);
    assert.equal((await counts(FLIGHT)).confirmed, 1);
    await assertInvariants();
  });

  test('concurrent confirms with different keys still confirm the inventory only once', async () => {
    const hold = (await holdViaApi()).body.hold;
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        http('POST', '/api/bookings/confirm', { bookingId: hold.bookingId }, { 'idempotency-key': `confirm-diff-${i}` })
      )
    );
    const fresh = results.filter(r => r.status === 200 && r.body.message === 'Booking confirmed successfully!');
    assert.equal(fresh.length, 1);
    for (const r of results) {
      assert.ok(
        (r.status === 200 && r.body.status === 'CONFIRMED') || (r.status === 409 && r.body.error === 'CONFIRM_IN_PROGRESS'),
        `unexpected ${r.status} ${r.raw}`
      );
    }
    const prov = await query(`SELECT COUNT(*)::int AS n FROM provider_reservations WHERE booking_id = $1`, [hold.bookingId]);
    assert.equal(prov.rows[0].n, 1);
    assert.deepEqual(await counts(FLIGHT), { total: 4, available: 3, held: 0, confirmed: 1 });
    await assertInvariants();
  });
});

// ---------------------------------------------------------------------------
describe('confirmation', () => {
  test('HELD -> CONFIRMED moves units held -> confirmed and records a PNR', async () => {
    const hold = (await holdViaApi(FLIGHT, 2)).body.hold;
    const r = await http('POST', '/api/bookings/confirm', { bookingId: hold.bookingId }, { 'idempotency-key': 'c1' });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'CONFIRMED');
    assert.ok(r.body.pnr);
    assert.deepEqual(await counts(FLIGHT), { total: 4, available: 2, held: 0, confirmed: 2 });

    const status = await http('GET', `/api/bookings/${hold.bookingId}/status`);
    assert.equal(status.body.status, 'CONFIRMED');
    assert.equal(status.body.hold.status, 'CONFIRMED');
    assert.equal(status.body.pnr, r.body.pnr);
    assert.deepEqual(status.body.allowedTransitions, ['CANCELLED']);
    await assertInvariants();
  });

  test('provider rejection -> FAILED and the seat goes back to available', async () => {
    mockAirlineProvider.setMode('FAILURE');
    const hold = (await holdViaApi()).body.hold;
    const r = await http('POST', '/api/bookings/confirm', { bookingId: hold.bookingId });
    assert.equal(r.status, 400);
    assert.equal(r.body.status, 'FAILED');
    assert.deepEqual(await counts(FLIGHT), { total: 4, available: 4, held: 0, confirmed: 0 });
    await assertInvariants();
  });

  test('provider timeout -> RECONCILING keeps the seat held, and the sweeper leaves it alone', async () => {
    mockAirlineProvider.setMode('TIMEOUT', 'CONFIRMED');
    const hold = (await holdViaApi()).body.hold;
    const r = await http('POST', '/api/bookings/confirm', { bookingId: hold.bookingId });
    assert.equal(r.status, 202);
    assert.equal(r.body.status, 'RECONCILING');

    await forceExpire(hold.holdId);
    assert.equal(await sweepExpiredHolds(), 0);
    assert.equal(await expireHold(hold.holdId), false);
    assert.equal((await counts(FLIGHT)).held, 1);

    // Operator resolves it. A second (racing) apply must not move inventory again.
    const [a, b] = await Promise.all([
      http('POST', '/api/reconciliation/apply', { bookingId: hold.bookingId, action: 'CONFIRM' }),
      http('POST', '/api/reconciliation/apply', { bookingId: hold.bookingId, action: 'CONFIRM' })
    ]);
    assert.equal([a, b].filter(x => x.status === 200).length, 1);
    assert.deepEqual(await counts(FLIGHT), { total: 4, available: 3, held: 0, confirmed: 1 });
    await assertInvariants();
  });

  test('a hold cannot be confirmed after its TTL, even before the sweeper runs', async () => {
    const hold = (await holdViaApi()).body.hold;
    await forceExpire(hold.holdId);
    const r = await http('POST', '/api/bookings/confirm', { bookingId: hold.bookingId });
    assert.equal(r.status, 410);
    assert.equal(r.body.error, 'HOLD_EXPIRED');
    assert.deepEqual(await counts(FLIGHT), { total: 4, available: 4, held: 0, confirmed: 0 });
    assert.equal((await http('GET', `/api/bookings/${hold.bookingId}/status`)).body.status, 'EXPIRED');
    await assertInvariants();
  });

  test('the sweeper does not expire a hold whose confirmation is in flight', async () => {
    mockAirlineProvider.setMode('DELAY'); // provider answers after ~3s
    const hold = (await holdViaApi()).body.hold;
    const pending = confirmBooking({ bookingId: hold.bookingId });
    await new Promise(r => setTimeout(r, 300)); // let phase 1 claim the booking
    await forceExpire(hold.holdId);
    assert.equal(await sweepExpiredHolds(), 0);
    const result = await pending;
    assert.equal(result.outcome, 'CONFIRMED');
    assert.deepEqual(await counts(FLIGHT), { total: 4, available: 3, held: 0, confirmed: 1 });
    await assertInvariants();
  });
});

// ---------------------------------------------------------------------------
describe('expiry and release', () => {
  test('expired holds are restocked exactly once even when expiry fires concurrently', async () => {
    const hold = (await holdViaApi(FLIGHT, 2)).body.hold;
    await forceExpire(hold.holdId);
    const results = await Promise.all([expireHold(hold.holdId), expireHold(hold.holdId), sweepExpiredHolds()]);
    const performed = results.filter(r => r === true || r === 1).length;
    assert.equal(performed, 1);
    assert.deepEqual(await counts(FLIGHT), { total: 4, available: 4, held: 0, confirmed: 0 });
    const r = await http('POST', '/api/bookings/confirm', { bookingId: hold.bookingId });
    assert.equal(r.status, 410);
    await assertInvariants();
  });

  test('an unexpired hold is not expired by an early TTL signal', async () => {
    const hold = (await holdViaApi()).body.hold;
    assert.equal(await expireHold(hold.holdId), false);
    assert.equal((await counts(FLIGHT)).held, 1);
  });

  test('traveller release: HELD -> RELEASED, idempotent, and not confirmable afterwards', async () => {
    const hold = (await holdViaApi()).body.hold;
    const r1 = await http('POST', `/api/bookings/${hold.bookingId}/release`, {});
    const r2 = await http('POST', `/api/bookings/${hold.bookingId}/release`, {});
    assert.equal(r1.status, 200);
    assert.equal(r1.body.status, 'RELEASED');
    assert.equal(r2.body.alreadyFinal, true);
    assert.deepEqual(await counts(FLIGHT), { total: 4, available: 4, held: 0, confirmed: 0 });
    assert.equal((await http('POST', '/api/bookings/confirm', { bookingId: hold.bookingId })).status, 410);
    await assertInvariants();
  });
});

// ---------------------------------------------------------------------------
describe('cancellation', () => {
  test('CONFIRMED -> CANCELLED restores the booked quantity to available', async () => {
    const hold = (await holdViaApi(FLIGHT, 2)).body.hold;
    await http('POST', '/api/bookings/confirm', { bookingId: hold.bookingId });
    const r = await http('POST', '/api/bookings/cancel', { bookingId: hold.bookingId });
    assert.equal(r.status, 200);
    assert.equal(r.body.restoredQuantity, 2);
    assert.deepEqual(await counts(FLIGHT), { total: 4, available: 4, held: 0, confirmed: 0 });
    await assertInvariants();
  });

  test('concurrent cancels restock only once', async () => {
    const hold = (await holdViaApi()).body.hold;
    await http('POST', '/api/bookings/confirm', { bookingId: hold.bookingId });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => http('POST', '/api/bookings/cancel', { bookingId: hold.bookingId }))
    );
    assert.ok(results.every(r => r.status === 200));
    assert.equal(results.filter(r => r.body.alreadyCancelled === false).length, 1);
    assert.deepEqual(await counts(FLIGHT), { total: 4, available: 4, held: 0, confirmed: 0 });
    await assertInvariants();
  });

  test('only confirmed bookings can be cancelled', async () => {
    const hold = (await holdViaApi()).body.hold;
    const r = await http('POST', '/api/bookings/cancel', { bookingId: hold.bookingId });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'INVALID_STATE');
    assert.equal((await counts(FLIGHT)).held, 1);
  });
});

// ---------------------------------------------------------------------------
describe('invariant preservation under a mixed workload', () => {
  test('random concurrent hold / confirm / release / cancel / expire keeps every invariant', async () => {
    await setCapacity(FLIGHT, 5);
    const bookings: string[] = [];
    for (let round = 0; round < 4; round++) {
      const holds = await Promise.allSettled(
        Array.from({ length: 12 }, (_, i) =>
          holdInventory({ travellerId: 'traveller_rahul', inventoryId: FLIGHT, quantity: 1 + (i % 2), ttlSeconds: 600 })
        )
      );
      const held = holds.flatMap(h => (h.status === 'fulfilled' ? [h.value.hold] : []));
      bookings.push(...held.map(h => h.bookingId));
      await Promise.allSettled(
        held.map((h, i) => {
          if (i % 3 === 0) return confirmBooking({ bookingId: h.bookingId });
          if (i % 3 === 1) return http('POST', `/api/bookings/${h.bookingId}/release`, {});
          return forceExpire(h.holdId).then(() => sweepExpiredHolds());
        })
      );
      await Promise.allSettled(bookings.map(id => cancelBooking(id).catch(() => undefined)));
      await assertInvariants();
    }
    const inv = await http('GET', '/api/inventory/invariants');
    assert.equal(inv.body.inventory.invariantValid, true);
    assert.equal(inv.body.auditCounters.duplicateBookings, 0);
    assert.equal(inv.body.auditCounters.oversold, 0);
  });
});

// ---------------------------------------------------------------------------
describe('high-demand / tatkal prepared booking', () => {
  async function prepare(windowOpensAt: string | null = null) {
    const created = await http('POST', '/api/prepared-bookings', { travellerId: 'traveller_ananya', mode: 'TATKAL', windowOpensAt });
    assert.equal(created.status, 201);
    const id = created.body.preparation.preparationId;
    assert.equal(created.body.preparation.nextAction, 'PREPARE_TRIP');
    await http('PUT', `/api/prepared-bookings/${id}/trip`, { origin: 'blr', destination: 'goi', travelDate: '2026-09-25' });
    await http('PUT', `/api/prepared-bookings/${id}/passengers`, {
      passengers: [
        { name: 'Ananya Iyer', age: 29, gender: 'F', berthPreference: 'WINDOW' },
        { name: 'Ravi Iyer', age: 31 }
      ]
    });
    await http('PUT', `/api/prepared-bookings/${id}/selection`, { inventoryId: TRAIN });
    const last = await http('PUT', `/api/prepared-bookings/${id}/payment`, { method: 'upi', label: 'GPay' });
    assert.equal(last.status, 200);
    assert.equal(last.body.preparation.status, 'READY');
    return id as string;
  }

  test('full flow: prepare -> window -> approval -> execute (idempotent) -> normal confirm', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const id = await prepare(future);

    const early = await http('POST', `/api/prepared-bookings/${id}/approve`, { userApproved: true });
    assert.equal(early.status, 409);
    assert.equal(early.body.error, 'BOOKING_WINDOW_NOT_OPEN');
    assert.equal((await http('POST', `/api/prepared-bookings/${id}/execute`, {})).status, 409);
    assert.equal((await counts(TRAIN)).held, 0);

    await http('PUT', `/api/prepared-bookings/${id}/window`, { windowOpensAt: new Date(Date.now() - 1000).toISOString() });
    const noConsent = await http('POST', `/api/prepared-bookings/${id}/approve`, {});
    assert.equal(noConsent.status, 400);
    assert.equal(noConsent.body.error, 'USER_APPROVAL_REQUIRED');

    const approved = await http('POST', `/api/prepared-bookings/${id}/approve`, { userApproved: true });
    assert.equal(approved.body.preparation.status, 'APPROVED');
    assert.equal(approved.body.preparation.nextAction, 'EXECUTE');

    // User mashes the button: one hold only
    const execs = await Promise.all(Array.from({ length: 5 }, () => http('POST', `/api/prepared-bookings/${id}/execute`, {})));
    assert.ok(execs.every(e => e.status === 201));
    assert.equal(new Set(execs.map(e => e.raw)).size, 1);
    const exec = execs[0].body;
    assert.equal(exec.hold.quantity, 2);
    assert.equal(exec.hold.bookingMode, 'TATKAL');
    assert.deepEqual(await counts(TRAIN), { total: 4, available: 2, held: 2, confirmed: 0 });

    const prep = await http('GET', `/api/prepared-bookings/${id}`);
    assert.equal(prep.body.preparation.status, 'SUBMITTED');
    assert.equal(prep.body.preparation.bookingId, exec.hold.bookingId);

    // Demo payment + the normal confirm endpoint, exactly like a normal booking
    const confirm = () =>
      http('POST', exec.next.endpoint, exec.next.body, { 'idempotency-key': exec.next.idempotencyKey });
    const [c1, c2] = await Promise.all([confirm(), confirm()]);
    assert.equal(c1.status, 200);
    assert.equal(c1.raw, c2.raw);
    assert.deepEqual(await counts(TRAIN), { total: 4, available: 2, held: 0, confirmed: 2 });
    assert.equal((await http('GET', `/api/bookings/${exec.hold.bookingId}/status`)).body.bookingMode, 'TATKAL');

    assert.equal((await http('PUT', `/api/prepared-bookings/${id}/trip`, { origin: 'BLR', destination: 'GOI', travelDate: '2026-09-26' })).status, 409);
    await assertInvariants();
  });

  test('tatkal competes fairly: executes are ordinary holds and respect capacity', async () => {
    await setCapacity(TRAIN, 3);
    const ids = await Promise.all([prepare(), prepare(), prepare()]);
    await Promise.all(ids.map(id => http('POST', `/api/prepared-bookings/${id}/approve`, { userApproved: true })));
    const results = await Promise.all(ids.map(id => http('POST', `/api/prepared-bookings/${id}/execute`, {})));
    assert.equal(results.filter(r => r.status === 201).length, 1); // 2 passengers each, only 3 seats
    const loser = results.find(r => r.status === 409)!;
    assert.equal(loser.body.error, 'INSUFFICIENT_INVENTORY');
    const loserId = ids[results.indexOf(loser)];
    assert.equal((await http('GET', `/api/prepared-bookings/${loserId}`)).body.preparation.status, 'APPROVED');
    await assertInvariants();
  });

  test('editing after approval clears the approval; secrets and non-train selections are rejected', async () => {
    const id = await prepare();
    await http('POST', `/api/prepared-bookings/${id}/approve`, { userApproved: true });
    const edited = await http('PUT', `/api/prepared-bookings/${id}/passengers`, { passengers: [{ name: 'Solo', age: 40 }] });
    assert.equal(edited.body.preparation.status, 'READY');
    assert.equal(edited.body.preparation.nextAction, 'AWAIT_USER_APPROVAL');
    assert.equal((await http('POST', `/api/prepared-bookings/${id}/execute`, {})).status, 409);

    const secret = await http('PUT', `/api/prepared-bookings/${id}/payment`, { method: 'CARD', cvv: '123' });
    assert.equal(secret.status, 400);
    assert.equal(secret.body.error, 'SENSITIVE_PAYMENT_DATA_REJECTED');

    const flight = await http('PUT', `/api/prepared-bookings/${id}/selection`, { inventoryId: FLIGHT });
    assert.equal(flight.status, 400);
    const tooMany = await http('PUT', `/api/prepared-bookings/${id}/passengers`, {
      passengers: Array.from({ length: 5 }, (_, i) => ({ name: `P${i}`, age: 30 }))
    });
    assert.equal(tooMany.status, 400);
  });
});

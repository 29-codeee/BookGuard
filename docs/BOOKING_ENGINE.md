# BookGuard Core Booking Engine

Owner module: `backend/src/booking/` (engine, idempotency, Tatkal preparation) plus the booking routes that sit on top of it.

This document covers the inventory model, the booking lifecycle, the concurrency and idempotency guarantees, the HTTP API, schema changes, and how teammates should integrate.

---

## 1. Inventory model and invariant

Each `inventory` row has four counters:

| Column | Meaning |
|---|---|
| `total_quantity` | Units that exist |
| `available_quantity` | Units anyone can hold right now |
| `held_quantity` | Units reserved by an `ACTIVE` hold (awaiting payment / reconciling) |
| `confirmed_quantity` | Units sold (`CONFIRMED` hold) |

**Invariant:** `available + held + confirmed = total`, and all counters are `>= 0`.

PostgreSQL enforces it with `CHECK` constraints (`check_inventory_invariant` and per-column checks), so any write that would break it fails and rolls back. Redis never decides inventory; it only triggers expiry early.

The engine also cross-checks the counters against the hold ledger (`GET /api/inventory/invariants` → `ledger`):

- `held_quantity` = Σ quantity of `ACTIVE` holds
- `confirmed_quantity` = Σ quantity of `CONFIRMED` holds

> Demo simulators that write to `inventory` directly without creating holds (e.g. the plugin race simulator, two-leg compensation demo) can show up as ledger mismatches. The hard invariant is unaffected.

## 2. Lifecycle

```
                 hold                 confirm (provider OK)
   AVAILABLE ──────────▶ HELD ─────────────────────────▶ CONFIRMED ──cancel──▶ CANCELLED
                          │  │                                ▲                (units → available)
                          │  │ provider timeout               │ operator apply
                          │  └──────────────▶ RECONCILING ────┤
                          │                                   └──▶ FAILED (units → available)
                          ├── TTL passes ──▶ EXPIRED   (units → available)
                          ├── traveller ───▶ RELEASED  (units → available)
                          └── provider rejects ─▶ FAILED (units → available)
```

| Booking status | Hold status | Inventory bucket |
|---|---|---|
| `HELD` | `ACTIVE` | held |
| `RECONCILING` | `ACTIVE` (the sweeper never expires it) | held |
| `CONFIRMED` | `CONFIRMED` | confirmed |
| `EXPIRED` | `EXPIRED` | returned to available |
| `RELEASED` *(new)* | `RELEASED` | returned to available |
| `FAILED` | `RELEASED` | returned to available |
| `CANCELLED` | `CANCELLED` *(new)* | returned to available |

Allowed transitions live in `backend/src/state/stateMachine.ts` (`ALLOWED_TRANSITIONS`, `canTransition`).

## 3. Concurrency guarantees

| Threat | Protection |
|---|---|
| Overselling / negative inventory | Hold locks the inventory row (`SELECT … FOR UPDATE`). Every counter move is a guarded `UPDATE … WHERE <bucket>_quantity >= q`. The DB `CHECK` constraints are the backstop. |
| Two confirms of one booking | Phase 1 locks the booking and sets a claim (`bookings.confirm_token`). A second confirm gets `409 CONFIRM_IN_PROGRESS`, or `200 already confirmed` once the first finishes. Phase 3 re-checks the claim, and the hold must still be `ACTIVE` (`UPDATE holds … WHERE status='ACTIVE'`). |
| Two cancels / releases / expiries | The booking row is locked and its source state checked; the loser sees the final state and does not touch inventory. |
| Confirm vs expiry race | Confirm refuses a hold whose `expires_at` has passed (and expires it on the spot → `410`). The sweeper skips bookings with a live confirm claim, so a payment already in flight is not undercut. Claims older than 60s are treated as abandoned. |
| Deadlocks | Fixed lock order: booking → hold → inventory. |
| Provider latency holding DB locks | The provider call happens between two short transactions, never inside one. |
| Side effects for rolled-back work | SSE broadcasts, Redis keys and provider cancels run only after `COMMIT`. |

## 4. Idempotency

Send an `Idempotency-Key` header (or `idempotencyKey` in the body, max 128 characters) on:

- `POST /api/bookings/hold`: stored **in the same transaction** as the hold, so a retry can never create a second booking. A failed hold (e.g. sold out) frees the key so a later retry is re-evaluated.
- `POST /api/bookings/confirm`: final outcomes are stored and replayed byte-for-byte (header `X-Cache-Idempotent: HIT`). Transient outcomes (`CONFIRM_IN_PROGRESS`, 5xx) free the key.
- `POST /api/prepared-bookings/:id/execute`: implicit key `prep:<id>:execute`.

Concurrent requests with the same key wait for the first one and then replay its response. The same key with a different payload returns `422 IDEMPOTENCY_KEY_REUSED`.

Cancel and release are idempotent without a key (they are state-based).

## 5. HTTP API

Errors use one shape: `{ "success": false, "error": "<CODE>", "message": "<text>", ...extra }`.

### Inventory
| Method | Path | Notes |
|---|---|---|
| GET | `/api/inventory` | Unchanged |
| GET | `/api/inventory/search` | Unchanged |
| GET | `/api/inventory/:id` | **New.** Counters and active holds for one item |
| GET | `/api/inventory/invariants` | Existing fields kept. **Added:** `violations[]`, `ledger{consistent,mismatches[]}`, `auditCounters.overdueActiveHolds/releasedHolds/cancelledBookings`, `statusDistribution.RELEASED`. `duplicateBookings` is now measured (duplicate provider confirmations or duplicate live holds), not hardcoded. |

### Bookings
| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/api/bookings/hold` | `{ travellerId?, inventoryId, quantity? (1-6), ttlSeconds? (1-3600) }` + optional `Idempotency-Key` | `201 { success, message, hold:{bookingId, holdId, inventoryId, quantity, expiresAt, ttlSeconds, totalAmount, status, bookingMode} }` | 400 `INVALID_QUANTITY`/`INVALID_TTL`, 404 `INVENTORY_NOT_FOUND`/`TRAVELLER_NOT_FOUND`, 409 `INSUFFICIENT_INVENTORY` (+`recovery`), 422 |
| POST | `/api/bookings/confirm` | `{ bookingId, travellerName?, language?, passengerDetails?, paymentDetails? }` + `Idempotency-Key` | `200` confirmed ticket (same fields as before), `202 RECONCILING` | 400 `FAILED` (provider rejected, +`recovery`) / `INVALID_STATE`, 404, 409 `CONFIRM_IN_PROGRESS`, 410 `HOLD_EXPIRED` (+`recovery`), 422 |
| GET | `/api/bookings/:id/status` | – | **New.** `{ status, bookingMode, pnr, confirmInProgress, allowedTransitions[], hold{holdId, status, expiresAt, secondsRemaining, quantity}, items[] }` | 404 |
| POST | `/api/bookings/:id/release` | `{ reason? }` | **New.** `200 { status:'RELEASED', alreadyFinal }` | 409 `INVALID_STATE`/`CONFIRM_IN_PROGRESS` |
| POST | `/api/bookings/cancel` | `{ bookingId, reason? }` | `200 { status:'CANCELLED', alreadyCancelled, restoredQuantity }` | 404, 409 `INVALID_STATE` (was 400) |
| GET | `/api/bookings/:id` | – | Unchanged | |
| GET | `/api/bookings/my-trips` | – | Unchanged | |

Confirm keeps its old status codes (200/202/400/410) because `App.tsx` branches on them.

### High-Demand / Tatkal prepared booking

Flow: **Prepare trip → passengers → selected train → payment preference → booking window opens → user approval → execute (hold) → demo payment → normal confirm.**

| Method | Path | Body |
|---|---|---|
| POST | `/api/prepared-bookings` | `{ travellerId?, mode?: 'TATKAL'\|'HIGH_DEMAND', windowOpensAt?: ISO }` |
| GET | `/api/prepared-bookings?travellerId=` | – |
| GET | `/api/prepared-bookings/:id` | – |
| PUT | `/api/prepared-bookings/:id/trip` | `{ origin, destination, travelDate:'YYYY-MM-DD', travelClass? }` |
| PUT | `/api/prepared-bookings/:id/passengers` | `{ passengers:[{ name, age, gender?, berthPreference? }] }` (Tatkal ≤ 4) |
| PUT | `/api/prepared-bookings/:id/selection` | `{ inventoryId }` (Tatkal requires a `train` matching the trip) |
| PUT | `/api/prepared-bookings/:id/payment` | `{ method:'UPI'\|'CARD'\|'NETBANKING'\|'WALLET', label? }` (card numbers, CVV, PIN, OTP etc. are rejected) |
| PUT | `/api/prepared-bookings/:id/window` | `{ windowOpensAt: ISO \| null }` (null = open now) |
| POST | `/api/prepared-bookings/:id/approve` | `{ userApproved: true }` (only when all steps are done **and** the window is open) |
| POST | `/api/prepared-bookings/:id/execute` | `{ ttlSeconds? }` → `201 { hold, next }` |
| POST | `/api/prepared-bookings/:id/cancel` | – |

All of these except execute return `{ success, preparation }`, where `preparation` includes `status` (`DRAFT → READY → APPROVED → SUBMITTED`, or `CANCELLED`), `checklist`, `windowOpen`, `secondsUntilWindow` and `nextAction` (`PREPARE_TRIP`, `PREPARE_PASSENGERS`, `SELECT_INVENTORY`, `PREPARE_PAYMENT`, `WAIT_FOR_WINDOW`, `AWAIT_USER_APPROVAL`, `EXECUTE`, `CONFIRM_PAYMENT`, `NONE`). A UI or assistant can simply follow `nextAction`.

`execute` calls the same `holdInventory()` as a normal hold: same row lock, same guards, same invariant, idempotent per preparation. The response's `next` block is a ready-made call to the **normal** `POST /api/bookings/confirm` (with idempotency key `prep:<id>:confirm`). Editing a preparation after approval clears the approval. Nothing here bypasses authentication, payment, CAPTCHA or provider controls; the preparation only stores data the traveller entered ahead of time.

## 6. Schema changes

Applied by `db/schema.sql` on fresh databases, and by `backend/src/db/migrations.ts` (idempotent, runs at every startup) on existing ones, including old Docker volumes.

- `bookings.status` adds `RELEASED`. New columns: `booking_mode` (`NORMAL`/`TATKAL`/`HIGH_DEMAND`), `confirm_token`, `confirm_started_at`.
- `holds.status` adds `CANCELLED`.
- `booking_items.status` adds `EXPIRED` and `RELEASED`.
- `idempotency_keys` new columns: `scope`, `state` (`IN_PROGRESS`/`COMPLETED`), `updated_at`.
- New table `booking_preparations`.
- New indexes: unique `ux_holds_one_live_per_booking` (at most one `ACTIVE`/`CONFIRMED` hold per booking), `ix_holds_active_expiry`, `ix_holds_booking`, `ix_booking_items_booking`.

## 7. Tests

```bash
cd backend
npm test                                                        # PGlite (embedded)
DATABASE_URL=postgres://user@localhost:5432/bookguard_test npm test   # real PostgreSQL
npm run test:concurrency                                        # 500-user proof script
```

PGlite runs all transactions on one connection, so run the suite against real PostgreSQL to prove row-lock behaviour under true parallelism. **The suite drops and recreates the schema. Use a throwaway database.**

Covered: single item vs 50 simultaneous requests; 200 concurrent holds vs capacity; multi-unit contention; input validation; DB-level CHECK enforcement; hold and confirm idempotency (same key, different payload, retry after sell-out); concurrent confirms with different keys; provider success, failure and timeout; racing reconciliation applies; confirm after TTL; sweeper vs in-flight confirm; concurrent expiry; release; cancellation (including concurrent); a mixed randomized workload with invariant and ledger checks after every round; the full Tatkal flow, including window gating, approval, execute idempotency, capacity fairness and secret rejection.

## 8. Integration notes for teammates

- **Server code:** call the engine, never `UPDATE inventory` directly:
  `holdInventory`, `confirmBooking`, `releaseBooking`, `cancelBooking`, `expireHold`, `sweepExpiredHolds`, `getBookingStatus`, `checkInvariants` from `backend/src/booking/engine.js`. Errors are `BookingError` (`code`, `httpStatus`, `toBody()`).
- **Legacy helpers:** `createHold` and `expireHold` in `redis/holdManager.ts` still work (thin wrappers).
- **Frontend:** `services/api.ts` adds `getBookingStatus`, `releaseHold`, `fetchInventoryItem`, `preparedBookings.*`, and an optional `idempotencyKey` argument on `createHold`. The types (`BookingStatus`, `PreparedBooking`, …) are in `types.ts`. No components were changed. `LiveStateBoard` does not yet have a `RELEASED` column.
- **AI / assistant for Tatkal:** drive the flow with the prepared-booking endpoints and `nextAction`. The approve step requires an explicit `userApproved: true` from the human.

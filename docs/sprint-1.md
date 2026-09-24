# PERSON 2 — SPRINT 1: Exploration and Analysis

**Date:** 2026-09-24
**Scope:** Understand the existing BookGuard booking/hold lifecycle before implementation. No business logic modification.
**Files Inspected:**
- `db/schema.sql`
- `backend/package.json`
- `backend/src/routes/bookings.ts`
- `docker-compose.yml`
- `backend/src/redis/holdManager.ts`
- `backend/src/state/stateMachine.ts`
- `backend/src/db/client.ts`
- `backend/src/providers/adapter.ts`, `mockProvider.ts`, `mockServer.ts`
- `backend/src/tests/concurrency.ts`

## Current Workflow Traces

### POST /api/bookings/hold
1. Validates input (`inventoryId` required).
2. Calls `createHold` (`holdManager.ts`).
3. Opens a PostgreSQL transaction (`client.ts`).
4. Selects inventory with `FOR UPDATE` lock.
5. Checks `available_quantity >= quantity`. Throws `INSUFFICIENT_INVENTORY` if not.
6. Decrements `available_quantity` and increments `held_quantity`.
7. Creates a `bookings` record (Status: `HELD`).
8. Creates a `holds` record (Status: `ACTIVE`, `expires_at` set).
9. Creates a `booking_items` record (Status: `HELD`).
10. Writes to `booking_events` audit log.
11. Commits transaction.
12. Stores hold in Redis with `EX` (TTL).
13. Broadcasts updates via SSE.

### POST /api/bookings/confirm
1. Extracts `idempotencyKey` from headers or body.
2. Checks `idempotency_keys` table. If found, returns cached response (`X-Cache-Idempotent: HIT`).
3. Fetches booking and hold data without a transaction/lock.
4. Validates state (rejects if `CONFIRMED`, `EXPIRED`, or not `HELD`/`RECONCILING`).
5. Calls external provider `providerAdapter.reserve()`.
6. Depending on provider response:
    - **Timeout**: Transitions to `RECONCILING` and triggers Copilot.
    - **Failure**: Opens transaction, transitions to `FAILED`, restocks inventory, marks hold `RELEASED`, cleans Redis, broadcasts.
    - **Success**: Opens transaction, transitions to `CONFIRMED`, updates inventory (`held` to `confirmed`), marks hold `CONFIRMED`, updates items, inserts `provider_reservations`.
7. Clears Redis hold key, broadcasts updates.
8. Writes to `idempotency_keys` and returns detailed JSON payload.

## Findings

1. **Current hold API contract:**
   - Endpoint: `POST /api/bookings/hold`
   - Request Body: `{ travellerId, inventoryId, quantity, ttlSeconds }`
   - Success Response (201): `{ success: true, message, hold: { bookingId, holdId, inventoryId, quantity, expiresAt, ttlSeconds, totalAmount } }`
   - Failure Response (409): `{ error: 'INSUFFICIENT_INVENTORY', message, recovery }`

2. **Current confirmation API contract:**
   - Endpoint: `POST /api/bookings/confirm`
   - Headers/Body: `idempotencyKey`
   - Request Body: `{ bookingId, travellerName, language, passengerDetails, paymentDetails }`
   - Success Response (200): Details including `bookingId`, `flightCode`, `pnr`, `passengerDetails`, `seatNumber`, etc.
   - Other Responses: 202 (Reconciling), 400 (Failed), 410 (Expired).

3. **Current hold TTL mechanism:**
   - Hybrid approach: stored in Redis using `EX` expiry flag and concurrently in PostgreSQL `holds` table with `expires_at` timestamp.

4. **Current expiry mechanism:**
   - Redis keyspace notifications (`redis.onExpiry`) intercept expired keys.
   - Fallback periodic DB sweeper (every 3 seconds) polls the `holds` table for expired rows.
   - Both call `expireHold(holdId)`, which uses a `FOR UPDATE` lock to atomically transition the hold and booking to `EXPIRED` and restock inventory.

5. **Current idempotency behavior:**
   - Implemented strictly for `/confirm` using the `idempotency_keys` table.
   - Replays byte-identical responses for duplicate requests by exact `idempotencyKey`.
   - Saves final status payloads on success/failure using `ON CONFLICT DO NOTHING`.
   - Missing on `/hold`.

6. **Current confirmation retry behavior:**
   - If an idempotency key is present, retries return the exact previous response.
   - If missing/different, and the state is `RECONCILING`, the system permits the request to invoke the provider adapter *again*. This could result in duplicate external bookings if the provider doesn't do its own idempotency.

7. **Current confirmation-vs-expiry race behavior:**
   - There is a race condition. `POST /confirm` reads the DB state without a lock, then issues a time-consuming provider network call.
   - During this call, `expireHold` can trigger, lock the hold, mark it `EXPIRED`, and restock the inventory.
   - When the provider succeeds, the confirmation tries to transition to `CONFIRMED`. `transitionBookingState` will throw an error (since `EXPIRED` -> `CONFIRMED` is invalid) and roll back the DB transaction. 
   - **Result**: The DB state remains safe, but an orphaned provider reservation is created (paid for, but system says `EXPIRED`).

8. **Current inventory release behavior:**
   - Released during `expireHold` (`available` + 1, `held` - 1).
   - Released during `/confirm` failure (`available` + 1, `held` - 1).
   - Restocked during `/cancel` of a confirmed booking (`available` + 1, `confirmed` - 1).

9. **Current state-machine usage:**
   - Used for transitions during confirmation (`HELD` -> `RECONCILING`, `FAILED`, `CONFIRMED`) and cancellation (`CONFIRMED` -> `CANCELLED`).
   - Ensures strict pathing and creates `booking_events` audit logs.

10. **Code paths that bypass the state machine:**
    - `createHold` writes `HELD` directly to `bookings` and inserts to `booking_events`.
    - `expireHold` writes `EXPIRED` directly to `bookings` and inserts to `booking_events`.

11. **Concurrency/race risks relevant to Person 2:**
    - Orphaned provider bookings due to the confirmation-vs-expiry race.
    - Double holds if `POST /hold` is spammed concurrently (no idempotency).
    - Redis-to-DB duplicate expiry calls (mitigated safely by DB row locks).

12. **Integration dependencies:**
    - **Person 1 (Inventory):** Depend on `inventory` table invariant (`available + held + confirmed = total`). Restocks must strictly observe this.
    - **Person 3 (Load Tests):** The `src/tests/concurrency.ts` file depends on `createHold` throwing `INSUFFICIENT_INVENTORY` perfectly when 500 users hit 3 seats.
    - **Person 4 (Frontend):** Depends heavily on the exact JSON payload shape of `/confirm` (e.g. `pnr`, `passengerDetails`, `protectionStatus`).

13. **Exact tests that already exist for these areas:**
    - `backend/src/tests/concurrency.ts`: Verifies inventory invariant and locking when 500 concurrent hold requests hit a 3-seat inventory.

14. **Exact gaps that must be implemented in later sprints:**
    - Idempotency for `POST /api/bookings/hold`.
    - Fix the confirmation-vs-expiry race (e.g., by locking the booking or transitioning to a locking state *before* the provider call).
    - Refactor `createHold` and `expireHold` to use the formal `stateMachine.ts`.

## Answers to Specific Questions

1. **Where exactly should hold idempotency live?**
   It should be implemented in `routes/bookings.ts` inside the `POST /api/bookings/hold` handler, prior to calling `createHold`, utilizing the existing `idempotency_keys` table logic.

2. **Does the current holds table support everything we need without schema changes?**
   Yes. The table tracks `booking_id`, `inventory_id`, `quantity`, `expires_at`, and `status`, which is sufficient for mapping to idempotency keys (via `booking_id`) and managing locking.

3. **How should a same-key concurrent hold race be serialized?**
   By inserting into `idempotency_keys` with `ON CONFLICT (key) DO NOTHING`. The first thread succeeds, while concurrent duplicates detect the conflict or fail the insert, safely returning the already generating/generated response.

4. **How is a Redis expiry and DB sweeper race currently handled?**
   Safely. Both systems call `expireHold(holdId)`. The function immediately acquires a row-level `FOR UPDATE` lock on the hold. The first to lock transitions the status to `EXPIRED`. The second acquires the lock later, observes `status !== 'ACTIVE'`, and returns false.

5. **Can confirmation and expiry both mutate the same booking?**
   Yes, if they overlap. Because `/confirm` reads without a lock before a long external provider call, expiry can run in the middle and mutate the booking to `EXPIRED`. 

6. **Can confirmation run after expiry has won?**
   Yes. If expiry wins during the provider call, confirmation will still attempt to mutate the booking. `transitionBookingState` will reject the DB update and roll back the transaction (preventing inventory corruption), but the provider booking will remain orphaned externally.

7. **Should confirmation idempotency be shared with hold idempotency or remain separate?**
   They can share the `idempotency_keys` table. The table schema only requires a unique `key` and stores an opaque `response_body`.

8. **Which existing tests must Person 3 preserve?**
   `src/tests/concurrency.ts` (500 virtual users vs 3 seats concurrency proof).

9. **Which API response fields does Person 4 already depend on?**
   `success`, `status`, `bookingId`, `flightCode`, `pnr`, `travellerName`, `passengerDetails`, `paymentDetails`, `totalAmount`, `seatNumber`, `terminalGate`, `bookingDate`, `protectionStatus`, and `message`.

10. **Is any schema change actually required?**
    No. The existing schema (idempotency, bookings, holds, inventory, state machine tables) is fully capable of solving the current gaps.

## Unresolved Questions
None at this time. All behaviors traced successfully.

## Exact Files Changed
- `docs/sprint-1.md` (Created)

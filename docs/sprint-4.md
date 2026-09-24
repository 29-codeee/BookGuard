# PERSON 2 — SPRINT 4: Confirmation Lifecycle and Race Conditions

**Date:** 2026-09-24

## Objective
Make `POST /api/bookings/confirm` race-safe against the hold expiry sweeper (`expireHold`), ensuring that inventory and booking states never become inconsistent, double-released, or oversold due to network delays or concurrent triggers.

## Design
1. **Deferred Event Broadcasting:**
   - Modified `transitionBookingState` in `stateMachine.ts` to accept a `deferBroadcast` option. When inside a transaction, the SSE broadcast is deferred and executed only *after* the PostgreSQL transaction commits successfully. This prevents deadlocks with the embedded PGlite engine and ensures clients do not receive events for rolled-back transitions.
2. **Race-Condition Defense (Phantom Reservation Prevention):**
   - Refactored `POST /api/bookings/confirm`.
   - The provider API call is executed outside of DB locks to prevent connection pool exhaustion.
   - After provider success, a transaction is opened. The booking row is immediately locked (`SELECT FOR UPDATE`). 
   - A strict state revalidation occurs: if the booking transitioned to `EXPIRED` *during* the provider call, the transaction aborts, the provider reservation is immediately cancelled, and a `410 HOLD_EXPIRED` is returned.
3. **Strict Lock Ordering:**
   - Within the transaction, locks are acquired in the exact same hierarchical order as Sprint 3 (`expireHold`): **Booking -> Hold -> Inventory**. This physically prevents any possible deadlocks between concurrent confirmation and expiration attempts.
4. **State Machine Adoption:**
   - HELD -> CONFIRMED and HELD -> FAILED transitions now properly use the immutable `transitionBookingState` function.
   - Idempotency guards remain intact, preventing duplicate provider calls entirely.

## Exact Files Changed
- `backend/src/state/stateMachine.ts`: Added `deferBroadcast` feature and decoupled immediate SSE emissions.
- `backend/src/routes/bookings.ts`: Refactored `/api/bookings/confirm` to implement lock ordering, deferred broadcasting, and phantom-reservation cancellation.
- `backend/src/tests/confirmation.ts`: Created new rigorous test suite.

## Exact Tests Added (confirmation.ts)
21 assertions were successfully executed across the following scenarios:
1. **Normal `HELD -> CONFIRMED`**: Verified payload, booking status, hold status, and precisely exactly one inventory row adjustment (`held_quantity` decremented, `confirmed_quantity` incremented).
2. **Confirmation Idempotency**: Verified multiple submissions of the same `Idempotency-Key` return identical PNRs without hitting the provider or DB twice.
3. **Already `EXPIRED` Rejection**: Attempting to confirm a mathematically and physically expired hold safely returns `410 HOLD_EXPIRED`.
4. **Confirmation Racing with Expiry (Phantom Reservation)**: Triggered expiry precisely while the provider call was inflight. Verified the provider was cancelled, no confirmation occurred, and inventory remained correct.
5. **Expiry Racing with Confirmation**: Triggered expiry after a hold had been fully confirmed. Verified the expiry was completely rejected.
6. **Invariant Preservation**: `available + held + confirmed = total` mathematical check remained perfectly intact at all steps.
7. **Immutable Audit Log**: Verified exact count of `booking_events` written per transition.

## Commands Executed
- `npx tsx src/tests/confirmation.ts`

## Actual Results
- **Result:** `21 passed, 0 failed.`
- The concurrent expiry vs confirmation races were cleanly resolved by the `Booking -> Hold -> Inventory` locking strategy. Phantom reservations were successfully detected and rolled back at the provider layer.

## Remaining Issues
None. Sprint 4 satisfies all architectural requirements.

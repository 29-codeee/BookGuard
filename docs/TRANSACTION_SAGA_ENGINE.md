# BookGuard Transaction & Saga Orchestration Engine

Owner Module: `backend/src/transactions/` (Saga, state machine, reservation locks, payment, idempotency) and `backend/src/ai/` (transaction risk, recovery advisor).

This document details the multi-provider transaction model, the distributed Saga lifecycle, the reservation lock mechanism, idempotency handling, deterministic risk assessment, and human-in-the-loop recovery advisories implemented in BookGuard.

---

## 1. System Motivation & Architectural Distinction

Traditional travel booking platforms frequently suffer from the **Distributed Commitment Problem**:
- A travel booking typically spans heterogeneous third-party service providers (hotels, airlines, train operators, vehicle transfers, and activity venues).
- These external providers **cannot participate in distributed ACID transactions** (e.g., Two-Phase Commit / 2PC) due to autonomy, long execution latencies, and lack of transaction coordinator hooks.
- Naive sequential bookings leave travellers or suppliers stranded when downstream legs fail after upstream legs have already succeeded.

BookGuard resolves this by pairing **PostgreSQL database-backed reservation locks** with a **backward-compensating Saga execution engine**, an **idempotent HTTP API layer**, and **rule-based risk and recovery intelligence**.

---

## 2. Transaction State Machine

The transaction lifecycle is governed by a strict, deterministic state machine (`backend/src/transactions/stateMachine.ts`). Any attempt to perform an undeclared state transition throws an immediate error and aborts the database write.

```
                   ┌──────────┐
                   │ PENDING  │
                   └────┬─────┘
                        │
                        ▼
                 ┌─────────────┐
                 │  RESERVING  │
                 └──────┬──────┘
                        │
                        ▼
                 ┌─────────────┐
                 │  RESERVED   │
                 └──────┬──────┘
                        │
                        ▼
             ┌─────────────────────┐
             │   PAYMENT_PENDING   │
             └──────────┬──────────┘
                        │
                        ▼
           ┌───────────────────────────┐
           │    PAYMENT_AUTHORIZED     │
           └────────────┬──────────────┘
                        │
                        ▼
                 ┌─────────────┐
                 │ CONFIRMING  │
                 └──────┬──────┘
                        │
                        ▼
                 ┌─────────────┐
                 │  COMPLETED  │◀─────────────────┐
                 └──────┬──────┘                  │
                        │ cancel                  │
                        ▼                         │
                 ┌─────────────┐                  │
                 │ CANCELLING  │                  │
                 └──────┬──────┘                  │
                        │                         │
                        ▼                         │
                 ┌─────────────┐                  │
                 │  CANCELLED  │                  │
                 └─────────────┘                  │
                                                  │
   Forward / Confirmation / Payment Failure       │
   ───────────────────────────────────────────────┘
                        │
                        ▼
                 ┌─────────────┐
                 │ROLLING_BACK │
                 └──────┬──────┘
                        │
           ┌────────────┴────────────┐
           │ All compensated         │ Compensation fails
           ▼                         ▼
    ┌─────────────┐           ┌─────────────────┐
    │ ROLLED_BACK │           │ ROLLBACK_FAILED │
    └─────────────┘           └─────────────────┘
                              (Unreleased Locks +
                               Recovery Advisory)
```

### Transition Matrix

| Current State | Permitted Next States | Description |
|:---|:---|:---|
| `PENDING` | `RESERVING`, `ROLLING_BACK` | Transaction initialized; beginning forward provider reservations. |
| `RESERVING` | `RESERVED`, `ROLLING_BACK` | Forward provider reservations in progress. |
| `RESERVED` | `PAYMENT_PENDING`, `ROLLING_BACK` | All forward provider reservations secured. |
| `PAYMENT_PENDING` | `PAYMENT_AUTHORIZED`, `ROLLING_BACK` | Contacting payment provider for authorization. |
| `PAYMENT_AUTHORIZED` | `CONFIRMING`, `ROLLING_BACK` | Payment authorized; issuing final provider confirmations. |
| `CONFIRMING` | `COMPLETED`, `ROLLING_BACK` | Final confirmations in progress. |
| `COMPLETED` | `CANCELLING` | Transaction confirmed and paid. User/operator requested cancellation. |
| `CANCELLING` | `CANCELLED`, `ROLLBACK_FAILED` | Compensating all confirmed providers and issuing refund. |
| `ROLLING_BACK` | `ROLLED_BACK`, `ROLLBACK_FAILED` | Compensating previously secured reservations in reverse order. |
| `ROLLED_BACK` | *(Terminal)* | All providers compensated, locks released, payment voided/refunded. |
| `CANCELLED` | *(Terminal)* | Explicit user cancellation completed cleanly. |
| `ROLLBACK_FAILED` | *(Terminal - Requires Operator)* | One or more provider compensations failed. Quarantined for review. |

---

## 3. Database-Backed Reservation Locks

Resource locks are tracked in the `booking_resource_locks` table. They prevent double-allocation across concurrent transactions while respecting inventory limits.

### Lock States

1. **`ACTIVE`**: A provisional lock acquired during transaction initialization with a 15-minute TTL (`expires_at = CURRENT_TIMESTAMP + 15 minutes`).
2. **`CONFIRMED`**: Acquired once the entire booking transaction reaches `COMPLETED`. Holds inventory permanently until user cancellation.
3. **`RELEASED`**: Marked when a transaction successfully rolls back. The lock no longer consumes capacity.

### Capacity Invariant Check

When reserving a resource of type $T$ with requested quantity $Q$, the engine enforces:

$$\sum (\text{available capacity}) - \sum_{L \in \text{Locks}} L.\text{quantity} \ge Q$$

where $\text{Locks}$ includes all locks where:
$$\text{status} = \text{'CONFIRMED'} \quad \lor \quad (\text{status} = \text{'ACTIVE'} \land \text{expires\_at} > \text{CURRENT\_TIMESTAMP})$$

### The `ROLLBACK_FAILED` Quarantine Principle

If a transaction fails and a subsequent provider compensation operation fails (e.g. flight cancellation rejected by airline), **BookGuard does NOT release that resource's lock**. The lock remains `CONFIRMED`.

*Why?* Releasing the lock when the external airline still holds the reservation would cause BookGuard to treat that seat as available in the internal catalog, leading to catastrophic double-selling. The unreleased lock intentionally quarantines the resource until a human operator reconciles the supplier state.

---

## 4. Saga Orchestration & Execution Flow

The Saga coordinator (`backend/src/transactions/saga.ts`) executes the following sequential pipeline:

```
[Client Request]
       │
       ▼ (1. Idempotency Check & Pre-Lock Validation)
[Database Transaction]
       │
       ▼ (2. Acquire ACTIVE Reservation Locks in DB)
[Risk Intelligence Layer]
       │
       ▼ (3. Deterministic Transaction Risk Assessment)
[Provider Reservation Phase (Sequential)]
       ├── 3.1 Reserve Provider 1 (Hotel)
       ├── 3.2 Reserve Provider 2 (Flight)
       └── 3.3 Reserve Provider 3 (Transport)
       │
       ▼ (4. Payment Authorization Phase)
[MockPaymentService.authorizePayment()]
       │
       ▼ (5. Provider Confirmation Phase (Sequential)]
       ├── 5.1 Confirm Provider 1
       ├── 5.2 Confirm Provider 2
       └── 5.3 Confirm Provider 3
       │
       ▼ (6. Payment Capture Phase)
[MockPaymentService.capturePayment()]
       │
       ▼ (7. Finalization)
[Promote Locks to CONFIRMED · State -> COMPLETED]
```

### Backward Compensation (Rollback Flow)

If an error occurs during reservation, authorization, or confirmation:
1. Transaction state transitions to `ROLLING_BACK`.
2. The Saga engine inspects all items whose provider state is `RESERVED` or `CONFIRMED`.
3. Compensations are executed in **strict Last-In-First-Out (LIFO) reverse order**.
4. If payment was authorized or captured, `voidAuthorization()` or `refundPayment()` is triggered.
5. If all compensations succeed:
   - Locks transition to `RELEASED`.
   - Transaction state transitions to `ROLLED_BACK`.
6. If any compensation fails:
   - Successfully compensated items have their locks `RELEASED`.
   - Uncompensated items retain their `CONFIRMED` locks.
   - Transaction state transitions to `ROLLBACK_FAILED`.
   - The **Recovery Advisor** generates and persists an emergency `MANUAL_OPERATOR_REVIEW` advisory.

---

## 5. API-Level Idempotency Interceptor

Every mutating request (`POST /api/transactions`) requires an `Idempotency-Key` header:

1. **First Arrival**:
   - A lock is placed on the key within the database.
   - A SHA-256 hash of the normalized request body is stored.
   - The transaction executes normally.
   - Upon completion, the HTTP status code and response payload are persisted.
2. **Duplicate Replay (Identical Payload)**:
   - Hash matches the stored record.
   - Cached response payload and HTTP status code are returned immediately without re-invoking providers or creating duplicate transactions.
3. **Payload Mismatch (Conflicting Payload)**:
   - Hash does not match the stored record.
   - Request is immediately rejected with HTTP 422 Unprocessable Entity (`IDEMPOTENCY_KEY_REUSED`), preventing unintended state mutations.

---

## 6. Deterministic Transaction Risk Assessment (Phase 6A)

Before initiating provider reservations, BookGuard computes an explainable risk score ($0 \le S \le 100$) using deterministic heuristics:

- **Provider Reliability Penalties**: Providers with historical reliability $< 0.85$ add $+20$ points; $< 0.70$ add $+40$ points.
- **Maintenance / Outage Flag**: Any provider in scheduled maintenance adds $+50$ points.
- **Unsupported Rollback Penalty**: Any provider lacking automated programmatic cancellation adds $+40$ points.
- **Multi-Provider Complexity**: $+10$ points per independent provider in the booking bundle.
- **Provider Latency Degradation**: Average historical latency $> 1000\text{ ms}$ adds $+15$ points; $> 2000\text{ ms}$ adds $+30$ points.

### Risk Bands & Actions

| Score Range | Risk Level | Advisory Action | Operational Behavior |
|:---:|:---:|:---:|:---|
| $0 \le S \le 39$ | `LOW` | `PROCEED` | Standard transaction execution. |
| $40 \le S \le 69$ | `MEDIUM` | `PROCEED` | Enhanced audit logging and telemetry tracking. |
| $70 \le S \le 100$ | `HIGH` | `REVIEW` | Flagged for operator visibility; execution continues without blocking. |

*Crucial Design Rule*: Risk assessment is **strictly non-blocking and advisory**. It does not mutate inventory or reject customer requests autonomously.

---

## 7. Human-in-the-Loop Recovery Advisor (Phase 6B)

When a transaction terminates in `ROLLBACK_FAILED` (or experiences an unrecoverable failure), the Recovery Advisor classifies the root cause and persists an actionable advisory:

```
[Failed Transaction & Unreleased Locks]
                   │
                   ▼
       [Rule-Based Expert Engine]
       ├── Transient Network Timeout ──────▶ AUTOMATIC_RETRY (Confidence 90%)
       ├── Provider Under Maintenance ─────▶ ALTERNATIVE_PROVIDER (Confidence 88%)
       ├── Rate Limit / Quota Exceeded ────▶ SCHEDULED_RETRY (Confidence 85%)
       └── Compensation Failure ───────────▶ MANUAL_OPERATOR_REVIEW (Confidence 98%)
                   │
                   ▼
  [booking_transaction_recovery_advisories]
                   │
                   ▼
      [Operations Dashboard UI]
  (Explicit Warning: "Do Not Release Lock Until Confirmed")
```

---

## 8. Persisted Relational Schema

```
booking_transactions (id, customer_id, status, currency, total_amount, idempotency_key, created_at, updated_at)
       ├── booking_transaction_items (id, transaction_id, item_type, resource_id, quantity, unit_price, status)
       ├── booking_resource_locks (id, transaction_id, item_id, resource_type, resource_id, quantity, status, expires_at)
       ├── booking_transaction_providers (id, transaction_id, item_id, provider_id, operation_type, status, provider_reference, error_message)
       ├── booking_transaction_events (id, transaction_id, event_type, payload, created_at)
       ├── booking_transaction_risk_assessments (id, transaction_id, risk_score, risk_level, recommended_action, factors_json)
       └── booking_transaction_recovery_advisories (id, transaction_id, failure_category, recovery_strategy, confidence, suggested_action, details_json)
```

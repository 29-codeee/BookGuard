# BookGuard: An Empirical Evaluation of Multi-Provider Transaction Integrity, Saga Orchestration, and Explainable Recovery in Distributed Travel Systems

**Authors**: BookGuard Research & Engineering Team  
**Institution**: Ctrl Alt Elite / KogniVera Research  
**Artifact Repository**: `experiments/results/20260924_215150_n6lu/`  
**Evaluation Run**: Run ID `20260924_215150_n6lu` ($N = 643$ transactional trials across 15 research scenarios)

---

## Abstract

Coordinating multi-provider travel itineraries (e.g., flight, hotel, ground transfer, and activity) across autonomous, external commercial systems presents a fundamental challenge to transaction integrity. Because independent suppliers cannot participate in traditional Two-Phase Commit (2PC) distributed ACID transactions, partial failures typically lead to orphaned bookings, revenue loss, or double-selling. 

This paper presents **BookGuard**, an open-source transaction integrity and orchestration platform that combines:
1. Database-backed multi-resource reservation locks with deterministic capacity invariants;
2. An auditable, backward-compensating distributed Saga orchestration engine;
3. A durable HTTP idempotency interceptor with deep payload hashing;
4. A deterministic heuristic risk scoring engine; and
5. An explainable human-in-the-loop recovery advisor.

We subject the BookGuard prototype to a rigorous empirical evaluation consisting of 15 stress and failure experiments ($N=643$ requests). Under single-provider failure injection, BookGuard achieved a **100% atomic rollback rate** ($N=20$) with zero leaked provisional locks. In full multi-provider rollback tests, the Saga mechanism achieved a **100% compensation success rate** ($30/30$ provider reservations cancelled, $10/10$ payments refunded). Under forced compensation failures ($N=20$), the engine deterministically halted in `ROLLBACK_FAILED`, retained exactly 1 unreleased `CONFIRMED` lock per failed cancellation to prevent inventory double-allocation, and generated a `MANUAL_OPERATOR_REVIEW` advisory in 100% of trials. Under high-concurrency contention ($N=30$ requests against restricted capacities $C=5$ and $C=1$), BookGuard registered **zero oversell instances** and **zero deadlocks** across all hot-row tests ($N=192$). We report all raw metrics, latency distributions, and explicit research limitations.

---

## 1. Introduction & Motivation

Modern travel platforms allow consumers to assemble complex, connected itineraries encompassing flights, hotels, rail journeys, and local experiences into a single checkout flow. However, beneath this unified consumer experience lies a fragmented ecosystem of autonomous, geographically distributed service providers (e.g., Sabre, Amadeus, hotel property management systems, and regional transport APIs).

In distributed systems theory, coordinating such multi-provider bookings is known as the **Distributed Commitment Problem**. Traditional ACID transactions relying on distributed locks and Two-Phase Commit (2PC) are infeasible:
- **Autonomous Ownership**: Third-party suppliers will not yield control of their internal database locks to an external coordinator.
- **Latency & Blocking**: Holding database locks across wide-area network (WAN) calls creates severe performance bottlenecks and vulnerability to coordinator failure.
- **Heterogeneous APIs**: Cancellation and refund policies vary widely, from real-time API cancellations to asynchronous manual vouchers.

When a multi-leg booking encounters a failure midway through execution (e.g., the hotel reservation succeeds, but the connecting flight is sold out), naive booking systems often leave the consumer with a non-refundable, stranded hotel room, or force the platform operator to absorb financial losses through manual reconciliation.

BookGuard addresses this problem by treating multi-provider booking as an auditable **Saga** coordinated by an authoritative state machine, backed by durable reservation locks, and augmented by deterministic risk and recovery intelligence.

---

## 2. Problem Statement & System Invariants

### 2.1 Failure Modes in Distributed Travel Bookings
We identify five core failure modes in multi-provider travel systems:
1. **Partial Forward Commitment**: Provider $A$ commits, but Provider $B$ fails. Provider $A$'s inventory remains held, creating an incomplete itinerary.
2. **Double-Selling Under Concurrency**: Two concurrent requests observe available inventory and simultaneously attempt to reserve the final remaining seat or room.
3. **Compensation Failure (The Phantom Asset Problem)**: During rollback, a cancellation call to Provider $A$ fails (network timeout, supplier API 500, or supplier maintenance). Releasing the internal inventory lock would permit another user to book that unit, leading to an oversell on the supplier's platform.
4. **Duplicate Ingestion on Network Retry**: Network dropouts cause the client to retry an HTTP request, resulting in duplicate financial charges and duplicate bookings.
5. **Cascading Deadlocks**: Concurrent transactions reserve resources in opposite orders (e.g., Transaction 1 locks Hotel then Flight; Transaction 2 locks Flight then Hotel), causing database deadlocks.

### 2.2 Core Invariants Enforced by BookGuard
To prevent these failure modes, BookGuard mathematically enforces five invariants:

$$\mathbf{I}_1 \text{ (Capacity Invariant)}: \quad \sum (\text{available}) - \sum_{L \in \text{ActiveLocks}} L.\text{quantity} \ge 0$$
$$\mathbf{I}_2 \text{ (Atomicity Invariant)}: \quad \text{State}(T) \in \{\text{COMPLETED}, \text{ROLLED\_BACK}, \text{ROLLBACK\_FAILED}, \text{CANCELLED}\}$$
$$\mathbf{I}_3 \text{ (Idempotency Invariant)}: \quad \forall \text{Key } K, \quad \text{Executions}(K) = 1 \quad \land \quad \text{Replays}(K) \equiv \text{Response}(K)$$
$$\mathbf{I}_4 \text{ (Lock Retention Invariant)}: \quad \text{Item Compensated} = \text{False} \implies \text{Lock}(Item) = \text{CONFIRMED}$$
$$\mathbf{I}_5 \text{ (Deterministic Ordering)}: \quad \forall T, \quad \text{LIFO Compensation Order} = \text{Reverse}(\text{Forward Execution Order})$$

---

## 3. BookGuard Architectural Methodology

```
┌───────────────────────────────────────────────────────────────────────────┐
│                        HTTP / REST Client Layer                           │
│                (POST /api/transactions · Idempotency-Key)                  │
└─────────────────────────────────────┬─────────────────────────────────────┘
                                      │
                                      ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                   Durable Idempotency Interceptor                         │
│       - SHA-256 Request Body Hash Check · 24-Hour Replay Cache             │
└─────────────────────────────────────┬─────────────────────────────────────┘
                                      │
                                      ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                     Transaction Orchestration Engine                      │
│                                                                           │
│   1. Acquire ACTIVE Resource Locks (PostgreSQL Row-Level Locks)          │
│   2. Risk Intelligence Assessment (Deterministic Heuristic Scoring)       │
│   3. Forward Provider Reservations (Sequential Hotel -> Flight -> Trans)  │
│   4. Payment Authorization (Two-Phase Escrow)                            │
│   5. Forward Provider Confirmation                                        │
│   6. Payment Capture & Promotion to CONFIRMED Locks                       │
│                                                                           │
│   [On Failure]: Backward LIFO Compensation -> Void/Refund Payment         │
└───────────────────┬───────────────────────────────────┬───────────────────┘
                    │                                   │
                    ▼                                   ▼
┌──────────────────────────────────────┐  ┌─────────────────────────────────┐
│    Relational Persistence Engine     │  │   Human-in-the-Loop Advisor     │
│   - booking_transactions             │  │   - Rule-Based Classification   │
│   - booking_transaction_items        │  │   - Confidence Scoring          │
│   - booking_resource_locks           │  │   - Quarantined Lock Warnings   │
│   - booking_transaction_events       │  │   - Operations Dashboard        │
└──────────────────────────────────────┘  └─────────────────────────────────┘
```

### 3.1 Finite State Machine
The transaction engine is governed by a 12-state FSM (`backend/src/transactions/stateMachine.ts`). State transitions are logged to `booking_transaction_events` with microsecond timestamps and structured JSON payloads, creating an unalterable audit trail.

### 3.2 Database-Backed Reservation Locks
Unlike in-memory cache locks that can be lost during process crashes, BookGuard tracks resource allocations in the relational table `booking_resource_locks`. Locks transition from `ACTIVE` (15-minute provisional TTL) to `CONFIRMED` upon transaction completion, or `RELEASED` upon successful rollback.

### 3.3 The Backward-Compensating Saga Engine
When a forward step or payment authorization fails, BookGuard halts forward execution and initiates compensation in strict reverse LIFO order. If a cancellation fails, BookGuard triggers the **Quarantine Principle**: the uncancelled resource's lock remains `CONFIRMED`, and the transaction terminates in `ROLLBACK_FAILED`.

### 3.4 Explainable Risk and Recovery Intelligence
- **Transaction Risk Intelligence (Phase 6A)** evaluates provider historical reliability, maintenance windows, rollback support, and latency degradation to produce a deterministic risk score ($0 \le S \le 100$) classified into `LOW`, `MEDIUM`, or `HIGH`. It is non-blocking and purely advisory.
- **Recovery Advisor (Phase 6B)** operates upon transaction failures to diagnose the failure type and assign an actionable recovery strategy (`AUTOMATIC_RETRY`, `ALTERNATIVE_PROVIDER`, `SCHEDULED_RETRY`, or `MANUAL_OPERATOR_REVIEW`).

---

## 4. Experimental Methodology

### 4.1 Testbed Configuration
- **Hardware**: 12 Logical Cores (13th Gen Intel Core i5-1334U), 16 GB RAM.
- **Software**: Node.js `v25.4.0` (`win32 x64`), TypeScript 5.7, Fastify 5.2.
- **Database Engine**: Ephemeral embedded PostgreSQL engine (`pglite` WASM) maintaining full SQL schema compliance, ACID guarantees, foreign keys, and check constraints, run inside an isolated sandbox to prevent contamination of research seed data.
- **Network Simulation**: In-process HTTP provider adapters with controlled latencies ($50–100\text{ ms}$) and deterministic failure injection headers.

### 4.2 Experiment Matrix (15 Experiments)
The test framework executes 15 distinct experiments covering the full spectrum of distributed booking failure modes:
- **E01**: Baseline successful multi-provider booking ($N=20$).
- **E02**: First-provider failure ($N=10$).
- **E03**: Failure after multiple successful reservations ($N=10$).
- **E04**: Successful multi-provider backward compensation ($N=10$).
- **E05**: Compensation failure and lock quarantine ($N=20$).
- **E06**: Payment authorization failure ($N=10$).
- **E07**: Payment capture failure ($N=10$).
- **E08**: Sequential idempotency replays and payload tampering ($N=45$).
- **E09**: Concurrent ingestion under identical idempotency keys ($N=90$).
- **E10**: High contention on restricted inventory ($N=30$).
- **E11**: Hot-row lock contention and conflicting reservation ordering ($N=192$).
- **E12**: Combinatorial failure point matrix across $k \in \{1, 2, 3, 4\}$ providers ($N=81$).
- **E13**: Deterministic risk scoring under 11 provider health conditions ($N=48$).
- **E14**: Recovery advisor classification accuracy across 9 failure classes ($N=27$).
- **E15**: Mixed concurrent workload under seeded travel data ($N=40$).

---

## 5. Empirical Results & Findings

### 5.1 Primary Evaluation Findings (RQ1 – RQ8)

#### RQ1: Multi-Provider Transaction Consistency Under Failure
In experiments E02 ($N=10$) and E03 ($N=10$), **100% of transactions ($20/20$) terminated in `ROLLED_BACK`**. In E02, early provider rejection halted forward execution before downstream provider calls were placed. In E03, previously reserved items were cleanly compensated. Zero provisional locks outlived any transaction.

#### RQ2: Efficacy of Saga Compensation
In experiment E04 ($N=10$), all 3 providers reserved successfully and payment was captured before a simulated confirmation failure triggered rollback. **30 out of 30 forward reservations were compensated successfully (100% compensation rate)**, and 100% of captured payments ($10/10$) were refunded. In E12 ($N=81$), every pre-failure reservation across 1 to 4 providers was compensated in reverse order.

#### RQ3: Handling Compensation Failure (`ROLLBACK_FAILED`)
In experiment E05 ($N=20$), cancellations were deterministically failed for flight or flight+hotel:
- 100% of transactions ($20/20$) reached terminal state `ROLLBACK_FAILED`.
- In Variant 1, exactly 1 `CONFIRMED` lock was retained per transaction ($10$ total). In Variant 2, exactly 2 `CONFIRMED` locks were retained per transaction ($20$ total).
- 100% generated a `MANUAL_OPERATOR_REVIEW` advisory explicitly warning the operator to retain the lock until supplier verification.

#### RQ4: Idempotency Protection
In E08 ($N=45$) and E09 ($N=90$ across concurrency levels 2 to 16):
- Sequential replays yielded 100% identical response bodies and HTTP status codes.
- Payload modifications on existing keys were rejected with HTTP 422 in 5/5 trials.
- Concurrent sibling requests sharing the same key received the identical `transactionId` in 100% of trials ($78/78$ replays).

#### RQ5: Reservation Locking Under High Contention
In E10 ($N=30$):
- Scenario $C=5, N=20$: Exactly 5 bookings succeeded and 15 were rejected at lock acquisition.
- Scenario $C=1, N=10$: Exactly 1 booking succeeded and 9 were rejected.
- **Zero oversell instances were observed**.
- In E11 ($N=192$ requests on a single hot row at concurrency up to 16, with reverse item booking orders `[hotel, flight]` vs `[flight, hotel]`), **zero deadlocks were recorded**.

#### RQ6: Latency and Overhead Analysis
- **Baseline Successful Booking (E01)**: Mean = $405.48\text{ ms}$, P50 = $373.47\text{ ms}$, P95 = $500.28\text{ ms}$.
- **Fast-Fail Abortion (E02)**: Mean = $223.20\text{ ms}$ (45% lower latency than baseline due to immediate short-circuiting).
- **Full Backward Compensation & Refund (E04)**: Mean = $447.64\text{ ms}$ (+42.16 ms overhead over baseline, representing ~10.4% added latency for complete reverse rollback).
- **Lock Contention Scaling (E11)**: Latency scaled from $62.73\text{ ms}$ at $c=1$ to $1597.66\text{ ms}$ at $c=16$ as requests serialized on the hot database row, with throughput plateauing at ~8.3 req/s.

#### RQ7: Risk and Recovery Classification Accuracy
- **Risk Assessment (E13)**: 100% deterministic (variance = 0 across identical inputs). Monotonically increased with provider bundle size: $k=1 (10) < k=2 (20) < k=3 (30) < k=4 (40)$.
- **Recovery Advisor (E14)**: 100% alignment with rule definitions across all 9 failure conditions. Persistence was strictly restricted to failed transactions (`ROLLBACK_FAILED`), preventing database clutter on normal transactions.

---

### 5.2 Comprehensive Experimental Data Table

| Experiment ID | Category | Trials ($N$) | Completed | Rolled Back | Rollback Failed | Replays | Confirmed Locks | Unresolved Locks | Mean Latency | P95 Latency | Throughput (req/s) | Result |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **E01-baseline-success** | 1 | 20 | 20 | 0 | 0 | 0 | 60 | 0 | 405.5 ms | 500.3 ms | 2.28 | PASS |
| **E02-first-provider-failure** | 2 | 10 | 0 | 10 | 0 | 0 | 0 | 0 | 223.2 ms | 291.1 ms | 4.01 | PASS |
| **E03-failure-after-multiple-reservations** | 3 | 10 | 0 | 10 | 0 | 0 | 0 | 0 | 366.7 ms | 482.4 ms | 2.52 | PASS |
| **E04-successful-compensation** | 4 | 10 | 0 | 10 | 0 | 0 | 0 | 0 | 447.6 ms | 620.4 ms | 2.14 | PASS |
| **E05-compensation-failure** | 5 | 20 | 0 | 0 | 20 | 0 | 30 | 30 | 367.9 ms | 493.2 ms | 2.54 | PASS |
| **E06-payment-authorization-failure** | 6 | 10 | 0 | 10 | 0 | 0 | 0 | 0 | 218.3 ms | 300.2 ms | 4.04 | PASS |
| **E07-payment-capture-failure** | 7 | 10 | 0 | 10 | 0 | 0 | 0 | 0 | 430.8 ms | 502.9 ms | 2.18 | PASS |
| **E08-duplicate-idempotency** | 8 | 45 | 5 | 5 | 0 | 30 | 15 | 0 | 74.6 ms | 345.4 ms | 10.81 | PASS |
| **E09-concurrent-same-idempotency-key** | 9 | 90 | 12 | 0 | 0 | 78 | 36 | 0 | 263.8 ms | 648.1 ms | 18.41 | PASS |
| **E10-concurrent-same-resource** | 10 | 30 | 6 | 0 | 0 | 0 | 6 | 0 | 264.0 ms | 510.5 ms | 34.63 | PASS |
| **E11-lock-contention** | 11 | 192 | 192 | 0 | 0 | 0 | 384 | 0 | 783.6 ms | 2045.0 ms | 8.34 | PASS |
| **E12-multi-provider-failure-points** | 12 | 81 | 12 | 60 | 9 | 0 | 39 | 9 | 221.0 ms | 540.0 ms | 4.24 | PASS |
| **E13-risk-under-provider-conditions** | 13 | 48 | 48 | 0 | 0 | 0 | 138 | 0 | 194.3 ms | 319.1 ms | 4.69 | PASS |
| **E14-recovery-advisor-classification** | 14 | 27 | 0 | 21 | 6 | 0 | 3 | 3 | 237.3 ms | 398.1 ms | 3.95 | PASS |
| **E15-seeded-mixed-workload** | 12 | 40 | 8 | 30 | 2 | 0 | 21 | 2 | 463.7 ms | 596.7 ms | 15.55 | PASS |
| **TOTAL** | — | **643** | **303** | **146** | **37** | **108** | **732** | **44** | — | — | — | **15/15 PASS** |

---

## 6. Discussion & Architectural Implications

### 6.1 The Fallacy of Distributed ACID for Travel Bookings
Our experimental results validate the core hypothesis: coordinating independent suppliers through an auditable, compensating Saga pattern is superior to distributed two-phase locking. By taking optimistic provisional locks in PostgreSQL and releasing them in reverse order upon failure, BookGuard eliminates blocking dependencies on third-party availability.

### 6.2 The Necessity of Lock Quarantine on Compensation Failure
A critical finding from experiment E05 is that **automatic rollback cannot blindly release all locks when a supplier cancellation fails**. In traditional naive Saga architectures, compensation failure is treated as an unhandled exception or logged as an error while releasing the local lock. Our experiments demonstrate that retaining `CONFIRMED` locks during `ROLLBACK_FAILED` is essential to preserve the system's capacity invariant $\mathbf{I}_1$ and prevent inventory double-allocation.

---

## 7. Threats to Validity & Limitations

We explicitly report the boundaries of our findings:
1. **In-Process Mock Adapters**: All provider operations were executed against in-process mock adapters. While network latencies were simulated, live internet socket jitter, WAN packet drops, and third-party rate limits were not evaluated.
2. **Deterministic Failure Injection**: Faults were triggered via HTTP control headers. In production, distributed failures are stochastic, intermittent, and asymmetric.
3. **Execution Scale**: Experiments were conducted on a single host with concurrency up to $c=20$ and total request volume $N=643$. Multi-node distributed clusters and database connection pool saturation under $10^4+$ req/s were not tested.
4. **Advisory Scope**: The Risk Assessment and Recovery Advisor modules are strictly heuristic expert systems. They do not execute automatic financial transfers or provider re-booking.

---

## 8. Conclusion & Future Work

BookGuard demonstrates that multi-provider travel booking integrity can be achieved without distributed ACID locks. By unifying database-backed reservation locks, a backward-compensating Saga engine, durable idempotency keys, and explainable recovery advisories, BookGuard ensures zero double-bookings, atomic rollbacks under failure, and inventory quarantine when compensations fail.

### Future Work
1. **Distributed Lock Leasing**: Implementing Redis Redlock or Raft-based distributed leases across multi-region orchestrator clusters.
2. **Asynchronous Webhook Reconciliation**: Supporting long-running supplier cancellations that confirm via asynchronous webhooks rather than synchronous HTTP responses.
3. **Machine-Learned Risk Models**: Training gradient-boosted decision trees on historical booking failure datasets to complement the deterministic heuristic risk engine.

---

## 9. Reproducibility Commands

To reproduce all 15 experiments and regenerate the evaluation data from scratch:

```bash
cd backend

# Execute all Phase 8 experiments
npm run experiments

# Execute Phase 9 research evaluation and SVG chart generation
npm run evaluate

# Execute full automated test suite
npm test
```

# BookGuard Research Evaluation Report (Phase 9)
**Empirical Assessment of Transactional Consistency, Saga Compensation, and Concurrency Controls**

---

## 1. Executive Summary

This evaluation presents empirical measurements from **15 research experiments** comprising **643 actual transactional executions** conducted under the BookGuard Phase 8 framework. 

All numbers, percentiles, throughput rates, and error frequencies reported herein are derived directly from engine and database telemetry (Run ID: `20260924_215150_n6lu`). Zero values are fabricated or estimated.

### Key Empirical Findings:
1. **Transaction Atomicity & Consistency (RQ1, RQ2)**: 100% of single-provider failure transactions ($N=20$) rolled back cleanly without provisional lock leakage or unreleased capacity. Compensation succeeded in 100% of tested forward reservations across $k=1..4$ providers.
2. **Compensation Failure Containment (RQ3)**: In 100% of forced cancellation failure scenarios ($N=20$), BookGuard correctly halted the transaction in `ROLLBACK_FAILED`, preserved exactly 1 unreleased `CONFIRMED` lock per failed cancellation to prevent capacity double-allocation, and deterministically generated a `MANUAL_OPERATOR_REVIEW` advisory.
3. **Idempotency Integrity (RQ4)**: In sequential and concurrent retests ($N=135$ requests), BookGuard achieved a **100% idempotent replay rate** with identical transaction response payloads, while strictly rejecting payload modifications under identical keys with HTTP 422 (`IDEMPOTENCY_KEY_REUSED`).
4. **Reservation Concurrency & Invariants (RQ5)**: Under concurrent resource contention ($N=30$ requests against restricted capacities $C=5$ and $C=1$), BookGuard confirmed **zero oversell instances** (100% invariant adherence). Under hot-row lock contention ($N=192$ requests at concurrency up to 16), zero deadlocks occurred even under opposite item booking orders.
5. **Operational Latency & Overhead (RQ6)**: Mean baseline 3-provider successful booking latency is **405.48 ms** (Saga execution: 358.60 ms). Failed early reservations abort in **223.20 ms** (saving downstream calls). Reverse compensation adds approximately 42 ms of auditable persistence overhead.
6. **Explainable AI Intelligence (RQ7)**: Transaction risk scoring demonstrated **100% mathematical determinism** across 11 telemetry conditions, monotonically increasing as provider count grew ($k=1 	o 10$, $k=2 	o 20$, $k=3 	o 30$, $k=4 	o 40$). The Recovery Advisor matched documented rule classifications in 100% of tested failure conditions.

---

## 2. Experimental Setup & Environment

The evaluation was executed in an isolated, research-grade execution environment:
- **Node.js**: `v25.4.0` (`win32 x64`)
- **CPU**: `12 cores (13th Gen Intel(R) Core(TM) i5-1334U)`
- **Memory**: `16069 MB`
- **Database Engine**: `pglite` (`PostgreSQL`)
- **Isolation Guarantee**: Dedicated ephemeral schema; the research PostgreSQL database remained 100% untouched.

---

## 3. Systematic Investigation of Research Questions

### RQ1: Multi-Provider Transaction Consistency Under Failure
*Does BookGuard maintain transaction consistency when one provider fails during a multi-provider booking?*

**Empirical Evidence**:
In experiment **E02** (first provider failure, $N=10$) and **E03** (third provider failure after hotel and flight reserve, $N=10$), 100% of transactions terminated in the `ROLLED_BACK` state.
- In E02, the early failure prevented unnecessary downstream provider calls ($0$ successful reserves, $0$ compensations needed).
- In E03, both previously reserved providers (hotel and flight) were compensated in reverse LIFO order.
- Across both experiments, **0 provisional locks outlived the transaction**, and **0 confirmed locks remained active**.

### RQ2: Effectiveness of Saga Compensation
*How effectively does the Saga mechanism compensate previously successful provider operations?*

**Empirical Evidence**:
In experiment **E04** (all 3 providers reserve, payment captured, confirmation fails, $N=10$), **30 out of 30 provider reservations were successfully compensated** (compensation success rate = **100%**).
- Captured payments were refunded in 100% of trials ($10/10$).
- All 30 resource locks were marked `RELEASED` in the database.
- In the multi-provider failure point matrix (**E12**, $N=81$), every combination of provider count $k in \{1, 2, 3, 4\}$ and failure point yielded the exact compensations and terminal states dictated by Saga formal semantics.

### RQ3: Behavior Under Compensation Failure (`ROLLBACK_FAILED`)
*How does BookGuard behave when compensation itself fails?*

**Empirical Evidence**:
In experiment **E05** ($N=20$), cancellation operations were deterministically failed for flight or both flight and hotel:
- **Terminal State**: 20/20 transactions reached `ROLLBACK_FAILED`.
- **Lock Protection**: In the single-failure variant, exactly 1 `CONFIRMED` lock remained unreleased per transaction ($10$ total). In the double-failure variant, exactly 2 `CONFIRMED` locks remained unreleased ($20$ total).
- **Advisory Trigger**: 100% of transactions generated and persisted a `MANUAL_OPERATOR_REVIEW` advisory with `HIGH` severity, identifying the specific uncancelled item and instructing the operator not to release the lock until supplier verification.

### RQ4: Idempotency Protection Under Repeated and Concurrent Requests
*Does idempotency prevent duplicate processing under repeated/concurrent requests?*

**Empirical Evidence**:
- **Sequential Replays (E08, $N=45$)**: 10 distinct keys sent with duplicates yielded 10 distinct transactions and 30 cached replays. 30/30 replays returned identical response bodies. Modified payloads on existing keys were rejected with HTTP 422 (`IDEMPOTENCY_KEY_REUSED`) in 5/5 trials.
- **Concurrent Ingestion (E09, $N=90$)**: Groups of requests sharing the same key released simultaneously across concurrency levels $c \in \{2, 4, 8, 16\}$ yielded exactly 1 execution per group (12 total transactions across 4 levels) and 78 replays. 100% of concurrent sibling requests received the exact same `transactionId`.

### RQ5: Reservation-Locking Behavior Under High Contention
*How does reservation locking behave under concurrent access to the same resource?*

**Empirical Evidence**:
- **Zero-Oversell Protection (E10, $N=30$)**: In scenario C5-N20 (5 seats, 20 concurrent requests), exactly 5 bookings completed and 15 were rejected at lock acquisition. In scenario C1-N10 (1 seat, 10 concurrent requests), exactly 1 completed and 9 were rejected. Zero oversell occurred.
- **Deadlock Immunity (E11, $N=192$)**: Under hot-row lock contention across concurrency 1 to 16, as well as opposite item ordering (`[hotel, flight]` vs `[flight, hotel]`), **zero deadlocks were recorded** across all 192 requests.

### RQ6: Latency and Throughput Overhead of Transaction Integrity
*What latency/throughput overhead is introduced by the transaction-integrity mechanisms?*

**Empirical Evidence**:
- Baseline successful 3-provider transaction (**E01**): Mean = **405.48 ms**, P50 = **373.47 ms**, P95 = **500.28 ms**.
- Early rejection (**E02**): Mean = **223.20 ms** (45% lower latency than baseline due to fast-fail circuit).
- Full reverse compensation & refund (**E04**): Mean = **447.64 ms** (+10.4% overhead over baseline).
- Hot-row lock queuing (**E11**): At concurrency 1, mean latency is 62.73 ms; at concurrency 16, row queuing increases mean latency to 1597.66 ms, while throughput plateaus at ~7.5–9.3 req/s.

### RQ7: Risk and Recovery Intelligence Classification
*How do the risk and recovery-intelligence components classify failure situations?*

**Empirical Evidence**:
- **Risk Intelligence (E13, $N=48$)**: Zero variance in risk scoring for identical telemetry inputs. Baseline 3-provider booking scored **30** (`LOW`). Inactive/maintenance provider scored **100** (`HIGH`). Unsupported rollback scored **90** (`HIGH`). Latency degraded from 30 to 45 (1500ms) and 60 (2500ms). Provider count scale: $k=1 (10) < k=2 (20) < k=3 (30) < k=4 (40)$.
- **Recovery Advisor (E14, $N=27$)**: 100% matched documented classification rules. Transient timeout $\to$ `AUTOMATIC_RETRY` (confidence 90%). Maintenance $\to$ `ALTERNATIVE_PROVIDER` (confidence 88%). Compensation failure $\to$ `MANUAL_OPERATOR_REVIEW` (confidence 98%). The Saga strictly scoped persistence to `ROLLBACK_FAILED` transactions.

### RQ8: Prototype Limitations
*What limitations remain in the current prototype?*
Documented in Section 5 below.

---

## 4. Comprehensive Experiment Data Table

| Experiment ID | Category | Trials | Completed | Rolled Back | Rollback Failed | Replays | Confirmed Locks | Unresolved Locks | Mean Latency (ms) | P95 Latency (ms) | Throughput (req/s) | Result |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **E01-baseline-success** | 1 | 20 | 20 | 0 | 0 | 0 | 60 | 0 | 405.5 | 500.3 | 2.28 | PASS |
| **E02-first-provider-failure** | 2 | 10 | 0 | 10 | 0 | 0 | 0 | 0 | 223.2 | 291.1 | 4.01 | PASS |
| **E03-failure-after-multiple-reservations** | 3 | 10 | 0 | 10 | 0 | 0 | 0 | 0 | 366.7 | 482.4 | 2.52 | PASS |
| **E04-successful-compensation** | 4 | 10 | 0 | 10 | 0 | 0 | 0 | 0 | 447.6 | 620.4 | 2.14 | PASS |
| **E05-compensation-failure** | 5 | 20 | 0 | 0 | 20 | 0 | 30 | 30 | 367.9 | 493.2 | 2.54 | PASS |
| **E06-payment-authorization-failure** | 6 | 10 | 0 | 10 | 0 | 0 | 0 | 0 | 218.3 | 300.2 | 4.04 | PASS |
| **E07-payment-capture-failure** | 7 | 10 | 0 | 10 | 0 | 0 | 0 | 0 | 430.8 | 502.9 | 2.18 | PASS |
| **E08-duplicate-idempotency** | 8 | 45 | 5 | 5 | 0 | 30 | 15 | 0 | 74.6 | 345.4 | 10.81 | PASS |
| **E09-concurrent-same-idempotency-key** | 9 | 90 | 12 | 0 | 0 | 78 | 36 | 0 | 263.8 | 648.1 | 18.41 | PASS |
| **E10-concurrent-same-resource** | 10 | 30 | 6 | 0 | 0 | 0 | 6 | 0 | 264.0 | 510.5 | 34.63 | PASS |
| **E11-lock-contention** | 11 | 192 | 192 | 0 | 0 | 0 | 384 | 0 | 783.6 | 2045.0 | 8.34 | PASS |
| **E12-multi-provider-failure-points** | 12 | 81 | 12 | 60 | 9 | 0 | 39 | 9 | 221.0 | 540.0 | 4.24 | PASS |
| **E13-risk-under-provider-conditions** | 13 | 48 | 48 | 0 | 0 | 0 | 138 | 0 | 194.3 | 319.1 | 4.69 | PASS |
| **E14-recovery-advisor-classification** | 14 | 27 | 0 | 21 | 6 | 0 | 3 | 3 | 237.3 | 398.1 | 3.95 | PASS |
| **E15-seeded-mixed-workload** | 12 | 40 | 8 | 30 | 2 | 0 | 21 | 2 | 463.7 | 596.7 | 15.55 | PASS |

---

## 5. Research Limitations

The empirical observations reported in this evaluation must be interpreted within the context of the prototype's test environment:
1. **Mock Provider Latency**: Provider adapters return synthesized responses without public internet socket jitter, WAN packet loss, or supplier rate-limiting.
2. **Deterministic Failure Injection**: Failures were injected deterministically to ensure scientific reproducibility; real-world distributed systems experience stochastic, intermittent failures.
3. **Database Concurrency Scale**: Evaluated at concurrency up to $c=20$ and $N=192$ requests per hot row within an in-memory/ephemeral PostgreSQL engine. Multi-node distributed clusters require external load-generator validation.
4. **Advisory Boundaries**: AI components are strictly advisory and do not automatically execute financial transfers or re-booking.

---

## 6. Reproduction Instructions

To reproduce all 15 experiments and regenerate this evaluation:

```bash
cd backend

# Execute all experiments and write machine-readable artifacts
npm run experiments

# Generate evaluation tables and SVG charts
npm run evaluate
```

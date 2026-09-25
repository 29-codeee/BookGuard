# BookGuard – Distributed Transaction Integrity for Multi-Provider Travel

> **"A travel booking is a promise about a thing that only exists once — and we make that promise across systems we do not control."**

**BookGuard** is an open-source, research-grade transaction integrity and orchestration platform for multi-provider travel bookings. It solves the **Distributed Commitment Problem** across autonomous, heterogeneous suppliers (flights, hotels, express trains, and local transfers) without requiring distributed Two-Phase Commit (2PC) ACID locks.

By unifying **PostgreSQL database-backed reservation locks**, a **backward-compensating Saga orchestration engine**, a **durable HTTP idempotency interceptor**, a **deterministic heuristic risk engine**, and an **explainable human-in-the-loop recovery advisor**, BookGuard guarantees zero double-bookings, atomic rollbacks under failure, and safe inventory quarantine when compensations fail.

---

## 📑 Table of Contents
1. [Core Integrity Guarantees & Invariants](#-core-integrity-guarantees--invariants)
2. [Platform Architecture & Engine Components](#-platform-architecture--engine-components)
3. [Repository Directory Structure](#-repository-directory-structure)
4. [Quickstart: Setup & Running](#-quickstart-setup--running)
5. [Database Architecture & Setup](#-database-architecture--setup)
6. [Interactive Demonstration Flows](#-interactive-demonstration-flows)
7. [Automated Testing Suite](#-automated-testing-suite)
8. [Phase 8 Stress & Failure Experiments](#-phase-8-stress--failure-experiments)
9. [Phase 9 Research Evaluation & Findings](#-phase-9-research-evaluation--findings)
10. [Research Limitations & Boundaries](#-research-limitations--boundaries)
11. [Research Paper & In-Depth Documentation](#-research-paper--in-depth-documentation)

---

## 🛡️ Core Integrity Guarantees & Invariants

| Invariant / Guarantee | Mathematical Definition | Enforcement Mechanism |
|:---|:---|:---|
| **Zero Oversell (`OVERSOLD = 0`)** | $\sum (\text{available}) - \sum_{L \in \text{Locks}} L.\text{qty} \ge 0$ | PostgreSQL row-level locks (`FOR UPDATE`) + active reservation locks table |
| **Atomic Multi-Provider Commitment** | $\text{State}(T) \in \{\text{COMPLETED}, \text{ROLLED\_BACK}, \dots\}$ | Sequential forward Saga + reverse LIFO compensation on any failure |
| **Exact Replay Under Network Retry** | $\text{Executions}(Key) \equiv 1$ | 24-hour durable idempotency cache with deep SHA-256 payload hash validation |
| **Payload Tampering Defense** | $\text{Hash}(P_1) \ne \text{Hash}(P_2) \implies \text{HTTP 422}$ | Rejection of payload modifications submitted under an existing idempotency key |
| **Inventory Quarantine on Rollback Failure** | $\text{Compensated}(Item) = \text{False} \implies \text{Lock} = \text{CONFIRMED}$ | Retains unreleased `CONFIRMED` lock during `ROLLBACK_FAILED` to prevent double-selling |
| **Deterministic Risk Intelligence** | $\text{Variance}(\text{Score}(Telemetry)) \equiv 0$ | Mathematical heuristic scoring ($0 \le S \le 100$) evaluating supplier stability |
| **Explainable Recovery Advisories** | $\text{Strategy} \in \{\text{RETRY}, \text{ALTERNATIVE}, \dots\}$ | Rule-based expert system diagnosing failures with calibrated confidence |

---

## 🏗️ Platform Architecture & Engine Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 React + TypeScript Operations Dashboard                     │
│   (Transaction Ops · Saga Timeline · Resource Locks · Recovery Advisory)    │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ HTTP Requests
                                       ▼ (Idempotency-Key Header)
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Fastify Backend Server                             │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ 1. Idempotency Interceptor (Deep SHA-256 Hash Matching)            │   │
│   └──────────────────────────────────┬──────────────────────────────────┘   │
│                                      │                                      │
│   ┌──────────────────────────────────▼──────────────────────────────────┐   │
│   │ 2. PostgreSQL Reservation Locks (ACTIVE provisional holds)          │   │
│   └──────────────────────────────────┬──────────────────────────────────┘   │
│                                      │                                      │
│   ┌──────────────────────────────────▼──────────────────────────────────┐   │
│   │ 3. Deterministic Risk Assessment (Scores 0–100 · LOW/MED/HIGH)      │   │
│   └──────────────────────────────────┬──────────────────────────────────┘   │
│                                      │                                      │
│   ┌──────────────────────────────────▼──────────────────────────────────┐   │
│   │ 4. Distributed Saga Coordinator                                     │   │
│   │    - Sequential Forward Reserve (Hotel -> Flight -> Transport)      │   │
│   │    - Payment Authorization & Escrow                                 │   │
│   │    - Provider Confirmation & Payment Capture                        │   │
│   │    [On Failure]: Reverse LIFO Compensation & Payment Void/Refund    │   │
│   └──────────────────────────────────┬──────────────────────────────────┘   │
│                                      │                                      │
│   ┌──────────────────────────────────▼──────────────────────────────────┐   │
│   │ 5. Recovery Advisor (Diagnoses failures · Quarantines failed locks) │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PostgreSQL Relational Storage Layer                      │
│   - Transaction Engine: 7 tables (transactions, items, locks, events...)    │
│   - Seeded Research Datasets: 21 tables (500 flights, 580 hotels, etc.)    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📁 Repository Directory Structure

```
BookGuard/
├── backend/                              # Fastify + TypeScript backend
│   ├── src/
│   │   ├── ai/                          # Risk assessment & Recovery advisor
│   │   │   ├── transactionRisk.ts       # Deterministic risk engine (Phase 6A)
│   │   │   └── recoveryAdvisor.ts       # Rule-based recovery advisor (Phase 6B)
│   │   ├── db/                          # Database client, migrations, schema
│   │   ├── experiments/                 # Phase 8 runners & Phase 9 evaluation engine
│   │   │   ├── framework.ts             # Harness, metrics, isolation, and reporter
│   │   │   ├── suite.ts                 # 15 research experiment definitions
│   │   │   └── evaluate.ts              # Phase 9 SVG chart generators & analysis
│   │   ├── providers/                   # Dataset-backed mock provider adapters
│   │   ├── routes/                      # REST endpoints (/api/transactions, /api/datasets)
│   │   ├── scripts/                     # CLI runners (runExperiments, evaluateExperiments)
│   │   ├── tests/                       # Automated test suites (95 tests passing)
│   │   └── transactions/                # Saga engine, locking, state machine, payment
│   └── package.json
├── frontend/                             # React + Vite + TypeScript dashboard
│   ├── src/
│   │   ├── components/TransactionOps/   # Phase 7 Operations & Research Dashboard
│   │   └── services/api.ts              # API client and demo scenario submission
│   └── package.json
├── dataset/                              # 20 research CSV datasets (flights, hotels, etc.)
├── db/                                   # SQL migrations and seed scripts
├── docs/                                 # Technical architecture specifications
│   ├── TRANSACTION_SAGA_ENGINE.md       # Full Saga and lock lifecycle documentation
│   └── BOOKING_ENGINE.md                # Legacy single-item hold specification
├── experiments/                          # Experiment outputs and research artifacts
│   ├── results/                         # Raw Phase 8 CSVs and run.json outputs
│   └── evaluation/                      # Phase 9 research tables and vector SVG charts
├── DEMO_GUIDE.md                         # Step-by-step interactive demonstration guide
├── RESEARCH_PAPER.md                     # Academic research paper on BookGuard findings
└── README.md                             # This executive document
```

---

## 🚀 Quickstart: Setup & Running

### Prerequisites
- **Node.js**: `v18.0.0` or higher (tested on `v25.4.0`)
- **npm**: `v9.0.0` or higher
- *(Optional)* **Docker**: For running native PostgreSQL on port `5433`

### 1. Install Dependencies
```bash
# In the project root
npm install

# In backend
cd backend && npm install

# In frontend
cd ../frontend && npm install
```

### 2. Start the Backend Server
```bash
cd backend
npm run dev
```
*The backend starts on `http://localhost:3000`. If PostgreSQL is not running on port 5433, it automatically falls back to an embedded in-memory PostgreSQL engine (PGlite WASM) with all SQL schemas and datasets seeded automatically.*

### 3. Start the Frontend Dashboard
```bash
cd frontend
npm run dev
```
*Open your browser to `http://localhost:5173/transaction-ops`.*

---

## 🗄️ Database Architecture & Setup

BookGuard supports both **Docker-hosted native PostgreSQL** and **Embedded In-Memory PostgreSQL (PGlite)**:

- **Connection URL**: `postgresql://postgres:postgrespassword@localhost:5433/bookguard?schema=public`
- **7 Transaction Engine Tables**:
  - `booking_transactions`
  - `booking_transaction_items`
  - `booking_resource_locks`
  - `booking_transaction_providers`
  - `booking_transaction_events`
  - `booking_transaction_risk_assessments`
  - `booking_transaction_recovery_advisories`
- **21 Seeded Research Dataset Tables**:
  - `dataset_hotels` (580 rows), `dataset_flights` (500 rows), `dataset_activities` (500 rows), `dataset_vehicles` (500 rows), `dataset_customers` (1000 rows), `dataset_booking_records` (4000 rows), etc.

To initialize or verify the PostgreSQL database:
```bash
cd backend
node --import tsx src/scripts/verifyDb.ts
```

---

## 🎬 Interactive Demonstration Flows

BookGuard includes four built-in, deterministic demo scenarios accessible directly from the **Transaction Ops** dashboard (`/transaction-ops`):

1. **Successful Multi-Provider Booking**:
   - Submits a bundled Hotel + Flight + Transport booking.
   - Demonstrates risk scoring (`LOW`, 30/100), provisional locking (`ACTIVE`), forward provider reservations, two-phase payment (authorize $\to$ capture), and promotion to permanent `CONFIRMED` locks.
2. **Provider Failure & Automatic Rollback**:
   - Transport provider fails during forward reservation.
   - Demonstrates immediate halt, reverse LIFO compensation (Flight cancelled $\to$ Hotel cancelled), payment voiding, and lock release (`RELEASED`).
3. **Compensation Failure & Lock Quarantine (`ROLLBACK_FAILED`)**:
   - Transport fails and Flight cancellation is rejected by the airline.
   - Demonstrates terminal transition to `ROLLBACK_FAILED`, unreleased `CONFIRMED` lock retention to quarantine capacity, and automatic generation of a `MANUAL_OPERATOR_REVIEW` advisory.
4. **Idempotency Protection**:
   - Demonstrates instant, byte-identical replays on duplicate network requests and HTTP 422 rejection on payload tampering.

*See [`DEMO_GUIDE.md`](DEMO_GUIDE.md) for full screenshots and cURL equivalents.*

---

## 🧪 Automated Testing Suite

BookGuard maintains a comprehensive, non-flaky automated test suite covering all layers:

### Running All Backend Tests (95 passing tests)
```bash
cd backend
npm test
```
*Executes transaction phase tests, Saga orchestration, API idempotency, risk scoring, recovery advisories, dashboard endpoints, experiment runners, and Phase 9 evaluation parsers.*

### Running Frontend Tests (35 passing tests)
```bash
cd frontend
npm test
```
*Executes unit and integration tests across the Transaction Ops dashboard, timeline builder, and state models.*

---

## 📊 Phase 8 Stress & Failure Experiments

The Phase 8 experiment framework (`backend/src/experiments/`) executes 15 distinct research experiments measuring system behavior under concurrency, failures, and contention.

To execute all 15 experiments:
```bash
cd backend
npm run experiments
```
*Generates machine-readable `run.json`, `summary.csv`, `variants.csv`, `trials.csv`, and `criteria.csv` in `experiments/results/<run_id>/`.*

---

## 📈 Phase 9 Research Evaluation & Findings

Phase 9 transforms empirical Phase 8 measurements ($N = 643$ transactional trials) into publication-ready research tables and vector SVG charts.

To reproduce the Phase 9 evaluation:
```bash
cd backend
npm run evaluate
```

### Empirical Results Table ($N = 643$ Trials)

| Experiment ID | Cat | Requests ($N$) | Completed | Rolled Back | Rollback Failed | Replays | Confirmed Locks | Mean Latency | P95 Latency | Result |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **E01-baseline-success** | 1 | 20 | 20 | 0 | 0 | 0 | 60 | 405.5 ms | 500.3 ms | PASS |
| **E02-first-provider-failure** | 2 | 10 | 0 | 10 | 0 | 0 | 0 | 223.2 ms | 291.1 ms | PASS |
| **E03-failure-after-multiple-reservations** | 3 | 10 | 0 | 10 | 0 | 0 | 0 | 366.7 ms | 482.4 ms | PASS |
| **E04-successful-compensation** | 4 | 10 | 0 | 10 | 0 | 0 | 0 | 447.6 ms | 620.4 ms | PASS |
| **E05-compensation-failure** | 5 | 20 | 0 | 0 | 20 | 0 | 30 | 367.9 ms | 493.2 ms | PASS |
| **E06-payment-authorization-failure** | 6 | 10 | 0 | 10 | 0 | 0 | 0 | 218.3 ms | 300.2 ms | PASS |
| **E07-payment-capture-failure** | 7 | 10 | 0 | 10 | 0 | 0 | 0 | 430.8 ms | 502.9 ms | PASS |
| **E08-duplicate-idempotency** | 8 | 45 | 5 | 5 | 0 | 30 | 15 | 74.6 ms | 345.4 ms | PASS |
| **E09-concurrent-same-idempotency-key** | 9 | 90 | 12 | 0 | 0 | 78 | 36 | 263.8 ms | 648.1 ms | PASS |
| **E10-concurrent-same-resource** | 10 | 30 | 6 | 0 | 0 | 0 | 6 | 264.0 ms | 510.5 ms | PASS |
| **E11-lock-contention** | 11 | 192 | 192 | 0 | 0 | 0 | 384 | 783.6 ms | 2045.0 ms | PASS |
| **E12-multi-provider-failure-points** | 12 | 81 | 12 | 60 | 9 | 0 | 39 | 221.0 ms | 540.0 ms | PASS |
| **E13-risk-under-provider-conditions** | 13 | 48 | 48 | 0 | 0 | 0 | 138 | 194.3 ms | 319.1 ms | PASS |
| **E14-recovery-advisor-classification** | 14 | 27 | 0 | 21 | 6 | 0 | 3 | 237.3 ms | 398.1 ms | PASS |
| **E15-seeded-mixed-workload** | 12 | 40 | 8 | 30 | 2 | 0 | 21 | 463.7 ms | 596.7 ms | PASS |
| **TOTAL** | — | **643** | **303** | **146** | **37** | **108** | **732** | — | — | **15/15 PASS** |

### Generated Research Visualizations
Located in [`experiments/evaluation/`](experiments/evaluation/):
- **Latency Distribution Chart**: `chart_latency_by_scenario.svg`
- **Concurrency & Throughput Scaling**: `chart_concurrency_scaling.svg`
- **Deterministic Risk Scoring Distribution**: `chart_risk_scores.svg`
- **Recovery Advisor Rule Accuracy**: `chart_recovery_classification.svg`
- **Zero-Oversell Resource Contention**: `chart_lock_contention.svg`

---

## ⚠️ Research Limitations & Boundaries

1. **Mock Provider Latency**: Downstream provider operations are simulated using in-process HTTP mock adapters. Real WAN socket latency, DNS jitter, and external rate-limiting are not captured.
2. **Deterministic Fault Injection**: Errors are injected via deterministic control headers (`x-mock-fail-phase`). Real-world network faults are stochastic and intermittent.
3. **Concurrency Scale**: Evaluated at concurrency up to $c=20$ and $N=643$ total requests on a single multi-core host. Multi-region cluster deployments were not evaluated.
4. **Advisory Boundaries**: AI components (Risk Intelligence and Recovery Advisor) are strictly heuristic and advisory; they do not autonomously transfer money or re-book inventory without operator confirmation.

---

## 📚 Research Paper & In-Depth Documentation

- 📄 **Full Research Paper**: [`RESEARCH_PAPER.md`](RESEARCH_PAPER.md)
- 🎮 **Demonstration Walkthrough**: [`DEMO_GUIDE.md`](DEMO_GUIDE.md)
- ⚙️ **Transaction Engine Specification**: [`docs/TRANSACTION_SAGA_ENGINE.md`](docs/TRANSACTION_SAGA_ENGINE.md)
- 🗄️ **Database Schema & Datasets**: [`DATABASE.md`](DATABASE.md)
- 📊 **Phase 9 Empirical Evaluation**: [`experiments/evaluation/RESEARCH_EVALUATION.md`](experiments/evaluation/RESEARCH_EVALUATION.md)

---

*BookGuard is developed for the KogniVera Hackathon 2026 by Team Ctrl Alt Elite.*

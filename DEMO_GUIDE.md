# BookGuard Interactive Demonstration Guide

This guide provides step-by-step instructions for demonstrating BookGuard's transaction integrity, Saga orchestration, deterministic risk assessment, and human-in-the-loop recovery intelligence.

Demonstrations can be performed through:
1. **Interactive Operations Dashboard Web UI** (`http://localhost:5173/transaction-ops`)
2. **Headless cURL / HTTP API Calls** directly against `http://localhost:3000`

---

## Prerequisites & Launching the Services

Ensure the backend and frontend are running:

### Terminal 1: Backend Server
```bash
cd backend
npm run dev
```
*Backend starts on `http://localhost:3000`. By default, it connects to PostgreSQL on `localhost:5433` (or falls back to in-memory PGlite with full schema and seed data).*

### Terminal 2: Frontend Dashboard
```bash
cd frontend
npm run dev
```
*Frontend starts on `http://localhost:5173`.*

Open your browser to:
👉 **`http://localhost:5173/transaction-ops`** (or click **Transaction Ops** in the top navigation bar).

---

## Demonstration 1: Multi-Provider Successful Booking

This scenario demonstrates the complete forward Saga pipeline: risk assessment $\to$ provisional reservation locks $\to$ sequential provider reservations $\to$ payment authorization $\to$ final confirmation $\to$ payment capture $\to$ lock promotion to `CONFIRMED`.

### In the Web Dashboard:
1. Scroll down to the **Demo Scenarios** panel on the Transaction Ops page.
2. If scenarios are hidden, click **Show scenarios**.
3. Locate **Successful Booking** (`FailureScenarios.scenarioC`).
4. Click **Run scenario…**. A confirmation dialog appears explaining that this will submit a real request to `POST /api/transactions`.
5. Click **Confirm & Run**.
6. The dashboard automatically loads the newly created transaction.

### What to Observe:
- **Transaction Overview**: Status is **`COMPLETED`** with green badge. Total amount and currency (INR) are displayed.
- **Risk Assessment Card**:
  - Score: **30 / 100** (`LOW`).
  - Recommended Action: **`PROCEED`**.
  - Risk Factors: Shows breakdown (3 providers in bundle $\to$ $+30$ complexity).
- **Resource Locks Panel**:
  - Exactly 3 locks: Hotel, Flight, Transport.
  - Status for all three: **`CONFIRMED`** (permanent allocation).
  - Expiry: Displays timestamp.
- **Provider Operations Table**:
  - Hotel: `RESERVED` $\to$ `CONFIRMED`.
  - Flight: `RESERVED` $\to$ `CONFIRMED`.
  - Transport: `RESERVED` $\to$ `CONFIRMED`.
- **Payment Lifecycle Panel**:
  - Status: **`CAPTURED`**.
  - Events: Authorization followed by Capture.
- **Saga Timeline**:
  - Chronological event timeline showing forward steps: `TRANSACTION_CREATED` $\to$ `LOCKS_ACQUIRED` $\to$ `PROVIDER_RESERVE_SUCCESS` $\times 3$ $\to$ `PAYMENT_AUTHORIZED` $\to$ `PROVIDER_CONFIRM_SUCCESS` $\times 3$ $\to$ `PAYMENT_CAPTURED` $\to$ `TRANSACTION_COMPLETED`.

---

## Demonstration 2: Provider Failure & Automatic Backward Compensation

This scenario demonstrates what happens when a downstream provider fails midway through execution (transport fails after hotel and flight have already reserved).

### In the Web Dashboard:
1. In the **Demo Scenarios** panel, locate **Provider Failure → Rollback Success** (`FailureScenarios.scenarioD`).
2. Click **Run scenario…** $\to$ **Confirm & Run**.
3. The dashboard loads the newly rolled-back transaction.

### What to Observe:
- **Transaction Overview**: Status is **`ROLLED_BACK`** with amber badge.
- **Provider Operations Table**:
  - Hotel: `RESERVED` $\to$ **`CANCELLED`** (Compensated in reverse order).
  - Flight: `RESERVED` $\to$ **`CANCELLED`** (Compensated in reverse order).
  - Transport: **`FAILED`** (Injected failure reason: `"Simulated transport failure: scenario D"`).
- **Resource Locks Panel**:
  - All 3 locks show status **`RELEASED`**.
  - **Zero Leaked Capacity**: The resources are immediately freed and available for other travellers.
- **Payment Lifecycle Panel**:
  - Status: **`REFUNDED`** or **`VOIDED`**.
- **Saga Timeline**:
  - Forward reservation stops immediately when transport fails.
  - Reverse compensation begins: Flight cancelled $\to$ Hotel cancelled $\to$ Locks released $\to$ `TRANSACTION_ROLLED_BACK`.

---

## Demonstration 3: Compensation Failure & Lock Quarantine (`ROLLBACK_FAILED`)

This scenario demonstrates BookGuard's containment mechanism when an external supplier rejects cancellation.

### In the Web Dashboard:
1. In the **Demo Scenarios** panel, locate **Rollback Failure** (`FailureScenarios.scenarioE`).
2. Click **Run scenario…** $\to$ **Confirm & Run**.
3. The dashboard loads the `ROLLBACK_FAILED` transaction.

### What to Observe:
- **Transaction Overview**: Status is **`ROLLBACK_FAILED`** with red badge.
- **Provider Operations Table**:
  - Hotel: **`CANCELLED`** (successfully compensated).
  - Flight: **`RESERVED` / `COMPENSATION_FAILED`** (flight cancellation was rejected by supplier).
  - Transport: **`FAILED`**.
- **Resource Locks Panel**:
  - Hotel lock: `RELEASED`.
  - Flight lock: **`CONFIRMED`** (Retained unreleased!).
  - A persistent visual warning alert appears:
    > ⚠️ **Unreleased Confirmed Locks Detected**  
    > Flight lock remains `CONFIRMED` to quarantine capacity and prevent double-booking until manual operator reconciliation.
- **Recovery Advisory Card**:
  - Category: **`COMPENSATION_FAILURE`**.
  - Strategy: **`MANUAL_OPERATOR_REVIEW`** (Severity: `HIGH`, Confidence: `98%`).
  - Guidance: *"Flight cancellation was rejected by supplier. Do not release database lock until supplier confirms seat release."*

---

## Demonstration 4: Headless cURL Demonstrations

You can execute identical scenarios from the terminal:

### 1. Successful Booking via cURL:
```bash
curl -X POST http://localhost:3000/api/transactions \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: demo-success-001" \
  -d '{
    "customerId": "CUST-0001",
    "items": [
      { "type": "hotel", "resourceId": "ROOM-0001", "quantity": 1 },
      { "type": "flight", "resourceId": "FLIGHT-0001", "quantity": 1 }
    ],
    "paymentMethod": "card_mock"
  }'
```

### 2. Idempotent Duplicate Replay via cURL:
Execute the exact same cURL command a second time:
```bash
curl -X POST http://localhost:3000/api/transactions \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: demo-success-001" \
  -d '{
    "customerId": "CUST-0001",
    "items": [
      { "type": "hotel", "resourceId": "ROOM-0001", "quantity": 1 },
      { "type": "flight", "resourceId": "FLIGHT-0001", "quantity": 1 }
    ],
    "paymentMethod": "card_mock"
  }'
```
*Notice that response returns instantly with the exact same `transactionId`, without creating a new transaction in the database.*

### 3. Conflicting Payload Rejection via cURL:
Submit a modified body with the same idempotency key:
```bash
curl -X POST http://localhost:3000/api/transactions \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: demo-success-001" \
  -d '{
    "customerId": "CUST-0001",
    "items": [
      { "type": "hotel", "resourceId": "ROOM-0001", "quantity": 2 }
    ],
    "paymentMethod": "card_mock"
  }'
```
*HTTP 422 Unprocessable Entity is returned immediately with error code `IDEMPOTENCY_KEY_REUSED`.*

---

## Demonstration 5: Inspecting Research Evaluation Artifacts

To view the publication-ready charts generated in Phase 9:
1. Open the [`experiments/evaluation/`](file:///c:/Users/Shreya/OneDrive/Desktop/BookGuard/experiments/evaluation/) folder.
2. View the vector SVG charts in any modern browser:
   - `chart_latency_by_scenario.svg`
   - `chart_concurrency_scaling.svg`
   - `chart_risk_scores.svg`
   - `chart_recovery_classification.svg`
   - `chart_lock_contention.svg`
3. Review [`experiments/evaluation/RESEARCH_EVALUATION.md`](file:///c:/Users/Shreya/OneDrive/Desktop/BookGuard/experiments/evaluation/RESEARCH_EVALUATION.md) for the structured metric breakdown.

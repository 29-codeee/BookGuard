# BookGuard – Real-Time Booking Integrity for Travel
### KogniVera Hackathon 2026 | Team: Ctrl Alt Elite

> **"A travel booking is a promise about a thing that only exists once — and we make that promise across systems we do not control."**

**BookGuard** is an enterprise-grade travel orchestration and booking integrity platform. It eliminates **overselling, double-bookings, stuck holds, and uncoordinated multi-leg trip failures** across high-demand travel systems (Flights, IRCTC Express Trains, RedBus Sleeper Buses, Luxury Stays, and Bundled Vacation Packages).

---

## 📑 Table of Contents
1. [Project Summary & Problem Solved](#-project-summary--problem-solved)
2. [Core Integrity Guarantees](#-core-integrity-guarantees)
3. [Multi-Modal Real-Time Travel Dataset](#-multi-modal-real-time-travel-dataset)
4. [Platform Architecture](#-platform-architecture)
5. [How to Run (Quickstart)](#-how-to-run-quickstart)
6. [User Guide: Navigating the Platform](#-user-guide-navigating-the-platform)
7. [API Reference](#-api-reference)
8. [Directory Structure](#-directory-structure)
9. [Troubleshooting & FAQs](#-troubleshooting--faqs)

---

## 🎯 Project Summary & Problem Solved

### The Problem
During peak booking periods (e.g., Tatkal train tickets, festival flights, or last oceanfront hotel suites), two or more users often attempt to purchase the exact same seat or room at the exact same millisecond. Traditional web applications charge both users and then initiate awkward, delayed cancellation refunds for the loser. Furthermore, if a traveller books a connected multi-leg trip (e.g., flight + hotel in Goa) and the flight gets cancelled, the non-refundable hotel booking is stranded, causing financial loss to either the customer or the partner.

### The BookGuard Solution
1. **Zero Double-Bookings**: Millisecond race conditions are resolved atomically at the database layer using PostgreSQL row-level locks (`SELECT ... FOR UPDATE`) paired with strict check constraints (`available_quantity >= 0`).
2. **10-Minute Atomic Hold Locks**: Like Ticketmaster and BookMyShow, selecting a seat/room reserves an exclusive 10-minute hold lock backed by Redis TTL and database tracking. No other user can snatch the seat during checkout.
3. **Automatic Restock Sweeper**: If a traveller closes the browser tab or abandons checkout, background sweepers immediately restock the inventory back to the available pool.
4. **Intelligent Multi-Modal Fallbacks**: If a specific travel category has no direct route, the platform proactively surfaces alternate high-speed options (e.g., flights or sleeper buses) so travellers never face a dead-end "0 found" screen.
5. **Trip Sentinel & SAGA Compensation**: If a flight leg is cancelled, BookGuard automatically searches for alternative flights to protect the hotel stay. If declined, it issues a 100% customer refund AND disburses compensation to the hotel partner to safeguard partner revenue.

---

## 🛡️ Core Integrity Guarantees

| Invariant / Guarantee | Enforcement Mechanism |
| :--- | :--- |
| **`OVERSOLD = 0`** | PostgreSQL row-level locks (`FOR UPDATE`) + SQL `CHECK (available_quantity >= 0)` |
| **`DUPLICATE BOOKINGS = 0`** | Durable `idempotency_keys` table replaying byte-identical responses on network retries |
| **`SYSTEM BALANCE INVARIANT`** | `available_quantity + held_quantity + confirmed_quantity == total_quantity` |
| **No Stuck Holds** | Dual Redis TTL keyspace expiry + periodic background hold sweeper (auto-restock) |
| **Timeout != Failure** | Provider network dropouts transition bookings to `RECONCILING` without dropping the hold |
| **Two-Leg SAGA Guarantee** | If one leg of a connected trip fails, compensating transactions auto-refund or rebook |
| **Multilingual Accessibility** | Native on-the-fly switching between **English**, **Hindi (हिन्दी)**, and **Kannada (ಕನ್ನಡ)** |

---

## ✈️ Multi-Modal Real-Time Travel Dataset

BookGuard includes comprehensive Indian travel inventory covering **all 8 major metropolitan sectors**:
- **Bengaluru (`BLR`)** • **Goa (`GOI`)** • **New Delhi (`DEL`)** • **Mumbai (`BOM`)**
- **Hyderabad (`HYD`)** • **Jaipur (`JAI`)** • **Kochi / Kerala (`COK`)** • **Chennai (`MAA`)**

### Included Inventory Categories
1. **Flights**: Real flight numbers and schedules across **IndiGo Express**, **Air India**, **Vistara Prime**, and **Akasa Air** (e.g., `6E 511`, `UK 879`, `AI 806`, `QP 1302`).
2. **IRCTC Trains**: Real express and high-speed rail across **Vande Bharat Express** (Executive Chair Car), **Tejas Mumbai Rajdhani** (1st & 2-Tier AC), **Shatabdi Express**, and **Duronto Express** (e.g., `VB 20641`, `RAJ 12951`, `SHAT 12009`).
3. **RedBus Sleeper Buses**: Multi-axle Volvo and electric sleepers from **SRS Travels**, **VRL Logistics**, **IntrCity SmartBus**, **Zingbus**, and **Orange Tours**.
4. **Hotels & Luxury Resorts**: 5-star heritage palaces and beachfront villas in every destination city (e.g., *Royal Heritage Oceanfront Suite* in Goa, *The Taj Mahal Palace* in Mumbai, *The Leela Palace* in Delhi, *The Oberoi Rajvilas* in Jaipur, *Kumarakom Lake Resort* in Kerala).
5. **Curated Vacation Bundles**: Multi-leg itineraries combining flights/trains + luxury stays + local transfers with single-click atomic checkout.

---

## 🏗️ Platform Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 React + TypeScript Frontend                 │
│   (Explore & Book, My Trips, Trip Sentinel, SRE Dashboard)  │
└──────────────┬───────────────────────────────▲──────────────┘
               │ HTTP Requests                 │ Live SSE Events
               ▼                               │ (/api/events)
┌──────────────────────────────────────────────┴──────────────┐
│                    Fastify Node.js Backend                  │
│  - Hold Manager (TTL timer & sweeper)                       │
│  - Idempotency & Concurrency Interceptor                    │
│  - SAGA Compensation & Disruption Resolver                  │
└──────────────┬───────────────────────────────▲──────────────┘
               │                               │
       PostgreSQL (PGlite WASM)           In-Memory Redis
  - ACID Row-Level Locks ('FOR UPDATE')   - Hold Keys ('hold:<id>')
  - Check Constraints & Invariant Views   - Keyspace Expiry Callbacks
```

---

## 🚀 How to Run (Quickstart)

### Prerequisites
- **Node.js** (v18.0.0 or higher recommended)
- **npm** (v9.0.0 or higher)

### 1. Clone & Install Dependencies
Open a terminal in the project root:
```bash
# Install root dependencies
npm install

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
cd ..
```

### 2. Start the Application
You can start both backend and frontend concurrently from the root directory:
```bash
npm run dev
```

Alternatively, open two separate terminal windows:
```bash
# Terminal 1: Start Backend Engine (Port 3001)
cd backend
npm run dev
```
```bash
# Terminal 2: Start Frontend Application (Port 3000)
cd frontend
npm run dev
```

### 3. Open in Browser
Visit **`http://localhost:3000/`** in your browser.

> **Note on Database**: BookGuard automatically runs with an embedded PostgreSQL engine (**PGlite WASM**), so **no external Docker or Postgres installation is required** to run out-of-the-box!

---

## 🖥️ User Guide: Navigating the Platform

### 0. 🤖 AI Planner (chatbot)
Type a request such as *"I want to visit Goa for 3 days with 2 friends"*. The planner asks only for missing details, builds a day-by-day itinerary, and suggests stays, transport and places. You can then adjust it by chatting ("show cheaper hotels", "add a train", "make it 4 days") or with the card buttons (Select / Book / Change / Remove). **Book** creates a demo booking request for the booking modules; items from live inventory are reserved through the booking engine. The **Current Trip Plan** panel updates as the conversation changes the plan.

- **AI mode:** put `ANTHROPIC_API_KEY` in `backend/.env` (see `backend/.env.example`). Keys stay on the server.
- **Demo mode:** with no key, an offline extractor keeps the chatbot fully working with sample data.

Details, API formats and teammate integration: **[docs/AI_TRAVEL_PLANNER.md](docs/AI_TRAVEL_PLANNER.md)**.

### 1. 🌴 Explore & Book (`/`)
- **Category Filter Tabs**: Switch seamlessly between **All Modes**, **Flights**, **IRCTC Trains**, **RedBus Buses**, **Hotels & Stays**, and **Holiday Bundles**.
- **Search Console**: Select origin and destination cities, travel date, and passenger count.
- **Popular Sector Chips**: Click chips like `Bengaluru ➔ Goa`, `Delhi ➔ Mumbai`, or `Delhi ➔ Jaipur` to immediately filter verified routes.
- **Dynamic Trip Cart**: Click `+` on multiple legs (e.g., flight + hotel) to bundle them into a single custom itinerary.
- **Real-Time Hold Lock**:
  - Click **"Book Direct"** on any item.
  - BookGuard immediately claims an exclusive row lock and triggers a **10-minute hold countdown** (`🔒 Held Exclusively For You (09:59)`).
  - Enter passenger details and complete confirmation.

### 2. 🧳 My Trips
- View all confirmed bookings, active holds, and generated PNRs.
- Inspect digital boarding passes and hotel check-in vouchers.
- Cancel bookings or download booking summaries.

### 3. ⚡ Trip Sentinel & Disruption Protection
- Experience automated multi-leg protection:
  - Select an active connected trip (e.g., Flight + Hotel in Goa).
  - Click **"Simulate Airline Disruption"** to trigger a real-time flight cancellation.
  - The Sentinel automatically detects the orphaned hotel stay and surfaces alternate flights to keep the vacation intact.
  - If rejected, BookGuard executes a **Two-Leg SAGA Compensation**:
    - Issues a 100% full refund to the traveller.
    - Automatically disburses compensation to the hotel partner to safeguard hotel revenue.
    - Records the entire transaction in an immutable audit ledger.

### 4. ⚙️ Ops & Invariants (Live SRE Monitoring)
- Real-time verification of the fundamental database equation:
  $$\text{Total Units} = \text{Available Units} + \text{Held Units} + \text{Confirmed Units}$$
- Live counters verifying **Oversold = 0** and **Duplicate Bookings = 0**.
- Live State Board showing real-time booking transitions via Server-Sent Events (SSE).

---

## 📡 API Reference

### Inventory Endpoints
- `GET /api/inventory` — Fetch all inventory items with computed invariant flags.
- `GET /api/inventory/search` — Search multi-modal inventory with origin, destination, date, and price filters.
- `GET /api/inventory/:id` — Single item with live counters and active holds.
- `GET /api/inventory/invariants` — Authoritative audit check verifying system-wide mathematical consistency (per-row violations, hold-ledger cross-check, measured duplicate confirmations).

### Booking & Concurrency Endpoints
- `POST /api/bookings/hold` — Atomically lock and reserve inventory for 10 minutes (`SELECT ... FOR UPDATE`). Optional `Idempotency-Key` header makes retries safe.
  ```json
  { "travellerId": "traveller_priya", "inventoryId": "flt_blr_goi_ix6534", "quantity": 1, "ttlSeconds": 600 }
  ```
- `POST /api/bookings/confirm` — Confirm booking idempotently with `Idempotency-Key` header.
- `GET /api/bookings/:id/status` — Booking state, hold countdown, allowed transitions.
- `POST /api/bookings/:id/release` — Release a hold before payment (`HELD → RELEASED`).
- `POST /api/bookings/cancel` — Cancel a confirmed booking and restock inventory (idempotent).
- `GET /api/bookings/:id` — Fetch complete booking details, items, and status.

### High-Demand / Tatkal Prepared Booking
- `POST /api/prepared-bookings`, `PUT /api/prepared-bookings/:id/{trip|passengers|selection|payment|window}` — Prepare everything before the booking window.
- `POST /api/prepared-bookings/:id/approve` — Explicit user approval (only once the window is open).
- `POST /api/prepared-bookings/:id/execute` — Hold through the standard engine (idempotent); then pay and confirm via `POST /api/bookings/confirm`.

Full lifecycle, guarantees, error codes and schema changes: **[docs/BOOKING_ENGINE.md](docs/BOOKING_ENGINE.md)**.

### Tests
```bash
cd backend
npm test                     # booking engine suite (embedded PGlite)
DATABASE_URL=postgres://... npm test   # same suite on real PostgreSQL (drops & recreates schema!)
npm run test:concurrency     # 500 virtual users vs limited seats
```

### Sentinel & Compensation Endpoints
- `POST /api/trip/disruption-simulate` — Simulate airline disruption for a multi-leg itinerary.
- `POST /api/trip/resolve-disruption` — Accept alternate flight or trigger partner compensation.
- `GET /api/trip/audit-ledger` — Retrieve financial compensation audit trail.

### AI Travel Planner (Chatbot)
- `POST /api/chat`: `{ sessionId?, message }` → reply, updated trip state, recommendations, booking request.
- `POST /api/chat/action`: card buttons (`select | book | remove | change | cheaper | add`).
- `POST /api/travel-plan`, `GET /api/recommendations`: structured planning without chat.
- `POST /api/booking-request`, `GET /api/booking-requests`, `PATCH /api/booking-requests/:id`: hand-off to hotel / transport / payment modules.

### Real-Time Streams
- `GET /api/events` — Server-Sent Events (SSE) stream for live inventory updates, state transitions, and hold expiries.

---

## 📂 Directory Structure

```
BookGuard/
├── backend/                  # Fastify Node.js API
│   ├── src/
│   │   ├── config.ts         # Environment & database configuration
│   │   ├── db/client.ts      # PostgreSQL connection pool & PGlite fallback
│   │   ├── redis/            # Hold manager, TTL sweeper & memory store
│   │   ├── routes/           # REST endpoints (inventory, bookings, compensation)
│   │   ├── server.ts         # Fastify server bootstrap & CORS
│   │   └── sse/eventHub.ts   # Server-Sent Events real-time broadcast
│   └── package.json
│
├── frontend/                 # Vite + React + TypeScript App
│   ├── src/
│   │   ├── App.tsx           # Main application state & view routing
│   │   ├── components/
│   │   │   ├── Navbar.tsx    # Navigation bar & multilingual switcher
│   │   │   ├── TravelPortal/ # Real-time search hero & checkout modals
│   │   │   ├── TripGuide/    # Multi-modal inventory grid & trip cart
│   │   │   ├── TripSentinel/ # Disruption simulator & compensation view
│   │   │   └── OpsDashboard/ # Live state board & invariant monitor
│   │   ├── services/api.ts   # Frontend API client
│   │   └── i18n/             # Multilingual dictionaries (EN, HI, KN)
│   ├── vite.config.ts        # Vite dev server & proxy (/api -> 3001)
│   └── package.json
│
├── db/                       # Authoritative SQL Schemas & Seeds
│   ├── schema.sql            # Table definitions, CHECK constraints, and views
│   └── seed.sql              # Realistic 8-metro Indian travel inventory
│
├── README.md                 # Complete project guide and documentation
└── package.json              # Root package with concurrent dev scripts
```

---

## ❓ Troubleshooting & FAQs

#### Q1: Port 3000 or 3001 is already in use
If another application is using port 3000 or 3001:
- You can change the frontend port in `frontend/vite.config.ts`.
- You can change the backend port in `backend/.env` by setting `PORT=3005`.

#### Q2: Search shows "0 found" when searching
- Ensure that the origin and destination belong to the supported sectors or click one of the **Popular Sector Chips** (`Bengaluru ➔ Goa`, `Delhi ➔ Mumbai`, `Delhi ➔ Jaipur`).
- If no direct service exists in a selected mode (e.g. no direct train between two distant cities), BookGuard will display alternative high-speed modes (flights/buses) or offer a one-click button to view all Indian sectors.

#### Q3: How do I reset the inventory back to default?
- In the web application, navigating or refreshing resets any completed test bookings.
- Alternatively, send a `POST` request to `http://localhost:3001/api/demo/reset` to restore the clean database state.

---

### Developed by Team Ctrl Alt Elite for KogniVera Hackathon 2026
*Zero Oversold • Guaranteed Seats • Smart Disruption Protection*

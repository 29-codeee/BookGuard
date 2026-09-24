# AI Travel Planner Chatbot

The chatbot is the user's conversational entry point to BookGuard:

```
User → AI Chatbot → Travel Plan → Booking Options → User Selection → Booking Request → Booking Module
```

It understands natural-language requests, asks only for missing details, builds a day-by-day itinerary, recommends stays, transport and places, updates the plan as the user changes it, and hands bookings off as **demo booking requests**. It never completes a real booking or payment.

- UI: **🤖 AI Planner** tab (`frontend/src/components/AiPlanner/`)
- Backend: `backend/src/chat/` + `backend/src/routes/chat.ts`
- Tests: `backend/src/tests/chat.test.ts` (runs offline)

---

## 1. Running it

```bash
cd backend && npm install && npm run dev        # API on :3001 (embedded Postgres if no DATABASE_URL)
cd frontend && npm install && npm run dev       # UI on :3000, proxies /api to :3001
```

Open http://localhost:3000 and click **AI Planner**.

### AI mode vs demo mode

| Mode | When | Understanding |
|---|---|---|
| **AI mode** | `ANTHROPIC_API_KEY` is set in `backend/.env` | Claude (`claude-opus-5` by default, override with `CHAT_AI_MODEL`) returns a schema-validated `TravelIntent` via structured outputs |
| **Demo mode** | No key, or `CHAT_AI_MODE=demo` | Offline rule-based extractor that returns the same `TravelIntent` shape |

If the AI service fails mid-conversation (network, rate limit, bad key, refusal), that turn automatically falls back to demo understanding. The reply carries an `aiNotice` telling the user. The UI header shows which mode the server runs in.

Copy `backend/.env.example` to `backend/.env`. Keys are only read by the backend and never reach the browser.

---

## 2. Architecture

```
routes/chat.ts                       HTTP API
   │
chat/orchestrator.ts                 conversation + orchestration
   ├── chat/llmExtractor.ts          AI service (Claude structured outputs)
   ├── chat/demoExtractor.ts         offline fallback, same output shape
   │        ↓ TravelIntent
   ├── chat/planner.ts               travel-plan state: missing fields, itinerary, estimate
   ├── chat/catalog.ts               recommendations (BookGuard inventory + demo data)
   └── chat/bookingGateway.ts        booking requests → module registry → booking modules
```

The LLM **only interprets language**. Places, hotels, fares, availability, estimates and booking status all come from the catalog, planner and gateway, so the assistant cannot invent prices or confirmations.

### Structured intent (`TravelIntent`)

```json
{
  "intent": "plan_trip",
  "destination": "Goa",
  "origin": "Bengaluru",
  "startDate": "2026-10-10",
  "durationDays": 3,
  "durationDelta": null,
  "travellers": 3,
  "travellersDelta": null,
  "budgetTier": "medium",
  "budgetAmount": null,
  "preferences": ["beach"],
  "target": null,
  "transportMode": null,
  "optionIndex": null,
  "optionId": null,
  "optionWhich": null,
  "pendingField": null,
  "missingInformation": [],
  "action": "generate_itinerary",
  "reply": null
}
```

The same shape is used for booking, for example `{"intent": "book", "target": "hotel", "optionId": "demo-goa-mid-01", "action": "create_booking_request", ...}`.

Intents: `plan_trip`, `provide_info`, `modify_trip`, `show_options`, `select_option`, `book`, `remove_item`, `add_item`, `reset`, `greeting`, `general_question`, `unknown`.

### Trip state

The trip state lives per chat session (in memory, 6-hour idle expiry) and is returned on every response as `trip`. Changes are applied incrementally, never by starting over:

- Changing the destination keeps the origin, dates, travellers and budget, and resets destination-specific picks.
- Changing duration or preferences rebuilds the itinerary.
- Changing the budget re-ranks and re-selects stays and transport, unless the user removed them.
- If a detail changes after a booking request was sent, the user is told to book again.

Required before planning: destination, origin, start date, duration, travellers. Budget is asked once; if left unanswered, it defaults to mid-range.

---

## 3. Demo data

| Destination | Places | Stays | Transport |
|---|---|---|---|
| Goa | 8 | 4 demo (budget/mid) + 3 live inventory (luxury) | Live flights/trains/buses from BLR, BOM, DEL, HYD, MAA |
| Manali | 7 | 5 demo | Demo only (HRTC Volvo, Shatabdi + cab, Kullu flight) |
| Hyderabad | 7 | 2 demo + 2 live | Live from BLR, GOI |
| Jaipur | 7 | 2 demo + 2 live | Live from DEL |
| Kerala (Kochi) | 6 | 2 demo + 2 live | Live from BLR, BOM, DEL |

Options marked **Live inventory** exist in BookGuard's `inventory` table. Booking one reserves it through the booking engine (row locks, idempotency, invariant). Options marked **Demo** are sample data, and booking them queues a request for the owning module. Routes without inventory get a clearly labelled estimated option. The seed inventory has a single travel date (25 Sep 2026), so live options are treated as a daily schedule in this demo.

---

## 4. API reference

All responses are JSON. Errors use `{ "success": false, "error": "<CODE>", "message": "<text>" }`.

### `POST /api/chat`

```json
{ "sessionId": "chat_… (optional on the first message)", "message": "I want to visit Goa for 3 days with 2 friends" }
```

Response (`ChatTurnResult`):

```json
{
  "success": true,
  "sessionId": "chat_5f…",
  "reply": "Sure! I can help plan your Goa trip. Could you tell me which city you will be starting from and when you would like to travel?",
  "trip": { "destination": {"id":"goa","name":"Goa","code":"GOI"}, "origin": null, "startDate": null, "durationDays": 3, "travellers": 3, "itinerary": null, "hotel": null, "transport": null, "places": [], "estimate": null, "bookingRequests": [], "status": "COLLECTING", "...": "..." },
  "missingInformation": ["origin", "startDate", "budget"],
  "recommendations": null,
  "show": [],
  "bookingRequest": null,
  "intent": { "intent": "plan_trip", "...": "..." },
  "aiMode": "llm",
  "aiNotice": null,
  "suggestions": ["From Bengaluru", "Next Friday", "Mid-range budget"],
  "demoDataNotice": "Demo suggestions: …"
}
```

`show` tells the UI which cards to render: `itinerary`, `hotels`, `transport`, `places`, `booking_request`. Empty or over-long messages get a friendly reply, not an error.

### `POST /api/chat/action` (card buttons)

```json
{ "sessionId": "chat_…", "action": "select | book | remove | change | cheaper | add | show", "target": "hotel | transport | place | itinerary | trip", "itemId": "demo-goa-mid-01", "mode": "train" }
```

Returns the same `ChatTurnResult`. Buttons skip language understanding but use the same state logic as typed messages.

### `GET /api/chat/session/:id` · `POST /api/chat/session/:id/reset` · `GET /api/chat/status`

These restore a conversation (trip and history, with live booking-request statuses), start over, or report `aiMode`, the model and the supported destinations.

### `POST /api/travel-plan` (no chat)

```json
{ "destination": "goa", "origin": "Bengaluru", "startDate": "2026-10-10", "durationDays": 3, "travellers": 3, "budget": "medium", "preferences": ["beach"], "transportMode": "train", "sessionId": "optional" }
```

Returns a `ChatTurnResult` with the full plan. Pass the returned `sessionId` to `/api/chat` to continue the conversation.

### `GET /api/recommendations`

`?destination=goa&type=hotel|transport|place|all&budget=budget|medium|luxury&origin=Bengaluru&mode=flight|train|bus&preferences=beach,food`

`origin` is required for `type=transport`.

### Booking requests

#### `POST /api/booking-request`

From a chat session (uses the session's plan and selected or recommended option):

```json
{ "sessionId": "chat_…", "type": "hotel", "itemId": "optional" }
```

Or directly, from any module:

```json
{
  "type": "hotel_booking",
  "destination": "Goa",
  "travellers": 3,
  "rooms": 2,
  "checkIn": "2026-10-10",
  "checkOut": "2026-10-13",
  "hotelId": "demo-hotel-01"
}
```

```json
{
  "type": "transport_booking",
  "from": "Bengaluru",
  "to": "Goa",
  "travellers": 3,
  "date": "2026-10-10",
  "mode": "train",
  "optionId": "trn_goa_express_12779",
  "inventoryId": "trn_goa_express_12779"
}
```

Requests the chatbot generates carry the full shape:

```json
{
  "type": "transport_booking",
  "requestId": "breq_…",
  "sessionId": "chat_…",
  "from": "Bengaluru", "fromCode": "BLR",
  "to": "Goa", "toCode": "GOI",
  "travellers": 3,
  "date": "2026-10-10",
  "returnDate": "2026-10-12",
  "mode": "train",
  "optionId": "trn_goa_express_12779",
  "operator": "IRCTC Goa Express (2-Tier AC Sleeper)",
  "code": "EXP 12779",
  "pricePerPerson": 1120,
  "estimatedTotal": 3360,
  "currency": "INR",
  "inventoryId": "trn_goa_express_12779",
  "demo": true
}
```

The response is a `BookingRequestRecord`:

```json
{
  "requestId": "breq_…",
  "type": "transport_booking",
  "status": "HELD",
  "module": "bookguard-engine",
  "message": "3 seat(s) reserved for 10 minutes pending demo payment",
  "bookingId": "bk_…",
  "request": { "…": "the payload above" },
  "booking": { "status": "HELD", "hold": { "expiresAt": "…" } },
  "next": {
    "action": "DEMO_PAYMENT_AND_CONFIRM",
    "method": "POST",
    "endpoint": "/api/bookings/confirm",
    "body": { "bookingId": "bk_…", "paymentDetails": { "method": "DEMO", "demo": true } },
    "note": "Handled by the Payment Demo module; send an Idempotency-Key header"
  }
}
```

Validation failures return `400 INVALID_BOOKING_REQUEST` listing every problem. Clicking "Book" twice returns the same request (`duplicate: true`) instead of reserving again.

#### Status lifecycle

```
RECEIVED ─▶ HELD            reserved via the BookGuard booking engine (live inventory)
         ─▶ PENDING_MODULE  waiting for a teammate's module (demo item, or group > 6)
         ─▶ REJECTED        e.g. sold out
HELD / PENDING_MODULE ─▶ CONFIRMED | FAILED | CANCELLED   (reported by the modules)
```

A `HELD` request follows its engine booking automatically: once the Payment Demo module confirms it through `/api/bookings/confirm`, the request reads `CONFIRMED`. An expired hold reads `FAILED`.

#### `GET /api/booking-requests?status=PENDING_MODULE&type=hotel_booking&sessionId=…` · `GET /api/booking-requests/:id`

Modules poll these for work.

#### `PATCH /api/booking-requests/:id`

Modules report back:

```json
{ "status": "CONFIRMED | FAILED | CANCELLED | PENDING_MODULE | REJECTED", "externalRef": "HTL-123", "message": "optional", "module": "hotel-service" }
```

---

## 5. Integration guide for teammates

```
AI Chatbot ─▶ Booking Request ─▶ Hotel Service ─▶ Transport Service ─▶ Payment Demo ─▶ Saga / Rollback
            (this module)       (teammate)        (teammate)          (teammate)       (teammate)
```

- **Hotel or Transport service.** Either poll `GET /api/booking-requests?status=PENDING_MODULE&type=hotel_booking` and `PATCH` the result, or register in-process:

  ```ts
  import { registerBookingModule } from './chat/bookingGateway.js';
  registerBookingModule('hotel_booking', async request => {
    // call your service…
    return { status: 'PENDING_MODULE', module: 'hotel-service', message: 'Accepted by hotel service' };
  });
  ```

  The default module reserves live-inventory items through the booking engine and queues everything else.
- **Payment Demo.** For `HELD` requests, call the `next` block (`POST /api/bookings/confirm` with an `Idempotency-Key`). The booking request status follows automatically.
- **Saga / rollback.** To undo, release the hold (`POST /api/bookings/:id/release`) or cancel a confirmed booking (`POST /api/bookings/cancel`), then `PATCH` the booking request to `CANCELLED` or `FAILED`.
- **Other UIs.** `POST /api/travel-plan` and `GET /api/recommendations` give structured planning without chat.

---

## 6. Error handling

| Situation | Behaviour |
|---|---|
| Empty or whitespace message, non-string, > 1000 chars | Friendly prompt; state unchanged |
| Unsupported destination ("Paris") | Explains and lists supported destinations; state unchanged |
| Unknown starting city | Asks for a supported city |
| Past date / more than a year ahead | Asks for another date |
| Travellers < 1 or > 20, duration outside 1–21 days | Asks again with the allowed range |
| "Change my travel date" without a date | Asks for the new value, then applies it |
| AI service error, timeout, refusal, bad key | Falls back to demo understanding for that turn (`aiNotice`) |
| Booking before the plan is complete | Asks for the missing details |
| Invalid direct booking request | `400` with all validation errors |
| Sold out / module failure | Request `REJECTED` with a message; alternatives are shown |
| Backend unreachable (UI) | Error bubble in the chat; the conversation continues |

---

## 7. Tests

```bash
cd backend && npm test      # engine + chatbot suites, fully offline
```

`chat.test.ts` covers:
- asking only for missing info, one-shot planning, and the example requests from the brief
- change, cheaper, another option, remove and add
- duration, traveller and date changes in place, including a pending date change
- selecting by position, and card buttons
- an inventory booking creating a real hold, with dedupe and demo payment reflected in the request status
- demo items queued and a module `PATCH` updating them
- booking before the plan is complete
- validation and error handling
- LLM mode with a mocked AI service, and fallback when the AI fails
- the schema, structured APIs and date parsing

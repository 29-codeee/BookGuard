-- ========================================================
-- BookGuard Authoritative PostgreSQL Schema
-- ========================================================

-- Drop tables if resetting
DROP VIEW IF EXISTS v_reconciliation_context CASCADE;
DROP VIEW IF EXISTS v_active_holds CASCADE;
DROP VIEW IF EXISTS v_inventory CASCADE;

DROP TABLE IF EXISTS ops_trace_events CASCADE;
DROP TABLE IF EXISTS booking_requests CASCADE;
DROP TABLE IF EXISTS booking_preparations CASCADE;
DROP TABLE IF EXISTS ai_decisions CASCADE;
DROP TABLE IF EXISTS booking_events CASCADE;
DROP TABLE IF EXISTS booking_items CASCADE;
DROP TABLE IF EXISTS provider_reservations CASCADE;
DROP TABLE IF EXISTS idempotency_keys CASCADE;
DROP TABLE IF EXISTS holds CASCADE;
DROP TABLE IF EXISTS bookings CASCADE;
DROP TABLE IF EXISTS inventory CASCADE;
DROP TABLE IF EXISTS travellers CASCADE;

-- 1. Travellers / Customers
CREATE TABLE travellers (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(32) NOT NULL,
    language_pref VARCHAR(8) DEFAULT 'en' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 2. Inventory (Authoritative Source of Truth)
-- INVARIANT: available_quantity + held_quantity + confirmed_quantity = total_quantity
-- INVARIANT: available_quantity >= 0, held_quantity >= 0, confirmed_quantity >= 0
CREATE TABLE inventory (
    id VARCHAR(64) PRIMARY KEY,
    resource_type VARCHAR(32) NOT NULL, -- 'flight' or 'hotel'
    code VARCHAR(64) NOT NULL,          -- e.g. 'IX 6534'
    name VARCHAR(255) NOT NULL,          -- e.g. 'Air India Express'
    origin VARCHAR(64) NOT NULL,        -- 'BLR'
    destination VARCHAR(64) NOT NULL,   -- 'GOI'
    travel_date DATE NOT NULL,          -- '2026-09-25'
    departure_time VARCHAR(16) NOT NULL,-- '06:10'
    arrival_time VARCHAR(16) NOT NULL,  -- '07:25'
    price NUMERIC(10, 2) NOT NULL,      -- 4120.00
    total_quantity INT NOT NULL CHECK (total_quantity >= 0),
    available_quantity INT NOT NULL CHECK (available_quantity >= 0),
    held_quantity INT NOT NULL DEFAULT 0 CHECK (held_quantity >= 0),
    confirmed_quantity INT NOT NULL DEFAULT 0 CHECK (confirmed_quantity >= 0),
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT check_inventory_invariant 
        CHECK (available_quantity + held_quantity + confirmed_quantity = total_quantity)
);

-- 3. Bookings
-- States: PENDING, HELD, RECONCILING, CONFIRMED, FAILED, EXPIRED, RELEASED, CANCELLED
CREATE TABLE bookings (
    id VARCHAR(64) PRIMARY KEY,
    traveller_id VARCHAR(64) NOT NULL REFERENCES travellers(id),
    status VARCHAR(32) NOT NULL CONSTRAINT bookings_status_check CHECK (
        status IN ('PENDING', 'HELD', 'RECONCILING', 'CONFIRMED', 'FAILED', 'EXPIRED', 'RELEASED', 'CANCELLED')
    ),
    total_amount NUMERIC(10, 2) NOT NULL,
    currency VARCHAR(8) DEFAULT 'INR' NOT NULL,
    booking_mode VARCHAR(16) DEFAULT 'NORMAL' NOT NULL, -- 'NORMAL' or 'TATKAL' / 'HIGH_DEMAND'
    confirm_token VARCHAR(64),                          -- set while a confirm attempt is talking to the provider
    confirm_started_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 4. Holds (TTL reservation tracked in Postgres alongside Redis)
CREATE TABLE holds (
    id VARCHAR(64) PRIMARY KEY,
    booking_id VARCHAR(64) NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    inventory_id VARCHAR(64) NOT NULL REFERENCES inventory(id),
    quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CONSTRAINT holds_status_check
        CHECK (status IN ('ACTIVE', 'CONFIRMED', 'EXPIRED', 'RELEASED', 'CANCELLED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 5. Idempotency Keys
CREATE TABLE idempotency_keys (
    key VARCHAR(128) PRIMARY KEY,
    scope VARCHAR(32) DEFAULT 'confirm' NOT NULL,       -- 'hold', 'confirm', 'prepared_execute'
    request_hash VARCHAR(128) NOT NULL,
    booking_id VARCHAR(64) REFERENCES bookings(id),
    state VARCHAR(16) DEFAULT 'COMPLETED' NOT NULL CHECK (state IN ('IN_PROGRESS', 'COMPLETED')),
    status_code INT NOT NULL,
    response_body JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 6. Booking Items (Supports multi-leg: Flight + Hotel)
CREATE TABLE booking_items (
    id VARCHAR(64) PRIMARY KEY,
    booking_id VARCHAR(64) NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    inventory_id VARCHAR(64) NOT NULL REFERENCES inventory(id),
    item_type VARCHAR(32) NOT NULL, -- 'flight' or 'hotel'
    status VARCHAR(32) NOT NULL DEFAULT 'HELD' CONSTRAINT booking_items_status_check CHECK (
        status IN ('HELD', 'CONFIRMED', 'FAILED', 'COMPENSATED', 'CANCELLED', 'EXPIRED', 'RELEASED')
    ),
    price NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 7. Provider Reservations
CREATE TABLE provider_reservations (
    id VARCHAR(64) PRIMARY KEY,
    booking_id VARCHAR(64) NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    booking_item_id VARCHAR(64) REFERENCES booking_items(id),
    provider_name VARCHAR(64) NOT NULL,
    provider_ref VARCHAR(128),
    provider_status VARCHAR(64) NOT NULL, -- 'RESERVED', 'CONFIRMED', 'FAILED', 'TIMED_OUT', 'CANCELLED'
    raw_response JSONB,
    last_checked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 8. Booking Events (Immutable Audit Log)
CREATE TABLE booking_events (
    id VARCHAR(64) PRIMARY KEY,
    booking_id VARCHAR(64) NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    from_state VARCHAR(32) NOT NULL,
    to_state VARCHAR(32) NOT NULL,
    reason TEXT NOT NULL,
    evidence JSONB,
    operator VARCHAR(64) DEFAULT 'SYSTEM',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 9. AI Decisions (Logged recommendations with human apply action)
CREATE TABLE ai_decisions (
    id VARCHAR(64) PRIMARY KEY,
    booking_id VARCHAR(64) NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    recommendation VARCHAR(32) NOT NULL CHECK (recommendation IN ('CONFIRM', 'FAIL', 'SAFE_RETRY', 'ESCALATE')),
    confidence NUMERIC(5, 2) NOT NULL,
    evidence_ids JSONB NOT NULL,
    reason TEXT NOT NULL,
    raw_prompt_hash VARCHAR(128),
    applied_by VARCHAR(64),
    applied_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 10. Ops Trace Events (Persisted mirror of live SSE execution traces)
CREATE TABLE ops_trace_events (
    id VARCHAR(64) PRIMARY KEY,
    trace_id VARCHAR(64) NOT NULL,
    operation_type VARCHAR(32) NOT NULL, -- HOLD, CONFIRM, EXPIRY, CANCEL
    event_type VARCHAR(32) NOT NULL,     -- running, success, failed, info
    stage VARCHAR(64) NOT NULL,
    message TEXT NOT NULL,
    booking_id VARCHAR(64),
    hold_id VARCHAR(64),
    inventory_id VARCHAR(64),
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_ops_trace_events_created_at ON ops_trace_events(created_at DESC);
CREATE INDEX idx_ops_trace_events_trace_id ON ops_trace_events(trace_id);

-- 11. Booking Preparations (High-Demand / Tatkal prepared booking flow)
-- DRAFT -> READY -> APPROVED -> SUBMITTED (hold created via the normal engine)
--                            \-> CANCELLED
CREATE TABLE booking_preparations (
    id VARCHAR(64) PRIMARY KEY,
    traveller_id VARCHAR(64) NOT NULL REFERENCES travellers(id),
    mode VARCHAR(16) NOT NULL DEFAULT 'TATKAL' CHECK (mode IN ('TATKAL', 'HIGH_DEMAND')),
    status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (
        status IN ('DRAFT', 'READY', 'APPROVED', 'SUBMITTED', 'CANCELLED')
    ),
    trip JSONB,
    passengers JSONB,
    inventory_id VARCHAR(64) REFERENCES inventory(id),
    payment_preference JSONB,
    window_opens_at TIMESTAMP WITH TIME ZONE,
    approved_at TIMESTAMP WITH TIME ZONE,
    booking_id VARCHAR(64) REFERENCES bookings(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 12. Chatbot booking requests (hand-off from the AI Travel Planner to booking modules)
-- RECEIVED -> HELD (reserved via the BookGuard engine) | PENDING_MODULE (awaiting an external module) | REJECTED
-- Modules then report CONFIRMED / FAILED / CANCELLED via PATCH /api/booking-requests/:id
CREATE TABLE IF NOT EXISTS booking_requests (
    id VARCHAR(64) PRIMARY KEY,
    session_id VARCHAR(64),
    type VARCHAR(32) NOT NULL CHECK (type IN ('hotel_booking', 'transport_booking')),
    payload JSONB NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'RECEIVED' CHECK (
        status IN ('RECEIVED', 'HELD', 'PENDING_MODULE', 'REJECTED', 'CONFIRMED', 'FAILED', 'CANCELLED')
    ),
    module VARCHAR(64),
    booking_id VARCHAR(64) REFERENCES bookings(id) ON DELETE SET NULL,
    external_ref VARCHAR(128),
    message TEXT,
    dedupe_key VARCHAR(128) UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_booking_requests_status ON booking_requests (status, type);

-- A booking can own at most one live (ACTIVE or CONFIRMED) hold.
CREATE UNIQUE INDEX ux_holds_one_live_per_booking ON holds (booking_id) WHERE status IN ('ACTIVE', 'CONFIRMED');
CREATE INDEX ix_holds_active_expiry ON holds (expires_at) WHERE status = 'ACTIVE';
CREATE INDEX ix_holds_booking ON holds (booking_id);
CREATE INDEX ix_booking_items_booking ON booking_items (booking_id);

-- Views for safe read-only queries
CREATE VIEW v_inventory AS
SELECT 
    id,
    resource_type,
    code,
    name,
    origin,
    destination,
    travel_date,
    departure_time,
    arrival_time,
    price,
    total_quantity,
    available_quantity,
    held_quantity,
    confirmed_quantity,
    (available_quantity + held_quantity + confirmed_quantity = total_quantity) AS invariant_valid,
    CASE WHEN available_quantity < 0 THEN 1 ELSE 0 END AS oversold_flag
FROM inventory;

CREATE VIEW v_active_holds AS
SELECT 
    h.id AS hold_id,
    h.booking_id,
    h.inventory_id,
    i.code,
    h.quantity,
    h.expires_at,
    h.status,
    EXTRACT(EPOCH FROM (h.expires_at - CURRENT_TIMESTAMP)) AS seconds_remaining
FROM holds h
JOIN inventory i ON h.inventory_id = i.id
WHERE h.status = 'ACTIVE' AND h.expires_at > CURRENT_TIMESTAMP;

CREATE VIEW v_reconciliation_context AS
SELECT 
    b.id AS booking_id,
    b.status AS booking_status,
    b.total_amount,
    t.name AS traveller_name,
    t.language_pref,
    pr.provider_name,
    pr.provider_ref,
    pr.provider_status,
    pr.last_checked_at
FROM bookings b
JOIN travellers t ON b.traveller_id = t.id
LEFT JOIN provider_reservations pr ON b.id = pr.booking_id
WHERE b.status = 'RECONCILING';

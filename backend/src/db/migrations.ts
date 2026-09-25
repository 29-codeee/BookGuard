/**
 * Idempotent, additive migrations for the booking engine.
 *
 * db/schema.sql already contains these changes for fresh databases. This file
 * upgrades databases created from an older schema (e.g. an existing Docker
 * `pgdata` volume). Every statement is safe to re-run. The SQL is embedded in
 * TypeScript so it ships inside `dist/` without needing the `db/` folder.
 */
export const BOOKING_ENGINE_MIGRATION = `
-- Historical Kaggle fare observations (analytics only; never bookable inventory)
CREATE TABLE IF NOT EXISTS historical_flight_fares (
  id BIGSERIAL PRIMARY KEY,
  origin VARCHAR(8) NOT NULL,
  destination VARCHAR(8) NOT NULL,
  company VARCHAR(128) NOT NULL,
  departure_time VARCHAR(16) NOT NULL,
  arrival_time VARCHAR(16) NOT NULL,
  duration_minutes INT NOT NULL,
  price_inr NUMERIC(10, 2) NOT NULL,
  travel_date DATE NOT NULL,
  cabin_class VARCHAR(32) NOT NULL,
  source VARCHAR(256) NOT NULL,
  UNIQUE (origin, destination, company, departure_time, arrival_time, travel_date, price_inr)
);
CREATE INDEX IF NOT EXISTS historical_flight_fares_route_idx
  ON historical_flight_fares (origin, destination, travel_date);

CREATE TABLE IF NOT EXISTS travel_reference_data (
  id VARCHAR(256) PRIMARY KEY,
  category VARCHAR(24) NOT NULL CHECK (category IN ('hotel', 'stay', 'airbnb', 'bus', 'train')),
  name TEXT NOT NULL,
  city TEXT,
  location TEXT,
  origin TEXT,
  destination TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS travel_reference_category_city_idx
  ON travel_reference_data (category, city);

-- bookings: RELEASED status, booking mode, confirm claim
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (
  status IN ('PENDING', 'HELD', 'RECONCILING', 'CONFIRMED', 'FAILED', 'EXPIRED', 'RELEASED', 'CANCELLED')
);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_mode VARCHAR(16) DEFAULT 'NORMAL' NOT NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS confirm_token VARCHAR(64);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS confirm_started_at TIMESTAMP WITH TIME ZONE;

-- holds: CANCELLED status (confirmed hold later cancelled)
ALTER TABLE holds DROP CONSTRAINT IF EXISTS holds_status_check;
ALTER TABLE holds ADD CONSTRAINT holds_status_check
  CHECK (status IN ('ACTIVE', 'CONFIRMED', 'EXPIRED', 'RELEASED', 'CANCELLED'));

-- booking_items: EXPIRED / RELEASED statuses
ALTER TABLE booking_items DROP CONSTRAINT IF EXISTS booking_items_status_check;
ALTER TABLE booking_items ADD CONSTRAINT booking_items_status_check CHECK (
  status IN ('HELD', 'CONFIRMED', 'FAILED', 'COMPENSATED', 'CANCELLED', 'EXPIRED', 'RELEASED')
);

-- idempotency_keys: scope + in-progress tracking
ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS scope VARCHAR(32) DEFAULT 'confirm' NOT NULL;
ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS state VARCHAR(16) DEFAULT 'COMPLETED' NOT NULL;
ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL;

-- High-Demand / Tatkal prepared bookings
CREATE TABLE IF NOT EXISTS booking_preparations (
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

-- 11. Chatbot booking requests (hand-off from the AI Travel Planner to booking modules)
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

CREATE UNIQUE INDEX IF NOT EXISTS ux_holds_one_live_per_booking ON holds (booking_id) WHERE status IN ('ACTIVE', 'CONFIRMED');
CREATE INDEX IF NOT EXISTS ix_holds_active_expiry ON holds (expires_at) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS ix_holds_booking ON holds (booking_id);
CREATE INDEX IF NOT EXISTS ix_booking_items_booking ON booking_items (booking_id);

-- Additive foundations for the multi-provider transaction engine. These tables
-- are independent of legacy bookings and never rewrite research inventory.
CREATE TABLE IF NOT EXISTS booking_transactions (
  id VARCHAR(64) PRIMARY KEY,
  customer_id VARCHAR(64) NOT NULL,
  status VARCHAR(24) NOT NULL CHECK (status IN ('PENDING','RESERVING','PROCESSING','COMPLETED','ROLLING_BACK','ROLLED_BACK','FAILED','ROLLBACK_FAILED')),
  currency VARCHAR(8) NOT NULL DEFAULT 'INR',
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS booking_transaction_items (
  id VARCHAR(64) PRIMARY KEY,
  transaction_id VARCHAR(64) NOT NULL REFERENCES booking_transactions(id) ON DELETE CASCADE,
  position INT NOT NULL,
  resource_type VARCHAR(16) NOT NULL CHECK (resource_type IN ('hotel','flight','transport','activity')),
  resource_id VARCHAR(64) NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  status VARCHAR(24) NOT NULL CHECK (status IN ('PENDING','RESERVING','RESERVED','PROCESSING','COMPLETED','FAILED','EXPIRED','RELEASED')),
  provider_name VARCHAR(128),
  unit_price NUMERIC(12,2),
  currency VARCHAR(8),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (transaction_id, position)
);
CREATE TABLE IF NOT EXISTS booking_resource_locks (
  id VARCHAR(64) PRIMARY KEY,
  transaction_id VARCHAR(64) NOT NULL REFERENCES booking_transactions(id) ON DELETE CASCADE,
  item_id VARCHAR(64) NOT NULL UNIQUE REFERENCES booking_transaction_items(id) ON DELETE CASCADE,
  resource_type VARCHAR(16) NOT NULL,
  resource_id VARCHAR(64) NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  status VARCHAR(16) NOT NULL CHECK (status IN ('ACTIVE','RELEASED','EXPIRED')),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS booking_resource_locks_capacity_idx ON booking_resource_locks (resource_type, resource_id, expires_at) WHERE status = 'ACTIVE';
CREATE TABLE IF NOT EXISTS booking_transaction_providers (
  id VARCHAR(64) PRIMARY KEY,
  transaction_id VARCHAR(64) NOT NULL REFERENCES booking_transactions(id) ON DELETE CASCADE,
  item_id VARCHAR(64) NOT NULL REFERENCES booking_transaction_items(id) ON DELETE CASCADE,
  provider_name VARCHAR(128) NOT NULL,
  status VARCHAR(24) NOT NULL CHECK (status IN ('PENDING','RESERVING','RESERVED','CONFIRMING','CONFIRMED','CANCELLING','CANCELLED','FAILED')),
  provider_reference VARCHAR(128),
  error_message TEXT,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS booking_transaction_events (
  id BIGSERIAL PRIMARY KEY,
  transaction_id VARCHAR(64) NOT NULL REFERENCES booking_transactions(id) ON DELETE CASCADE,
  item_id VARCHAR(64) REFERENCES booking_transaction_items(id) ON DELETE SET NULL,
  from_state VARCHAR(24),
  to_state VARCHAR(24) NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS booking_transaction_events_tx_idx ON booking_transaction_events (transaction_id, created_at);

-- Saga lifecycle metadata applies only to the new transaction foundation tables.
ALTER TABLE booking_resource_locks DROP CONSTRAINT IF EXISTS booking_resource_locks_status_check;
ALTER TABLE booking_resource_locks ADD CONSTRAINT booking_resource_locks_status_check
  CHECK (status IN ('ACTIVE','CONFIRMED','RELEASED','EXPIRED'));
CREATE INDEX IF NOT EXISTS booking_resource_locks_allocation_idx
  ON booking_resource_locks (resource_type, resource_id, status, expires_at);
ALTER TABLE booking_transaction_providers ADD COLUMN IF NOT EXISTS operation_type VARCHAR(16) NOT NULL DEFAULT 'RESERVE';
ALTER TABLE booking_transaction_providers DROP CONSTRAINT IF EXISTS booking_transaction_providers_operation_type_check;
ALTER TABLE booking_transaction_providers ADD CONSTRAINT booking_transaction_providers_operation_type_check
  CHECK (operation_type IN ('RESERVE','CONFIRM','CANCEL'));

-- Phase 6A: Advisory transaction risk assessment storage
CREATE TABLE IF NOT EXISTS booking_transaction_risk_assessments (
  id VARCHAR(64) PRIMARY KEY,
  transaction_id VARCHAR(64) NOT NULL REFERENCES booking_transactions(id) ON DELETE CASCADE,
  risk_score NUMERIC(5, 2) NOT NULL,
  risk_level VARCHAR(16) NOT NULL CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
  decision VARCHAR(16) NOT NULL CHECK (decision IN ('PROCEED', 'REVIEW')),
  factors JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider_assessments JSONB NOT NULL DEFAULT '[]'::jsonb,
  calculated_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS booking_tx_risk_assessments_tx_idx
  ON booking_transaction_risk_assessments (transaction_id);

-- Phase 6B: Recovery Intelligence / Advisory storage
CREATE TABLE IF NOT EXISTS booking_transaction_recovery_advisories (
  id VARCHAR(64) PRIMARY KEY,
  transaction_id VARCHAR(64) NOT NULL REFERENCES booking_transactions(id) ON DELETE CASCADE,
  recommendation VARCHAR(32) NOT NULL CHECK (recommendation IN ('AUTOMATIC_RETRY', 'ALTERNATIVE_PROVIDER', 'MANUAL_OPERATOR_REVIEW')),
  severity VARCHAR(16) NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
  confidence NUMERIC(5, 2) NOT NULL,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  suggested_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  affected_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS booking_tx_recovery_advisories_tx_idx
  ON booking_transaction_recovery_advisories (transaction_id);

-- Ops trace events (persisted mirror of live SSE execution traces for the Ops dashboard)
CREATE TABLE IF NOT EXISTS ops_trace_events (
  id VARCHAR(64) PRIMARY KEY,
  trace_id VARCHAR(64) NOT NULL,
  operation_type VARCHAR(32) NOT NULL,
  event_type VARCHAR(32) NOT NULL,
  stage VARCHAR(64) NOT NULL,
  message TEXT NOT NULL,
  booking_id VARCHAR(64),
  hold_id VARCHAR(64),
  inventory_id VARCHAR(64),
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ops_trace_events_created_at ON ops_trace_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_trace_events_trace_id ON ops_trace_events (trace_id);
`;

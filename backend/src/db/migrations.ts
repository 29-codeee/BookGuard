/**
 * Idempotent, additive migrations for the booking engine.
 *
 * db/schema.sql already contains these changes for fresh databases. This file
 * upgrades databases created from an older schema (e.g. an existing Docker
 * `pgdata` volume). Every statement is safe to re-run. The SQL is embedded in
 * TypeScript so it ships inside `dist/` without needing the `db/` folder.
 */
export const BOOKING_ENGINE_MIGRATION = `
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
`;

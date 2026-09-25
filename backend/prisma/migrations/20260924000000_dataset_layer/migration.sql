-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "dataset_customers" (
    "customer_id" VARCHAR(32) NOT NULL,
    "customer_name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(32),
    "preferred_currency" VARCHAR(8) NOT NULL,
    "account_status" VARCHAR(24) NOT NULL,
    "total_bookings" INTEGER NOT NULL,
    "successful_bookings" INTEGER NOT NULL,
    "cancelled_bookings" INTEGER NOT NULL,
    "created_at" DATE NOT NULL,

    CONSTRAINT "dataset_customers_pkey" PRIMARY KEY ("customer_id")
);

-- CreateTable
CREATE TABLE "dataset_providers" (
    "provider_id" VARCHAR(32) NOT NULL,
    "provider_name" VARCHAR(255) NOT NULL,
    "provider_type" VARCHAR(32) NOT NULL,
    "api_endpoint" TEXT,
    "response_time_ms" INTEGER NOT NULL,
    "reliability_score" DECIMAL(4,3) NOT NULL,
    "supports_rollback" BOOLEAN NOT NULL,
    "supports_idempotency" BOOLEAN NOT NULL,
    "status" VARCHAR(24) NOT NULL,

    CONSTRAINT "dataset_providers_pkey" PRIMARY KEY ("provider_id")
);

-- CreateTable
CREATE TABLE "dataset_flights" (
    "flight_id" VARCHAR(32) NOT NULL,
    "airline" VARCHAR(128) NOT NULL,
    "flight_number" VARCHAR(32) NOT NULL,
    "origin_airport" VARCHAR(8) NOT NULL,
    "origin_city" VARCHAR(128) NOT NULL,
    "destination_airport" VARCHAR(8) NOT NULL,
    "destination_city" VARCHAR(128) NOT NULL,
    "departure_date" DATE NOT NULL,
    "departure_time" VARCHAR(8) NOT NULL,
    "arrival_time" VARCHAR(8) NOT NULL,
    "available_seats" INTEGER NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(8) NOT NULL,

    CONSTRAINT "dataset_flights_pkey" PRIMARY KEY ("flight_id")
);

-- CreateTable
CREATE TABLE "dataset_hotels" (
    "hotel_id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "city" VARCHAR(128) NOT NULL,
    "location" TEXT NOT NULL,
    "rating" DECIMAL(3,1) NOT NULL,
    "reviews" INTEGER NOT NULL,
    "price_per_night" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(8) NOT NULL,
    "hotel_type" VARCHAR(64) NOT NULL,

    CONSTRAINT "dataset_hotels_pkey" PRIMARY KEY ("hotel_id")
);

-- CreateTable
CREATE TABLE "dataset_vehicles" (
    "vehicle_id" VARCHAR(32) NOT NULL,
    "provider" VARCHAR(128) NOT NULL,
    "vehicle_type" VARCHAR(64) NOT NULL,
    "city" VARCHAR(128) NOT NULL,
    "state" VARCHAR(128) NOT NULL,
    "pickup_location" TEXT NOT NULL,
    "drop_location" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(8) NOT NULL,
    "capacity" INTEGER NOT NULL,

    CONSTRAINT "dataset_vehicles_pkey" PRIMARY KEY ("vehicle_id")
);

-- CreateTable
CREATE TABLE "dataset_activities" (
    "activity_id" VARCHAR(32) NOT NULL,
    "provider" VARCHAR(128) NOT NULL,
    "activity_name" VARCHAR(255) NOT NULL,
    "city" VARCHAR(128) NOT NULL,
    "date" DATE NOT NULL,
    "start_time" VARCHAR(8) NOT NULL,
    "duration_hours" DECIMAL(5,2) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "price_per_person" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(8) NOT NULL,

    CONSTRAINT "dataset_activities_pkey" PRIMARY KEY ("activity_id")
);

-- CreateTable
CREATE TABLE "dataset_room_inventory" (
    "room_inventory_id" VARCHAR(32) NOT NULL,
    "hotel_id" VARCHAR(32) NOT NULL,
    "room_type" VARCHAR(128) NOT NULL,
    "check_in" DATE NOT NULL,
    "check_out" DATE NOT NULL,
    "total_rooms" INTEGER NOT NULL,
    "available_rooms" INTEGER NOT NULL,
    "price_per_night" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(8) NOT NULL,
    "status" VARCHAR(24) NOT NULL,

    CONSTRAINT "dataset_room_inventory_pkey" PRIMARY KEY ("room_inventory_id")
);

-- CreateTable
CREATE TABLE "dataset_activity_inventory" (
    "activity_inventory_id" VARCHAR(32) NOT NULL,
    "activity_id" VARCHAR(32) NOT NULL,
    "date" DATE NOT NULL,
    "start_time" VARCHAR(8) NOT NULL,
    "total_capacity" INTEGER NOT NULL,
    "booked_slots" INTEGER NOT NULL,
    "available_slots" INTEGER NOT NULL,
    "price_per_person" DECIMAL(12,2) NOT NULL,
    "status" VARCHAR(24) NOT NULL,

    CONSTRAINT "dataset_activity_inventory_pkey" PRIMARY KEY ("activity_inventory_id")
);

-- CreateTable
CREATE TABLE "dataset_transport_inventory" (
    "transport_inventory_id" VARCHAR(32) NOT NULL,
    "vehicle_id" VARCHAR(32) NOT NULL,
    "date" DATE NOT NULL,
    "time_slot" VARCHAR(32) NOT NULL,
    "total_capacity" INTEGER NOT NULL,
    "booked_units" INTEGER NOT NULL,
    "available_units" INTEGER NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "status" VARCHAR(24) NOT NULL,

    CONSTRAINT "dataset_transport_inventory_pkey" PRIMARY KEY ("transport_inventory_id")
);

-- CreateTable
CREATE TABLE "dataset_booking_records" (
    "id" VARCHAR(32) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "customer_id" VARCHAR(32) NOT NULL,
    "booking_date" DATE NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "payment_status" VARCHAR(24) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(8) NOT NULL,
    "created_at" DATE NOT NULL,

    CONSTRAINT "dataset_booking_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dataset_hotel_bookings" (
    "booking_id" VARCHAR(32) NOT NULL,
    "hotel_id" VARCHAR(32) NOT NULL,
    "room_inventory_id" VARCHAR(32) NOT NULL,
    "guests" INTEGER NOT NULL,

    CONSTRAINT "dataset_hotel_bookings_pkey" PRIMARY KEY ("booking_id")
);

-- CreateTable
CREATE TABLE "dataset_flight_bookings" (
    "flight_booking_id" VARCHAR(32) NOT NULL,
    "flight_id" VARCHAR(32) NOT NULL,
    "travel_date" DATE NOT NULL,
    "origin_airport" VARCHAR(8) NOT NULL,
    "destination_airport" VARCHAR(8) NOT NULL,
    "passengers" INTEGER NOT NULL,

    CONSTRAINT "dataset_flight_bookings_pkey" PRIMARY KEY ("flight_booking_id")
);

-- CreateTable
CREATE TABLE "dataset_transport_bookings" (
    "transport_booking_id" VARCHAR(32) NOT NULL,
    "vehicle_id" VARCHAR(32) NOT NULL,
    "transport_inventory_id" VARCHAR(32) NOT NULL,
    "travel_date" DATE NOT NULL,
    "passengers" INTEGER NOT NULL,
    "pickup_location" TEXT NOT NULL,
    "drop_location" TEXT NOT NULL,

    CONSTRAINT "dataset_transport_bookings_pkey" PRIMARY KEY ("transport_booking_id")
);

-- CreateTable
CREATE TABLE "dataset_activity_bookings" (
    "activity_booking_id" VARCHAR(32) NOT NULL,
    "activity_id" VARCHAR(32) NOT NULL,
    "activity_inventory_id" VARCHAR(32) NOT NULL,
    "activity_date" DATE NOT NULL,
    "participants" INTEGER NOT NULL,

    CONSTRAINT "dataset_activity_bookings_pkey" PRIMARY KEY ("activity_booking_id")
);

-- CreateTable
CREATE TABLE "dataset_payments" (
    "payment_id" VARCHAR(32) NOT NULL,
    "booking_id" VARCHAR(32) NOT NULL,
    "customer_id" VARCHAR(32) NOT NULL,
    "transaction_reference" VARCHAR(64) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(8) NOT NULL,
    "payment_method" VARCHAR(64) NOT NULL,
    "payment_status" VARCHAR(24) NOT NULL,
    "gateway" VARCHAR(64) NOT NULL,
    "created_at" DATE NOT NULL,
    "failure_reason" TEXT,

    CONSTRAINT "dataset_payments_pkey" PRIMARY KEY ("payment_id")
);

-- CreateTable
CREATE TABLE "dataset_compensation_records" (
    "compensation_id" VARCHAR(32) NOT NULL,
    "booking_id" VARCHAR(32) NOT NULL,
    "customer_id" VARCHAR(32) NOT NULL,
    "incident_type" VARCHAR(64) NOT NULL,
    "original_amount" DECIMAL(12,2) NOT NULL,
    "compensation_amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(8) NOT NULL,
    "compensation_type" VARCHAR(64) NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "resolution" TEXT NOT NULL,
    "created_at" DATE NOT NULL,

    CONSTRAINT "dataset_compensation_records_pkey" PRIMARY KEY ("compensation_id")
);

-- CreateTable
CREATE TABLE "dataset_transaction_logs" (
    "transaction_id" VARCHAR(32) NOT NULL,
    "booking_id" VARCHAR(32) NOT NULL,
    "customer_id" VARCHAR(32) NOT NULL,
    "transaction_type" VARCHAR(64) NOT NULL,
    "provider_count" INTEGER NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(8) NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "failure_type" VARCHAR(64),
    "rollback_required" BOOLEAN NOT NULL,
    "retry_count" INTEGER NOT NULL,
    "created_at" DATE NOT NULL,

    CONSTRAINT "dataset_transaction_logs_pkey" PRIMARY KEY ("transaction_id")
);

-- CreateTable
CREATE TABLE "dataset_event_logs" (
    "event_id" VARCHAR(32) NOT NULL,
    "transaction_id" VARCHAR(32) NOT NULL,
    "booking_id" VARCHAR(32) NOT NULL,
    "provider_id" VARCHAR(32) NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "resource_type" VARCHAR(32) NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "message" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dataset_event_logs_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "dataset_reservation_locks" (
    "lock_id" VARCHAR(32) NOT NULL,
    "resource_type" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "booking_id" VARCHAR(32) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lock_status" VARCHAR(32) NOT NULL,
    "locked_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "release_reason" TEXT,

    CONSTRAINT "dataset_reservation_locks_pkey" PRIMARY KEY ("lock_id")
);

-- CreateTable
CREATE TABLE "dataset_availability_checks" (
    "availability_check_id" VARCHAR(32) NOT NULL,
    "customer_id" VARCHAR(32) NOT NULL,
    "resource_type" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "requested_quantity" INTEGER NOT NULL,
    "available_quantity_at_check" INTEGER NOT NULL,
    "availability_result" VARCHAR(24) NOT NULL,
    "reservation_lock" VARCHAR(32) NOT NULL,
    "check_duration_ms" INTEGER NOT NULL,
    "status" VARCHAR(24) NOT NULL,

    CONSTRAINT "dataset_availability_checks_pkey" PRIMARY KEY ("availability_check_id")
);

-- CreateTable
CREATE TABLE "dataset_test_scenarios" (
    "scenario_id" VARCHAR(32) NOT NULL,
    "scenario_type" VARCHAR(64) NOT NULL,
    "customer_id" VARCHAR(32) NOT NULL,
    "transaction_id" VARCHAR(32) NOT NULL,
    "provider_count" INTEGER NOT NULL,
    "resources_involved" INTEGER NOT NULL,
    "payment_attempted" BOOLEAN NOT NULL,
    "expected_system_action" TEXT NOT NULL,
    "expected_final_status" VARCHAR(32) NOT NULL,
    "severity" VARCHAR(16) NOT NULL,
    "scenario_date" DATE NOT NULL,

    CONSTRAINT "dataset_test_scenarios_pkey" PRIMARY KEY ("scenario_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dataset_customers_email_key" ON "dataset_customers"("email");

-- CreateIndex
CREATE INDEX "dataset_providers_provider_type_status_idx" ON "dataset_providers"("provider_type", "status");

-- CreateIndex
CREATE INDEX "dataset_flights_origin_airport_destination_airport_departur_idx" ON "dataset_flights"("origin_airport", "destination_airport", "departure_date");

-- CreateIndex
CREATE INDEX "dataset_hotels_city_price_per_night_idx" ON "dataset_hotels"("city", "price_per_night");

-- CreateIndex
CREATE INDEX "dataset_vehicles_city_vehicle_type_idx" ON "dataset_vehicles"("city", "vehicle_type");

-- CreateIndex
CREATE INDEX "dataset_activities_city_date_idx" ON "dataset_activities"("city", "date");

-- CreateIndex
CREATE INDEX "dataset_room_inventory_hotel_id_check_in_check_out_idx" ON "dataset_room_inventory"("hotel_id", "check_in", "check_out");

-- CreateIndex
CREATE INDEX "dataset_activity_inventory_activity_id_date_idx" ON "dataset_activity_inventory"("activity_id", "date");

-- CreateIndex
CREATE INDEX "dataset_transport_inventory_vehicle_id_date_idx" ON "dataset_transport_inventory"("vehicle_id", "date");

-- CreateIndex
CREATE INDEX "dataset_booking_records_customer_id_created_at_idx" ON "dataset_booking_records"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "dataset_booking_records_kind_status_idx" ON "dataset_booking_records"("kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "dataset_payments_transaction_reference_key" ON "dataset_payments"("transaction_reference");

-- CreateIndex
CREATE INDEX "dataset_payments_booking_id_payment_status_idx" ON "dataset_payments"("booking_id", "payment_status");

-- CreateIndex
CREATE INDEX "dataset_compensation_records_booking_id_status_idx" ON "dataset_compensation_records"("booking_id", "status");

-- CreateIndex
CREATE INDEX "dataset_transaction_logs_booking_id_created_at_idx" ON "dataset_transaction_logs"("booking_id", "created_at");

-- CreateIndex
CREATE INDEX "dataset_event_logs_booking_id_timestamp_idx" ON "dataset_event_logs"("booking_id", "timestamp");

-- CreateIndex
CREATE INDEX "dataset_event_logs_transaction_id_idx" ON "dataset_event_logs"("transaction_id");

-- CreateIndex
CREATE INDEX "dataset_reservation_locks_resource_type_resource_id_lock_st_idx" ON "dataset_reservation_locks"("resource_type", "resource_id", "lock_status");

-- CreateIndex
CREATE INDEX "dataset_reservation_locks_booking_id_idx" ON "dataset_reservation_locks"("booking_id");

-- CreateIndex
CREATE INDEX "dataset_availability_checks_resource_type_resource_id_idx" ON "dataset_availability_checks"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "dataset_availability_checks_customer_id_status_idx" ON "dataset_availability_checks"("customer_id", "status");

-- CreateIndex
CREATE INDEX "dataset_test_scenarios_scenario_type_scenario_date_idx" ON "dataset_test_scenarios"("scenario_type", "scenario_date");

-- AddForeignKey
ALTER TABLE "dataset_room_inventory" ADD CONSTRAINT "dataset_room_inventory_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "dataset_hotels"("hotel_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_activity_inventory" ADD CONSTRAINT "dataset_activity_inventory_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "dataset_activities"("activity_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_transport_inventory" ADD CONSTRAINT "dataset_transport_inventory_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "dataset_vehicles"("vehicle_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_booking_records" ADD CONSTRAINT "dataset_booking_records_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "dataset_customers"("customer_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_hotel_bookings" ADD CONSTRAINT "dataset_hotel_bookings_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "dataset_booking_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_hotel_bookings" ADD CONSTRAINT "dataset_hotel_bookings_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "dataset_hotels"("hotel_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_hotel_bookings" ADD CONSTRAINT "dataset_hotel_bookings_room_inventory_id_fkey" FOREIGN KEY ("room_inventory_id") REFERENCES "dataset_room_inventory"("room_inventory_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_flight_bookings" ADD CONSTRAINT "dataset_flight_bookings_flight_booking_id_fkey" FOREIGN KEY ("flight_booking_id") REFERENCES "dataset_booking_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_flight_bookings" ADD CONSTRAINT "dataset_flight_bookings_flight_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "dataset_flights"("flight_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_transport_bookings" ADD CONSTRAINT "dataset_transport_bookings_transport_booking_id_fkey" FOREIGN KEY ("transport_booking_id") REFERENCES "dataset_booking_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_transport_bookings" ADD CONSTRAINT "dataset_transport_bookings_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "dataset_vehicles"("vehicle_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_transport_bookings" ADD CONSTRAINT "dataset_transport_bookings_transport_inventory_id_fkey" FOREIGN KEY ("transport_inventory_id") REFERENCES "dataset_transport_inventory"("transport_inventory_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_activity_bookings" ADD CONSTRAINT "dataset_activity_bookings_activity_booking_id_fkey" FOREIGN KEY ("activity_booking_id") REFERENCES "dataset_booking_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_activity_bookings" ADD CONSTRAINT "dataset_activity_bookings_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "dataset_activities"("activity_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_activity_bookings" ADD CONSTRAINT "dataset_activity_bookings_activity_inventory_id_fkey" FOREIGN KEY ("activity_inventory_id") REFERENCES "dataset_activity_inventory"("activity_inventory_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_payments" ADD CONSTRAINT "dataset_payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "dataset_booking_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_payments" ADD CONSTRAINT "dataset_payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "dataset_customers"("customer_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_compensation_records" ADD CONSTRAINT "dataset_compensation_records_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "dataset_booking_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_compensation_records" ADD CONSTRAINT "dataset_compensation_records_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "dataset_customers"("customer_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_transaction_logs" ADD CONSTRAINT "dataset_transaction_logs_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "dataset_booking_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_transaction_logs" ADD CONSTRAINT "dataset_transaction_logs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "dataset_customers"("customer_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_event_logs" ADD CONSTRAINT "dataset_event_logs_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "dataset_booking_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_event_logs" ADD CONSTRAINT "dataset_event_logs_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "dataset_transaction_logs"("transaction_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_event_logs" ADD CONSTRAINT "dataset_event_logs_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "dataset_providers"("provider_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_reservation_locks" ADD CONSTRAINT "dataset_reservation_locks_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "dataset_booking_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_availability_checks" ADD CONSTRAINT "dataset_availability_checks_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "dataset_customers"("customer_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_test_scenarios" ADD CONSTRAINT "dataset_test_scenarios_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "dataset_customers"("customer_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_test_scenarios" ADD CONSTRAINT "dataset_test_scenarios_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "dataset_transaction_logs"("transaction_id") ON DELETE RESTRICT ON UPDATE CASCADE;


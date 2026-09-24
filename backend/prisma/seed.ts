import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { Prisma, PrismaClient } from '@prisma/client';

type CsvRow = Record<string, string>;
const prisma = new PrismaClient();
const datasetDir = path.resolve(process.env.DATASET_DIR || path.join(process.cwd(), '..', 'dataset'));

function required(row: CsvRow, key: string, file: string): string {
  const value = row[key]?.trim();
  if (!value) throw new Error(`${file}: required value "${key}" is empty`);
  return value;
}
function number(row: CsvRow, key: string, file: string): number {
  const raw = required(row, key, file);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${file}: "${key}" is not numeric: ${raw}`);
  return value;
}
function date(row: CsvRow, key: string, file: string): Date {
  const raw = required(row, key, file);
  const value = new Date(`${raw.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(value.getTime())) throw new Error(`${file}: "${key}" is not a date: ${raw}`);
  return value;
}
function timestamp(row: CsvRow, key: string, file: string): Date {
  const raw = required(row, key, file);
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) throw new Error(`${file}: "${key}" is not a timestamp: ${raw}`);
  return value;
}
function bool(row: CsvRow, key: string, file: string): boolean {
  const raw = required(row, key, file).toLowerCase();
  if (raw === 'yes' || raw === 'true') return true;
  if (raw === 'no' || raw === 'false') return false;
  throw new Error(`${file}: "${key}" must be yes/no or true/false, received ${raw}`);
}
function optional(row: CsvRow, key: string): string | null {
  return row[key]?.trim() || null;
}

async function rows(file: string): Promise<CsvRow[]> {
  const fullPath = path.join(datasetDir, file);
  const content = await readFile(fullPath, 'utf8');
  const records = parse(content, { columns: true, bom: true, skip_empty_lines: true, trim: true }) as CsvRow[];
  if (!records.length) throw new Error(`${file}: no data rows found`);
  return records;
}

async function importFile<T>(
  file: string,
  map: (row: CsvRow) => T,
  createMany: (args: { data: T[]; skipDuplicates: true }) => Promise<{ count: number }>,
): Promise<void> {
  const input = await rows(file);
  const mapped = input.map((row, index) => {
    try { return map(row); }
    catch (error) { throw new Error(`${file}, data row ${index + 2}: ${(error as Error).message}`, { cause: error }); }
  });
  const { count } = await createMany({ data: mapped, skipDuplicates: true });
  console.log(`[seed] ${file}: ${count} inserted, ${mapped.length - count} already present`);
}

async function seed(tx: Prisma.TransactionClient): Promise<void> {
  await importFile('bookguard_customers.csv', r => ({
    id: required(r, 'customer_id', 'customers'), name: required(r, 'customer_name', 'customers'),
    email: required(r, 'email', 'customers'), phone: optional(r, 'phone'),
    preferredCurrency: required(r, 'preferred_currency', 'customers'), accountStatus: required(r, 'account_status', 'customers'),
    totalBookings: number(r, 'total_bookings', 'customers'), successfulBookings: number(r, 'successful_bookings', 'customers'),
    cancelledBookings: number(r, 'cancelled_bookings', 'customers'), createdAt: date(r, 'created_at', 'customers'),
  }), args => tx.customer.createMany(args));

  await importFile('bookguard_providers.csv', r => ({
    id: required(r, 'provider_id', 'providers'), name: required(r, 'provider_name', 'providers'),
    type: required(r, 'provider_type', 'providers'), apiEndpoint: optional(r, 'api_endpoint'),
    responseTimeMs: number(r, 'response_time_ms', 'providers'), reliabilityScore: required(r, 'reliability_score', 'providers'),
    supportsRollback: bool(r, 'supports_rollback', 'providers'), supportsIdempotency: bool(r, 'supports_idempotency', 'providers'),
    status: required(r, 'status', 'providers'),
  }), args => tx.provider.createMany(args));

  await importFile('bookguard_flights.csv', r => ({
    id: required(r, 'flight_id', 'flights'), airline: required(r, 'airline', 'flights'), flightNumber: required(r, 'flight_number', 'flights'),
    originAirport: required(r, 'origin_airport', 'flights'), originCity: required(r, 'origin_city', 'flights'),
    destinationAirport: required(r, 'destination_airport', 'flights'), destinationCity: required(r, 'destination_city', 'flights'),
    departureDate: date(r, 'departure_date', 'flights'), departureTime: required(r, 'departure_time', 'flights'),
    arrivalTime: required(r, 'arrival_time', 'flights'), availableSeats: number(r, 'available_seats', 'flights'),
    price: required(r, 'price', 'flights'), currency: required(r, 'currency', 'flights'),
  }), args => tx.flight.createMany(args));

  await importFile('bookguard_hotels(1).csv', r => ({
    id: required(r, 'hotel_id', 'hotels'), name: required(r, 'name', 'hotels'), city: required(r, 'city', 'hotels'),
    location: required(r, 'location', 'hotels'), rating: required(r, 'rating', 'hotels'), reviews: number(r, 'reviews', 'hotels'),
    pricePerNight: required(r, 'price_per_night', 'hotels'), currency: required(r, 'currency', 'hotels'), hotelType: required(r, 'hotel_type', 'hotels'),
  }), args => tx.hotel.createMany(args));

  await importFile('bookguard_transport(1).csv', r => ({
    id: required(r, 'vehicle_id', 'transport'), provider: required(r, 'provider', 'transport'), vehicleType: required(r, 'vehicle_type', 'transport'),
    city: required(r, 'city', 'transport'), state: required(r, 'state', 'transport'), pickupLocation: required(r, 'pickup_location', 'transport'),
    dropLocation: required(r, 'drop_location', 'transport'), price: required(r, 'price', 'transport'),
    currency: required(r, 'currency', 'transport'), capacity: number(r, 'capacity', 'transport'),
  }), args => tx.vehicle.createMany(args));

  await importFile('bookguard_activities.csv', r => ({
    id: required(r, 'activity_id', 'activities'), provider: required(r, 'provider', 'activities'), name: required(r, 'activity_name', 'activities'),
    city: required(r, 'city', 'activities'), date: date(r, 'date', 'activities'), startTime: required(r, 'start_time', 'activities'),
    durationHours: required(r, 'duration_hours', 'activities'), capacity: number(r, 'capacity', 'activities'),
    pricePerPerson: required(r, 'price_per_person', 'activities'), currency: required(r, 'currency', 'activities'),
  }), args => tx.activity.createMany(args));

  await importFile('bookguard_room_inventory.csv', r => ({
    id: required(r, 'room_inventory_id', 'room inventory'), hotelId: required(r, 'hotel_id', 'room inventory'),
    roomType: required(r, 'room_type', 'room inventory'), checkIn: date(r, 'check_in', 'room inventory'), checkOut: date(r, 'check_out', 'room inventory'),
    totalRooms: number(r, 'total_rooms', 'room inventory'), availableRooms: number(r, 'available_rooms', 'room inventory'),
    pricePerNight: required(r, 'price_per_night', 'room inventory'), currency: required(r, 'currency', 'room inventory'), status: required(r, 'status', 'room inventory'),
  }), args => tx.roomInventory.createMany(args));

  await importFile('bookguard_activity_inventory.csv', r => ({
    id: required(r, 'activity_inventory_id', 'activity inventory'), activityId: required(r, 'activity_id', 'activity inventory'),
    date: date(r, 'date', 'activity inventory'), startTime: required(r, 'start_time', 'activity inventory'),
    totalCapacity: number(r, 'total_capacity', 'activity inventory'), bookedSlots: number(r, 'booked_slots', 'activity inventory'),
    availableSlots: number(r, 'available_slots', 'activity inventory'), pricePerPerson: required(r, 'price_per_person', 'activity inventory'),
    status: required(r, 'status', 'activity inventory'),
  }), args => tx.activityInventory.createMany(args));

  await importFile('bookguard_transport_inventory.csv', r => ({
    id: required(r, 'transport_inventory_id', 'transport inventory'), vehicleId: required(r, 'vehicle_id', 'transport inventory'),
    date: date(r, 'date', 'transport inventory'), timeSlot: required(r, 'time_slot', 'transport inventory'),
    totalCapacity: number(r, 'total_capacity', 'transport inventory'), bookedUnits: number(r, 'booked_units', 'transport inventory'),
    availableUnits: number(r, 'available_units', 'transport inventory'), price: required(r, 'price', 'transport inventory'), status: required(r, 'status', 'transport inventory'),
  }), args => tx.transportInventory.createMany(args));

  const bookingSets = [
    { file: 'bookguard_hotel_bookings.csv', kind: 'hotel', id: 'booking_id', date: 'booking_date' },
    { file: 'bookguard_flight_bookings.csv', kind: 'flight', id: 'flight_booking_id', date: 'travel_date' },
    { file: 'bookguard_transport_bookings.csv', kind: 'transport', id: 'transport_booking_id', date: 'travel_date' },
    { file: 'bookguard_activity_bookings.csv', kind: 'activity', id: 'activity_booking_id', date: 'activity_date' },
  ] as const;
  for (const set of bookingSets) {
    await importFile(set.file, r => ({
      id: required(r, set.id, set.file), kind: set.kind, customerId: required(r, 'customer_id', set.file),
      bookingDate: date(r, set.date, set.file), status: required(r, 'booking_status', set.file),
      paymentStatus: required(r, 'payment_status', set.file), amount: required(r, 'amount', set.file),
      currency: required(r, 'currency', set.file), createdAt: date(r, 'created_at', set.file),
    }), args => tx.bookingRecord.createMany(args));
  }

  await importFile('bookguard_hotel_bookings.csv', r => ({
    bookingId: required(r, 'booking_id', 'hotel bookings'), hotelId: required(r, 'hotel_id', 'hotel bookings'),
    roomInventoryId: required(r, 'room_inventory_id', 'hotel bookings'), guests: number(r, 'guests', 'hotel bookings'),
  }), args => tx.hotelBooking.createMany(args));
  await importFile('bookguard_flight_bookings.csv', r => ({
    bookingId: required(r, 'flight_booking_id', 'flight bookings'), flightId: required(r, 'flight_id', 'flight bookings'),
    travelDate: date(r, 'travel_date', 'flight bookings'), originAirport: required(r, 'origin_airport', 'flight bookings'),
    destinationAirport: required(r, 'destination_airport', 'flight bookings'), passengers: number(r, 'passengers', 'flight bookings'),
  }), args => tx.flightBooking.createMany(args));
  await importFile('bookguard_transport_bookings.csv', r => ({
    bookingId: required(r, 'transport_booking_id', 'transport bookings'), vehicleId: required(r, 'vehicle_id', 'transport bookings'),
    inventoryId: required(r, 'transport_inventory_id', 'transport bookings'), travelDate: date(r, 'travel_date', 'transport bookings'),
    passengers: number(r, 'passengers', 'transport bookings'), pickupLocation: required(r, 'pickup_location', 'transport bookings'),
    dropLocation: required(r, 'drop_location', 'transport bookings'),
  }), args => tx.transportBooking.createMany(args));
  await importFile('bookguard_activity_bookings.csv', r => ({
    bookingId: required(r, 'activity_booking_id', 'activity bookings'), activityId: required(r, 'activity_id', 'activity bookings'),
    inventoryId: required(r, 'activity_inventory_id', 'activity bookings'), activityDate: date(r, 'activity_date', 'activity bookings'),
    participants: number(r, 'participants', 'activity bookings'),
  }), args => tx.activityBooking.createMany(args));

  await importFile('bookguard_payments.csv', r => ({
    id: required(r, 'payment_id', 'payments'), bookingId: required(r, 'booking_id', 'payments'), customerId: required(r, 'customer_id', 'payments'),
    transactionReference: required(r, 'transaction_reference', 'payments'), amount: required(r, 'amount', 'payments'),
    currency: required(r, 'currency', 'payments'), paymentMethod: required(r, 'payment_method', 'payments'),
    status: required(r, 'payment_status', 'payments'), gateway: required(r, 'gateway', 'payments'), createdAt: date(r, 'created_at', 'payments'),
    failureReason: optional(r, 'failure_reason'),
  }), args => tx.payment.createMany(args));
  await importFile('bookguard_compensation_records.csv', r => ({
    id: required(r, 'compensation_id', 'compensations'), bookingId: required(r, 'booking_id', 'compensations'),
    customerId: required(r, 'customer_id', 'compensations'), incidentType: required(r, 'incident_type', 'compensations'),
    originalAmount: required(r, 'original_amount', 'compensations'), compensationAmount: required(r, 'compensation_amount', 'compensations'),
    currency: required(r, 'currency', 'compensations'), compensationType: required(r, 'compensation_type', 'compensations'),
    status: required(r, 'status', 'compensations'), resolution: required(r, 'resolution', 'compensations'), createdAt: date(r, 'created_at', 'compensations'),
  }), args => tx.compensationRecord.createMany(args));
  await importFile('bookguard_transaction_logs.csv', r => ({
    id: required(r, 'transaction_id', 'transaction logs'), bookingId: required(r, 'booking_id', 'transaction logs'),
    customerId: required(r, 'customer_id', 'transaction logs'), transactionType: required(r, 'transaction_type', 'transaction logs'),
    providerCount: number(r, 'provider_count', 'transaction logs'), totalAmount: required(r, 'total_amount', 'transaction logs'),
    currency: required(r, 'currency', 'transaction logs'), status: required(r, 'status', 'transaction logs'),
    failureType: optional(r, 'failure_type'), rollbackRequired: bool(r, 'rollback_required', 'transaction logs'),
    retryCount: number(r, 'retry_count', 'transaction logs'), createdAt: date(r, 'created_at', 'transaction logs'),
  }), args => tx.transactionLog.createMany(args));
  await importFile('bookguard_event_logs.csv', r => ({
    id: required(r, 'event_id', 'event logs'), transactionId: required(r, 'transaction_id', 'event logs'),
    bookingId: required(r, 'booking_id', 'event logs'), providerId: required(r, 'provider_id', 'event logs'),
    eventType: required(r, 'event_type', 'event logs'), resourceType: required(r, 'resource_type', 'event logs'),
    status: required(r, 'status', 'event logs'), message: required(r, 'message', 'event logs'), timestamp: timestamp(r, 'timestamp', 'event logs'),
  }), args => tx.eventLog.createMany(args));
  await importFile('bookguard_reservation_locks.csv', r => ({
    id: required(r, 'lock_id', 'reservation locks'), resourceType: required(r, 'resource_type', 'reservation locks'),
    resourceId: required(r, 'resource_id', 'reservation locks'), bookingId: required(r, 'booking_id', 'reservation locks'),
    quantity: number(r, 'quantity', 'reservation locks'), status: required(r, 'lock_status', 'reservation locks'),
    lockedAt: timestamp(r, 'locked_at', 'reservation locks'), expiresAt: timestamp(r, 'expires_at', 'reservation locks'),
    releaseReason: optional(r, 'release_reason'),
  }), args => tx.reservationLock.createMany(args));
  await importFile('bookguard_availability_checks.csv', r => ({
    id: required(r, 'availability_check_id', 'availability checks'), customerId: required(r, 'customer_id', 'availability checks'),
    resourceType: required(r, 'resource_type', 'availability checks'), resourceId: required(r, 'resource_id', 'availability checks'),
    requestedQuantity: number(r, 'requested_quantity', 'availability checks'), availableQuantity: number(r, 'available_quantity_at_check', 'availability checks'),
    result: required(r, 'availability_result', 'availability checks'), reservationLock: required(r, 'reservation_lock', 'availability checks'),
    checkDurationMs: number(r, 'check_duration_ms', 'availability checks'), status: required(r, 'status', 'availability checks'),
  }), args => tx.availabilityCheck.createMany(args));
  await importFile('bookguard_test_scenarios.csv', r => ({
    id: required(r, 'scenario_id', 'test scenarios'), scenarioType: required(r, 'scenario_type', 'test scenarios'),
    customerId: required(r, 'customer_id', 'test scenarios'), transactionId: required(r, 'transaction_id', 'test scenarios'),
    providerCount: number(r, 'provider_count', 'test scenarios'), resourcesInvolved: number(r, 'resources_involved', 'test scenarios'),
    paymentAttempted: bool(r, 'payment_attempted', 'test scenarios'), expectedSystemAction: required(r, 'expected_system_action', 'test scenarios'),
    expectedFinalStatus: required(r, 'expected_final_status', 'test scenarios'), severity: required(r, 'severity', 'test scenarios'),
    scenarioDate: date(r, 'scenario_date', 'test scenarios'),
  }), args => tx.testScenario.createMany(args));
}

async function main(): Promise<void> {
  try {
    console.log(`[seed] Importing CSV files from ${datasetDir}`);
    await prisma.$transaction(seed, { maxWait: 15_000, timeout: 120_000 });
    console.log('[seed] All 20 CSV datasets imported successfully.');
  } catch (error) {
    console.error('[seed] Import failed; transaction rolled back.', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();

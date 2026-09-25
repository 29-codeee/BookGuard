# BookGuard database setup

BookGuard has two PostgreSQL data layers. The booking engine continues to use its existing `pg` client (or embedded PGlite for local demo mode) and the authoritative schema in `db/schema.sql`. The Prisma layer stores the 20 research CSV datasets in separate `dataset_*` tables; it does not replace the live booking engine tables.

## PostgreSQL setup

Start the project PostgreSQL service and set `DATABASE_URL` in `backend/.env`:

```env
DATABASE_URL=postgresql://postgres:postgrespassword@localhost:5433/bookguard
```

The seed command defaults to the repository’s `dataset/` directory. Set `DATASET_DIR` if the files are elsewhere. The importer reads CSV files only when explicitly run; HTTP requests do not read these files.

From `backend/`, run:

```sh
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
```

`db:migrate` applies the checked-in additive migration. It only creates research tables. `db:seed` inserts all 20 datasets in one PostgreSQL transaction. If validation or insertion fails, that transaction rolls back. The source IDs and relationships are preserved. Re-running the seed skips existing primary and unique keys, so it will not duplicate rows.

For schema development, use `npm run db:migrate:dev` against a development database. Do not use `prisma db push` against a shared database; use the checked-in migration workflow.

## Table map

| CSV data | Prisma model / PostgreSQL table | Main relationships |
| --- | --- | --- |
| customers | `Customer` / `dataset_customers` | parent of bookings, payments, compensations, transactions, checks, scenarios |
| providers | `Provider` / `dataset_providers` | parent of provider event logs |
| flights | `Flight` / `dataset_flights` | parent of flight bookings |
| hotels | `Hotel` / `dataset_hotels` | parent of room inventory and hotel bookings |
| transport vehicles | `Vehicle` / `dataset_vehicles` | parent of transport inventory and bookings |
| activities | `Activity` / `dataset_activities` | parent of activity inventory and bookings |
| room inventory | `RoomInventory` / `dataset_room_inventory` | hotel and hotel-booking foreign keys |
| activity inventory | `ActivityInventory` / `dataset_activity_inventory` | activity and activity-booking foreign keys |
| transport inventory | `TransportInventory` / `dataset_transport_inventory` | vehicle and transport-booking foreign keys |
| four booking CSVs | `BookingRecord` plus `HotelBooking`, `FlightBooking`, `TransportBooking`, `ActivityBooking` | common customer/status/amount record, with normalized per-category detail rows |
| payments | `Payment` / `dataset_payments` | booking and customer foreign keys |
| compensation records | `CompensationRecord` / `dataset_compensation_records` | booking and customer foreign keys |
| transaction logs | `TransactionLog` / `dataset_transaction_logs` | booking and customer foreign keys |
| event logs | `EventLog` / `dataset_event_logs` | booking, transaction, and provider foreign keys |
| reservation locks | `ReservationLock` / `dataset_reservation_locks` | booking foreign key; polymorphic resource type/ID is indexed |
| availability checks | `AvailabilityCheck` / `dataset_availability_checks` | customer foreign key; polymorphic resource type/ID is indexed |
| test scenarios | `TestScenario` / `dataset_test_scenarios` | customer and transaction foreign keys |

IDs, date fields, quantities, currency amounts, booleans, and provider reliability scores use typed columns. Primary/unique keys and indexes support joins, booking status lookups, routes/dates, and resource-lock checks. The CSVs use mixed booking ID prefixes, so `BookingRecord` is the shared parent used by payments, logs, compensation records, and locks.

## Local fallback

When `DATABASE_URL` is unset, the current Fastify app starts with embedded PGlite. Prisma’s migration and seed commands require a reachable PostgreSQL server. The CSV importer is a setup command and is not part of the normal API request path.

## Local Windows development

Run PostgreSQL and Redis in Docker, then run Fastify and the frontend directly with Node/npm. This does not build or start the backend Docker image.

From the project root:

```powershell
docker compose up -d postgres redis
cd backend
npm install
npx prisma validate
npx prisma generate
npx prisma migrate status
npm run dev
```

The host connection settings are stored in `backend/.env`: PostgreSQL at `localhost:5433` and Redis at `localhost:6379`, using the database credentials from `docker-compose.yml`. Run Prisma commands from `backend/` so Prisma loads that `.env` file. The existing `dev` script starts the Fastify TypeScript source with `tsx`; its files under `../db` resolve from the unchanged repository layout, without Docker COPY steps.

In a second terminal, start the existing frontend with `cd frontend; npm run dev` (Vite prints its local URL). The API listens on `http://localhost:3001`; verify it at `http://localhost:3001/api/health`.

If `prisma migrate status` reports the checked-in migration as pending, apply it without resetting the database with `npm run db:migrate` (Prisma `migrate deploy`). This migration adds the dataset tables; it does not reset existing data. To import CSV datasets, run `npm run db:seed` from `backend/` after migration.

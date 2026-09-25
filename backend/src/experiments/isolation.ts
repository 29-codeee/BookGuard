/**
 * Experiment database isolation.
 *
 * Experiments never run against the research database. Two engines are supported:
 *  - pglite:   an in-memory embedded PostgreSQL that disappears when the process exits.
 *  - postgres: a brand-new database `bookguard_exp_<runId>` created on the configured server,
 *              bootstrapped from db/schema.sql, and dropped on teardown (unless keepDatabase).
 * Both receive a small synthetic dataset, so seeded research inventory is never read or consumed.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { config } from '../config.js';
import { closeDb, getPoolMax, initDb, isEnginePGlite, query } from '../db/client.js';
import { BOOKING_ENGINE_MIGRATION } from '../db/migrations.js';
import type { EngineKind } from './types.js';

export const EXPERIMENT_DB_PREFIX = 'bookguard_exp_';
const DB_NAME_PATTERN = /^bookguard_exp_[a-z0-9_]{1,40}$/;

export interface ExperimentDatabase {
  engine: EngineKind;
  isolatedDatabase: string | null;
  databaseVersion: string | null;
  poolMax: number | null;
  teardown(): Promise<string>;
}

function locateSchemaFile(): string {
  const candidates = [config.dbSchemaPath, path.resolve(process.cwd(), '../db/schema.sql'), path.resolve(process.cwd(), './db/schema.sql')];
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) throw new Error('Could not locate db/schema.sql to bootstrap the isolated experiment database');
  return found;
}

function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

export function experimentDatabaseName(runId: string): string {
  const name = `${EXPERIMENT_DB_PREFIX}${runId.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`.slice(0, 55);
  if (!DB_NAME_PATTERN.test(name)) throw new Error(`Refusing unsafe experiment database name: ${name}`);
  return name;
}

async function openPglite(): Promise<ExperimentDatabase> {
  config.databaseUrl = '';
  await initDb();
  if (!isEnginePGlite()) throw new Error('Expected the embedded PGlite engine but a native connection is active');
  const version = await query<{ version: string }>('SELECT version()');
  return {
    engine: 'pglite',
    isolatedDatabase: null,
    databaseVersion: version.rows[0]?.version ?? null,
    poolMax: null,
    teardown: async () => {
      await closeDb();
      return 'In-memory PGlite instance closed; all experiment data discarded.';
    }
  };
}

async function openPostgres(runId: string, serverUrl: string, keepDatabase: boolean): Promise<ExperimentDatabase> {
  const researchDb = new URL(serverUrl).pathname.replace(/^\//, '');
  const dbName = experimentDatabaseName(runId);
  if (dbName === researchDb) throw new Error('Experiment database name collides with the configured database');

  const admin = new pg.Client({ connectionString: withDatabase(serverUrl, 'postgres') });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (exists.rowCount) throw new Error(`Experiment database ${dbName} already exists; refusing to reuse it`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }

  const isolatedUrl = withDatabase(serverUrl, dbName);
  try {
    // schema.sql starts with DROP TABLE statements, so verify the connection target before executing it.
    const bootstrap = new pg.Client({ connectionString: isolatedUrl });
    await bootstrap.connect();
    try {
      const current = await bootstrap.query<{ db: string }>('SELECT current_database() AS db');
      if (current.rows[0]?.db !== dbName) throw new Error(`Bootstrap connected to ${current.rows[0]?.db}, expected ${dbName}`);
      await bootstrap.query(fs.readFileSync(locateSchemaFile(), 'utf8'));
      await bootstrap.query(BOOKING_ENGINE_MIGRATION);
    } finally {
      await bootstrap.end();
    }

    config.databaseUrl = isolatedUrl;
    await initDb();
    // initDb silently falls back to PGlite on connection errors; an experiment must never mislabel its engine.
    if (isEnginePGlite()) throw new Error('Native PostgreSQL connection failed; refusing to continue on a different engine');
    const current = await query<{ db: string; version: string }>('SELECT current_database() AS db, version() AS version');
    if (current.rows[0]?.db !== dbName) throw new Error(`Engine connected to ${current.rows[0]?.db}, expected ${dbName}`);

    return {
      engine: 'postgres',
      isolatedDatabase: dbName,
      databaseVersion: current.rows[0].version,
      poolMax: getPoolMax(),
      teardown: async () => {
        await closeDb();
        if (keepDatabase) return `Isolated database ${dbName} kept for inspection (--keep-db). Drop it with: DROP DATABASE "${dbName}";`;
        await dropExperimentDatabase(serverUrl, dbName);
        return `Isolated database ${dbName} dropped.`;
      }
    };
  } catch (err) {
    await closeDb().catch(() => {});
    await dropExperimentDatabase(serverUrl, dbName).catch(() => {});
    throw err;
  }
}

async function dropExperimentDatabase(serverUrl: string, dbName: string): Promise<void> {
  if (!DB_NAME_PATTERN.test(dbName)) throw new Error(`Refusing to drop non-experiment database ${dbName}`);
  const admin = new pg.Client({ connectionString: withDatabase(serverUrl, 'postgres') });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

export async function openExperimentDatabase(
  engine: EngineKind,
  runId: string,
  options: { serverUrl?: string; keepDatabase?: boolean } = {}
): Promise<ExperimentDatabase> {
  if (engine === 'pglite') return openPglite();
  const serverUrl = options.serverUrl ?? process.env.DATABASE_URL;
  if (!serverUrl) throw new Error('--engine postgres needs DATABASE_URL (used only to reach the server; a separate database is created)');
  return openPostgres(runId, serverUrl, options.keepDatabase ?? false);
}

// ---------------- synthetic dataset ----------------

export const RESOURCE_TYPES = ['hotel', 'flight', 'transport', 'activity'] as const;
export type ExperimentResourceType = typeof RESOURCE_TYPES[number];
export const EXPERIMENT_CUSTOMER = 'exp-customer';

const DATASET_TABLES = [
  'dataset_customers', 'dataset_flights', 'dataset_hotels', 'dataset_room_inventory', 'dataset_vehicles',
  'dataset_transport_inventory', 'dataset_activities', 'dataset_activity_inventory', 'dataset_providers', 'dataset_event_logs'
];

/**
 * Creates minimal dataset tables inside the isolated database. Refuses to run if any dataset table
 * already exists — that would mean we are not in a fresh isolated database.
 */
export async function createSyntheticDataset(): Promise<void> {
  const existing = await query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY($1)`,
    [DATASET_TABLES]
  );
  if (existing.rowCount) {
    throw new Error(`Dataset tables already exist (${existing.rows.map(r => r.table_name).join(', ')}); refusing to run outside an isolated database`);
  }
  const statements = [
    `CREATE TABLE dataset_customers (customer_id VARCHAR(64) PRIMARY KEY)`,
    `CREATE TABLE dataset_flights (flight_id VARCHAR(64) PRIMARY KEY, available_seats INT, price NUMERIC(12,2), currency VARCHAR(8), airline VARCHAR(128))`,
    `CREATE TABLE dataset_hotels (hotel_id VARCHAR(64) PRIMARY KEY, name VARCHAR(255))`,
    `CREATE TABLE dataset_room_inventory (room_inventory_id VARCHAR(64) PRIMARY KEY, hotel_id VARCHAR(64), available_rooms INT, price_per_night NUMERIC(12,2), currency VARCHAR(8))`,
    `CREATE TABLE dataset_vehicles (vehicle_id VARCHAR(64) PRIMARY KEY, provider VARCHAR(128), currency VARCHAR(8))`,
    `CREATE TABLE dataset_transport_inventory (transport_inventory_id VARCHAR(64) PRIMARY KEY, vehicle_id VARCHAR(64), available_units INT, price NUMERIC(12,2))`,
    `CREATE TABLE dataset_activities (activity_id VARCHAR(64) PRIMARY KEY, provider VARCHAR(128), currency VARCHAR(8))`,
    `CREATE TABLE dataset_activity_inventory (activity_inventory_id VARCHAR(64) PRIMARY KEY, activity_id VARCHAR(64), available_slots INT, price_per_person NUMERIC(12,2))`,
    `CREATE TABLE dataset_providers (provider_id VARCHAR(64) PRIMARY KEY, provider_name VARCHAR(128), provider_type VARCHAR(32), reliability_score NUMERIC(5,3), response_time_ms INT, supports_rollback BOOLEAN, supports_idempotency BOOLEAN, status VARCHAR(32))`,
    `CREATE TABLE dataset_event_logs (event_id VARCHAR(64) PRIMARY KEY, provider_id VARCHAR(64), event_type VARCHAR(64), status VARCHAR(32))`,
    `INSERT INTO dataset_customers VALUES ('${EXPERIMENT_CUSTOMER}')`
  ];
  for (const sql of statements) await query(sql);
  // A highly reliable active alternative per type makes the advisor's alternative-provider lookup deterministic.
  for (const type of RESOURCE_TYPES) {
    await query(
      `INSERT INTO dataset_providers VALUES ($1, $2, $3, 0.999, 100, true, true, 'active')`,
      [`alt-${type}`, `Alternative ${type} provider`, type]
    );
  }
}

export interface ResourceSet {
  prefix: string;
  capacity: number;
  ids: Record<ExperimentResourceType, string>;
  providers: Record<ExperimentResourceType, string>;
}

const UNIT_PRICE: Record<ExperimentResourceType, number> = { hotel: 3000, flight: 4500, transport: 800, activity: 1200 };

/**
 * Creates one resource of every type with the given capacity and baseline provider telemetry
 * (active, reliability 0.99, 300 ms, rollback + idempotency supported, no historical failures).
 */
export async function createResourceSet(prefix: string, capacity: number): Promise<ResourceSet> {
  const id = (suffix: string) => `${prefix}-${suffix}`.slice(0, 64);
  const providers: Record<ExperimentResourceType, string> = {
    hotel: `${prefix} Hotel Co`, flight: `${prefix} Air`, transport: `${prefix} Transit`, activity: `${prefix} Tours`
  };
  const ids: Record<ExperimentResourceType, string> = {
    hotel: id('ROOM'), flight: id('FLT'), transport: id('TRN'), activity: id('ACT')
  };
  await query(`INSERT INTO dataset_hotels VALUES ($1, $2)`, [id('HTL'), providers.hotel]);
  await query(`INSERT INTO dataset_room_inventory VALUES ($1, $2, $3, $4, 'INR')`, [ids.hotel, id('HTL'), capacity, UNIT_PRICE.hotel]);
  await query(`INSERT INTO dataset_flights VALUES ($1, $2, $3, 'INR', $4)`, [ids.flight, capacity, UNIT_PRICE.flight, providers.flight]);
  await query(`INSERT INTO dataset_vehicles VALUES ($1, $2, 'INR')`, [id('VEH'), providers.transport]);
  await query(`INSERT INTO dataset_transport_inventory VALUES ($1, $2, $3, $4)`, [ids.transport, id('VEH'), capacity, UNIT_PRICE.transport]);
  await query(`INSERT INTO dataset_activities VALUES ($1, $2, 'INR')`, [id('ACTV'), providers.activity]);
  await query(`INSERT INTO dataset_activity_inventory VALUES ($1, $2, $3, $4)`, [ids.activity, id('ACTV'), capacity, UNIT_PRICE.activity]);
  for (const type of RESOURCE_TYPES) {
    await query(
      `INSERT INTO dataset_providers VALUES ($1, $2, $3, 0.99, 300, true, true, 'active')`,
      [id(`PRV-${type}`), providers[type], type]
    );
  }
  return { prefix, capacity, ids, providers };
}

export function itemsFor(set: ResourceSet, types: readonly ExperimentResourceType[], quantity = 1) {
  return types.map(type => ({ type, resourceId: set.ids[type], quantity }));
}

import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { config } from '../config.js';
import { BOOKING_ENGINE_MIGRATION } from './migrations.js';

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

export interface TransactionClient {
  query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>>;
}

let pgPool: pg.Pool | null = null;
let pgliteInstance: PGlite | null = null;
let isPGlite = false;

export async function initDb(): Promise<void> {
  if (config.databaseUrl) {
    try {
      console.log(`[DB] Attempting connection to PostgreSQL at ${config.databaseUrl.replace(/:[^:@]+@/, ':***@')}...`);
      const pool = new pg.Pool({
        connectionString: config.databaseUrl,
        connectionTimeoutMillis: 3000
      });
      // Test connection
      await pool.query('SELECT 1');
      pgPool = pool;
      isPGlite = false;
      console.log('[DB] Connected successfully to native PostgreSQL server.');
      await runMigrations();
      return;
    } catch (err) {
      console.warn('[DB] Native PostgreSQL connection failed, falling back to embedded PGlite WASM engine:', (err as Error).message);
    }
  }

  // Fallback / Standalone mode: PGlite WASM (runs genuine Postgres 16 in-process)
  console.log('[DB] Initializing embedded PostgreSQL (PGlite WASM engine with ACID & CHECK constraints)...');
  const dataDir = path.resolve(process.cwd(), './data/pglite');
  try {
    // Try in-memory or fresh directory
    pgliteInstance = new PGlite();
    await pgliteInstance.waitReady;
    console.log('[DB] In-memory PGlite WASM engine ready.');
  } catch (memErr) {
    console.warn('[DB] In-memory PGlite failed, attempting data directory:', memErr);
    fs.mkdirSync(dataDir, { recursive: true });
    pgliteInstance = new PGlite(dataDir);
    await pgliteInstance.waitReady;
  }
  isPGlite = true;
  console.log('[DB] Embedded PostgreSQL engine ready.');

  // Apply schema & seed if fresh
  await applySchemaAndSeed();
}

/** Applies the idempotent booking-engine migration (no-op on a fresh schema.sql). */
export async function runMigrations(): Promise<void> {
  try {
    const tableCheck = await query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory' LIMIT 1`);
    if (tableCheck.rowCount === 0) return; // schema not created yet
    if (pgPool) {
      await pgPool.query(BOOKING_ENGINE_MIGRATION);
    } else if (pgliteInstance) {
      await pgliteInstance.exec(BOOKING_ENGINE_MIGRATION);
    }
  } catch (err) {
    console.error('[DB] Error applying booking engine migration:', err);
    throw err;
  }
}

// PGlite reports DML row counts in `affectedRows`; `rows` is empty for UPDATE/DELETE without RETURNING.
function pgliteRowCount(res: { rows: unknown[]; affectedRows?: number }): number {
  return res.rows.length > 0 ? res.rows.length : (res.affectedRows ?? 0);
}

export async function query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
  if (pgPool) {
    const res = await pgPool.query(text, params);
    return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length };
  } else if (pgliteInstance) {
    const res = await pgliteInstance.query(text, params);
    return { rows: res.rows as T[], rowCount: pgliteRowCount(res) };
  }
  throw new Error('[DB] Database client not initialized');
}

export async function withTransaction<T>(callback: (client: TransactionClient) => Promise<T>): Promise<T> {
  if (pgPool) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const txClient: TransactionClient = {
        query: async <R = any>(text: string, params?: any[]) => {
          const res = await client.query(text, params);
          return { rows: res.rows as R[], rowCount: res.rowCount ?? res.rows.length };
        }
      };
      const result = await callback(txClient);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } else if (pgliteInstance) {
    // PGlite transaction
    return await pgliteInstance.transaction(async (tx) => {
      const txClient: TransactionClient = {
        query: async <R = any>(text: string, params?: any[]) => {
          const res = await tx.query(text, params);
          return { rows: res.rows as R[], rowCount: pgliteRowCount(res) };
        }
      };
      return await callback(txClient);
    });
  }
  throw new Error('[DB] Database client not initialized');
}

export async function applySchemaAndSeed(forceSchema = false): Promise<void> {
  try {
    const potentialSchemaPaths = [
      config.dbSchemaPath,
      path.resolve(process.cwd(), '../db/schema.sql'),
      path.resolve(process.cwd(), './db/schema.sql'),
      path.resolve(__dirname, '../../../../db/schema.sql')
    ];
    const schemaFile = potentialSchemaPaths.find(p => fs.existsSync(p));

    const potentialSeedPaths = [
      config.dbSeedPath,
      path.resolve(process.cwd(), '../db/seed.sql'),
      path.resolve(process.cwd(), './db/seed.sql'),
      path.resolve(__dirname, '../../../../db/seed.sql')
    ];
    const seedFile = potentialSeedPaths.find(p => fs.existsSync(p));

    // Check if table already exists
    let tableExists = false;
    try {
      const checkRes = await query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory' LIMIT 1`);
      tableExists = checkRes.rowCount > 0;
    } catch {
      tableExists = false;
    }

    if (!tableExists || forceSchema) {
      if (!schemaFile) {
        console.error('[DB] Could not locate schema.sql in expected paths:', potentialSchemaPaths);
        return;
      }
      console.log(`[DB] Executing initial schema from ${schemaFile}...`);
      const schemaSql = fs.readFileSync(schemaFile, 'utf8');
      if (pgPool) {
        await pgPool.query(schemaSql);
      } else if (pgliteInstance) {
        await pgliteInstance.exec(schemaSql);
      }
    }
    await runMigrations();

    if (seedFile) {
      console.log(`[DB] Executing seed dataset from ${seedFile}...`);
      const seedSql = fs.readFileSync(seedFile, 'utf8');
      if (pgPool) {
        await pgPool.query(seedSql);
      } else if (pgliteInstance) {
        await pgliteInstance.exec(seedSql);
      }
    }
    console.log('[DB] Schema and seed executed successfully.');
  } catch (err) {
    console.error('[DB] Error applying schema or seed:', err);
    throw err;
  }
}

export function isEnginePGlite(): boolean {
  return isPGlite;
}

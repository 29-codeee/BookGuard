import pg from 'pg';
import { BOOKING_ENGINE_MIGRATION } from '../db/migrations.js';

async function main() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgrespassword@localhost:5433/bookguard?schema=public'
  });

  try {
    await client.connect();
    console.log('Connected to PostgreSQL localhost:5433/bookguard');

    // Run additive migration to ensure booking_transaction_recovery_advisories is present
    await client.query(BOOKING_ENGINE_MIGRATION);

    const res = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
    const tableNames = res.rows.map((r: any) => r.table_name);
    console.log('Total tables in public schema:', tableNames.length);

    // 1. Check all 21 dataset tables
    const datasetTables = tableNames.filter((t: string) => t.startsWith('dataset_'));
    console.log('\n--- ALL 21 DATASET TABLES (Total: ' + datasetTables.length + ') ---');
    for (const dt of datasetTables) {
      const c = await client.query(`SELECT count(*) FROM "${dt}"`);
      console.log(`  ${dt}: ${c.rows[0].count}`);
    }

    // 2. Check legacy booking tables
    const legacyTables = ['travellers', 'inventory', 'bookings', 'holds', 'idempotency_keys'];
    console.log('\n--- LEGACY BOOKING TABLES ---');
    for (const lt of legacyTables) {
      if (tableNames.includes(lt)) {
        const c = await client.query(`SELECT count(*) FROM "${lt}"`);
        console.log(`  ${lt}: ${c.rows[0].count}`);
      } else {
        console.log(`  ${lt}: NOT_FOUND`);
      }
    }

    // 3. Check transaction engine tables
    const txTables = [
      'booking_transactions',
      'booking_transaction_items',
      'booking_resource_locks',
      'booking_transaction_providers',
      'booking_transaction_events',
      'booking_transaction_risk_assessments',
      'booking_transaction_recovery_advisories'
    ];
    console.log('\n--- TRANSACTION ENGINE TABLES (Phases 1-6B) ---');
    for (const tt of txTables) {
      const exists = tableNames.includes(tt);
      if (exists) {
        const c = await client.query(`SELECT count(*) FROM "${tt}"`);
        console.log(`  ${tt}: EXISTS, rows = ${c.rows[0].count}`);
      } else {
        console.log(`  ${tt}: NOT_YET_MIGRATED`);
      }
    }
  } catch (err) {
    console.error('Database check error:', err);
  } finally {
    await client.end();
  }
}

main();

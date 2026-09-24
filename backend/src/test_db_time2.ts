import { initDb, query } from './db/client.js';

async function testTime() {
  await initDb();
  const res = await query(`
    SELECT 
      NOW()::text as now_text, 
      CURRENT_TIMESTAMP::text as ct_text,
      (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::text as ct_utc_text,
      (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::text as ct_ist_text,
      current_setting('TIMEZONE') as tz
  `);
  console.log('DB Time Text:', res.rows[0]);
  process.exit(0);
}

testTime().catch(console.error);

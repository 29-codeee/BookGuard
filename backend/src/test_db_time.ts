import { initDb, query } from './db/client.js';

async function testTime() {
  await initDb();
  
  const jsTime = new Date().toISOString();
  console.log('JS Time:', jsTime);
  
  const res = await query(`
    SELECT NOW() as now, 
           CURRENT_TIMESTAMP as ct,
           CURRENT_TIMESTAMP AT TIME ZONE 'UTC' as ct_utc,
           CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata' as ct_ist
  `);
  
  console.log('DB Time:', res.rows[0]);
  process.exit(0);
}

testTime().catch(console.error);

import { initDb, query } from './db/client.js';

async function debugExpiry() {
  await initDb();
  
  const jsNow = new Date().toISOString();
  console.log('JS Now:', jsNow);
  
  const holds = await query(`
    SELECT id, status, expires_at, 
           CURRENT_TIMESTAMP as ct,
           (expires_at <= CURRENT_TIMESTAMP) as is_expired_in_db
    FROM holds 
    WHERE status = 'ACTIVE'
  `);
  
  console.log('ACTIVE holds:', holds.rows);
  process.exit(0);
}

debugExpiry().catch(console.error);

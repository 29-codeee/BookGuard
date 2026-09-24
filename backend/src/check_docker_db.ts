import pg from 'pg';

async function checkDockerDb() {
  const pool = new pg.Pool({
    connectionString: 'postgres://postgres:postgrespassword@localhost:5432/bookguard'
  });
  const res = await pool.query(`
    SELECT 
      NOW()::text as now_text, 
      CURRENT_TIMESTAMP::text as ct_text,
      (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::text as ct_utc_text,
      (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::text as ct_ist_text,
      current_setting('TIMEZONE') as tz
  `);
  console.log('Docker DB Time Text:', res.rows[0]);

  const activeHolds = await pool.query(`
    SELECT id, status, expires_at::text, 
           (expires_at <= CURRENT_TIMESTAMP) as is_expired_in_db
    FROM holds 
    WHERE status = 'ACTIVE'
  `);
  console.log('ACTIVE holds in Docker:', activeHolds.rows);

  await pool.end();
}
checkDockerDb().catch(console.error);

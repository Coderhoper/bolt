const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function run() {
  const conn = process.argv[2];
  const migrationsDir = path.resolve(process.argv[3] || 'supabase/migrations');
  if (!conn) {
    console.error('Usage: node run-all-migrations.cjs <connection-string> [migrations-dir]');
    process.exit(1);
  }

  const client = new Client({ connectionString: conn });
  try {
    await client.connect();
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const full = path.join(migrationsDir, file);
      console.log('\n=== Applying', file, '===');
      const sql = fs.readFileSync(full, 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');
        console.log('Applied', file);
      } catch (err) {
        console.error('Failed to apply', file, err.message || err);
        try { await client.query('ROLLBACK'); } catch (e) {}
        throw err;
      }
    }

    console.log('\nAll migrations applied.');
  } catch (err) {
    console.error('Migration process aborted:', err.message || err);
    process.exit(2);
  } finally {
    try { await client.end(); } catch (e) {}
  }
}

run();

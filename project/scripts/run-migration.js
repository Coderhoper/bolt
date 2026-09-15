const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function run() {
  const conn = process.argv[2];
  const sqlFile = process.argv[3];
  if (!conn || !sqlFile) {
    console.error('Usage: node run-migration.js <connection-string> <sql-file>');
    process.exit(1);
  }

  const client = new Client({ connectionString: conn });
  try {
    await client.connect();
    const sql = fs.readFileSync(path.resolve(sqlFile), 'utf8');
    console.log('Applying migration', sqlFile);
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Migration applied successfully.');

    // Verification queries
    const tables = await client.query("SELECT tablename FROM pg_tables WHERE tablename IN ('subcategories','product_variants');");
    console.log('Tables found:', tables.rows);

    const fn = await client.query("SELECT proname FROM pg_proc WHERE proname = 'process_sale';");
    console.log('Functions found:', fn.rows);

    try {
      const sample = await client.query('SELECT id, sku, current_stock FROM product_variants LIMIT 5;');
      console.log('product_variants sample:', sample.rows);
    } catch (e) {
      console.log('product_variants not present or query failed:', e.message);
    }

    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err.message || err);
    try { await client.query('ROLLBACK'); } catch (e) {}
    process.exit(2);
  } finally {
    try { await client.end(); } catch (e) {}
  }
}

run();

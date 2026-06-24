'use strict';

// Copies all data from the live (production) database into the alpha database.
// Wipes alpha first so it's a clean snapshot of live.
//
// Usage:
//   node refresh-alpha.js <LIVE_DATABASE_URL> <ALPHA_DATABASE_URL>
//
// Get both External Database URLs from the Render dashboard (each DB -> Info).

const { Pool } = require('pg');

const [,, LIVE_URL, ALPHA_URL] = process.argv;
if (!LIVE_URL || !ALPHA_URL) {
  console.error('Usage: node refresh-alpha.js <LIVE_DATABASE_URL> <ALPHA_DATABASE_URL>');
  process.exit(1);
}

const live  = new Pool({ connectionString: LIVE_URL,  ssl: { rejectUnauthorized: false } });
const alpha = new Pool({ connectionString: ALPHA_URL, ssl: { rejectUnauthorized: false } });

// Tables in dependency order (parents before children)
const TABLES = [
  'users',
  'client_accounts',
  'client_memberships',
  'properties',
  'cleaners',
  'listings',
  'manager_property_assignments',
  'manager_listing_assignments',
  'guest_relationships',
  'calendar_feeds',
  'feed_source_colors',
  'cached_events',
  'booked_in_changes',
  'shared_resources',
  'shared_resource_reservations',
  'app_runtime_flags',
];

async function truncateAll(client) {
  for (const table of [...TABLES].reverse()) {
    await client.query(`TRUNCATE TABLE IF EXISTS "${table}" RESTART IDENTITY CASCADE`).catch(() => {});
  }
}

async function copyTable(tableName) {
  const { rows } = await live.query(`SELECT * FROM "${tableName}"`);
  if (rows.length === 0) {
    console.log(`  ${tableName}: (empty)`);
    return;
  }

  const cols = Object.keys(rows[0]);
  const colList = cols.map(c => `"${c}"`).join(', ');

  for (const row of rows) {
    const vals = cols.map((_, i) => `$${i + 1}`).join(', ');
    await alpha.query(
      `INSERT INTO "${tableName}" (${colList}) VALUES (${vals})`,
      cols.map(c => row[c])
    );
  }

  if (cols.includes('id')) {
    await alpha.query(`
      SELECT setval(
        pg_get_serial_sequence('"${tableName}"', 'id'),
        COALESCE(MAX(id), 0) + 1, false
      ) FROM "${tableName}"
    `);
  }

  console.log(`  ${tableName}: ${rows.length} row(s) copied`);
}

async function main() {
  console.log('Refreshing alpha database from live...\n');

  const alphaClient = await alpha.connect();
  try {
    console.log('Clearing alpha tables...');
    await alphaClient.query('BEGIN');
    await truncateAll(alphaClient);
    await alphaClient.query('COMMIT');
  } catch (e) {
    await alphaClient.query('ROLLBACK');
    throw e;
  } finally {
    alphaClient.release();
  }

  console.log('\nCopying data from live...');
  for (const table of TABLES) {
    try {
      await copyTable(table);
    } catch (err) {
      if (err.message && err.message.includes('does not exist')) {
        console.log(`  ${table}: not in source, skipping`);
      } else {
        throw err;
      }
    }
  }

  console.log('\nDone. Alpha is now a copy of live.');
  await live.end();
  await alpha.end();
}

main().catch(err => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});

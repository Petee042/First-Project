'use strict';

// Usage:
//   node migrate-db.js <SOURCE_DATABASE_URL> <TARGET_DATABASE_URL>
//
// Copies all data from a source database into a target database.
// Safe to re-run: truncates target tables before copying.
// The target schema is created by the app's own migration on first boot,
// so run this AFTER automaticpeople-db has been initialised by deploying
// the app once (even a failed start is enough for schema creation).

const { Pool } = require('pg');

const [,, SOURCE_URL, TARGET_URL] = process.argv;
if (!SOURCE_URL || !TARGET_URL) {
  console.error('Usage: node migrate-db.js <SOURCE_URL> <TARGET_URL>');
  process.exit(1);
}

const src = new Pool({ connectionString: SOURCE_URL, ssl: { rejectUnauthorized: false } });
const tgt = new Pool({ connectionString: TARGET_URL, ssl: { rejectUnauthorized: false } });

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

async function copyTable(tableName) {
  const { rows } = await src.query(`SELECT * FROM "${tableName}"`);
  if (rows.length === 0) {
    console.log(`  ${tableName}: empty, skipping`);
    return;
  }

  const cols = Object.keys(rows[0]);
  const colList = cols.map(c => `"${c}"`).join(', ');

  // Truncate target table (cascade to handle FK references within the set)
  await tgt.query(`TRUNCATE TABLE "${tableName}" RESTART IDENTITY CASCADE`);

  for (const row of rows) {
    const vals = cols.map((_, i) => `$${i + 1}`).join(', ');
    await tgt.query(
      `INSERT INTO "${tableName}" (${colList}) VALUES (${vals})`,
      cols.map(c => row[c])
    );
  }

  // Reset the sequence to max(id) + 1 if there's a serial id column
  if (cols.includes('id')) {
    await tgt.query(`
      SELECT setval(
        pg_get_serial_sequence('"${tableName}"', 'id'),
        COALESCE(MAX(id), 0) + 1, false
      ) FROM "${tableName}"
    `);
  }

  console.log(`  ${tableName}: ${rows.length} row(s) copied`);
}

async function main() {
  console.log('Starting database migration...\n');

  // Disable FK checks isn't possible in Postgres, so we truncate in reverse order first
  console.log('Truncating target tables in reverse order...');
  const tgtClient = await tgt.connect();
  try {
    await tgtClient.query('BEGIN');
    for (const table of [...TABLES].reverse()) {
      await tgtClient.query(`TRUNCATE TABLE IF EXISTS "${table}" RESTART IDENTITY CASCADE`).catch(() => {});
    }
    await tgtClient.query('COMMIT');
  } catch (e) {
    await tgtClient.query('ROLLBACK');
    throw e;
  } finally {
    tgtClient.release();
  }

  console.log('\nCopying tables...');
  for (const table of TABLES) {
    try {
      await copyTable(table);
    } catch (err) {
      if (err.message && err.message.includes('does not exist')) {
        console.log(`  ${table}: table does not exist in source, skipping`);
      } else {
        throw err;
      }
    }
  }

  console.log('\nMigration complete.');
  await src.end();
  await tgt.end();
}

main().catch(err => {
  console.error('\nMigration failed:', err.message);
  process.exit(1);
});

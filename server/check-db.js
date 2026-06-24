'use strict';
const { Pool } = require('pg');
const url = process.argv[2];
if (!url) { console.error('Usage: node check-db.js <DATABASE_URL>'); process.exit(1); }
const p = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
p.query("SELECT table_name, (SELECT COUNT(*) FROM information_schema.columns WHERE table_name=t.table_name AND table_schema='public') AS col_count FROM information_schema.tables t WHERE table_schema='public' ORDER BY table_name")
  .then(r => {
    console.log('Tables found:', r.rows.length);
    r.rows.forEach(x => console.log(' -', x.table_name, '('+x.col_count+' cols)'));
  })
  .catch(e => console.error('Connection/query error:', e.message))
  .finally(() => p.end());

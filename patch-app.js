'use strict';
const fs = require('fs');
let content = fs.readFileSync('c:/Users/peter/AutomaticPeople/server/app.js', 'utf8');

// 1. Insert helper functions after writeEventLog
const ANCHOR = '// Import rules pipeline';
const HELPERS = `
async function logIcsTransaction(opts) {
  const { listingId, channelId, importingChannelLabel, exportingChannelLabel, importUrl, status, eventCount, rawPayload, errorText } = opts || {};
  try {
    await pool.query(
      \`INSERT INTO ics_transaction_log
         (listing_id, channel_id, importing_channel_label, exporting_channel_label,
          import_url, status, event_count, raw_payload, error_text)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)\`,
      [
        listingId || null,
        channelId || null,
        String(importingChannelLabel || ''),
        String(exportingChannelLabel || ''),
        String(importUrl || ''),
        String(status || 'success'),
        Number(eventCount || 0),
        String(rawPayload || '').slice(0, 65536),
        errorText || null
      ]
    );
  } catch (logErr) {
    console.error('[IcsTransactionLog] Failed to log transaction:', logErr && logErr.message);
  }
}

async function findExportingChannelLabel(importUrl) {
  if (!importUrl) return '';
  try {
    const result = await pool.query(
      \`SELECT label FROM listing_channels
       WHERE NULLIF(TRIM(export_url), '') IS NOT NULL AND export_url = $1
       LIMIT 1\`,
      [importUrl]
    );
    if (result.rows[0]) return String(result.rows[0].label || '');
    const parsed = new URL(importUrl);
    return parsed.hostname;
  } catch (_e) {
    return String(importUrl).slice(0, 120);
  }
}

`;

if (!content.includes(ANCHOR)) {
  console.error('ANCHOR not found!');
  process.exit(1);
}
content = content.replace(ANCHOR, HELPERS + ANCHOR);
console.log('Step 1 done');

// 2. Return rawText from fetchEventsFromCalendarUrl
const OLD_RETURN = 'return { events };';
const NEW_RETURN = 'return { events, rawText: icsText };';
if (!content.includes(OLD_RETURN)) {
  console.error('OLD_RETURN not found!');
} else {
  content = content.replace(OLD_RETURN, NEW_RETURN);
  console.log('Step 2 done');
}

// 3. Log ICS transactions in syncChannelEvents
const OLD_SYNC = `  if (fetched.error) {
    console.error(\`[CalendarSync] Listing \${listingId} channel "\${channel.label}": \${fetched.error}\`);
    return;
  }

  const now = new Date().toISOString();`;

const NEW_SYNC = `  if (fetched.error) {
    console.error(\`[CalendarSync] Listing \${listingId} channel "\${channel.label}": \${fetched.error}\`);
    const exportingLabelErr = await findExportingChannelLabel(importUrl);
    await logIcsTransaction({ listingId, channelId, importingChannelLabel: channel.label, exportingChannelLabel: exportingLabelErr, importUrl, status: 'error', eventCount: 0, rawPayload: '', errorText: fetched.error });
    return;
  }

  const exportingLabel = await findExportingChannelLabel(importUrl);
  await logIcsTransaction({ listingId, channelId, importingChannelLabel: channel.label, exportingChannelLabel: exportingLabel, importUrl, status: 'success', eventCount: fetched.events.length, rawPayload: fetched.rawText || '', errorText: null });

  const now = new Date().toISOString();`;

if (!content.includes(OLD_SYNC)) {
  console.error('OLD_SYNC not found!');
} else {
  content = content.replace(OLD_SYNC, NEW_SYNC);
  console.log('Step 3 done');
}

// 4. Add admin ICS log endpoint before /health
const HEALTH_ANCHOR = '// GET /health — simple health check for Render';
const ICS_LOG_ENDPOINT = `// GET /api/admin/ics-log — ICS transaction log for admin diagnostics
app.get('/api/admin/ics-log', requireAdminAuth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const result = await pool.query(
      \`SELECT id, logged_at, listing_id, channel_id,
              importing_channel_label, exporting_channel_label,
              import_url, status, event_count,
              raw_payload, error_text
       FROM ics_transaction_log
       ORDER BY logged_at DESC
       LIMIT $1 OFFSET $2\`,
      [limit, offset]
    );
    const countResult = await pool.query('SELECT COUNT(*)::int AS total FROM ics_transaction_log');
    return res.json({
      entries: result.rows,
      total: Number(countResult.rows[0].total || 0),
      limit,
      offset
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load ICS transaction log.' });
  }
});

`;

if (!content.includes(HEALTH_ANCHOR)) {
  console.error('HEALTH_ANCHOR not found!');
} else {
  content = content.replace(HEALTH_ANCHOR, ICS_LOG_ENDPOINT + HEALTH_ANCHOR);
  console.log('Step 4 done');
}

fs.writeFileSync('c:/Users/peter/AutomaticPeople/server/app.js', content, 'utf8');
console.log('All done. File size:', content.length);

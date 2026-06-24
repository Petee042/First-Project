'use strict';
const fs = require('fs');
let content = fs.readFileSync('c:/Users/peter/AutomaticPeople/server/app.js', 'utf8');

const OLD_SYNC = "    console.error(`[CalendarSync] Listing ${listingId} channel \"${channel.label}\": ${fetched.error}`);\r\n    return;\r\n  }\r\n\r\n  const now = new Date().toISOString();";

const NEW_SYNC = "    console.error(`[CalendarSync] Listing ${listingId} channel \"${channel.label}\": ${fetched.error}`);\r\n    const exportingLabelErr = await findExportingChannelLabel(importUrl);\r\n    await logIcsTransaction({ listingId, channelId, importingChannelLabel: channel.label, exportingChannelLabel: exportingLabelErr, importUrl, status: 'error', eventCount: 0, rawPayload: '', errorText: fetched.error });\r\n    return;\r\n  }\r\n\r\n  const exportingLabel = await findExportingChannelLabel(importUrl);\r\n  await logIcsTransaction({ listingId, channelId, importingChannelLabel: channel.label, exportingChannelLabel: exportingLabel, importUrl, status: 'success', eventCount: fetched.events.length, rawPayload: fetched.rawText || '', errorText: null });\r\n\r\n  const now = new Date().toISOString();";

if (!content.includes(OLD_SYNC)) {
  console.error('OLD_SYNC still not found!');
  process.exit(1);
}

content = content.replace(OLD_SYNC, NEW_SYNC);
fs.writeFileSync('c:/Users/peter/AutomaticPeople/server/app.js', content, 'utf8');
console.log('Step 3 done. File size:', content.length);

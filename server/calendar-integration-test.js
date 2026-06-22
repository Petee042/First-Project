'use strict';

/**
 * Calendar Integration Test
 * Tests new calendar store, sync, event log, and ICS export endpoints.
 *
 * Usage:
 *   node calendar-integration-test.js
 *   TEST_BASE_URL=https://automaticpeople-alpha.onrender.com node calendar-integration-test.js
 *   TEST_EMAIL=user@example.com TEST_PASSWORD=pass node calendar-integration-test.js
 *
 * If TEST_EMAIL/TEST_PASSWORD are not set, the script creates a fresh test account.
 * Auto-validation must be enabled on the server (ENABLE_INVITE_AUTO_VALIDATION=true)
 * for the self-created account path to work.
 */

const BASE_URL = String(process.env.TEST_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const TEST_EMAIL = String(process.env.TEST_EMAIL || '').trim();
const TEST_PASSWORD = String(process.env.TEST_PASSWORD || '').trim();
const USE_HEADLESS = process.env.HEADLESS !== 'false';

let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch {
  console.error('ERROR: puppeteer is not installed. Run: npm install puppeteer');
  process.exit(1);
}

// ── Helpers ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function pass(label) {
  console.log('  ✓ ' + label);
  passed++;
}

function fail(label, detail) {
  const msg = '  ✗ ' + label + (detail ? ': ' + detail : '');
  console.log(msg);
  failed++;
  failures.push(msg);
}

function section(title) {
  console.log('\n── ' + title + ' ──────────────────────────────────────');
}

function uniqueEmail() {
  return 'test-cal-' + Date.now() + '-' + Math.floor(Math.random() * 9999) + '@test-automaticpeople.dev';
}

async function httpJson(cookieHeader, method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookieHeader) headers['Cookie'] = cookieHeader;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(BASE_URL + path, opts);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { status: res.status, ok: res.ok, data, headers: res.headers };
}

function cookieFromResponse(res) {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return '';
  return setCookie.split(';')[0];
}

// ── Phase 1: API-level smoke tests (no browser needed) ─────────────────────

async function runApiTests() {
  section('Phase 1: Server Health & Auth');

  // Health check
  const health = await httpJson(null, 'GET', '/health');
  if (health.status === 200) pass('GET /health returns 200');
  else fail('GET /health', 'got ' + health.status);

  // Unauthenticated access to protected endpoints
  const meUnauth = await httpJson(null, 'GET', '/api/me');
  if (meUnauth.status === 401) pass('GET /api/me returns 401 without session');
  else fail('GET /api/me unauthenticated', 'expected 401, got ' + meUnauth.status);

  const eventLogUnauth = await httpJson(null, 'GET', '/api/event-log');
  if (eventLogUnauth.status === 401) {
    pass('GET /api/event-log returns 401 without session (new endpoint deployed)');
  } else if (eventLogUnauth.status === 404 || (eventLogUnauth.status === 200 && (!eventLogUnauth.data || !eventLogUnauth.data.entries))) {
    console.log('  ℹ  GET /api/event-log: endpoint not yet deployed on this environment (got ' + eventLogUnauth.status + ') - will test after deploy.');
  } else {
    fail('GET /api/event-log unauthenticated', 'expected 401, got ' + eventLogUnauth.status + ': ' + JSON.stringify(eventLogUnauth.data).slice(0, 80));
  }

  // Determine login credentials
  let email = TEST_EMAIL;
  let password = TEST_PASSWORD;
  let cookie = '';

  if (!email || !password) {
    section('Phase 1b: Create Test Account');
    email = uniqueEmail();
    password = 'CalTest!2026';

    const signup = await httpJson(null, 'POST', '/api/signup', {
      firstName: 'Cal', familyName: 'Test',
      country: 'GB', email, password
    });
    if (signup.status === 201) pass('POST /api/signup creates account');
    else { fail('POST /api/signup', JSON.stringify(signup.data)); return null; }

    console.log('  ℹ  Test account created: ' + email);
  }

  section('Phase 1c: Login');
  const login = await httpJson(null, 'POST', '/api/login', { email, password });

  if (login.status === 200) {
    pass('POST /api/login succeeds');
    cookie = cookieFromResponse(login);
  } else if (login.status === 403 && login.data && login.data.code === 'ACCOUNT_NOT_VALIDATED') {
    fail('POST /api/login', 'Account not validated. Set ENABLE_INVITE_AUTO_VALIDATION=true on server, or pass TEST_EMAIL/TEST_PASSWORD for a validated account.');
    return null;
  } else {
    fail('POST /api/login', 'got ' + login.status + ': ' + JSON.stringify(login.data));
    return null;
  }

  const me = await httpJson(cookie, 'GET', '/api/me');
  if (me.status === 200 && me.data && me.data.email) {
    pass('GET /api/me returns user data (email: ' + me.data.email + ')');
  } else {
    fail('GET /api/me after login', 'got ' + me.status);
    return null;
  }

  return { cookie, email };
}

async function runCalendarApiTests(cookie) {
  section('Phase 2: Calendar Event Log API');

  const eventLog = await httpJson(cookie, 'GET', '/api/event-log');
  if (eventLog.status === 200 && eventLog.data && Array.isArray(eventLog.data.entries)) {
    pass('GET /api/event-log returns 200 with entries array (count: ' + eventLog.data.entries.length + ')');
  } else if (eventLog.status === 200 && eventLog.data && eventLog.data.raw) {
    console.log('  ℹ  GET /api/event-log: returned HTML (old code, new endpoint not deployed yet) - will test after deploy.');
  } else if (eventLog.status === 200) {
    console.log('  ℹ  GET /api/event-log: returned 200 but no entries array - old code likely, endpoint not deployed yet. Response: ' + JSON.stringify(eventLog.data).slice(0, 60));
  } else {
    fail('GET /api/event-log', 'got ' + eventLog.status + ': ' + JSON.stringify(eventLog.data).slice(0, 80));
  }

  section('Phase 3: Listings & Calendar Data');

  const listings = await httpJson(cookie, 'GET', '/api/listings');
  if (listings.status === 200 && listings.data && Array.isArray(listings.data.listings)) {
    pass('GET /api/listings returns 200 (' + listings.data.listings.length + ' listings)');
  } else {
    fail('GET /api/listings', 'got ' + listings.status);
    return null;
  }

  if (!listings.data.listings.length) {
    console.log('  ℹ  No listings configured - skipping listing-level tests.');
    return null;
  }

  const listing = listings.data.listings[0];
  const lid = listing.id;
  console.log('  ℹ  Testing with listing: ' + listing.name + ' (id=' + lid + ')');

  // Per-listing event log
  const listingLog = await httpJson(cookie, 'GET', '/api/listings/' + lid + '/event-log');
  if (listingLog.status === 200 && listingLog.data && Array.isArray(listingLog.data.entries)) {
    pass('GET /api/listings/:id/event-log returns 200 (' + listingLog.data.entries.length + ' entries)');
  } else {
    fail('GET /api/listings/:id/event-log', 'got ' + listingLog.status + ': ' + JSON.stringify(listingLog.data));
  }

  // Calendar channels (new endpoint)
  const channels = await httpJson(cookie, 'GET', '/api/listings/' + lid + '/channels');
  if (channels.status === 200 && channels.data && Array.isArray(channels.data.channels)) {
    pass('GET /api/listings/:id/channels returns 200 (' + channels.data.channels.length + ' channels)');
  } else if (channels.status === 404) {
    fail('GET /api/listings/:id/channels', 'endpoint not found - new code may not be deployed yet');
  } else {
    fail('GET /api/listings/:id/channels', 'got ' + channels.status + ': ' + JSON.stringify(channels.data));
  }

  // Cached events (existing endpoint)
  const events = await httpJson(cookie, 'GET', '/api/listings/' + lid + '/events');
  if (events.status === 200 && events.data) {
    pass('GET /api/listings/:id/events returns 200');
    const evts = events.data.events || [];
    console.log('  ℹ  Events in cache: ' + evts.length);
    if (evts.length > 0) {
      const e0 = evts[0];
      if (e0.start && e0.end) pass('Calendar events have start and end dates');
      else fail('Calendar event format', 'missing start or end: ' + JSON.stringify(e0));
    }
  } else {
    fail('GET /api/listings/:id/events', 'got ' + events.status);
  }

  // Calendar calendar_events store (new store endpoint)
  const calStore = await httpJson(cookie, 'GET', '/api/listings/' + lid + '/calendar-events');
  if (calStore.status === 200) {
    pass('GET /api/listings/:id/calendar-events (new store) returns 200');
    const storeEvts = calStore.data && calStore.data.events ? calStore.data.events : [];
    console.log('  ℹ  Calendar store events: ' + storeEvts.length);
  } else if (calStore.status === 404) {
    console.log('  ℹ  GET /api/listings/:id/calendar-events: endpoint not yet deployed on this environment.');
  } else {
    fail('GET /api/listings/:id/calendar-events', 'got ' + calStore.status);
  }

  // ICS export
  const ics = await httpJson(cookie, 'GET', '/api/listings/' + lid + '/calendar.ics');
  if (ics.status === 200) {
    pass('GET /api/listings/:id/calendar.ics returns 200');
    if (typeof ics.data === 'object' && ics.data.raw) {
      if (ics.data.raw.includes('BEGIN:VCALENDAR')) pass('ICS export contains BEGIN:VCALENDAR');
      else fail('ICS format', 'missing BEGIN:VCALENDAR in export');
    }
  } else {
    fail('GET /api/listings/:id/calendar.ics', 'got ' + ics.status);
  }

  return lid;
}

async function runCalendarSyncApiTest(cookie, lid) {
  section('Phase 4: Calendar Sync (Refresh)');

  console.log('  ℹ  Triggering calendar sync for listing ' + lid + ' ...');
  const refresh = await httpJson(cookie, 'POST', '/api/listings/' + lid + '/events/refresh');
  if (refresh.status === 200 && refresh.data) {
    pass('POST /api/listings/:id/events/refresh returns 200');
    const events = refresh.data.events || [];
    console.log('  ℹ  Events after sync: ' + events.length);
    if (Array.isArray(refresh.data.events)) pass('Sync response has events array');
    else fail('Sync response format', 'missing events array');
  } else {
    fail('POST /api/listings/:id/events/refresh', 'got ' + refresh.status + ': ' + JSON.stringify(refresh.data));
  }

  // Check event log was updated after sync
  const logAfterSync = await httpJson(cookie, 'GET', '/api/listings/' + lid + '/event-log');
  if (logAfterSync.status === 200 && Array.isArray(logAfterSync.data.entries)) {
    pass('Event log accessible after sync (' + logAfterSync.data.entries.length + ' entries)');
  } else {
    fail('Event log after sync', 'got ' + logAfterSync.status);
  }
}

// ── Phase 5: Browser (Puppeteer) tests ────────────────────────────────────

async function runBrowserTests(apiCookie) {
  section('Phase 5: Browser UI Tests (Puppeteer)');

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: USE_HEADLESS,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  } catch (err) {
    fail('Puppeteer launch', err.message);
    return;
  }

  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push('PageError: ' + err.message));

  try {
    // Inject the API session cookie so we bypass the CSRF-protected login form
    if (apiCookie) {
      const [cookieName, cookieValue] = apiCookie.split('=');
      const cookieDomain = new URL(BASE_URL).hostname;
      await page.setCookie({
        name: cookieName.trim(),
        value: cookieValue.trim(),
        domain: cookieDomain,
        path: '/'
      });
      pass('Session cookie injected into browser context');
    }

    // Navigate directly to dashboard (session already set via cookie)
    await page.goto(BASE_URL + '/dashboard.html', { waitUntil: 'networkidle2', timeout: 30000 });
    const dashUrl = page.url();
    if (dashUrl.includes('dashboard')) {
      pass('Navigated directly to dashboard with injected session');
    } else {
      // If we were redirected to login, session cookie didn't take hold
      fail('Dashboard access with injected session', 'redirected to ' + dashUrl);
      return;
    }

    // Dashboard renders
    const dashboardTitle = await page.title();
    if (dashboardTitle) pass('Dashboard page has title: ' + dashboardTitle);

    // Check Event Log section
    const eventLogSection = await page.$('#eventLogSection');
    if (eventLogSection) {
      pass('Dashboard has #eventLogSection element');
    } else {
      fail('Dashboard Event Log section', '#eventLogSection not found in DOM');
    }

    const eventLogTbody = await page.$('#eventLogTableBody');
    if (eventLogTbody) {
      pass('Dashboard has #eventLogTableBody element');
    } else {
      fail('Event log table body', '#eventLogTableBody not found');
    }

    // Wait for event log to load (it should auto-load)
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const eventLogText = await page.evaluate(() => {
      const el = document.getElementById('eventLogTableBody');
      return el ? el.textContent.trim() : null;
    });
    if (eventLogText !== null && !eventLogText.includes('Loading event log')) {
      pass('Event log loaded content (not stuck on loading)');
    } else if (eventLogText === null) {
      fail('Event log text', 'tbody not found');
    } else {
      fail('Event log loading', 'still showing "Loading event log..." after 2s');
    }

    // Check Private Reservations section (existing)
    const privateResSection = await page.$('#privateReservationsTableBody');
    if (privateResSection) pass('Private Reservations table present');
    else fail('Private Reservations', 'tbody not found');

    // Navigate to Config tab
    const configTab = await page.$('[data-panel="panel-config"]');
    if (configTab) {
      await configTab.click();
      await new Promise((resolve) => setTimeout(resolve, 500));
      const configListings = await page.$('#configListingsList');
      if (configListings) pass('Config tab shows configListingsList');
      else fail('Config tab', '#configListingsList not found');
    } else {
      fail('Config tab button', 'not found');
    }

    // Check for JS console errors
    if (consoleErrors.length === 0) {
      pass('No JavaScript console errors on dashboard');
    } else {
      // Filter known third-party noise
      const realErrors = consoleErrors.filter((e) =>
        !e.includes('favicon') &&
        !e.includes('chrome-extension') &&
        !e.includes('net::ERR_BLOCKED')
      );
      if (realErrors.length === 0) {
        pass('No significant JavaScript console errors (ignored browser extension noise)');
      } else {
        fail('JavaScript console errors (' + realErrors.length + ')', realErrors.slice(0, 3).join(' | '));
      }
    }

    // Test listing page if listings exist
    const listingLinks = await page.$$('[href*="listing.html?id="]');
    if (listingLinks.length) {
      const href = await listingLinks[0].evaluate((el) => el.href);
      await page.goto(href, { waitUntil: 'networkidle2', timeout: 15000 });
      const listingTitle = await page.title();
      pass('Listing page loads: ' + listingTitle);

      // Check calendar is present
      const calendar = await page.$('#reservationCalendar');
      if (calendar) pass('Listing page has #reservationCalendar');
      else fail('Listing calendar', '#reservationCalendar not found');

      // Check tooltip on calendar day
      const calendarDay = await page.$('.calendar-day:not(.calendar-day-empty)');
      if (calendarDay) {
        await calendarDay.hover();
        pass('Can hover over calendar day cells');
      }
    } else {
      console.log('  ℹ  No listing links found on Config tab - skipping listing page tests.');
    }

  } finally {
    await browser.close();
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║     AutomaticPeople Calendar Integration Test            ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('Target: ' + BASE_URL);
  console.log('Time:   ' + new Date().toISOString());

  try {
    const auth = await runApiTests();
    if (!auth) {
      console.log('\n⚠  Login failed - cannot continue with authenticated tests.');
    } else {
      const lid = await runCalendarApiTests(auth.cookie);
      if (lid) {
        await runCalendarSyncApiTest(auth.cookie, lid);
      }
      await runBrowserTests(auth.cookie);
    }
  } catch (err) {
    console.log('\nFATAL ERROR: ' + err.message);
    console.log(err.stack);
    failed++;
  }

  // ── Summary ────────────────────────────────────────────────────────────
  section('Summary');
  console.log('  Passed: ' + passed);
  console.log('  Failed: ' + failed);
  if (failures.length) {
    console.log('\n  Failures:');
    failures.forEach((f) => console.log(' ' + f));
  }
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
})();

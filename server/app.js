'use strict';

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SALT_ROUNDS = 12;
const SESSION_SECRET = process.env.SESSION_SECRET || 'replace-this-secret-in-production';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'Peterku';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Quiblick!3';
const usersFile = path.join(__dirname, 'users.json');
const listingsFile = path.join(__dirname, 'listings.json');
const usePostgres = Boolean(process.env.DATABASE_URL);
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

const pool = usePostgres
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    })
  : null;

// ── User storage ─────────────────────────────────────────────────────────────
function readUsersFromFile() {
  if (!fs.existsSync(usersFile)) {
    fs.writeFileSync(usersFile, '[]', 'utf8');
  }

  const content = fs.readFileSync(usersFile, 'utf8');
  return JSON.parse(content);
}

function writeUsersToFile(users) {
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2), 'utf8');
}

function ensureLocalListingsStore() {
  if (!fs.existsSync(listingsFile)) {
    fs.writeFileSync(listingsFile, JSON.stringify({ listings: [], feeds: [], source_colors: [] }, null, 2), 'utf8');
  }
}

function readListingsStore() {
  ensureLocalListingsStore();
  const content = fs.readFileSync(listingsFile, 'utf8');
  const parsed = JSON.parse(content);
  if (!parsed || !Array.isArray(parsed.listings) || !Array.isArray(parsed.feeds)) {
    return { listings: [], feeds: [], source_colors: [] };
  }
  if (!Array.isArray(parsed.source_colors)) {
    parsed.source_colors = [];
  }
  return parsed;
}

function writeListingsStore(store) {
  fs.writeFileSync(listingsFile, JSON.stringify(store, null, 2), 'utf8');
}

function normaliseCalendarUrl(rawUrl) {
  const trimmed = String(rawUrl || '')
    .trim()
    .replace(/^<+|>+$/g, '')
    .replace(/^"+|"+$/g, '')
    .replace(/^'+|'+$/g, '')
    .replace(/&amp;/gi, '&');
  if (!trimmed) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }

  // Preserve the original URL string to avoid mutating signed feed query parameters.
  return trimmed;
}

function decodeHtmlEntitiesForUrl(value) {
  return String(value || '').replace(/&amp;/gi, '&');
}

function previewBodyText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 180);
}

function isBookingInvalidTokenError(url, status, bodyText) {
  if (!/booking\.com/i.test(String(url || ''))) {
    return false;
  }
  if (Number(status) !== 400) {
    return false;
  }

  const raw = String(bodyText || '');
  const lower = raw.toLowerCase();
  if (lower.includes('invalid token')) {
    return true;
  }

  try {
    const parsed = JSON.parse(raw);
    const detail = String(parsed.detail || '').toLowerCase();
    return detail.includes('invalid token');
  } catch {
    return false;
  }
}

function normaliseColor(value) {
  const color = String(value || '').trim();
  if (!HEX_COLOR_REGEX.test(color)) {
    return null;
  }
  return color.toLowerCase();
}

async function initializeUserStore() {
  if (!usePostgres) {
    if (!fs.existsSync(usersFile)) {
      fs.writeFileSync(usersFile, '[]', 'utf8');
    }
    ensureLocalListingsStore();
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS listings (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, name)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS calendar_feeds (
      id BIGSERIAL PRIMARY KEY,
      listing_id BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      url TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS feed_source_colors (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, label)
    )
  `);

  await migrateUsersFromFile();
}

async function migrateUsersFromFile() {
  if (!fs.existsSync(usersFile)) {
    return;
  }

  const users = readUsersFromFile();
  if (!Array.isArray(users) || users.length === 0) {
    return;
  }

  for (const user of users) {
    await pool.query(
      `
        INSERT INTO users (id, username, email, password_hash, created_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
      `,
      [user.id, user.username, user.email, user.password_hash, user.created_at]
    );
  }

  const result = await pool.query('SELECT COALESCE(MAX(id), 0) AS max_id FROM users');
  const maxId = Number(result.rows[0].max_id);

  if (maxId > 0) {
    await pool.query(
      "SELECT setval(pg_get_serial_sequence('users', 'id'), $1)",
      [maxId]
    );
  }
}

async function findUserByEmail(email) {
  if (!usePostgres) {
    return readUsersFromFile().find((user) => user.email === email);
  }

  const result = await pool.query('SELECT * FROM users WHERE email = $1 LIMIT 1', [email]);
  return result.rows[0];
}

async function findUserByUsername(username) {
  if (!usePostgres) {
    return readUsersFromFile().find((user) => user.username === username);
  }

  const result = await pool.query('SELECT * FROM users WHERE username = $1 LIMIT 1', [username]);
  return result.rows[0];
}

async function createUser(username, email, passwordHash) {
  if (!usePostgres) {
    const users = readUsersFromFile();
    const nextId = users.length ? Math.max(...users.map((user) => user.id)) + 1 : 1;

    const user = {
      id: nextId,
      username,
      email,
      password_hash: passwordHash,
      created_at: new Date().toISOString()
    };

    users.push(user);
    writeUsersToFile(users);
    return user;
  }

  const result = await pool.query(
    `
      INSERT INTO users (username, email, password_hash)
      VALUES ($1, $2, $3)
      RETURNING id, username, email, password_hash, created_at
    `,
    [username, email, passwordHash]
  );

  return result.rows[0];
}

async function getAllUsers() {
  if (!usePostgres) {
    return readUsersFromFile()
      .slice()
      .sort((a, b) => String(a.username).localeCompare(String(b.username)))
      .map((user) => ({
        id: user.id,
        username: user.username,
        email: user.email,
        created_at: user.created_at
      }));
  }

  const result = await pool.query(
    'SELECT id, username, email, created_at FROM users ORDER BY username ASC'
  );
  return result.rows;
}

async function deleteUserAndData(userId) {
  if (!usePostgres) {
    const users = readUsersFromFile();
    const existing = users.find((user) => Number(user.id) === Number(userId));
    if (!existing) {
      return { error: 'User not found.' };
    }

    const remainingUsers = users.filter((user) => Number(user.id) !== Number(userId));
    writeUsersToFile(remainingUsers);

    const store = readListingsStore();
    const removedListingIds = new Set(
      store.listings
        .filter((listing) => Number(listing.user_id) === Number(userId))
        .map((listing) => Number(listing.id))
    );

    const updatedStore = {
      listings: store.listings.filter((listing) => Number(listing.user_id) !== Number(userId)),
      feeds: store.feeds.filter((feed) => !removedListingIds.has(Number(feed.listing_id))),
      source_colors: (store.source_colors || []).filter((row) => Number(row.user_id) !== Number(userId))
    };
    writeListingsStore(updatedStore);

    return { deletedUserId: Number(userId) };
  }

  const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [userId]);
  if (!result.rows[0]) {
    return { error: 'User not found.' };
  }

  return { deletedUserId: Number(result.rows[0].id) };
}

async function getListingsForUser(userId) {
  if (!usePostgres) {
    const store = readListingsStore();
    return store.listings
      .filter((listing) => Number(listing.user_id) === Number(userId))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  const result = await pool.query(
    'SELECT id, user_id, name, created_at FROM listings WHERE user_id = $1 ORDER BY name ASC',
    [userId]
  );
  return result.rows;
}

async function getListingByIdForUser(listingId, userId) {
  if (!usePostgres) {
    const store = readListingsStore();
    return store.listings.find(
      (listing) => Number(listing.id) === Number(listingId) && Number(listing.user_id) === Number(userId)
    );
  }

  const result = await pool.query(
    'SELECT id, user_id, name, created_at FROM listings WHERE id = $1 AND user_id = $2 LIMIT 1',
    [listingId, userId]
  );
  return result.rows[0];
}

async function createListingForUser(userId, name) {
  if (!usePostgres) {
    const store = readListingsStore();
    const alreadyExists = store.listings.some(
      (listing) => Number(listing.user_id) === Number(userId) && listing.name.toLowerCase() === name.toLowerCase()
    );

    if (alreadyExists) {
      return { error: 'A listing with this name already exists.' };
    }

    const nextId = store.listings.length
      ? Math.max(...store.listings.map((listing) => Number(listing.id))) + 1
      : 1;

    const listing = {
      id: nextId,
      user_id: Number(userId),
      name,
      created_at: new Date().toISOString()
    };

    store.listings.push(listing);
    writeListingsStore(store);
    return { listing };
  }

  try {
    const result = await pool.query(
      'INSERT INTO listings (user_id, name) VALUES ($1, $2) RETURNING id, user_id, name, created_at',
      [userId, name]
    );
    return { listing: result.rows[0] };
  } catch (err) {
    if (err && err.code === '23505') {
      return { error: 'A listing with this name already exists.' };
    }
    throw err;
  }
}

async function updateListingNameForUser(listingId, userId, name) {
  if (!usePostgres) {
    const store = readListingsStore();
    const idx = store.listings.findIndex(
      (listing) => Number(listing.id) === Number(listingId) && Number(listing.user_id) === Number(userId)
    );

    if (idx === -1) {
      return { error: 'Listing not found.' };
    }

    const duplicate = store.listings.some(
      (listing) =>
        Number(listing.user_id) === Number(userId) &&
        Number(listing.id) !== Number(listingId) &&
        listing.name.toLowerCase() === name.toLowerCase()
    );

    if (duplicate) {
      return { error: 'A listing with this name already exists.' };
    }

    store.listings[idx].name = name;
    writeListingsStore(store);
    return { listing: store.listings[idx] };
  }

  try {
    const result = await pool.query(
      'UPDATE listings SET name = $1 WHERE id = $2 AND user_id = $3 RETURNING id, user_id, name, created_at',
      [name, listingId, userId]
    );

    if (!result.rows[0]) {
      return { error: 'Listing not found.' };
    }
    return { listing: result.rows[0] };
  } catch (err) {
    if (err && err.code === '23505') {
      return { error: 'A listing with this name already exists.' };
    }
    throw err;
  }
}

async function getFeedsForListing(listingId, userId) {
  if (!usePostgres) {
    const store = readListingsStore();
    const ownedListing = store.listings.find(
      (listing) => Number(listing.id) === Number(listingId) && Number(listing.user_id) === Number(userId)
    );
    if (!ownedListing) {
      return null;
    }

    return store.feeds
      .filter((feed) => Number(feed.listing_id) === Number(listingId))
      .sort((a, b) => Number(a.id) - Number(b.id));
  }

  const listingResult = await pool.query(
    'SELECT id FROM listings WHERE id = $1 AND user_id = $2 LIMIT 1',
    [listingId, userId]
  );
  if (!listingResult.rows[0]) {
    return null;
  }

  const result = await pool.query(
    'SELECT id, listing_id, label, url, created_at FROM calendar_feeds WHERE listing_id = $1 ORDER BY id ASC',
    [listingId]
  );
  return result.rows;
}

async function createFeedForListing(listingId, userId, label, url) {
  if (!usePostgres) {
    const store = readListingsStore();
    const ownedListing = store.listings.find(
      (listing) => Number(listing.id) === Number(listingId) && Number(listing.user_id) === Number(userId)
    );
    if (!ownedListing) {
      return { error: 'Listing not found.' };
    }

    const nextId = store.feeds.length
      ? Math.max(...store.feeds.map((feed) => Number(feed.id))) + 1
      : 1;

    const feed = {
      id: nextId,
      listing_id: Number(listingId),
      label,
      url,
      created_at: new Date().toISOString()
    };

    store.feeds.push(feed);
    writeListingsStore(store);
    return { feed };
  }

  const listingResult = await pool.query(
    'SELECT id FROM listings WHERE id = $1 AND user_id = $2 LIMIT 1',
    [listingId, userId]
  );
  if (!listingResult.rows[0]) {
    return { error: 'Listing not found.' };
  }

  const result = await pool.query(
    'INSERT INTO calendar_feeds (listing_id, label, url) VALUES ($1, $2, $3) RETURNING id, listing_id, label, url, created_at',
    [listingId, label, url]
  );
  return { feed: result.rows[0] };
}

async function updateFeedForListing(feedId, listingId, userId, label, url) {
  if (!usePostgres) {
    const store = readListingsStore();
    const ownedListing = store.listings.find(
      (listing) => Number(listing.id) === Number(listingId) && Number(listing.user_id) === Number(userId)
    );
    if (!ownedListing) {
      return { error: 'Listing not found.' };
    }

    const idx = store.feeds.findIndex(
      (feed) => Number(feed.id) === Number(feedId) && Number(feed.listing_id) === Number(listingId)
    );
    if (idx === -1) {
      return { error: 'Feed not found.' };
    }

    store.feeds[idx].label = label;
    store.feeds[idx].url = url;
    writeListingsStore(store);
    return { feed: store.feeds[idx] };
  }

  const listingResult = await pool.query(
    'SELECT id FROM listings WHERE id = $1 AND user_id = $2 LIMIT 1',
    [listingId, userId]
  );
  if (!listingResult.rows[0]) {
    return { error: 'Listing not found.' };
  }

  const result = await pool.query(
    'UPDATE calendar_feeds SET label = $1, url = $2 WHERE id = $3 AND listing_id = $4 RETURNING id, listing_id, label, url, created_at',
    [label, url, feedId, listingId]
  );

  if (!result.rows[0]) {
    return { error: 'Feed not found.' };
  }

  return { feed: result.rows[0] };
}

async function getFeedSourcesForUser(userId) {
  if (!usePostgres) {
    const store = readListingsStore();
    const listingIds = new Set(
      store.listings
        .filter((listing) => Number(listing.user_id) === Number(userId))
        .map((listing) => Number(listing.id))
    );

    const uniqueLabels = new Map();
    store.feeds
      .filter((feed) => listingIds.has(Number(feed.listing_id)))
      .forEach((feed) => {
        const label = String(feed.label || '').trim();
        if (!label) return;
        const key = label.toLowerCase();
        if (!uniqueLabels.has(key)) {
          uniqueLabels.set(key, label);
        }
      });

    const colorByKey = new Map();
    store.source_colors
      .filter((row) => Number(row.user_id) === Number(userId))
      .forEach((row) => {
        const label = String(row.label || '').trim();
        const color = normaliseColor(row.color);
        if (!label || !color) return;
        colorByKey.set(label.toLowerCase(), color);
      });

    return Array.from(uniqueLabels.entries())
      .map(([key, label]) => ({ label, color: colorByKey.get(key) || null }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  const labelsResult = await pool.query(
    `
      SELECT DISTINCT cf.label AS label
      FROM listings l
      INNER JOIN calendar_feeds cf ON cf.listing_id = l.id
      WHERE l.user_id = $1
      ORDER BY cf.label ASC
    `,
    [userId]
  );

  const colorsResult = await pool.query(
    'SELECT label, color FROM feed_source_colors WHERE user_id = $1',
    [userId]
  );

  const colorByKey = new Map();
  colorsResult.rows.forEach((row) => {
    const label = String(row.label || '').trim();
    const color = normaliseColor(row.color);
    if (!label || !color) return;
    colorByKey.set(label.toLowerCase(), color);
  });

  return labelsResult.rows.map((row) => {
    const label = String(row.label || '').trim();
    return {
      label,
      color: colorByKey.get(label.toLowerCase()) || null
    };
  });
}

async function upsertFeedSourceColorForUser(userId, label, color) {
  if (!usePostgres) {
    const store = readListingsStore();
    const key = label.toLowerCase();
    const idx = store.source_colors.findIndex(
      (row) => Number(row.user_id) === Number(userId) && String(row.label || '').trim().toLowerCase() === key
    );

    if (idx >= 0) {
      store.source_colors[idx].label = label;
      store.source_colors[idx].color = color;
      store.source_colors[idx].updated_at = new Date().toISOString();
    } else {
      store.source_colors.push({
        user_id: Number(userId),
        label,
        color,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }

    writeListingsStore(store);
    return { label, color };
  }

  const result = await pool.query(
    `
      INSERT INTO feed_source_colors (user_id, label, color)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, label)
      DO UPDATE SET color = EXCLUDED.color, updated_at = CURRENT_TIMESTAMP
      RETURNING label, color
    `,
    [userId, label, color]
  );

  return result.rows[0];
}

function unfoldIcsLines(icsText) {
  const lines = icsText.replace(/\r/g, '').split('\n');
  const unfolded = [];

  for (const line of lines) {
    if (!line) {
      continue;
    }

    if ((line.startsWith(' ') || line.startsWith('\t')) && unfolded.length) {
      unfolded[unfolded.length - 1] += line.trimStart();
    } else {
      unfolded.push(line);
    }
  }

  return unfolded;
}

function parseIcsDate(rawValue) {
  if (!rawValue) {
    return null;
  }

  const value = rawValue.split(':').pop() || '';

  if (/^\d{8}$/.test(value)) {
    const year = value.slice(0, 4);
    const month = value.slice(4, 6);
    const day = value.slice(6, 8);
    return `${year}-${month}-${day}`;
  }

  if (/^\d{8}T\d{6}Z$/.test(value)) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6)) - 1;
    const day = Number(value.slice(6, 8));
    const hour = Number(value.slice(9, 11));
    const minute = Number(value.slice(11, 13));
    const second = Number(value.slice(13, 15));
    return new Date(Date.UTC(year, month, day, hour, minute, second)).toISOString();
  }

  if (/^\d{8}T\d{6}$/.test(value)) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6)) - 1;
    const day = Number(value.slice(6, 8));
    const hour = Number(value.slice(9, 11));
    const minute = Number(value.slice(11, 13));
    const second = Number(value.slice(13, 15));
    return new Date(year, month, day, hour, minute, second).toISOString();
  }

  return value;
}

function parseIcsEvents(icsText) {
  const lines = unfoldIcsLines(icsText);
  const events = [];
  let current = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = { raw: {} };
      continue;
    }

    if (line === 'END:VEVENT') {
      if (current) {
        events.push({
          start:       parseIcsDate(current.start),
          end:         parseIcsDate(current.end),
          title:       current.title || '',
          description: current.description || '',
          location:    current.location || '',
          raw:         current.raw
        });
      }
      current = null;
      continue;
    }

    if (!current) {
      continue;
    }

    // Store every property in raw using the property name before ':'  or ';'
    const sepIdx = line.indexOf(':');
    if (sepIdx !== -1) {
      const key = line.slice(0, sepIdx).split(';')[0].trim();
      const val = line.slice(sepIdx + 1).trim();
      current.raw[key] = val;
    }

    if (line.startsWith('DTSTART')) {
      current.start = line;
    } else if (line.startsWith('DTEND')) {
      current.end = line;
    } else if (line.startsWith('SUMMARY:')) {
      current.title = line.slice('SUMMARY:'.length).trim();
    } else if (line.startsWith('DESCRIPTION:')) {
      current.description = line.slice('DESCRIPTION:'.length).trim();
    } else if (line.startsWith('LOCATION:')) {
      current.location = line.slice('LOCATION:'.length).trim();
    }
  }

  return events;
}

function normaliseSourceKey(source) {
  return String(source || '').trim().toLowerCase();
}

function normaliseSummary(summary) {
  return String(summary || '').trim().toLowerCase();
}

function isAirbnbSource(source) {
  return normaliseSourceKey(source).includes('airbnb');
}

function isAirbnbReservedSummary(summary) {
  return normaliseSummary(summary) === 'reserved';
}

function isAirbnbNotAvailableSummary(summary) {
  const text = normaliseSummary(summary);
  return text === '(not available)' || text === 'not available';
}

async function fetchEventsFromCalendarUrl(calendarUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const standardOptions = {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        Accept: 'text/calendar,text/plain,*/*',
        'User-Agent': 'Mozilla/5.0 (compatible; CalendarSync/1.0; +https://render.com)'
      }
    };
    const minimalOptions = {
      signal: controller.signal,
      redirect: 'follow'
    };

    const candidateUrls = [];
    const pushCandidate = (value) => {
      const next = String(value || '').trim();
      if (!next) return;
      if (!candidateUrls.includes(next)) {
        candidateUrls.push(next);
      }
    };

    pushCandidate(calendarUrl);
    pushCandidate(decodeHtmlEntitiesForUrl(calendarUrl));
    pushCandidate(decodeHtmlEntitiesForUrl(String(calendarUrl || '').replace(/\+/g, '%2B')));

    let lastStatus = null;
    let lastPreview = '';

    for (const candidateUrl of candidateUrls) {
      const variants = [standardOptions, minimalOptions];
      for (const options of variants) {
        const upstream = await fetch(candidateUrl, options);

        if (!upstream.ok) {
          lastStatus = upstream.status;
          const bodyText = await upstream.text().catch(() => '');

          if (isBookingInvalidTokenError(candidateUrl, upstream.status, bodyText)) {
            return {
              error: 'Booking.com calendar token is invalid or expired. Generate a new iCal export URL for this room in Booking.com and update this feed URL.'
            };
          }

          lastPreview = previewBodyText(bodyText);
          continue;
        }

        const icsText = await upstream.text();
        if (!icsText.includes('BEGIN:VCALENDAR')) {
          lastStatus = upstream.status;
          lastPreview = previewBodyText(icsText);
          continue;
        }

        const events = parseIcsEvents(icsText)
          .filter((event) => event.start || event.end || event.title || event.description || event.location)
          .slice(0, 500);

        return { events };
      }
    }

    const statusText = lastStatus ? ' (HTTP ' + lastStatus + ').' : '.';
    const previewText = lastPreview ? ' Response preview: ' + lastPreview : '';
    return { error: 'Unable to fetch calendar feed' + statusText + previewText };
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return { error: 'Calendar request timed out.' };
    }
    return { error: 'Failed to load calendar entries.' };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Middleware ───────────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 // 1 hour
  }
}));

// Serve admin page at root for admin subdomain hostnames.
app.use((req, res, next) => {
  const host = String(req.hostname || '').toLowerCase();
  if (host.startsWith('admin.') && req.path === '/') {
    return res.sendFile(path.join(__dirname, '..', 'public', 'Admin', 'index.html'));
  }
  return next();
});

// Serve static files from the public folder
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Auth guard ───────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorised' });
}

function requireAdminAuth(req, res, next) {
  if (req.session && req.session.isAdmin === true) {
    return next();
  }
  res.status(401).json({ error: 'Admin unauthorised' });
}

// ── Routes ───────────────────────────────────────────────────────────────────

// POST /api/signup
app.post('/api/signup', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  // Basic email format check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  try {
    const normalisedUsername = username.trim();
    const normalisedEmail = email.trim().toLowerCase();

    if (await findUserByUsername(normalisedUsername) || await findUserByEmail(normalisedEmail)) {
      return res.status(409).json({ error: 'Username or email already in use.' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    await createUser(normalisedUsername, normalisedEmail, passwordHash);
    return res.status(201).json({ message: 'Account created. You can now log in.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// POST /api/login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = await findUserByEmail(email.trim().toLowerCase());

  if (!user) {
    // Prevent user enumeration — same response if user not found
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  try {
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Regenerate session on login to prevent session fixation
    req.session.regenerate((err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error. Please try again.' });
      }
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.email = user.email;
      return res.json({ message: 'Login successful.' });
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// POST /api/admin/login
app.post('/api/admin/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid admin credentials.' });
  }

  req.session.regenerate((err) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error. Please try again.' });
    }
    req.session.isAdmin = true;
    req.session.adminUsername = ADMIN_USERNAME;
    return res.json({ message: 'Admin login successful.' });
  });
});

// GET /api/admin/me
app.get('/api/admin/me', (req, res) => {
  if (req.session && req.session.isAdmin === true) {
    return res.json({ username: req.session.adminUsername || ADMIN_USERNAME });
  }
  return res.status(401).json({ error: 'Admin unauthorised' });
});

// GET /api/admin/users
app.get('/api/admin/users', requireAdminAuth, async (req, res) => {
  try {
    const users = await getAllUsers();
    return res.json({ users });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load users.' });
  }
});

// DELETE /api/admin/users/:userId
app.delete('/api/admin/users/:userId', requireAdminAuth, async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid user id.' });
  }

  try {
    const result = await deleteUserAndData(userId);
    if (result.error) {
      return res.status(404).json({ error: result.error });
    }
    return res.json({ message: 'User deleted.', deletedUserId: result.deletedUserId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete user.' });
  }
});

// GET /api/me — return current user info (requires auth)
app.get('/api/me', requireAuth, (req, res) => {
  res.json({
    username: req.session.username,
    email: req.session.email
  });
});

// GET /api/listings — all listings for current user
app.get('/api/listings', requireAuth, async (req, res) => {
  try {
    const listings = await getListingsForUser(req.session.userId);
    return res.json({ listings });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load listings.' });
  }
});

// POST /api/listings — create listing (unique name per user)
app.post('/api/listings', requireAuth, async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'Listing name is required.' });
  }

  try {
    const { listing, error } = await createListingForUser(req.session.userId, name);
    if (error) {
      return res.status(409).json({ error });
    }
    return res.status(201).json({ listing });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create listing.' });
  }
});

// GET /api/listings/:listingId — get one listing for current user
app.get('/api/listings/:listingId', requireAuth, async (req, res) => {
  const listingId = Number(req.params.listingId);
  if (!Number.isInteger(listingId) || listingId <= 0) {
    return res.status(400).json({ error: 'Invalid listing id.' });
  }

  try {
    const listing = await getListingByIdForUser(listingId, req.session.userId);
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found.' });
    }
    return res.json({ listing });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load listing.' });
  }
});

// PUT /api/listings/:listingId — rename listing
app.put('/api/listings/:listingId', requireAuth, async (req, res) => {
  const listingId = Number(req.params.listingId);
  const name = String(req.body.name || '').trim();

  if (!Number.isInteger(listingId) || listingId <= 0) {
    return res.status(400).json({ error: 'Invalid listing id.' });
  }
  if (!name) {
    return res.status(400).json({ error: 'Listing name is required.' });
  }

  try {
    const { listing, error } = await updateListingNameForUser(listingId, req.session.userId, name);
    if (error === 'Listing not found.') {
      return res.status(404).json({ error });
    }
    if (error) {
      return res.status(409).json({ error });
    }
    return res.json({ listing });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update listing.' });
  }
});

// GET /api/listings/:listingId/feeds — feeds for a listing
app.get('/api/listings/:listingId/feeds', requireAuth, async (req, res) => {
  const listingId = Number(req.params.listingId);
  if (!Number.isInteger(listingId) || listingId <= 0) {
    return res.status(400).json({ error: 'Invalid listing id.' });
  }

  try {
    const feeds = await getFeedsForListing(listingId, req.session.userId);
    if (feeds === null) {
      return res.status(404).json({ error: 'Listing not found.' });
    }
    return res.json({ feeds });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load feeds.' });
  }
});

// GET /api/feed-sources — all configured feed source labels + chosen colors
app.get('/api/feed-sources', requireAuth, async (req, res) => {
  try {
    const sources = await getFeedSourcesForUser(req.session.userId);
    return res.json({ sources });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load feed sources.' });
  }
});

// PUT /api/feed-sources/color — set color for one feed source label
app.put('/api/feed-sources/color', requireAuth, async (req, res) => {
  const label = String(req.body.label || '').trim();
  const color = normaliseColor(req.body.color);

  if (!label) {
    return res.status(400).json({ error: 'Feed source label is required.' });
  }
  if (!color) {
    return res.status(400).json({ error: 'Valid color is required (#RRGGBB).' });
  }

  try {
    const sources = await getFeedSourcesForUser(req.session.userId);
    const exists = sources.some((source) => source.label.toLowerCase() === label.toLowerCase());
    if (!exists) {
      return res.status(404).json({ error: 'Feed source not found.' });
    }

    const saved = await upsertFeedSourceColorForUser(req.session.userId, label, color);
    return res.json({ source: saved });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to save source color.' });
  }
});

// POST /api/listings/:listingId/feeds — add a feed
app.post('/api/listings/:listingId/feeds', requireAuth, async (req, res) => {
  const listingId = Number(req.params.listingId);
  const label = String(req.body.label || '').trim();
  const url = normaliseCalendarUrl(req.body.url);

  if (!Number.isInteger(listingId) || listingId <= 0) {
    return res.status(400).json({ error: 'Invalid listing id.' });
  }
  if (!label) {
    return res.status(400).json({ error: 'Feed label is required.' });
  }
  if (!url) {
    return res.status(400).json({ error: 'Valid feed URL is required (http/https).' });
  }

  try {
    const { feed, error } = await createFeedForListing(listingId, req.session.userId, label, url);
    if (error) {
      return res.status(404).json({ error });
    }
    return res.status(201).json({ feed });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create feed.' });
  }
});

// PUT /api/listings/:listingId/feeds/:feedId — edit a feed
app.put('/api/listings/:listingId/feeds/:feedId', requireAuth, async (req, res) => {
  const listingId = Number(req.params.listingId);
  const feedId = Number(req.params.feedId);
  const label = String(req.body.label || '').trim();
  const url = normaliseCalendarUrl(req.body.url);

  if (!Number.isInteger(listingId) || listingId <= 0 || !Number.isInteger(feedId) || feedId <= 0) {
    return res.status(400).json({ error: 'Invalid listing/feed id.' });
  }
  if (!label) {
    return res.status(400).json({ error: 'Feed label is required.' });
  }
  if (!url) {
    return res.status(400).json({ error: 'Valid feed URL is required (http/https).' });
  }

  try {
    const { feed, error } = await updateFeedForListing(feedId, listingId, req.session.userId, label, url);
    if (error === 'Listing not found.') {
      return res.status(404).json({ error });
    }
    if (error === 'Feed not found.') {
      return res.status(404).json({ error });
    }
    return res.json({ feed });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update feed.' });
  }
});

// GET /api/listings/:listingId/events — consolidated events from all listing feeds
app.get('/api/listings/:listingId/events', requireAuth, async (req, res) => {
  const listingId = Number(req.params.listingId);
  if (!Number.isInteger(listingId) || listingId <= 0) {
    return res.status(400).json({ error: 'Invalid listing id.' });
  }

  try {
    const listing = await getListingByIdForUser(listingId, req.session.userId);
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    const feeds = await getFeedsForListing(listingId, req.session.userId);
    const safeFeeds = feeds || [];
    if (!safeFeeds.length) {
      return res.json({ listing, events: [], feedErrors: [] });
    }

    const results = await Promise.all(
      safeFeeds.map(async (feed) => {
        const fetched = await fetchEventsFromCalendarUrl(feed.url);
        if (fetched.error) {
          return { feedId: feed.id, source: feed.label, error: fetched.error, events: [] };
        }

        const events = fetched.events.map((event) => ({
          isReservation: isAirbnbSource(feed.label)
            ? isAirbnbReservedSummary(event.title)
            : true,
          isUnavailableBlock: isAirbnbSource(feed.label)
            ? isAirbnbNotAvailableSummary(event.title)
            : false,
          source: feed.label,
          start: event.start,
          end: event.end,
          title: event.title,
          description: event.description,
          location: event.location,
          raw: event.raw
        }));

        return { feedId: feed.id, source: feed.label, error: null, events };
      })
    );

    const feedErrors = results
      .filter((result) => result.error)
      .map((result) => ({ source: result.source, error: result.error }));

    const events = results
      .flatMap((result) => result.events)
      .sort((a, b) => {
        const aTime = a.start ? new Date(a.start).getTime() : Number.NEGATIVE_INFINITY;
        const bTime = b.start ? new Date(b.start).getTime() : Number.NEGATIVE_INFINITY;
        return aTime - bTime;
      });

    return res.json({ listing, events, feedErrors });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load listing events.' });
  }
});

// GET /api/calendar-entries?url=... — load and parse ICS events
app.get('/api/calendar-entries', requireAuth, async (req, res) => {
  const calendarUrl = normaliseCalendarUrl(req.query.url);

  if (!calendarUrl) {
    return res.status(400).json({ error: 'Valid calendar URL is required (http/https).' });
  }

  try {
    const fetched = await fetchEventsFromCalendarUrl(calendarUrl);
    if (fetched.error) {
      return res.status(400).json({ error: fetched.error });
    }

    const events = fetched.events;
    return res.json({ events });
  } catch (err) {
    console.error('Calendar fetch error:', err);
    return res.status(500).json({ error: 'Failed to load calendar entries.' });
  }
});

// GET /health — simple health check for Render
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// POST /api/logout
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out.' });
  });
});

// GET /admin - admin page route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'Admin', 'index.html'));
});

// Catch-all: redirect unknown routes to index
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Start ────────────────────────────────────────────────────────────────────
async function startServer() {
  try {
    await initializeUserStore();
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
      console.log(`User storage: ${usePostgres ? 'Postgres' : 'local JSON file'}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();

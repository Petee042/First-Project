'use strict';

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SALT_ROUNDS = 12;
const SESSION_SECRET = process.env.SESSION_SECRET || 'replace-this-secret-in-production';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'Peterku';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Quiblick!3';
const KAYAK_API_BASE_URL = process.env.KAYAK_API_BASE_URL || 'https://sandbox-en-us.kayakaffiliates.com';
const KAYAK_API_KEY = process.env.KAYAK_API_KEY || '';
const STAY_API_KEY = process.env.STAY_API_KEY || '';
const STAY_API_BASE_URL = 'https://api.stayapi.com';
const usersFile = path.join(__dirname, 'users.json');
const listingsFile = path.join(__dirname, 'listings.json');
const usePostgres = Boolean(process.env.DATABASE_URL);
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

const KAYAK_COMMON_QUERY_FIELDS = [
  { key: 'userTrackId', type: 'string', required: true, description: 'Unique user/session identifier.' },
  { key: 'onlyIfComplete', type: 'boolean', required: false, defaultValue: 'false', description: 'Return 202 until search is complete.' },
  { key: 'searchTimeout', type: 'number', required: false, description: 'Max milliseconds to wait for completion.' },
  { key: 'checkin', type: 'date', required: false, description: 'Check-in date (YYYY-MM-DD).' },
  { key: 'checkout', type: 'date', required: false, description: 'Check-out date (YYYY-MM-DD).' },
  { key: 'rooms', type: 'string', required: false, description: 'Room/guest pattern such as 2:4|1.' },
  { key: 'languageCode', type: 'string', required: false, defaultValue: 'EN', description: 'Language code (ISO 639, uppercase).' },
  { key: 'currencyCode', type: 'string', required: false, description: 'Currency code (ISO 4217).' },
  { key: 'includeTaxesInTotal', type: 'boolean', required: false, description: 'Include VAT/sales tax in totals.' },
  { key: 'includeLocalTaxesInTotal', type: 'boolean', required: false, description: 'Include local taxes in totals.' }
];

const KAYAK_HOTEL_ENDPOINTS = {
  singleHotel: {
    id: 'singleHotel',
    title: 'Single hotel search',
    method: 'GET',
    path: '/hotel',
    queryFields: [
      { key: 'hotel', type: 'string', required: true, description: 'Hotel key, e.g. khotel:1000.' },
      ...KAYAK_COMMON_QUERY_FIELDS,
      { key: 'responseOptions', type: 'string', required: false, description: 'Comma-delimited options (features,images,reviews,...).' }
    ]
  },
  multipleHotels: {
    id: 'multipleHotels',
    title: 'Multiple hotel search',
    method: 'GET',
    path: '/hotels',
    queryFields: [
      { key: 'destination', type: 'string', required: true, description: 'Destination key, e.g. kplace:58075.' },
      ...KAYAK_COMMON_QUERY_FIELDS,
      { key: 'minPrice', type: 'number', required: false, description: 'Minimum hotel price.' },
      { key: 'maxPrice', type: 'number', required: false, description: 'Maximum hotel price.' },
      { key: 'starRating', type: 'string', required: false, description: 'Pipe list, e.g. 3|4|5.' },
      { key: 'hotelRating', type: 'string', required: false, description: 'Pipe list of rating values.' },
      { key: 'hotelRatingExcludeSelfRated', type: 'boolean', required: false, defaultValue: 'false', description: 'Exclude self-rated hotels for hotelRating filter.' },
      { key: 'propertyTypes', type: 'string', required: false, description: 'Pipe list of property type ids.' },
      { key: 'features', type: 'string', required: false, description: 'Pipe list of amenity ids.' },
      { key: 'featuresFilterMode', type: 'string', required: false, defaultValue: 'AND', description: 'AND or OR for features matching.' },
      { key: 'themes', type: 'string', required: false, description: 'Pipe list of hotel theme ids.' },
      { key: 'chains', type: 'string', required: false, description: 'Pipe list of hotel chain ids.' },
      { key: 'guestRatings', type: 'string', required: false, description: 'Pipe list of guest rating values.' },
      { key: 'deals', type: 'string', required: false, description: 'Pipe list of deal ids.' },
      { key: 'hotelName', type: 'string', required: false, description: 'Hotel name/phrase search.' },
      { key: 'sortField', type: 'string', required: false, defaultValue: 'popularity', description: 'consumerRating,distance,name,minRate,popularity,rating.' },
      { key: 'sortDirection', type: 'string', required: false, defaultValue: 'ascending', description: 'ascending or descending.' },
      { key: 'pageIndex', type: 'number', required: false, defaultValue: '0', description: 'Result page index.' },
      { key: 'pageSize', type: 'number', required: false, defaultValue: '25', description: 'Results per page (1-250).' },
      { key: 'preferredHotels', type: 'string', required: false, description: 'Pipe list of hotel ids in preferred order.' },
      { key: 'summaryOnly', type: 'boolean', required: false, description: 'Return only summary metadata.' },
      { key: 'responseOptions', type: 'string', required: false, description: 'Comma-delimited options (filter,destination,topRates,...).' }
    ]
  },
  basicMultipleHotels: {
    id: 'basicMultipleHotels',
    title: 'Basic multiple hotel search',
    method: 'GET',
    path: '/hotels/basic',
    queryFields: [
      { key: 'destination', type: 'string', required: true, description: 'Destination key, e.g. kplace:58075.' },
      ...KAYAK_COMMON_QUERY_FIELDS,
      { key: 'minPrice', type: 'number', required: false, description: 'Minimum hotel price.' },
      { key: 'maxPrice', type: 'number', required: false, description: 'Maximum hotel price.' },
      { key: 'starRating', type: 'string', required: false, description: 'Pipe list, e.g. 3|4|5.' },
      { key: 'hotelRating', type: 'string', required: false, description: 'Pipe list of rating values.' },
      { key: 'hotelRatingExcludeSelfRated', type: 'boolean', required: false, defaultValue: 'false', description: 'Exclude self-rated hotels for hotelRating filter.' },
      { key: 'propertyTypes', type: 'string', required: false, description: 'Pipe list of property type ids.' },
      { key: 'features', type: 'string', required: false, description: 'Pipe list of amenity ids.' },
      { key: 'themes', type: 'string', required: false, description: 'Pipe list of hotel theme ids.' },
      { key: 'chains', type: 'string', required: false, description: 'Pipe list of hotel chain ids.' },
      { key: 'guestRatings', type: 'string', required: false, description: 'Pipe list of guest rating values.' },
      { key: 'deals', type: 'string', required: false, description: 'Pipe list of deal ids.' },
      { key: 'hotelName', type: 'string', required: false, description: 'Hotel name/phrase search.' },
      { key: 'sortField', type: 'string', required: false, defaultValue: 'popularity', description: 'consumerRating,distance,name,minRate,popularity,rating.' },
      { key: 'sortDirection', type: 'string', required: false, defaultValue: 'ascending', description: 'ascending or descending.' },
      { key: 'pageIndex', type: 'number', required: false, defaultValue: '0', description: 'Result page index.' },
      { key: 'pageSize', type: 'number', required: false, defaultValue: '25', description: 'Results per page (1-250).' },
      { key: 'preferredHotels', type: 'string', required: false, description: 'Pipe list of hotel ids in preferred order.' }
    ]
  }
};

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
    fs.writeFileSync(listingsFile, JSON.stringify({ listings: [], feeds: [], source_colors: [], properties: [], cached_events: [], cleaners: [], booked_in_changes: [] }, null, 2), 'utf8');
  }
}

function readListingsStore() {
  ensureLocalListingsStore();
  const content = fs.readFileSync(listingsFile, 'utf8');
  const parsed = JSON.parse(content);
  if (!parsed || !Array.isArray(parsed.listings) || !Array.isArray(parsed.feeds)) {
    return { listings: [], feeds: [], source_colors: [], properties: [], cached_events: [], cleaners: [], booked_in_changes: [] };
  }
  if (!Array.isArray(parsed.source_colors)) {
    parsed.source_colors = [];
  }
  if (!Array.isArray(parsed.properties)) {
    parsed.properties = [];
  }
  if (!Array.isArray(parsed.cached_events)) {
    parsed.cached_events = [];
  }
  if (!Array.isArray(parsed.cleaners)) {
    parsed.cleaners = [];
  }
  if (!Array.isArray(parsed.booked_in_changes)) {
    parsed.booked_in_changes = [];
  }
  parsed.listings.forEach((listing) => {
    if (listing.date_basis !== 'checkin' && listing.date_basis !== 'checkout') {
      listing.date_basis = 'checkout';
    }
    if (!Object.prototype.hasOwnProperty.call(listing, 'usual_cleaner_id')) {
      listing.usual_cleaner_id = null;
    }
  });
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
    CREATE TABLE IF NOT EXISTS properties (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      postal_address TEXT,
      manager_name TEXT,
      manager_email TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, name)
    )`);

  await pool.query(`
    ALTER TABLE properties ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE
  `);

  await pool.query(`
    ALTER TABLE listings
    ADD COLUMN IF NOT EXISTS property_id BIGINT REFERENCES properties(id) ON DELETE SET NULL
  `);

  await pool.query(`
    ALTER TABLE listings
    ADD COLUMN IF NOT EXISTS date_basis TEXT NOT NULL DEFAULT 'checkout'
  `);

  await pool.query(`
    ALTER TABLE listings
    DROP CONSTRAINT IF EXISTS listings_date_basis_check
  `);

  await pool.query(`
    ALTER TABLE listings
    ADD CONSTRAINT listings_date_basis_check CHECK (date_basis IN ('checkin', 'checkout'))
  `);

  await pool.query(`
    ALTER TABLE listings
    ADD COLUMN IF NOT EXISTS usual_cleaner_id BIGINT REFERENCES cleaners(id) ON DELETE SET NULL
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cached_events (
      id BIGSERIAL PRIMARY KEY,
      listing_id BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      feed_id BIGINT NOT NULL REFERENCES calendar_feeds(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      events_json TEXT NOT NULL DEFAULT '[]',
      error_text TEXT,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (listing_id, feed_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cleaners (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL,
      telephone TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, email)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS booked_in_changes (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      property_id BIGINT REFERENCES properties(id) ON DELETE SET NULL,
      listing_id BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      reservation_checkin_date DATE NOT NULL,
      reservation_checkout_date DATE NOT NULL,
      changeover_date DATE NOT NULL,
      cleaner_id BIGINT REFERENCES cleaners(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, listing_id, reservation_checkin_date, reservation_checkout_date)
    )
  `);

  await migrateUsersFromFile();

  await pool.query(`
    INSERT INTO properties (user_id, name)
    SELECT u.id, 'default'
    FROM users u
    LEFT JOIN properties p
      ON p.user_id = u.id AND LOWER(p.name) = 'default'
    WHERE p.id IS NULL
  `);

  await pool.query(`
    UPDATE listings l
    SET property_id = p.id
    FROM properties p
    WHERE l.user_id = p.user_id
      AND l.property_id IS NULL
      AND LOWER(p.name) = 'default'
  `);
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
    await ensureDefaultPropertyForUser(user.id);
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

  await ensureDefaultPropertyForUser(result.rows[0].id);
  return result.rows[0];
}

function normaliseOptionalEmail(value) {
  const email = String(value || '').trim();
  if (!email) {
    return null;
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) ? email.toLowerCase() : null;
}

function normaliseTelephone(value) {
  const telephone = String(value || '').trim();
  if (!telephone) {
    return null;
  }
  return telephone;
}

function normaliseDateBasis(value) {
  const basis = String(value || '').trim().toLowerCase();
  return basis === 'checkin' ? 'checkin' : 'checkout';
}

function normaliseDateKey(value) {
  const raw = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function normaliseCleanerId(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function getCleanersForUser(userId) {
  if (!usePostgres) {
    const store = readListingsStore();
    return (store.cleaners || [])
      .filter((cleaner) => Number(cleaner.user_id) === Number(userId))
      .sort((a, b) => {
        const byLast = String(a.last_name || '').localeCompare(String(b.last_name || ''));
        if (byLast !== 0) return byLast;
        return String(a.first_name || '').localeCompare(String(b.first_name || ''));
      })
      .map((cleaner) => ({
        id: cleaner.id,
        user_id: cleaner.user_id,
        first_name: cleaner.first_name,
        last_name: cleaner.last_name,
        email: cleaner.email,
        telephone: cleaner.telephone,
        created_at: cleaner.created_at,
        updated_at: cleaner.updated_at
      }));
  }

  const result = await pool.query(
    `
      SELECT id, user_id, first_name, last_name, email, telephone, created_at, updated_at
      FROM cleaners
      WHERE user_id = $1
      ORDER BY last_name ASC, first_name ASC
    `,
    [userId]
  );
  return result.rows;
}

async function createCleanerForUser(userId, input) {
  const firstName = String(input.firstName || '').trim();
  const lastName = String(input.lastName || '').trim();
  const email = normaliseOptionalEmail(input.email);
  const telephone = normaliseTelephone(input.telephone);
  const password = String(input.password || '');

  if (!firstName || !lastName || !email || !telephone || !password) {
    return { error: 'First name, last name, email, telephone, and password are required.' };
  }
  if (password.length < 8) {
    return { error: 'Cleaner password must be at least 8 characters.' };
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  if (!usePostgres) {
    const store = readListingsStore();
    const duplicate = (store.cleaners || []).some(
      (cleaner) => Number(cleaner.user_id) === Number(userId) && String(cleaner.email).toLowerCase() === email
    );
    if (duplicate) {
      return { error: 'A cleaner with this email already exists.' };
    }

    const nextId = (store.cleaners || []).length
      ? Math.max(...store.cleaners.map((cleaner) => Number(cleaner.id))) + 1
      : 1;
    const now = new Date().toISOString();
    const cleaner = {
      id: nextId,
      user_id: Number(userId),
      first_name: firstName,
      last_name: lastName,
      email,
      telephone,
      password_hash: passwordHash,
      created_at: now,
      updated_at: now
    };
    store.cleaners.push(cleaner);
    writeListingsStore(store);

    return {
      cleaner: {
        id: cleaner.id,
        user_id: cleaner.user_id,
        first_name: cleaner.first_name,
        last_name: cleaner.last_name,
        email: cleaner.email,
        telephone: cleaner.telephone,
        created_at: cleaner.created_at,
        updated_at: cleaner.updated_at
      }
    };
  }

  try {
    const result = await pool.query(
      `
        INSERT INTO cleaners (user_id, first_name, last_name, email, telephone, password_hash)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, user_id, first_name, last_name, email, telephone, created_at, updated_at
      `,
      [userId, firstName, lastName, email, telephone, passwordHash]
    );
    return { cleaner: result.rows[0] };
  } catch (err) {
    if (err && err.code === '23505') {
      return { error: 'A cleaner with this email already exists.' };
    }
    throw err;
  }
}

async function updateCleanerForUser(cleanerId, userId, input) {
  const firstName = String(input.firstName || '').trim();
  const lastName = String(input.lastName || '').trim();
  const email = normaliseOptionalEmail(input.email);
  const telephone = normaliseTelephone(input.telephone);
  const password = String(input.password || '').trim();

  if (!firstName || !lastName || !email || !telephone) {
    return { error: 'First name, last name, email, and telephone are required.' };
  }
  if (password && password.length < 8) {
    return { error: 'Cleaner password must be at least 8 characters.' };
  }

  if (!usePostgres) {
    const store = readListingsStore();
    const idx = (store.cleaners || []).findIndex(
      (cleaner) => Number(cleaner.id) === Number(cleanerId) && Number(cleaner.user_id) === Number(userId)
    );
    if (idx === -1) {
      return { error: 'Cleaner not found.' };
    }

    const duplicate = store.cleaners.some(
      (cleaner) => Number(cleaner.user_id) === Number(userId)
        && Number(cleaner.id) !== Number(cleanerId)
        && String(cleaner.email).toLowerCase() === email
    );
    if (duplicate) {
      return { error: 'A cleaner with this email already exists.' };
    }

    store.cleaners[idx].first_name = firstName;
    store.cleaners[idx].last_name = lastName;
    store.cleaners[idx].email = email;
    store.cleaners[idx].telephone = telephone;
    store.cleaners[idx].updated_at = new Date().toISOString();
    if (password) {
      store.cleaners[idx].password_hash = await bcrypt.hash(password, SALT_ROUNDS);
    }
    writeListingsStore(store);

    return {
      cleaner: {
        id: store.cleaners[idx].id,
        user_id: store.cleaners[idx].user_id,
        first_name: store.cleaners[idx].first_name,
        last_name: store.cleaners[idx].last_name,
        email: store.cleaners[idx].email,
        telephone: store.cleaners[idx].telephone,
        created_at: store.cleaners[idx].created_at,
        updated_at: store.cleaners[idx].updated_at
      }
    };
  }

  const existing = await pool.query(
    'SELECT id FROM cleaners WHERE id = $1 AND user_id = $2 LIMIT 1',
    [cleanerId, userId]
  );
  if (!existing.rows[0]) {
    return { error: 'Cleaner not found.' };
  }

  const passwordHash = password ? await bcrypt.hash(password, SALT_ROUNDS) : null;

  try {
    const result = await pool.query(
      `
        UPDATE cleaners
        SET first_name = $1,
            last_name = $2,
            email = $3,
            telephone = $4,
            password_hash = COALESCE($5, password_hash),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $6 AND user_id = $7
        RETURNING id, user_id, first_name, last_name, email, telephone, created_at, updated_at
      `,
      [firstName, lastName, email, telephone, passwordHash, cleanerId, userId]
    );
    return { cleaner: result.rows[0] };
  } catch (err) {
    if (err && err.code === '23505') {
      return { error: 'A cleaner with this email already exists.' };
    }
    throw err;
  }
}

async function ensureDefaultPropertyForUser(userId) {
  if (!usePostgres) {
    const store = readListingsStore();
    const existing = store.properties.find(
      (property) => Number(property.user_id) === Number(userId) && (property.is_default === true || String(property.name).toLowerCase() === 'default')
    );
    if (existing) {
      if (!existing.is_default) {
        existing.is_default = true;
        writeListingsStore(store);
      }
      return existing;
    }

    const nextId = store.properties.length
      ? Math.max(...store.properties.map((property) => Number(property.id))) + 1
      : 1;
    const property = {
      id: nextId,
      user_id: Number(userId),
      name: 'default',
      postal_address: '',
      manager_name: '',
      manager_email: '',
      is_default: true,
      created_at: new Date().toISOString()
    };
    store.properties.push(property);
    store.listings.forEach((listing) => {
      if (Number(listing.user_id) === Number(userId) && !listing.property_id) {
        listing.property_id = property.id;
      }
    });
    writeListingsStore(store);
    return property;
  }

  // Resolve the canonical default property before attempting to create one.
  const candidatesResult = await pool.query(
    `
      SELECT id, user_id, name, postal_address, manager_name, manager_email, is_default, created_at
      FROM properties
      WHERE user_id = $1 AND (is_default = TRUE OR LOWER(name) = 'default')
      ORDER BY id ASC
    `,
    [userId]
  );

  let property = candidatesResult.rows.find((row) => row.is_default === true) || candidatesResult.rows[0] || null;

  if (!property) {
    const insertResult = await pool.query(
      `
        INSERT INTO properties (user_id, name, is_default)
        VALUES ($1, 'default', TRUE)
        RETURNING id, user_id, name, postal_address, manager_name, manager_email, is_default, created_at
      `,
      [userId]
    );
    property = insertResult.rows[0] || null;
  }

  if (property) {
    await pool.query(
      `
        UPDATE properties
        SET is_default = CASE WHEN id = $1 THEN TRUE ELSE FALSE END
        WHERE user_id = $2 AND (id = $1 OR is_default = TRUE)
      `,
      [property.id, userId]
    );
    property.is_default = true;

    // Clean up duplicates generated by the previous bug.
    await pool.query(
      `
        DELETE FROM properties p
        WHERE p.user_id = $1
          AND p.id <> $2
          AND LOWER(p.name) = 'default'
          AND NOT EXISTS (
            SELECT 1
            FROM listings l
            WHERE l.user_id = $1 AND l.property_id = p.id
          )
      `,
      [userId, property.id]
    );

    await pool.query(
      `
        UPDATE listings
        SET property_id = $1
        WHERE user_id = $2 AND property_id IS NULL
      `,
      [property.id, userId]
    );
  }

  return property;
}

async function getPropertiesForUser(userId) {
  await ensureDefaultPropertyForUser(userId);

  if (!usePostgres) {
    const store = readListingsStore();
    return store.properties
      .filter((property) => Number(property.user_id) === Number(userId))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  const result = await pool.query(
    `
      SELECT id, user_id, name, postal_address, manager_name, manager_email, is_default, created_at
      FROM properties
      WHERE user_id = $1
      ORDER BY name ASC
    `,
    [userId]
  );
  return result.rows;
}

async function getPropertyByIdForUser(propertyId, userId) {
  await ensureDefaultPropertyForUser(userId);

  if (!usePostgres) {
    const store = readListingsStore();
    return store.properties.find(
      (property) => Number(property.id) === Number(propertyId) && Number(property.user_id) === Number(userId)
    );
  }

  const result = await pool.query(
    `
      SELECT id, user_id, name, postal_address, manager_name, manager_email, is_default, created_at
      FROM properties
      WHERE id = $1 AND user_id = $2
      LIMIT 1
    `,
    [propertyId, userId]
  );
  return result.rows[0];
}

async function createPropertyForUser(userId, name) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) {
    return { error: 'Property name is required.' };
  }

  if (!usePostgres) {
    const store = readListingsStore();
    const duplicate = store.properties.some(
      (property) => Number(property.user_id) === Number(userId) && String(property.name).toLowerCase() === trimmedName.toLowerCase()
    );
    if (duplicate) {
      return { error: 'A property with this name already exists.' };
    }

    const nextId = store.properties.length
      ? Math.max(...store.properties.map((property) => Number(property.id))) + 1
      : 1;
    const property = {
      id: nextId,
      user_id: Number(userId),
      name: trimmedName,
      postal_address: '',
      manager_name: '',
      manager_email: '',
      created_at: new Date().toISOString()
    };
    store.properties.push(property);
    writeListingsStore(store);
    return { property };
  }

  try {
    const result = await pool.query(
      `
        INSERT INTO properties (user_id, name)
        VALUES ($1, $2)
        RETURNING id, user_id, name, postal_address, manager_name, manager_email, is_default, created_at
      `,
      [userId, trimmedName]
    );
    return { property: result.rows[0] };
  } catch (err) {
    if (err && err.code === '23505') {
      return { error: 'A property with this name already exists.' };
    }
    throw err;
  }
}

async function updatePropertyForUser(propertyId, userId, input) {
  const name = String(input.name || '').trim();
  const postalAddress = String(input.postalAddress || '').trim();
  const managerName = String(input.managerName || '').trim();
  const rawManagerEmail = String(input.managerEmail || '').trim();
  const managerEmail = normaliseOptionalEmail(rawManagerEmail);

  if (!name) {
    return { error: 'Property name is required.' };
  }
  if (rawManagerEmail && !managerEmail) {
    return { error: 'Manager email is invalid.' };
  }

  if (!usePostgres) {
    const store = readListingsStore();
    const idx = store.properties.findIndex(
      (property) => Number(property.id) === Number(propertyId) && Number(property.user_id) === Number(userId)
    );
    if (idx === -1) {
      return { error: 'Property not found.' };
    }

    const duplicate = store.properties.some(
      (property) => Number(property.user_id) === Number(userId)
        && Number(property.id) !== Number(propertyId)
        && String(property.name).toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
      return { error: 'A property with this name already exists.' };
    }

    store.properties[idx].name = name;
    store.properties[idx].postal_address = postalAddress;
    store.properties[idx].manager_name = managerName;
    store.properties[idx].manager_email = managerEmail || '';
    writeListingsStore(store);
    return { property: store.properties[idx] };
  }

  try {
    const existing = await getPropertyByIdForUser(propertyId, userId);
    if (!existing) {
      return { error: 'Property not found.' };
    }
    const result = await pool.query(
      `
        UPDATE properties
        SET name = $1, postal_address = $2, manager_name = $3, manager_email = $4
        WHERE id = $5 AND user_id = $6
        RETURNING id, user_id, name, postal_address, manager_name, manager_email, is_default, created_at
      `,
      [name, postalAddress, managerName, managerEmail, propertyId, userId]
    );
    if (!result.rows[0]) {
      return { error: 'Property not found.' };
    }
    return { property: result.rows[0] };
  } catch (err) {
    if (err && err.code === '23505') {
      return { error: 'A property with this name already exists.' };
    }
    throw err;
  }
}

async function deletePropertyForUser(propertyId, userId) {
  const property = await getPropertyByIdForUser(propertyId, userId);
  if (!property) {
    return { error: 'Property not found.' };
  }

  if (property.is_default === true) {
    return { error: 'The default property cannot be deleted.' };
  }

  if (!usePostgres) {
    const store = readListingsStore();
    const assignedCount = store.listings.filter(
      (listing) => Number(listing.user_id) === Number(userId) && Number(listing.property_id) === Number(propertyId)
    ).length;
    if (assignedCount > 0) {
      return { error: 'This property cannot be deleted while listings are assigned to it.' };
    }

    const nextProperties = store.properties.filter(
      (item) => !(Number(item.id) === Number(propertyId) && Number(item.user_id) === Number(userId))
    );
    store.properties = nextProperties;
    writeListingsStore(store);
    return { deletedPropertyId: Number(propertyId) };
  }

  const assignedResult = await pool.query(
    'SELECT COUNT(*)::int AS count FROM listings WHERE user_id = $1 AND property_id = $2',
    [userId, propertyId]
  );
  if (Number(assignedResult.rows[0].count) > 0) {
    return { error: 'This property cannot be deleted while listings are assigned to it.' };
  }

  const result = await pool.query(
    'DELETE FROM properties WHERE id = $1 AND user_id = $2 RETURNING id',
    [propertyId, userId]
  );
  if (!result.rows[0]) {
    return { error: 'Property not found.' };
  }

  return { deletedPropertyId: Number(result.rows[0].id) };
}

async function resolvePropertyForListing(userId, propertyId) {
  if (Number.isInteger(Number(propertyId)) && Number(propertyId) > 0) {
    const property = await getPropertyByIdForUser(Number(propertyId), userId);
    if (property) {
      return property;
    }
    return null;
  }
  return ensureDefaultPropertyForUser(userId);
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
      properties: (store.properties || []).filter((property) => Number(property.user_id) !== Number(userId)),
      listings: store.listings.filter((listing) => Number(listing.user_id) !== Number(userId)),
      feeds: store.feeds.filter((feed) => !removedListingIds.has(Number(feed.listing_id))),
      source_colors: (store.source_colors || []).filter((row) => Number(row.user_id) !== Number(userId)),
      cleaners: (store.cleaners || []).filter((cleaner) => Number(cleaner.user_id) !== Number(userId)),
      cached_events: (store.cached_events || []).filter((row) => !removedListingIds.has(Number(row.listing_id))),
      booked_in_changes: (store.booked_in_changes || []).filter((row) => Number(row.user_id) !== Number(userId))
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

async function getUserArchiveData(userId) {
  if (!usePostgres) {
    const users = readUsersFromFile();
    const user = users.find((item) => Number(item.id) === Number(userId));
    if (!user) {
      return { error: 'User not found.' };
    }

    const store = readListingsStore();
    const listings = store.listings
      .filter((listing) => Number(listing.user_id) === Number(userId))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const properties = (store.properties || [])
      .filter((property) => Number(property.user_id) === Number(userId))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const propertyById = new Map(properties.map((property) => [Number(property.id), property]));

    const feedsByListingId = new Map();
    store.feeds.forEach((feed) => {
      const listingKey = Number(feed.listing_id);
      if (!feedsByListingId.has(listingKey)) {
        feedsByListingId.set(listingKey, []);
      }
      feedsByListingId.get(listingKey).push({
        label: feed.label,
        url: feed.url,
        created_at: feed.created_at || null
      });
    });

    const sourceColors = (store.source_colors || [])
      .filter((row) => Number(row.user_id) === Number(userId))
      .map((row) => ({
        label: row.label,
        color: row.color,
        created_at: row.created_at || null,
        updated_at: row.updated_at || null
      }));

    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      user: {
        username: user.username,
        email: user.email,
        password_hash: user.password_hash,
        created_at: user.created_at || null
      },
      properties: properties.map((property) => ({
        name: property.name,
        postal_address: property.postal_address || '',
        manager_name: property.manager_name || '',
        manager_email: property.manager_email || '',
        created_at: property.created_at || null
      })),
      listings: listings.map((listing) => ({
        name: listing.name,
        property_name: propertyById.get(Number(listing.property_id))
          ? propertyById.get(Number(listing.property_id)).name
          : 'default',
        created_at: listing.created_at || null,
        feeds: (feedsByListingId.get(Number(listing.id)) || []).sort((a, b) => String(a.label).localeCompare(String(b.label)))
      })),
      sourceColors
    };
  }

  const userResult = await pool.query(
    'SELECT id, username, email, password_hash, created_at FROM users WHERE id = $1 LIMIT 1',
    [userId]
  );
  const user = userResult.rows[0];
  if (!user) {
    return { error: 'User not found.' };
  }

  const listingsResult = await pool.query(
    'SELECT id, name, property_id, created_at FROM listings WHERE user_id = $1 ORDER BY name ASC',
    [userId]
  );
  const listingIds = listingsResult.rows.map((row) => Number(row.id));

  const propertiesResult = await pool.query(
    `
      SELECT id, name, postal_address, manager_name, manager_email, created_at
      FROM properties
      WHERE user_id = $1
      ORDER BY name ASC
    `,
    [userId]
  );
  const propertyById = new Map(propertiesResult.rows.map((row) => [Number(row.id), row]));

  let feedsRows = [];
  if (listingIds.length) {
    const feedsResult = await pool.query(
      'SELECT listing_id, label, url, created_at FROM calendar_feeds WHERE listing_id = ANY($1::bigint[]) ORDER BY listing_id ASC, label ASC',
      [listingIds]
    );
    feedsRows = feedsResult.rows;
  }

  const sourceColorsResult = await pool.query(
    'SELECT label, color, created_at, updated_at FROM feed_source_colors WHERE user_id = $1 ORDER BY label ASC',
    [userId]
  );

  const feedsByListingId = new Map();
  feedsRows.forEach((row) => {
    const listingKey = Number(row.listing_id);
    if (!feedsByListingId.has(listingKey)) {
      feedsByListingId.set(listingKey, []);
    }
    feedsByListingId.get(listingKey).push({
      label: row.label,
      url: row.url,
      created_at: row.created_at || null
    });
  });

  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    user: {
      username: user.username,
      email: user.email,
      password_hash: user.password_hash,
      created_at: user.created_at || null
    },
    properties: propertiesResult.rows.map((row) => ({
      name: row.name,
      postal_address: row.postal_address || '',
      manager_name: row.manager_name || '',
      manager_email: row.manager_email || '',
      created_at: row.created_at || null
    })),
    listings: listingsResult.rows.map((listing) => ({
      name: listing.name,
      property_name: propertyById.get(Number(listing.property_id))
        ? propertyById.get(Number(listing.property_id)).name
        : 'default',
      created_at: listing.created_at || null,
      feeds: feedsByListingId.get(Number(listing.id)) || []
    })),
    sourceColors: sourceColorsResult.rows.map((row) => ({
      label: row.label,
      color: row.color,
      created_at: row.created_at || null,
      updated_at: row.updated_at || null
    }))
  };
}

function normaliseArchiveString(value) {
  return String(value || '').trim();
}

function normaliseArchiveEmail(value) {
  const email = normaliseArchiveString(value).toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) ? email : null;
}

function normaliseArchiveTimestamp(value) {
  const text = normaliseArchiveString(value);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normaliseArchiveFeed(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const label = normaliseArchiveString(entry.label || entry.source || entry.name);
  const url = normaliseCalendarUrl(entry.url || entry.feedUrl || entry.calendarUrl || '');
  if (!label || !url) {
    return null;
  }
  return {
    label,
    url,
    created_at: normaliseArchiveTimestamp(entry.created_at || entry.createdAt)
  };
}

function normaliseArchiveListing(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const name = normaliseArchiveString(entry.name || entry.listingName || entry.title);
  if (!name) {
    return null;
  }

  const rawFeeds = Array.isArray(entry.feeds)
    ? entry.feeds
    : (Array.isArray(entry.calendar_feeds) ? entry.calendar_feeds : []);

  return {
    name,
    property_name: normaliseArchiveString(entry.property_name || entry.propertyName || entry.property || 'default') || 'default',
    created_at: normaliseArchiveTimestamp(entry.created_at || entry.createdAt),
    feeds: rawFeeds
      .map((feed) => normaliseArchiveFeed(feed))
      .filter(Boolean)
  };
}

function normaliseArchiveProperty(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const name = normaliseArchiveString(entry.name || entry.propertyName || entry.title);
  if (!name) {
    return null;
  }
  const rawManagerEmail = normaliseArchiveString(entry.manager_email || entry.managerEmail || entry.email);
  return {
    name,
    postal_address: normaliseArchiveString(entry.postal_address || entry.postalAddress || entry.address),
    manager_name: normaliseArchiveString(entry.manager_name || entry.managerName),
    manager_email: rawManagerEmail ? (normaliseOptionalEmail(rawManagerEmail) || '') : '',
    created_at: normaliseArchiveTimestamp(entry.created_at || entry.createdAt)
  };
}

function normaliseArchiveSourceColor(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const label = normaliseArchiveString(entry.label || entry.source || entry.name);
  const color = normaliseColor(entry.color || entry.hex || '');
  if (!label || !color) {
    return null;
  }
  return {
    label,
    color,
    created_at: normaliseArchiveTimestamp(entry.created_at || entry.createdAt),
    updated_at: normaliseArchiveTimestamp(entry.updated_at || entry.updatedAt)
  };
}

function normaliseUserArchivePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { error: 'Archive payload is required.' };
  }

  const userRaw = payload.user && typeof payload.user === 'object'
    ? payload.user
    : (payload.account && typeof payload.account === 'object' ? payload.account : null);

  if (!userRaw) {
    return { error: 'Archive user record is missing.' };
  }

  const username = normaliseArchiveString(userRaw.username || userRaw.userName || userRaw.name);
  const email = normaliseArchiveEmail(userRaw.email || userRaw.mail);
  const passwordHash = normaliseArchiveString(userRaw.password_hash || userRaw.passwordHash || userRaw.hash);
  if (!username || !email || !passwordHash) {
    return { error: 'Archive user data is incomplete.' };
  }

  const rawListings = Array.isArray(payload.listings)
    ? payload.listings
    : (Array.isArray(payload.listingRecords) ? payload.listingRecords : []);
  const listings = rawListings
    .map((item) => normaliseArchiveListing(item))
    .filter(Boolean);

  const rawProperties = Array.isArray(payload.properties)
    ? payload.properties
    : (Array.isArray(payload.propertyRecords) ? payload.propertyRecords : []);
  let properties = rawProperties
    .map((item) => normaliseArchiveProperty(item))
    .filter(Boolean);

  if (!properties.some((property) => property.name.toLowerCase() === 'default')) {
    properties.unshift({
      name: 'default',
      postal_address: '',
      manager_name: '',
      manager_email: '',
      created_at: null
    });
  }

  const rawColors = Array.isArray(payload.sourceColors)
    ? payload.sourceColors
    : (Array.isArray(payload.source_colors) ? payload.source_colors : []);
  const sourceColors = rawColors
    .map((item) => normaliseArchiveSourceColor(item))
    .filter(Boolean);

  return {
    schemaVersion: Number(payload.schemaVersion || payload.schema_version || 1),
    importedAt: new Date().toISOString(),
    user: {
      username,
      email,
      password_hash: passwordHash,
      created_at: normaliseArchiveTimestamp(userRaw.created_at || userRaw.createdAt)
    },
    properties,
    listings,
    sourceColors
  };
}

function getUniqueListingName(baseName, usedNames) {
  const root = normaliseArchiveString(baseName) || 'Listing';
  let candidate = root;
  let suffix = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = root + ' (' + suffix + ')';
    suffix += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

async function restoreUserArchiveData(archivePayload) {
  const payload = normaliseUserArchivePayload(archivePayload);
  if (payload.error) {
    return { error: payload.error };
  }

  if (await findUserByUsername(payload.user.username) || await findUserByEmail(payload.user.email)) {
    return { error: 'A user with this username or email already exists.' };
  }

  if (!usePostgres) {
    const users = readUsersFromFile();
    const nextUserId = users.length ? Math.max(...users.map((user) => Number(user.id))) + 1 : 1;

    users.push({
      id: nextUserId,
      username: payload.user.username,
      email: payload.user.email,
      password_hash: payload.user.password_hash,
      created_at: payload.user.created_at || new Date().toISOString()
    });
    writeUsersToFile(users);

    const store = readListingsStore();
    const propertyNameMap = new Map();
    const nextPropertyIdStart = store.properties.length
      ? Math.max(...store.properties.map((property) => Number(property.id))) + 1
      : 1;
    let nextPropertyId = nextPropertyIdStart;

    payload.properties.forEach((property) => {
      const propertyId = nextPropertyId;
      nextPropertyId += 1;
      store.properties.push({
        id: propertyId,
        user_id: nextUserId,
        name: property.name,
        postal_address: property.postal_address || '',
        manager_name: property.manager_name || '',
        manager_email: property.manager_email || '',
        created_at: property.created_at || new Date().toISOString()
      });
      propertyNameMap.set(property.name.toLowerCase(), propertyId);
    });

    const usedNames = new Set();
    const nextListingIdStart = store.listings.length
      ? Math.max(...store.listings.map((listing) => Number(listing.id))) + 1
      : 1;
    let nextListingId = nextListingIdStart;

    const nextFeedIdStart = store.feeds.length
      ? Math.max(...store.feeds.map((feed) => Number(feed.id))) + 1
      : 1;
    let nextFeedId = nextFeedIdStart;

    payload.listings.forEach((listing) => {
      const listingId = nextListingId;
      nextListingId += 1;

      const uniqueName = getUniqueListingName(listing.name, usedNames);
      const propertyId = propertyNameMap.get(String(listing.property_name || 'default').toLowerCase())
        || propertyNameMap.get('default')
        || null;
      store.listings.push({
        id: listingId,
        user_id: nextUserId,
        property_id: propertyId,
        name: uniqueName,
        created_at: listing.created_at || new Date().toISOString()
      });

      listing.feeds.forEach((feed) => {
        store.feeds.push({
          id: nextFeedId,
          listing_id: listingId,
          label: feed.label,
          url: feed.url,
          created_at: feed.created_at || new Date().toISOString()
        });
        nextFeedId += 1;
      });
    });

    payload.sourceColors.forEach((row) => {
      store.source_colors.push({
        user_id: nextUserId,
        label: row.label,
        color: row.color,
        created_at: row.created_at || new Date().toISOString(),
        updated_at: row.updated_at || new Date().toISOString()
      });
    });

    writeListingsStore(store);
    return { user: { id: nextUserId, username: payload.user.username, email: payload.user.email } };
  }

  const createdUserResult = await pool.query(
    `
      INSERT INTO users (username, email, password_hash, created_at)
      VALUES ($1, $2, $3, COALESCE($4::timestamptz, CURRENT_TIMESTAMP))
      RETURNING id, username, email
    `,
    [payload.user.username, payload.user.email, payload.user.password_hash, payload.user.created_at]
  );

  const createdUser = createdUserResult.rows[0];
  const propertyNameMap = new Map();

  for (const property of payload.properties) {
    const propertyResult = await pool.query(
      `
        INSERT INTO properties (user_id, name, postal_address, manager_name, manager_email, created_at)
        VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, CURRENT_TIMESTAMP))
        RETURNING id, name
      `,
      [
        createdUser.id,
        property.name,
        property.postal_address || '',
        property.manager_name || '',
        property.manager_email || null,
        property.created_at
      ]
    );
    propertyNameMap.set(String(propertyResult.rows[0].name).toLowerCase(), Number(propertyResult.rows[0].id));
  }

  const usedNames = new Set();

  for (const listing of payload.listings) {
    const uniqueName = getUniqueListingName(listing.name, usedNames);
    const propertyId = propertyNameMap.get(String(listing.property_name || 'default').toLowerCase())
      || propertyNameMap.get('default')
      || null;
    const listingResult = await pool.query(
      `
        INSERT INTO listings (user_id, name, property_id, created_at)
        VALUES ($1, $2, $3, COALESCE($4::timestamptz, CURRENT_TIMESTAMP))
        RETURNING id
      `,
      [createdUser.id, uniqueName, propertyId, listing.created_at]
    );
    const newListingId = Number(listingResult.rows[0].id);

    for (const feed of listing.feeds) {
      await pool.query(
        `
          INSERT INTO calendar_feeds (listing_id, label, url, created_at)
          VALUES ($1, $2, $3, COALESCE($4::timestamptz, CURRENT_TIMESTAMP))
        `,
        [newListingId, feed.label, feed.url, feed.created_at]
      );
    }
  }

  for (const row of payload.sourceColors) {
    await pool.query(
      `
        INSERT INTO feed_source_colors (user_id, label, color, created_at, updated_at)
        VALUES ($1, $2, $3, COALESCE($4::timestamptz, CURRENT_TIMESTAMP), COALESCE($5::timestamptz, CURRENT_TIMESTAMP))
        ON CONFLICT (user_id, label)
        DO UPDATE SET color = EXCLUDED.color, updated_at = CURRENT_TIMESTAMP
      `,
      [createdUser.id, row.label, row.color, row.created_at, row.updated_at]
    );
  }

  return { user: createdUser };
}

async function getListingsForUser(userId) {
  const defaultProperty = await ensureDefaultPropertyForUser(userId);

  if (!usePostgres) {
    const store = readListingsStore();
    let changed = false;
    const propertiesById = new Map(
      store.properties
        .filter((property) => Number(property.user_id) === Number(userId))
        .map((property) => [Number(property.id), property])
    );
    const listings = store.listings
      .filter((listing) => Number(listing.user_id) === Number(userId))
      .map((listing) => {
        if (!listing.property_id && defaultProperty) {
          listing.property_id = defaultProperty.id;
          changed = true;
        }
        const property = propertiesById.get(Number(listing.property_id));
        return {
          ...listing,
          property_id: Number(listing.property_id || (defaultProperty ? defaultProperty.id : 0)) || null,
          property_name: property ? property.name : (defaultProperty ? defaultProperty.name : null),
          date_basis: normaliseDateBasis(listing.date_basis)
        };
      })
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (changed) {
      writeListingsStore(store);
    }
    return listings;
  }

  await pool.query(
    `
      UPDATE listings
      SET property_id = $1
      WHERE user_id = $2 AND property_id IS NULL
    `,
    [defaultProperty.id, userId]
  );

  const result = await pool.query(
    `
      SELECT l.id, l.user_id, l.name, l.property_id, l.date_basis, l.usual_cleaner_id, l.created_at, p.name AS property_name
      FROM listings l
      LEFT JOIN properties p ON p.id = l.property_id
      WHERE l.user_id = $1
      ORDER BY l.name ASC
    `,
    [userId]
  );
  return result.rows;
}

async function getListingByIdForUser(listingId, userId) {
  const defaultProperty = await ensureDefaultPropertyForUser(userId);

  if (!usePostgres) {
    const store = readListingsStore();
    const listing = store.listings.find(
      (listing) => Number(listing.id) === Number(listingId) && Number(listing.user_id) === Number(userId)
    );
    if (!listing) {
      return null;
    }
    if (!listing.property_id && defaultProperty) {
      listing.property_id = defaultProperty.id;
      writeListingsStore(store);
    }
    const property = store.properties.find((item) => Number(item.id) === Number(listing.property_id));
    return {
      ...listing,
      property_id: Number(listing.property_id || (defaultProperty ? defaultProperty.id : 0)) || null,
      property_name: property ? property.name : (defaultProperty ? defaultProperty.name : null),
      date_basis: normaliseDateBasis(listing.date_basis)
    };
  }

  const result = await pool.query(
    `
      SELECT l.id, l.user_id, l.name, l.property_id, l.date_basis, l.usual_cleaner_id, l.created_at, p.name AS property_name
      FROM listings l
      LEFT JOIN properties p ON p.id = l.property_id
      WHERE l.id = $1 AND l.user_id = $2
      LIMIT 1
    `,
    [listingId, userId]
  );
  const listing = result.rows[0];
  if (listing && !listing.property_id && defaultProperty) {
    const backfilled = await pool.query(
      `
        UPDATE listings
        SET property_id = $1
        WHERE id = $2 AND user_id = $3
        RETURNING id, user_id, name, property_id, created_at
      `,
      [defaultProperty.id, listingId, userId]
    );
    if (backfilled.rows[0]) {
      backfilled.rows[0].property_name = defaultProperty.name;
      return backfilled.rows[0];
    }
  }
  return listing;
}

async function createListingForUser(userId, name, propertyId, dateBasis, usualCleanerId) {
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

    const property = await resolvePropertyForListing(userId, propertyId);
    if (!property) {
      return { error: 'Property not found.' };
    }

    const listing = {
      id: nextId,
      user_id: Number(userId),
      property_id: Number(property.id),
      date_basis: normaliseDateBasis(dateBasis),
      usual_cleaner_id: normaliseCleanerId(usualCleanerId),
      name,
      created_at: new Date().toISOString()
    };

    store.listings.push(listing);
    writeListingsStore(store);
    return { listing };
  }

  try {
    const property = await resolvePropertyForListing(userId, propertyId);
    if (!property) {
      return { error: 'Property not found.' };
    }

    const result = await pool.query(
      `
        INSERT INTO listings (user_id, name, property_id, date_basis, usual_cleaner_id)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, user_id, name, property_id, date_basis, usual_cleaner_id, created_at
      `,
      [userId, name, property.id, normaliseDateBasis(dateBasis), normaliseCleanerId(usualCleanerId)]
    );
    result.rows[0].property_name = property.name;
    return { listing: result.rows[0] };
  } catch (err) {
    if (err && err.code === '23505') {
      return { error: 'A listing with this name already exists.' };
    }
    throw err;
  }
}

async function updateListingForUser(listingId, userId, name, propertyId, dateBasis, usualCleanerId) {
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

    const property = await resolvePropertyForListing(userId, propertyId);
    if (!property) {
      return { error: 'Property not found.' };
    }

    store.listings[idx].name = name;
    store.listings[idx].property_id = Number(property.id);
    store.listings[idx].date_basis = normaliseDateBasis(dateBasis);
    store.listings[idx].usual_cleaner_id = normaliseCleanerId(usualCleanerId);
    writeListingsStore(store);
    return {
      listing: {
        ...store.listings[idx],
        property_name: property.name
      }
    };
  }

  try {
    const property = await resolvePropertyForListing(userId, propertyId);
    if (!property) {
      return { error: 'Property not found.' };
    }

    const result = await pool.query(
      `
        UPDATE listings
        SET name = $1, property_id = $2, date_basis = $3, usual_cleaner_id = $4
        WHERE id = $5 AND user_id = $6
        RETURNING id, user_id, name, property_id, date_basis, usual_cleaner_id, created_at
      `,
      [name, property.id, normaliseDateBasis(dateBasis), normaliseCleanerId(usualCleanerId), listingId, userId]
    );

    if (!result.rows[0]) {
      return { error: 'Listing not found.' };
    }
    result.rows[0].property_name = property.name;
    return { listing: result.rows[0] };
  } catch (err) {
    if (err && err.code === '23505') {
      return { error: 'A listing with this name already exists.' };
    }
    throw err;
  }
}

async function getBookedInChangesForUserByListings(userId, listingIds) {
  const uniqueListingIds = Array.from(new Set((listingIds || [])
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0)));

  if (!uniqueListingIds.length) {
    return [];
  }

  if (!usePostgres) {
    const store = readListingsStore();
    return (store.booked_in_changes || [])
      .filter((row) => Number(row.user_id) === Number(userId) && uniqueListingIds.includes(Number(row.listing_id)))
      .map((row) => ({
        id: row.id,
        user_id: row.user_id,
        property_id: row.property_id || null,
        listing_id: row.listing_id,
        reservation_checkin_date: row.reservation_checkin_date,
        reservation_checkout_date: row.reservation_checkout_date,
        changeover_date: row.changeover_date,
        cleaner_id: row.cleaner_id || null,
        created_at: row.created_at,
        updated_at: row.updated_at
      }));
  }

  const result = await pool.query(
    `
      SELECT id, user_id, property_id, listing_id,
             reservation_checkin_date::text AS reservation_checkin_date,
             reservation_checkout_date::text AS reservation_checkout_date,
             changeover_date::text AS changeover_date,
             cleaner_id, created_at, updated_at
      FROM booked_in_changes
      WHERE user_id = $1
        AND listing_id = ANY($2::bigint[])
    `,
    [userId, uniqueListingIds]
  );
  return result.rows;
}

async function upsertBookedInChangesForUser(userId, changes) {
  const payload = Array.isArray(changes) ? changes : [];
  if (!payload.length) {
    return { saved: 0 };
  }

  const listings = await getListingsForUser(userId);
  const listingById = new Map((listings || []).map((listing) => [Number(listing.id), listing]));
  const cleaners = await getCleanersForUser(userId);
  const cleanerIdSet = new Set((cleaners || []).map((cleaner) => Number(cleaner.id)));

  const normalised = [];
  payload.forEach((entry) => {
    const listingId = Number(entry.listingId);
    if (!Number.isInteger(listingId) || listingId <= 0 || !listingById.has(listingId)) {
      return;
    }

    const reservationCheckinDate = normaliseDateKey(entry.reservationCheckinDate);
    const reservationCheckoutDate = normaliseDateKey(entry.reservationCheckoutDate);
    const changeoverDate = normaliseDateKey(entry.changeoverDate);
    if (!reservationCheckinDate || !reservationCheckoutDate || !changeoverDate) {
      return;
    }

    const cleanerId = normaliseCleanerId(entry.cleanerId);
    if (cleanerId && !cleanerIdSet.has(cleanerId)) {
      return;
    }

    const listing = listingById.get(listingId);
    normalised.push({
      listingId,
      propertyId: listing && listing.property_id ? Number(listing.property_id) : null,
      reservationCheckinDate,
      reservationCheckoutDate,
      changeoverDate,
      cleanerId
    });
  });

  if (!normalised.length) {
    return { saved: 0 };
  }

  if (!usePostgres) {
    const store = readListingsStore();
    const nextIdStart = (store.booked_in_changes || []).length
      ? Math.max(...store.booked_in_changes.map((item) => Number(item.id))) + 1
      : 1;
    let nextId = nextIdStart;
    const now = new Date().toISOString();

    normalised.forEach((entry) => {
      const idx = (store.booked_in_changes || []).findIndex((item) =>
        Number(item.user_id) === Number(userId)
        && Number(item.listing_id) === Number(entry.listingId)
        && String(item.reservation_checkin_date) === entry.reservationCheckinDate
        && String(item.reservation_checkout_date) === entry.reservationCheckoutDate
      );

      if (idx >= 0) {
        store.booked_in_changes[idx].property_id = entry.propertyId;
        store.booked_in_changes[idx].changeover_date = entry.changeoverDate;
        store.booked_in_changes[idx].cleaner_id = entry.cleanerId;
        store.booked_in_changes[idx].updated_at = now;
      } else {
        store.booked_in_changes.push({
          id: nextId,
          user_id: Number(userId),
          property_id: entry.propertyId,
          listing_id: entry.listingId,
          reservation_checkin_date: entry.reservationCheckinDate,
          reservation_checkout_date: entry.reservationCheckoutDate,
          changeover_date: entry.changeoverDate,
          cleaner_id: entry.cleanerId,
          created_at: now,
          updated_at: now
        });
        nextId += 1;
      }
    });

    writeListingsStore(store);
    return { saved: normalised.length };
  }

  for (const entry of normalised) {
    await pool.query(
      `
        INSERT INTO booked_in_changes (
          user_id,
          property_id,
          listing_id,
          reservation_checkin_date,
          reservation_checkout_date,
          changeover_date,
          cleaner_id
        )
        VALUES ($1, $2, $3, $4::date, $5::date, $6::date, $7)
        ON CONFLICT (user_id, listing_id, reservation_checkin_date, reservation_checkout_date)
        DO UPDATE SET
          property_id = EXCLUDED.property_id,
          changeover_date = EXCLUDED.changeover_date,
          cleaner_id = EXCLUDED.cleaner_id,
          updated_at = CURRENT_TIMESTAMP
      `,
      [
        userId,
        entry.propertyId,
        entry.listingId,
        entry.reservationCheckinDate,
        entry.reservationCheckoutDate,
        entry.changeoverDate,
        entry.cleanerId
      ]
    );
  }

  return { saved: normalised.length };
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

// ── Persistent event cache ───────────────────────────────────────────────────

async function getAllListingsWithFeeds() {
  if (!usePostgres) {
    const store = readListingsStore();
    const listingIds = [...new Set(store.feeds.map((f) => Number(f.listing_id)))];
    return listingIds.map((id) => ({ id }));
  }
  const result = await pool.query(
    'SELECT DISTINCT listing_id AS id FROM calendar_feeds ORDER BY listing_id ASC'
  );
  return result.rows;
}

async function getFeedsForListingInternal(listingId) {
  if (!usePostgres) {
    const store = readListingsStore();
    return store.feeds.filter((f) => Number(f.listing_id) === Number(listingId));
  }
  const result = await pool.query(
    'SELECT id, listing_id, label, url FROM calendar_feeds WHERE listing_id = $1 ORDER BY id ASC',
    [listingId]
  );
  return result.rows;
}

async function storeFeedCache(listingId, feedId, label, events, errorText) {
  const eventsJson = JSON.stringify(events || []);
  const now = new Date().toISOString();
  if (!usePostgres) {
    const store = readListingsStore();
    const idx = store.cached_events.findIndex(
      (c) => Number(c.listing_id) === Number(listingId) && Number(c.feed_id) === Number(feedId)
    );
    const entry = {
      listing_id: Number(listingId),
      feed_id: Number(feedId),
      label,
      events_json: eventsJson,
      error_text: errorText || null,
      fetched_at: now
    };
    if (idx === -1) {
      store.cached_events.push(entry);
    } else {
      store.cached_events[idx] = entry;
    }
    writeListingsStore(store);
    return;
  }
  await pool.query(
    `
      INSERT INTO cached_events (listing_id, feed_id, label, events_json, error_text, fetched_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (listing_id, feed_id)
      DO UPDATE SET label = EXCLUDED.label,
                    events_json = EXCLUDED.events_json,
                    error_text = EXCLUDED.error_text,
                    fetched_at = NOW()
    `,
    [listingId, feedId, label, eventsJson, errorText || null]
  );
}

async function getCachedEventsForListing(listingId) {
  if (!usePostgres) {
    const store = readListingsStore();
    return store.cached_events.filter((c) => Number(c.listing_id) === Number(listingId));
  }
  const result = await pool.query(
    'SELECT feed_id, label, events_json, error_text, fetched_at FROM cached_events WHERE listing_id = $1 ORDER BY feed_id ASC',
    [listingId]
  );
  return result.rows;
}

async function refreshEventsForListing(listingId) {
  const feeds = await getFeedsForListingInternal(listingId);
  await Promise.all(
    feeds.map(async (feed) => {
      const fetched = await fetchEventsFromCalendarUrl(feed.url);
      if (fetched.error) {
        await storeFeedCache(listingId, feed.id, feed.label, [], fetched.error);
      } else {
        const events = fetched.events.map((event) => ({
          isReservation: isAirbnbSource(feed.label) ? isAirbnbReservedSummary(event.title) : true,
          isUnavailableBlock: isAirbnbSource(feed.label) ? isAirbnbNotAvailableSummary(event.title) : false,
          source: feed.label,
          start: event.start,
          end: event.end,
          title: event.title,
          description: event.description,
          location: event.location,
          raw: event.raw
        }));
        await storeFeedCache(listingId, feed.id, feed.label, events, null);
      }
    })
  );
}

async function refreshAllListingsEvents() {
  try {
    const listings = await getAllListingsWithFeeds();
    await Promise.all(listings.map((listing) => refreshEventsForListing(listing.id).catch((err) => {
      console.error('Cron refresh error for listing', listing.id, err && err.message);
    })));
    console.log('Event cache refresh complete for', listings.length, 'listings at', new Date().toISOString());
  } catch (err) {
    console.error('Event cache refresh failed:', err && err.message);
  }
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

app.use(express.json({ limit: '5mb' }));
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

function normaliseAdminQueryValue(value, type) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  if (type === 'boolean') {
    const lower = text.toLowerCase();
    if (lower === 'true' || lower === '1') return 'true';
    if (lower === 'false' || lower === '0') return 'false';
    return null;
  }

  if (type === 'number') {
    const parsed = Number(text);
    return Number.isFinite(parsed) ? String(parsed) : null;
  }

  return text;
}

function maskKeyForDiagnostics(secret) {
  const value = String(secret || '');
  if (!value) {
    return '(missing)';
  }
  if (value.length <= 4) {
    return '*'.repeat(value.length);
  }
  return '*'.repeat(value.length - 4) + value.slice(-4);
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

// GET /api/admin/users/:userId/archive
app.get('/api/admin/users/:userId/archive', requireAdminAuth, async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid user id.' });
  }

  try {
    const archive = await getUserArchiveData(userId);
    if (archive.error) {
      return res.status(404).json({ error: archive.error });
    }

    const usernamePart = String(archive.user.username || 'user').replace(/[^a-zA-Z0-9_-]+/g, '_');
    const stamp = new Date().toISOString().slice(0, 10);
    const fileName = usernamePart + '-archive-' + stamp + '.json';
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + fileName + '"');
    return res.status(200).send(JSON.stringify(archive, null, 2));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to archive user.' });
  }
});

// POST /api/admin/users/load
app.post('/api/admin/users/load', requireAdminAuth, async (req, res) => {
  const archive = req.body && req.body.archive;
  if (!archive || typeof archive !== 'object') {
    return res.status(400).json({ error: 'Archive payload is required.' });
  }

  try {
    const result = await restoreUserArchiveData(archive);
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    return res.status(201).json({ message: 'User data loaded.', user: result.user });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load user data.' });
  }
});

// GET /api/admin/kayak/endpoints
app.get('/api/admin/kayak/endpoints', requireAdminAuth, (req, res) => {
  const endpointList = Object.values(KAYAK_HOTEL_ENDPOINTS).map((endpoint) => ({
    id: endpoint.id,
    title: endpoint.title,
    method: endpoint.method,
    path: endpoint.path,
    queryFields: endpoint.queryFields
  }));

  return res.json({
    baseUri: '/api/3.0',
    configuredBaseUrl: KAYAK_API_BASE_URL,
    hasApiKeyConfigured: Boolean(KAYAK_API_KEY),
    endpoints: endpointList
  });
});

// POST /api/admin/kayak/request
app.post('/api/admin/kayak/request', requireAdminAuth, async (req, res) => {
  if (!KAYAK_API_KEY) {
    return res.status(500).json({ error: 'KAYAK_API_KEY is not configured on the server.' });
  }

  const endpointId = String(req.body.endpointId || '').trim();
  const endpoint = KAYAK_HOTEL_ENDPOINTS[endpointId];
  if (!endpoint) {
    return res.status(400).json({ error: 'Unknown KAYAK endpoint.' });
  }

  const payload = req.body && typeof req.body.params === 'object' ? req.body.params : {};
  const requestUrl = new URL('/api/3.0' + endpoint.path, KAYAK_API_BASE_URL);
  const missingRequiredFields = [];

  for (const field of endpoint.queryFields) {
    const rawValue = payload[field.key];
    const normalised = normaliseAdminQueryValue(rawValue, field.type);
    if (field.required && !normalised) {
      missingRequiredFields.push(field.key);
      continue;
    }
    if (normalised !== null) {
      requestUrl.searchParams.set(field.key, normalised);
    }
  }

  if (missingRequiredFields.length) {
    return res.status(400).json({
      error: 'Missing required fields: ' + missingRequiredFields.join(', ')
    });
  }

  if (!requestUrl.searchParams.get('userTrackId')) {
    requestUrl.searchParams.set('userTrackId', randomUUID());
  }
  requestUrl.searchParams.set('apiKey', KAYAK_API_KEY);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const upstream = await fetch(requestUrl, {
      method: endpoint.method,
      headers: { Accept: 'application/json, text/plain, */*' },
      signal: controller.signal
    });

    const text = await upstream.text();
    let parsedBody = text;
    try {
      parsedBody = text ? JSON.parse(text) : null;
    } catch {
      // Keep plain text body when JSON parsing fails.
    }

    const maskedUrl = requestUrl.toString().replace(KAYAK_API_KEY, '***');
    return res.status(200).json({
      request: {
        endpointId: endpoint.id,
        method: endpoint.method,
        url: maskedUrl,
        diagnostics: {
          apiKeyInjected: Boolean(requestUrl.searchParams.get('apiKey')),
          configuredApiKeyMask: maskKeyForDiagnostics(KAYAK_API_KEY)
        }
      },
      response: {
        status: upstream.status,
        ok: upstream.ok,
        headers: Object.fromEntries(upstream.headers.entries()),
        body: parsedBody
      }
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return res.status(504).json({ error: 'KAYAK request timed out after 45 seconds.' });
    }
    console.error('KAYAK test request failed:', err);
    return res.status(502).json({ error: 'Failed to execute KAYAK request.' });
  } finally {
    clearTimeout(timeout);
  }
});

// GET /api/me — return current user info (requires auth)
app.get('/api/me', requireAuth, (req, res) => {
  res.json({
    username: req.session.username,
    email: req.session.email
  });
});

// GET /api/cleaners — all cleaners for current user
app.get('/api/cleaners', requireAuth, async (req, res) => {
  try {
    const cleaners = await getCleanersForUser(req.session.userId);
    return res.json({ cleaners });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load cleaners.' });
  }
});

// POST /api/cleaners — create cleaner for current user
app.post('/api/cleaners', requireAuth, async (req, res) => {
  try {
    const { cleaner, error } = await createCleanerForUser(req.session.userId, {
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      email: req.body.email,
      telephone: req.body.telephone,
      password: req.body.password
    });
    if (error) {
      return res.status(400).json({ error });
    }
    return res.status(201).json({ cleaner });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create cleaner.' });
  }
});

// PUT /api/cleaners/:cleanerId — update cleaner for current user
app.put('/api/cleaners/:cleanerId', requireAuth, async (req, res) => {
  const cleanerId = Number(req.params.cleanerId);
  if (!Number.isInteger(cleanerId) || cleanerId <= 0) {
    return res.status(400).json({ error: 'Invalid cleaner id.' });
  }

  try {
    const { cleaner, error } = await updateCleanerForUser(cleanerId, req.session.userId, {
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      email: req.body.email,
      telephone: req.body.telephone,
      password: req.body.password
    });
    if (error === 'Cleaner not found.') {
      return res.status(404).json({ error });
    }
    if (error) {
      return res.status(400).json({ error });
    }
    return res.json({ cleaner });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update cleaner.' });
  }
});

// POST /api/booked-in-changes/lookup — fetch booked-in changes for selected listings
app.post('/api/booked-in-changes/lookup', requireAuth, async (req, res) => {
  const listingIds = Array.isArray(req.body.listingIds) ? req.body.listingIds : [];

  try {
    const changes = await getBookedInChangesForUserByListings(req.session.userId, listingIds);
    return res.json({ changes });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load booked-in changes.' });
  }
});

// POST /api/booked-in-changes/upsert — persist changeover overrides for reservations
app.post('/api/booked-in-changes/upsert', requireAuth, async (req, res) => {
  const changes = Array.isArray(req.body.changes) ? req.body.changes : [];

  try {
    const result = await upsertBookedInChangesForUser(req.session.userId, changes);
    return res.json({ saved: result.saved });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to save booked-in changes.' });
  }
});

// GET /api/properties — all properties for current user
app.get('/api/properties', requireAuth, async (req, res) => {
  try {
    const properties = await getPropertiesForUser(req.session.userId);
    return res.json({ properties });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load properties.' });
  }
});

// POST /api/properties — create property for current user
app.post('/api/properties', requireAuth, async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'Property name is required.' });
  }

  try {
    const { property, error } = await createPropertyForUser(req.session.userId, name);
    if (error) {
      return res.status(409).json({ error });
    }
    return res.status(201).json({ property });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create property.' });
  }
});

// GET /api/properties/:propertyId — get property details
app.get('/api/properties/:propertyId', requireAuth, async (req, res) => {
  const propertyId = Number(req.params.propertyId);
  if (!Number.isInteger(propertyId) || propertyId <= 0) {
    return res.status(400).json({ error: 'Invalid property id.' });
  }

  try {
    const property = await getPropertyByIdForUser(propertyId, req.session.userId);
    if (!property) {
      return res.status(404).json({ error: 'Property not found.' });
    }
    return res.json({ property });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load property.' });
  }
});

// PUT /api/properties/:propertyId — update property details
app.put('/api/properties/:propertyId', requireAuth, async (req, res) => {
  const propertyId = Number(req.params.propertyId);
  if (!Number.isInteger(propertyId) || propertyId <= 0) {
    return res.status(400).json({ error: 'Invalid property id.' });
  }

  try {
    const { property, error } = await updatePropertyForUser(propertyId, req.session.userId, {
      name: req.body.name,
      postalAddress: req.body.postalAddress,
      managerName: req.body.managerName,
      managerEmail: req.body.managerEmail
    });
    if (error === 'Property not found.') {
      return res.status(404).json({ error });
    }
    if (error) {
      return res.status(400).json({ error });
    }
    return res.json({ property });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update property.' });
  }
});

// DELETE /api/properties/:propertyId — delete property if safe
app.delete('/api/properties/:propertyId', requireAuth, async (req, res) => {
  const propertyId = Number(req.params.propertyId);
  if (!Number.isInteger(propertyId) || propertyId <= 0) {
    return res.status(400).json({ error: 'Invalid property id.' });
  }

  try {
    const result = await deletePropertyForUser(propertyId, req.session.userId);
    if (result.error === 'Property not found.') {
      return res.status(404).json({ error: result.error });
    }
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    return res.json({ message: 'Property deleted.', deletedPropertyId: result.deletedPropertyId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete property.' });
  }
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
  const propertyId = Number(req.body.propertyId);
  const dateBasis = normaliseDateBasis(req.body.dateBasis);
  const usualCleanerId = req.body.usualCleanerId;
  if (!name) {
    return res.status(400).json({ error: 'Listing name is required.' });
  }

  try {
    const { listing, error } = await createListingForUser(
      req.session.userId,
      name,
      Number.isInteger(propertyId) && propertyId > 0 ? propertyId : null,
      dateBasis,
      usualCleanerId
    );
    if (error) {
      return res.status(error === 'Property not found.' ? 404 : 409).json({ error });
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
  const propertyId = Number(req.body.propertyId);
  const dateBasis = normaliseDateBasis(req.body.dateBasis);
  const usualCleanerId = req.body.usualCleanerId;

  if (!Number.isInteger(listingId) || listingId <= 0) {
    return res.status(400).json({ error: 'Invalid listing id.' });
  }
  if (!name) {
    return res.status(400).json({ error: 'Listing name is required.' });
  }

  try {
    const { listing, error } = await updateListingForUser(
      listingId,
      req.session.userId,
      name,
      Number.isInteger(propertyId) && propertyId > 0 ? propertyId : null,
      dateBasis,
      usualCleanerId
    );
    if (error === 'Listing not found.') {
      return res.status(404).json({ error });
    }
    if (error === 'Property not found.') {
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

function buildIcsDateString(dateValue) {
  const raw = String(dateValue || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw.replace(/-/g, '');
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) +
    'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
}

function escapeIcsText(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function foldIcsLine(line) {
  const chars = [...line];
  if (chars.length <= 75) return line;
  const parts = [];
  let current = '';
  for (const ch of chars) {
    if (current.length >= 75) {
      parts.push(current);
      current = ' ' + ch;
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts.join('\\r\\n');
}

function buildIcsCalendar(listing, events) {
  const now = buildIcsDateString(new Date().toISOString());
  const prodId = '-//herupa1//Listing ' + listing.id + '//EN';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:' + prodId,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + escapeIcsText(listing.name)
  ];

  events.forEach((event, idx) => {
    const dtstart = buildIcsDateString(event.start);
    const dtend = buildIcsDateString(event.end);
    if (!dtstart || !dtend) return;

    const isAllDay = /^\d{8}$/.test(dtstart);
    const uid = 'listing-' + listing.id + '-' + idx + '@herupa1';

    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + uid);
    lines.push('DTSTAMP:' + now);
    if (isAllDay) {
      lines.push('DTSTART;VALUE=DATE:' + dtstart);
      lines.push('DTEND;VALUE=DATE:' + dtend);
    } else {
      lines.push('DTSTART:' + dtstart);
      lines.push('DTEND:' + dtend);
    }
    lines.push('SUMMARY:' + escapeIcsText(event.title || event.source || 'Reservation'));
    if (event.description) {
      lines.push('DESCRIPTION:' + escapeIcsText(event.description));
    }
    if (event.location) {
      lines.push('LOCATION:' + escapeIcsText(event.location));
    }
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join('\\r\\n') + '\\r\\n';
}

// GET /api/listings/:listingId/calendar.ics — export merged calendar as ICS
app.get('/api/listings/:listingId/calendar.ics', requireAuth, async (req, res) => {
  const listingId = Number(req.params.listingId);
  if (!Number.isInteger(listingId) || listingId <= 0) {
    return res.status(400).send('Invalid listing id.');
  }

  try {
    const listing = await getListingByIdForUser(listingId, req.session.userId);
    if (!listing) {
      return res.status(404).send('Listing not found.');
    }

    const cached = await getCachedEventsForListing(listingId);
    const events = cached
      .filter((c) => !c.error_text)
      .flatMap((c) => {
        try { return JSON.parse(c.events_json || '[]'); } catch { return []; }
      })
      .sort((a, b) => {
        const aTime = a.start ? new Date(a.start).getTime() : 0;
        const bTime = b.start ? new Date(b.start).getTime() : 0;
        return aTime - bTime;
      });

    const icsContent = buildIcsCalendar(listing, events);
    const safeName = String(listing.name || 'listing').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + safeName + '.ics"');
    return res.send(icsContent);
  } catch (err) {
    console.error(err);
    return res.status(500).send('Failed to generate calendar.');
  }
});

// GET /api/listings/:listingId/events — serve events from the persistent cache
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

    const cached = await getCachedEventsForListing(listingId);

    const feedErrors = cached
      .filter((c) => c.error_text)
      .map((c) => ({ source: c.label, error: c.error_text }));

    const events = cached
      .filter((c) => !c.error_text)
      .flatMap((c) => {
        try {
          return JSON.parse(c.events_json || '[]');
        } catch {
          return [];
        }
      })
      .sort((a, b) => {
        const aTime = a.start ? new Date(a.start).getTime() : Number.NEGATIVE_INFINITY;
        const bTime = b.start ? new Date(b.start).getTime() : Number.NEGATIVE_INFINITY;
        return aTime - bTime;
      });

    const fetchedAt = cached.length
      ? cached.map((c) => c.fetched_at).sort().pop()
      : null;

    return res.json({ listing, events, feedErrors, fetchedAt });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load listing events.' });
  }
});

// POST /api/listings/:listingId/events/refresh — trigger immediate cache refresh then return events
app.post('/api/listings/:listingId/events/refresh', requireAuth, async (req, res) => {
  const listingId = Number(req.params.listingId);
  if (!Number.isInteger(listingId) || listingId <= 0) {
    return res.status(400).json({ error: 'Invalid listing id.' });
  }

  try {
    const listing = await getListingByIdForUser(listingId, req.session.userId);
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    await refreshEventsForListing(listingId);

    const cached = await getCachedEventsForListing(listingId);

    const feedErrors = cached
      .filter((c) => c.error_text)
      .map((c) => ({ source: c.label, error: c.error_text }));

    const events = cached
      .filter((c) => !c.error_text)
      .flatMap((c) => {
        try {
          return JSON.parse(c.events_json || '[]');
        } catch {
          return [];
        }
      })
      .sort((a, b) => {
        const aTime = a.start ? new Date(a.start).getTime() : Number.NEGATIVE_INFINITY;
        const bTime = b.start ? new Date(b.start).getTime() : Number.NEGATIVE_INFINITY;
        return aTime - bTime;
      });

    const fetchedAt = cached.length
      ? cached.map((c) => c.fetched_at).sort().pop()
      : null;

    return res.json({ listing, events, feedErrors, fetchedAt });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to refresh listing events.' });
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

// ── Stay API admin proxy ─────────────────────────────────────────────────────

const STAY_API_ENDPOINTS = {
  destinationLookup: {
    id: 'destinationLookup',
    title: 'Destination Lookup',
    description: 'Search for a destination and retrieve its dest_id and dest_type to use in hotel searches.',
    method: 'GET',
    path: '/v1/booking/destinations/lookup',
    queryFields: [
      { key: 'query', type: 'string', required: true, description: 'Destination name to look up, e.g. Barcelona.' }
    ]
  },
  hotelSearch: {
    id: 'hotelSearch',
    title: 'Hotel Search',
    description: 'Search for available hotels in a destination for a given date range and occupancy.',
    method: 'GET',
    path: '/v1/booking/search',
    queryFields: [
      { key: 'dest_id',  type: 'string', required: true,  description: 'Destination ID returned by Destination Lookup, e.g. -3233180.' },
      { key: 'checkin',  type: 'date',   required: true,  description: 'Check-in date (YYYY-MM-DD).' },
      { key: 'checkout', type: 'date',   required: true,  description: 'Check-out date (YYYY-MM-DD).' },
      { key: 'adults',   type: 'number', required: true,  description: 'Number of adult guests.' },
      { key: 'rooms',    type: 'number', required: true,  description: 'Number of rooms.' },
      { key: 'dest_type', type: 'string', required: false, description: 'Destination type returned by Destination Lookup (e.g. city).' },
      { key: 'page',     type: 'number', required: false, description: 'Page number for pagination.' },
      { key: 'currency', type: 'string', required: false, description: 'ISO 4217 currency code, e.g. USD.' },
      { key: 'locale',   type: 'string', required: false, description: 'Locale string, e.g. en-gb.' }
    ]
  },
  hotelDetails: {
    id: 'hotelDetails',
    title: 'Hotel Details',
    description: 'Retrieve full details for a specific hotel by its hotel_id.',
    method: 'GET',
    path: '/v2/booking/hotel/details',
    queryFields: [
      { key: 'hotel_id', type: 'string', required: true, description: 'Hotel ID to retrieve details for, e.g. 1331780.' }
    ]
  },
  airbnbListingPricing: {
    id: 'airbnbListingPricing',
    title: 'Airbnb Listing Pricing',
    description: 'Retrieve Airbnb listing pricing totals for dates and occupancy.',
    method: 'GET',
    path: '/v1/airbnb/listing/:listingId/pricing',
    pathFields: [
      { key: 'listingId', type: 'string', required: true, description: 'Airbnb listing id path value, e.g. 22135033.' }
    ],
    queryFields: [
      { key: 'check_in', type: 'date', required: true, description: 'Check-in date (YYYY-MM-DD).' },
      { key: 'check_out', type: 'date', required: true, description: 'Check-out date (YYYY-MM-DD).' },
      { key: 'adults', type: 'number', required: true, description: 'Number of adult guests.' },
      { key: 'currency', type: 'string', required: false, description: 'Currency code, e.g. EUR.' }
    ]
  }
};

// GET /api/admin/stay/endpoints
app.get('/api/admin/stay/endpoints', requireAdminAuth, (req, res) => {
  return res.json({
    hasApiKeyConfigured: Boolean(STAY_API_KEY),
    endpoints: Object.values(STAY_API_ENDPOINTS).map((ep) => ({
      id: ep.id,
      title: ep.title,
      description: ep.description,
      method: ep.method,
      path: ep.path,
      pathFields: ep.pathFields || [],
      queryFields: ep.queryFields
    }))
  });
});

// POST /api/admin/stay/request
app.post('/api/admin/stay/request', requireAdminAuth, async (req, res) => {
  if (!STAY_API_KEY) {
    return res.status(500).json({ error: 'STAY_API_KEY is not configured on the server.' });
  }

  const endpointId = String(req.body.endpointId || '').trim();
  const endpoint = STAY_API_ENDPOINTS[endpointId];
  if (!endpoint) {
    return res.status(400).json({ error: 'Unknown Stay API endpoint.' });
  }

  const payload = (req.body && typeof req.body.params === 'object') ? req.body.params : {};
  let resolvedPath = endpoint.path;
  const missing = [];

  for (const field of (endpoint.pathFields || [])) {
    const normalised = normaliseAdminQueryValue(payload[field.key], field.type);
    if (field.required && !normalised) {
      missing.push(field.key);
      continue;
    }
    if (normalised !== null) {
      resolvedPath = resolvedPath.replace(':' + field.key, encodeURIComponent(normalised));
    }
  }

  const requestUrl = new URL(resolvedPath, STAY_API_BASE_URL);

  for (const field of (endpoint.queryFields || [])) {
    const normalised = normaliseAdminQueryValue(payload[field.key], field.type);
    if (field.required && !normalised) {
      missing.push(field.key);
      continue;
    }
    if (normalised !== null) {
      requestUrl.searchParams.set(field.key, normalised);
    }
  }

  if (missing.length) {
    return res.status(400).json({ error: 'Missing required fields: ' + missing.join(', ') });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const upstream = await fetch(requestUrl, {
      method: endpoint.method,
      headers: {
        'x-api-key': STAY_API_KEY,
        'Accept': 'application/json'
      },
      signal: controller.signal
    });

    const text = await upstream.text();
    let parsedBody = text;
    try { parsedBody = text ? JSON.parse(text) : null; } catch { /* keep raw text */ }

    return res.status(200).json({
      request: {
        endpointId: endpoint.id,
        method: endpoint.method,
        url: requestUrl.toString()
      },
      response: {
        status: upstream.status,
        ok: upstream.ok,
        headers: Object.fromEntries(upstream.headers.entries()),
        body: parsedBody
      }
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return res.status(504).json({ error: 'Stay API request timed out.' });
    }
    console.error('Stay API test request failed:', err);
    return res.status(502).json({ error: 'Failed to execute Stay API request.' });
  } finally {
    clearTimeout(timeout);
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

    // Run initial refresh 15 s after startup, then every 10 minutes
    setTimeout(() => {
      refreshAllListingsEvents();
      setInterval(refreshAllListingsEvents, 10 * 60 * 1000);
    }, 15000);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();

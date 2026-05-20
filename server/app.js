'use strict';

const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const sanitizeHtml = require('sanitize-html');
const Stripe = require('stripe');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');
const { randomUUID, createHmac, timingSafeEqual } = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SALT_ROUNDS = 12;
const SESSION_SECRET = String(process.env.SESSION_SECRET || '').trim();
const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || '').trim();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '').trim();
const ADMIN_AUTH_CONFIGURED = Boolean(ADMIN_USERNAME && ADMIN_PASSWORD);
const ENABLE_INVITE_AUTO_VALIDATION = String(process.env.ENABLE_INVITE_AUTO_VALIDATION || '').trim().toLowerCase() === 'true';
const KAYAK_API_BASE_URL = process.env.KAYAK_API_BASE_URL || 'https://sandbox-en-us.kayakaffiliates.com';
const KAYAK_API_KEY = process.env.KAYAK_API_KEY || '';
const STAY_API_KEY = process.env.STAY_API_KEY || '';
const STAY_API_BASE_URL = 'https://api.stayapi.com';
const POSTMARK_SERVER_TOKEN = String(process.env.POSTMARK_SERVER_TOKEN || '').trim();
const POSTMARK_FROM = String(process.env.POSTMARK_FROM || 'noreply@automaticpeople.com').trim();
const POSTMARK_MESSAGE_STREAM = String(process.env.POSTMARK_MESSAGE_STREAM || 'outbound').trim();
const STRIPE_SECRET_KEY = String(process.env.STRIPE_SECRET_KEY || '').trim();
const STRIPE_PUBLISHABLE_KEY = String(process.env.STRIPE_PUBLISHABLE_KEY || '').trim();
const STRIPE_WEBHOOK_SECRET = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
const STRIPE_CONNECT_DEFAULT_COUNTRY = String(process.env.STRIPE_CONNECT_DEFAULT_COUNTRY || 'GB').trim().toUpperCase();
const DATA_RESET_FLAG_KEY = 'minimal-profile-reset-v1';
const APP_BASE_URL = String(process.env.APP_BASE_URL || '').trim();
const ACCOUNT_VALIDATION_TOKEN_VERSION = 'v1';
const ACCOUNT_VALIDATION_TOKEN_TTL_MS = Number(process.env.ACCOUNT_VALIDATION_TOKEN_TTL_MS || (1000 * 60 * 60 * 24 * 7));
const PASSWORD_RESET_TOKEN_VERSION = 'v1';
const PASSWORD_RESET_TOKEN_TTL_MS = Number(process.env.PASSWORD_RESET_TOKEN_TTL_MS || (1000 * 60 * 60));
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
const stripeClient = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Legacy local JSON storage mode has been removed.');
}

if (!SESSION_SECRET || SESSION_SECRET === 'replace-this-secret-in-production' || SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be set to a strong value (minimum 32 characters).');
}

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

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runOneTimeSiteDataResetIfNeeded() {
  

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_runtime_flags (
      key TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const existingFlag = await pool.query(
    'SELECT key FROM app_runtime_flags WHERE key = $1 LIMIT 1',
    [DATA_RESET_FLAG_KEY]
  );
  if (existingFlag.rows[0]) {
    return;
  }

  await pool.query('BEGIN');
  try {
    await pool.query(`
      TRUNCATE TABLE
        manager_listing_assignments,
        manager_property_assignments,
        guest_relationships,
        booked_in_changes,
        cached_events,
        calendar_feeds,
        feed_source_colors,
        shared_resource_reservations,
        shared_resources,
        listings,
        properties,
        cleaners,
        client_memberships,
        client_accounts,
        users
      RESTART IDENTITY CASCADE
    `);

    await pool.query(
      'INSERT INTO app_runtime_flags (key) VALUES ($1)',
      [DATA_RESET_FLAG_KEY]
    );

    await pool.query('COMMIT');
  } catch (err) {
    await pool.query('ROLLBACK');
    throw err;
  }
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

function isPrivateIpv4Address(address) {
  const parts = String(address || '').split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isPrivateIpv6Address(address) {
  const value = String(address || '').toLowerCase();
  if (!value) return true;
  if (value === '::1' || value === '::') return true;
  if (value.startsWith('fc') || value.startsWith('fd')) return true;
  if (value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')) return true;

  if (value.startsWith('::ffff:')) {
    const mappedV4 = value.slice('::ffff:'.length);
    if (net.isIP(mappedV4) === 4) {
      return isPrivateIpv4Address(mappedV4);
    }
  }

  return false;
}

function isPrivateIpAddress(address) {
  const family = net.isIP(String(address || ''));
  if (family === 4) return isPrivateIpv4Address(address);
  if (family === 6) return isPrivateIpv6Address(address);
  return true;
}

function isBlockedCalendarHostname(hostname) {
  const value = String(hostname || '').trim().toLowerCase();
  if (!value) return true;
  if (value === 'localhost' || value.endsWith('.localhost')) return true;
  if (value.endsWith('.local')) return true;
  return false;
}

async function isSafeCalendarFetchTarget(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || ''));
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  const hostname = String(parsed.hostname || '').trim();
  if (isBlockedCalendarHostname(hostname)) {
    return false;
  }

  if (net.isIP(hostname)) {
    return !isPrivateIpAddress(hostname);
  }

  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    if (!Array.isArray(records) || records.length === 0) {
      return false;
    }
    return records.every((record) => !isPrivateIpAddress(record.address));
  } catch {
    return false;
  }
}

async function fetchCalendarUrlSafely(initialUrl, options) {
  let currentUrl = String(initialUrl || '').trim();

  for (let redirectCount = 0; redirectCount < 5; redirectCount += 1) {
    const safe = await isSafeCalendarFetchTarget(currentUrl);
    if (!safe) {
      return { error: 'Calendar URL target is blocked for security reasons.' };
    }

    const response = await fetch(currentUrl, {
      ...options,
      redirect: 'manual'
    });

    if (response.status >= 300 && response.status < 400) {
      const locationHeader = response.headers.get('location');
      if (!locationHeader) {
        return response;
      }
      currentUrl = new URL(locationHeader, currentUrl).toString();
      continue;
    }

    return response;
  }

  return { error: 'Calendar request exceeded redirect limit.' };
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
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS stripe_account_id TEXT
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS stripe_onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS stripe_charges_enabled BOOLEAN NOT NULL DEFAULT FALSE
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS stripe_payouts_enabled BOOLEAN NOT NULL DEFAULT FALSE
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS first_name TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS family_name TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS telephone TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS country_of_residence TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_validated BOOLEAN NOT NULL DEFAULT TRUE
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS shared_resources (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      short_description TEXT NOT NULL,
      full_description_html TEXT NOT NULL DEFAULT '',
      max_units INTEGER NOT NULL DEFAULT 1,
      max_days_advance_booking INTEGER NOT NULL DEFAULT 365,
      property_id BIGINT REFERENCES properties(id) ON DELETE SET NULL,
      listing_id BIGINT REFERENCES listings(id) ON DELETE SET NULL,
      resource_type TEXT NOT NULL DEFAULT 'undefined',
      free_of_charge BOOLEAN NOT NULL DEFAULT FALSE,
      cash_on_site BOOLEAN NOT NULL DEFAULT FALSE,
      bank_transfer BOOLEAN NOT NULL DEFAULT FALSE,
      online_payment BOOLEAN NOT NULL DEFAULT FALSE,
      free_of_charge_message_html TEXT NOT NULL DEFAULT '',
      cash_on_site_message_html TEXT NOT NULL DEFAULT '',
      bank_transfer_message_html TEXT NOT NULL DEFAULT '',
      online_payment_message_html TEXT NOT NULL DEFAULT '',
      charge_basis TEXT,
      daily_charge_mode TEXT,
      daily_rate NUMERIC(10,2),
      hourly_charge_mode TEXT,
      hourly_rate NUMERIC(10,2),
      hourly_rates_json TEXT NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE shared_resources
    ADD COLUMN IF NOT EXISTS property_id BIGINT REFERENCES properties(id) ON DELETE SET NULL
  `);

  await pool.query(`
    ALTER TABLE shared_resources
    ADD COLUMN IF NOT EXISTS listing_id BIGINT REFERENCES listings(id) ON DELETE SET NULL
  `);

  await pool.query(`
    ALTER TABLE shared_resources
    ADD COLUMN IF NOT EXISTS max_days_advance_booking INTEGER NOT NULL DEFAULT 365
  `);

  await pool.query(`
    ALTER TABLE shared_resources
    ADD COLUMN IF NOT EXISTS resource_type TEXT NOT NULL DEFAULT 'undefined'
  `);

  await pool.query(`
    ALTER TABLE shared_resources
    ADD COLUMN IF NOT EXISTS free_of_charge BOOLEAN NOT NULL DEFAULT FALSE
  `);

  await pool.query(`
    ALTER TABLE shared_resources
    ADD COLUMN IF NOT EXISTS cash_on_site BOOLEAN NOT NULL DEFAULT FALSE
  `);

  await pool.query(`
    ALTER TABLE shared_resources
    ADD COLUMN IF NOT EXISTS bank_transfer BOOLEAN NOT NULL DEFAULT FALSE
  `);

  await pool.query(`
    ALTER TABLE shared_resources
    ADD COLUMN IF NOT EXISTS online_payment BOOLEAN NOT NULL DEFAULT FALSE
  `);

  await pool.query(`
    ALTER TABLE shared_resources
    ADD COLUMN IF NOT EXISTS free_of_charge_message_html TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE shared_resources
    ADD COLUMN IF NOT EXISTS cash_on_site_message_html TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE shared_resources
    ADD COLUMN IF NOT EXISTS bank_transfer_message_html TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE shared_resources
    ADD COLUMN IF NOT EXISTS online_payment_message_html TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE shared_resources
    ADD COLUMN IF NOT EXISTS charge_basis TEXT
  `);

  await pool.query(`
    ALTER TABLE shared_resources
    ADD COLUMN IF NOT EXISTS daily_charge_mode TEXT
  `);

  await pool.query(`
    ALTER TABLE shared_resources
    ADD COLUMN IF NOT EXISTS daily_rate NUMERIC(10,2)
  `);

  await pool.query(`
    ALTER TABLE shared_resources
    ADD COLUMN IF NOT EXISTS hourly_charge_mode TEXT
  `);

  await pool.query(`
    ALTER TABLE shared_resources
    ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(10,2)
  `);

  await pool.query(`
    ALTER TABLE shared_resources
    ADD COLUMN IF NOT EXISTS hourly_rates_json TEXT NOT NULL DEFAULT '[]'
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS shared_resource_reservations (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      shared_resource_id BIGINT NOT NULL REFERENCES shared_resources(id) ON DELETE CASCADE,
      reservation_identifier TEXT NOT NULL,
      listing_id BIGINT REFERENCES listings(id) ON DELETE SET NULL,
      reservation_checkin_date DATE NOT NULL,
      reservation_checkout_date DATE NOT NULL,
      requested_start_at TIMESTAMPTZ NOT NULL,
      requested_end_at TIMESTAMPTZ NOT NULL,
      spaces_required INTEGER NOT NULL DEFAULT 1,
      first_name TEXT NOT NULL DEFAULT '',
      family_name TEXT NOT NULL DEFAULT '',
      email_address TEXT NOT NULL DEFAULT '',
      telephone TEXT NOT NULL DEFAULT '',
      vehicle_registration TEXT NOT NULL DEFAULT '',
      reservation_amount NUMERIC(10,2),
      payment_provider TEXT NOT NULL DEFAULT '',
      payment_intent_id TEXT,
      payment_status TEXT NOT NULL DEFAULT '',
      payment_currency TEXT NOT NULL DEFAULT '',
      payment_amount_minor INTEGER,
      application_fee_minor INTEGER,
      payment_last_error TEXT,
      paid_at TIMESTAMPTZ,
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE shared_resource_reservations
    ADD COLUMN IF NOT EXISTS first_name TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE shared_resource_reservations
    ADD COLUMN IF NOT EXISTS family_name TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE shared_resource_reservations
    ADD COLUMN IF NOT EXISTS email_address TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE shared_resource_reservations
    ADD COLUMN IF NOT EXISTS telephone TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE shared_resource_reservations
    ADD COLUMN IF NOT EXISTS vehicle_registration TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE shared_resource_reservations
    ADD COLUMN IF NOT EXISTS reservation_amount NUMERIC(10,2)
  `);

  await pool.query(`
    ALTER TABLE shared_resource_reservations
    ADD COLUMN IF NOT EXISTS payment_provider TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE shared_resource_reservations
    ADD COLUMN IF NOT EXISTS payment_intent_id TEXT
  `);

  await pool.query(`
    ALTER TABLE shared_resource_reservations
    ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE shared_resource_reservations
    ADD COLUMN IF NOT EXISTS payment_currency TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE shared_resource_reservations
    ADD COLUMN IF NOT EXISTS payment_amount_minor INTEGER
  `);

  await pool.query(`
    ALTER TABLE shared_resource_reservations
    ADD COLUMN IF NOT EXISTS application_fee_minor INTEGER
  `);

  await pool.query(`
    ALTER TABLE shared_resource_reservations
    ADD COLUMN IF NOT EXISTS payment_last_error TEXT
  `);

  await pool.query(`
    ALTER TABLE shared_resource_reservations
    ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_resource_reservations_payment_intent_id
    ON shared_resource_reservations (payment_intent_id)
    WHERE payment_intent_id IS NOT NULL
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_accounts (
      id BIGSERIAL PRIMARY KEY,
      created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_memberships (
      id BIGSERIAL PRIMARY KEY,
      client_account_id BIGINT NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      invited_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (client_account_id, user_id, role)
    )
  `);

  await pool.query(`
    ALTER TABLE client_memberships
    DROP CONSTRAINT IF EXISTS client_memberships_role_check
  `);

  await pool.query(`
    ALTER TABLE client_memberships
    ADD CONSTRAINT client_memberships_role_check CHECK (role IN ('Client', 'Manager', 'Staff', 'Guest'))
  `);

  await pool.query(`
    ALTER TABLE client_memberships
    DROP CONSTRAINT IF EXISTS client_memberships_status_check
  `);

  await pool.query(`
    ALTER TABLE client_memberships
    ADD CONSTRAINT client_memberships_status_check CHECK (status IN ('active', 'inactive', 'invited', 'revoked'))
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_client_memberships_user
    ON client_memberships (user_id)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS manager_property_assignments (
      id BIGSERIAL PRIMARY KEY,
      manager_membership_id BIGINT NOT NULL REFERENCES client_memberships(id) ON DELETE CASCADE,
      property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (manager_membership_id, property_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS manager_listing_assignments (
      id BIGSERIAL PRIMARY KEY,
      manager_membership_id BIGINT NOT NULL REFERENCES client_memberships(id) ON DELETE CASCADE,
      listing_id BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (manager_membership_id, listing_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guest_relationships (
      id BIGSERIAL PRIMARY KEY,
      client_account_id BIGINT NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,
      guest_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      guest_email TEXT NOT NULL DEFAULT '',
      guest_phone TEXT NOT NULL DEFAULT '',
      guest_first_name TEXT NOT NULL DEFAULT '',
      guest_family_name TEXT NOT NULL DEFAULT '',
      source_type TEXT NOT NULL DEFAULT 'reservation',
      source_id TEXT,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_guest_relationship_unique_contact
    ON guest_relationships (client_account_id, guest_email, guest_phone)
  `);

  await pool.query(`
    ALTER TABLE guest_relationships
    ADD COLUMN IF NOT EXISTS guest_first_name TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE guest_relationships
    ADD COLUMN IF NOT EXISTS guest_family_name TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE properties
    ADD COLUMN IF NOT EXISTS client_account_id BIGINT REFERENCES client_accounts(id) ON DELETE SET NULL
  `);

  await pool.query(`
    ALTER TABLE listings
    ADD COLUMN IF NOT EXISTS client_account_id BIGINT REFERENCES client_accounts(id) ON DELETE SET NULL
  `);

  await pool.query(`
    ALTER TABLE listings
    ADD COLUMN IF NOT EXISTS empty_export BOOLEAN NOT NULL DEFAULT FALSE
  `);

  await pool.query(`
    ALTER TABLE shared_resources
    ADD COLUMN IF NOT EXISTS client_account_id BIGINT REFERENCES client_accounts(id) ON DELETE SET NULL
  `);

  await pool.query(`
    ALTER TABLE shared_resource_reservations
    ADD COLUMN IF NOT EXISTS client_account_id BIGINT REFERENCES client_accounts(id) ON DELETE SET NULL
  `);

  await pool.query(`
    ALTER TABLE booked_in_changes
    ADD COLUMN IF NOT EXISTS client_account_id BIGINT REFERENCES client_accounts(id) ON DELETE SET NULL
  `);

  await pool.query(`
    ALTER TABLE booked_in_changes
    ADD COLUMN IF NOT EXISTS cleaner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL
  `);

  await pool.query(`
    ALTER TABLE feed_source_colors
    ADD COLUMN IF NOT EXISTS client_account_id BIGINT REFERENCES client_accounts(id) ON DELETE SET NULL
  `);

  await pool.query(`
    ALTER TABLE cleaners
    ADD COLUMN IF NOT EXISTS client_account_id BIGINT REFERENCES client_accounts(id) ON DELETE SET NULL
  `);

  await pool.query(`
    ALTER TABLE cleaners
    ADD COLUMN IF NOT EXISTS cleaner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_cleaners_cleaner_user_id
    ON cleaners (cleaner_user_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_booked_in_changes_cleaner_user_id
    ON booked_in_changes (cleaner_user_id)
  `);

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

  await pool.query(`
    INSERT INTO client_accounts (created_by_user_id, display_name)
    SELECT u.id,
           COALESCE(NULLIF(TRIM(u.username), ''), ('User ' || u.id::text)) || ' Client Account'
    FROM users u
    WHERE NOT EXISTS (
      SELECT 1
      FROM client_memberships cm
      WHERE cm.user_id = u.id
        AND cm.role = 'Client'
        AND cm.status = 'active'
    )
  `);

  await pool.query(`
    INSERT INTO client_memberships (client_account_id, user_id, role, status, invited_by_user_id)
    SELECT ca.id, ca.created_by_user_id, 'Client', 'active', ca.created_by_user_id
    FROM client_accounts ca
    WHERE ca.created_by_user_id IS NOT NULL
    ON CONFLICT (client_account_id, user_id, role) DO NOTHING
  `);

  await pool.query(`
    UPDATE properties p
    SET client_account_id = lookup.client_account_id
    FROM (
      SELECT p2.id AS row_id, cm.client_account_id
      FROM properties p2
      JOIN LATERAL (
        SELECT client_account_id
        FROM client_memberships
        WHERE user_id = p2.user_id
          AND role = 'Client'
          AND status = 'active'
        ORDER BY id ASC
        LIMIT 1
      ) cm ON TRUE
      WHERE p2.client_account_id IS NULL
    ) lookup
    WHERE p.id = lookup.row_id
  `);

  await pool.query(`
    UPDATE listings l
    SET client_account_id = lookup.client_account_id
    FROM (
      SELECT l2.id AS row_id, cm.client_account_id
      FROM listings l2
      JOIN LATERAL (
        SELECT client_account_id
        FROM client_memberships
        WHERE user_id = l2.user_id
          AND role = 'Client'
          AND status = 'active'
        ORDER BY id ASC
        LIMIT 1
      ) cm ON TRUE
      WHERE l2.client_account_id IS NULL
    ) lookup
    WHERE l.id = lookup.row_id
  `);

  await pool.query(`
    UPDATE shared_resources r
    SET client_account_id = lookup.client_account_id
    FROM (
      SELECT r2.id AS row_id, cm.client_account_id
      FROM shared_resources r2
      JOIN LATERAL (
        SELECT client_account_id
        FROM client_memberships
        WHERE user_id = r2.user_id
          AND role = 'Client'
          AND status = 'active'
        ORDER BY id ASC
        LIMIT 1
      ) cm ON TRUE
      WHERE r2.client_account_id IS NULL
    ) lookup
    WHERE r.id = lookup.row_id
  `);

  await pool.query(`
    UPDATE shared_resource_reservations rr
    SET client_account_id = lookup.client_account_id
    FROM (
      SELECT rr2.id AS row_id, cm.client_account_id
      FROM shared_resource_reservations rr2
      JOIN LATERAL (
        SELECT client_account_id
        FROM client_memberships
        WHERE user_id = rr2.user_id
          AND role = 'Client'
          AND status = 'active'
        ORDER BY id ASC
        LIMIT 1
      ) cm ON TRUE
      WHERE rr2.client_account_id IS NULL
    ) lookup
    WHERE rr.id = lookup.row_id
  `);

  await pool.query(`
    UPDATE booked_in_changes bic
    SET client_account_id = lookup.client_account_id
    FROM (
      SELECT bic2.id AS row_id, cm.client_account_id
      FROM booked_in_changes bic2
      JOIN LATERAL (
        SELECT client_account_id
        FROM client_memberships
        WHERE user_id = bic2.user_id
          AND role = 'Client'
          AND status = 'active'
        ORDER BY id ASC
        LIMIT 1
      ) cm ON TRUE
      WHERE bic2.client_account_id IS NULL
    ) lookup
    WHERE bic.id = lookup.row_id
  `);

  await pool.query(`
    UPDATE feed_source_colors fsc
    SET client_account_id = lookup.client_account_id
    FROM (
      SELECT fsc2.id AS row_id, cm.client_account_id
      FROM feed_source_colors fsc2
      JOIN LATERAL (
        SELECT client_account_id
        FROM client_memberships
        WHERE user_id = fsc2.user_id
          AND role = 'Client'
          AND status = 'active'
        ORDER BY id ASC
        LIMIT 1
      ) cm ON TRUE
      WHERE fsc2.client_account_id IS NULL
    ) lookup
    WHERE fsc.id = lookup.row_id
  `);

  await pool.query(`
    UPDATE cleaners c
    SET client_account_id = lookup.client_account_id
    FROM (
      SELECT c2.id AS row_id, cm.client_account_id
      FROM cleaners c2
      JOIN LATERAL (
        SELECT client_account_id
        FROM client_memberships
        WHERE user_id = c2.user_id
          AND role = 'Client'
          AND status = 'active'
        ORDER BY id ASC
        LIMIT 1
      ) cm ON TRUE
      WHERE c2.client_account_id IS NULL
    ) lookup
    WHERE c.id = lookup.row_id
  `);

  await pool.query(`
    UPDATE cleaners c
    SET cleaner_user_id = u.id
    FROM users u
    WHERE c.cleaner_user_id IS NULL
      AND NULLIF(TRIM(c.email), '') IS NOT NULL
      AND LOWER(u.email) = LOWER(c.email)
  `);

  const usersMissingNames = await pool.query(
    `
      SELECT id, username
      FROM users
      WHERE NULLIF(TRIM(COALESCE(first_name, '')), '') IS NULL
        AND NULLIF(TRIM(COALESCE(family_name, '')), '') IS NULL
      ORDER BY id ASC
    `
  );
  for (const userRow of usersMissingNames.rows) {
    const derived = deriveNamesFromUsername(userRow.username);
    if (!derived.firstName && !derived.familyName) {
      continue;
    }
    await pool.query(
      `
        UPDATE users
        SET first_name = $1,
            family_name = $2
        WHERE id = $3
      `,
      [derived.firstName, derived.familyName, userRow.id]
    );
  }

  const defaultCleanerPasswordHash = await bcrypt.hash('letmein1', SALT_ROUNDS);
  const cleanersResult = await pool.query(
    `
      SELECT c.id,
             c.user_id,
             c.client_account_id,
             c.cleaner_user_id,
             c.first_name,
             c.last_name,
             c.telephone,
             LOWER(TRIM(c.email)) AS email
      FROM cleaners c
      WHERE NULLIF(TRIM(c.email), '') IS NOT NULL
      ORDER BY c.id ASC
    `
  );

  for (const cleaner of cleanersResult.rows) {
    let linkedUserId = Number(cleaner.cleaner_user_id) || null;
    let linkedUser = linkedUserId ? await getUserById(linkedUserId) : null;

    if (!linkedUser) {
      linkedUser = await findUserByEmail(cleaner.email);
      if (!linkedUser) {
        const emailLocalPart = String(cleaner.email || '').split('@')[0].replace(/[^a-z0-9._-]/gi, '').toLowerCase();
        const username = ('staff-' + (emailLocalPart || 'user') + '-' + String(cleaner.id)).slice(0, 60);
        linkedUser = await createUser(username, cleaner.email, defaultCleanerPasswordHash);
      }

      linkedUserId = Number(linkedUser.id) || null;
      if (linkedUserId) {
        await pool.query(
          `
            UPDATE cleaners
            SET cleaner_user_id = $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
          `,
          [linkedUserId, cleaner.id]
        );
      }
    }

    if (linkedUserId) {
      await pool.query(
        `
          UPDATE users
          SET first_name = CASE
                WHEN NULLIF(TRIM(COALESCE(first_name, '')), '') IS NULL THEN $1
                ELSE first_name
              END,
              family_name = CASE
                WHEN NULLIF(TRIM(COALESCE(family_name, '')), '') IS NULL THEN $2
                ELSE family_name
              END,
              telephone = CASE
                WHEN NULLIF(TRIM(COALESCE(telephone, '')), '') IS NULL THEN $3
                ELSE telephone
              END
          WHERE id = $4
        `,
        [String(cleaner.first_name || '').trim(), String(cleaner.last_name || '').trim(), String(cleaner.telephone || '').trim(), linkedUserId]
      );

      // Requested default staff password for currently configured cleaner-linked users.
      await pool.query(
        'UPDATE users SET password_hash = $1 WHERE id = $2',
        [defaultCleanerPasswordHash, linkedUserId]
      );

      if (cleaner.client_account_id) {
        await pool.query(
          `
            INSERT INTO client_memberships (client_account_id, user_id, role, status, invited_by_user_id)
            VALUES ($1, $2, 'Staff', 'active', $3)
            ON CONFLICT (client_account_id, user_id, role) DO NOTHING
          `,
          [cleaner.client_account_id, linkedUserId, cleaner.user_id]
        );
      }
    }
  }

  await pool.query(`
    UPDATE booked_in_changes bic
    SET cleaner_user_id = c.cleaner_user_id,
        updated_at = CURRENT_TIMESTAMP
    FROM cleaners c
    WHERE bic.cleaner_user_id IS NULL
      AND bic.cleaner_id = c.id
      AND c.cleaner_user_id IS NOT NULL
  `);

  await pool.query(`
    INSERT INTO client_memberships (client_account_id, user_id, role, status, invited_by_user_id)
    SELECT DISTINCT p.client_account_id, u.id, 'Manager', 'active', p.user_id
    FROM properties p
    JOIN users u
      ON LOWER(u.email) = LOWER(p.manager_email)
    WHERE p.client_account_id IS NOT NULL
      AND NULLIF(TRIM(p.manager_email), '') IS NOT NULL
    ON CONFLICT (client_account_id, user_id, role) DO NOTHING
  `);

  await pool.query(`
    INSERT INTO client_memberships (client_account_id, user_id, role, status, invited_by_user_id)
    SELECT DISTINCT c.client_account_id, c.cleaner_user_id, 'Staff', 'active', c.user_id
    FROM cleaners c
    WHERE c.client_account_id IS NOT NULL
      AND c.cleaner_user_id IS NOT NULL
    ON CONFLICT (client_account_id, user_id, role) DO NOTHING
  `);

  await pool.query(`
    INSERT INTO guest_relationships (
      client_account_id,
      guest_email,
      guest_phone,
      guest_first_name,
      guest_family_name,
      source_type,
      source_id,
      first_seen_at,
      last_seen_at
    )
    SELECT
      rr.client_account_id,
      LOWER(TRIM(rr.email_address)) AS guest_email,
      TRIM(COALESCE(rr.telephone, '')) AS guest_phone,
      COALESCE(MAX(NULLIF(TRIM(COALESCE(rr.first_name, '')), '')), '') AS guest_first_name,
      COALESCE(MAX(NULLIF(TRIM(COALESCE(rr.family_name, '')), '')), '') AS guest_family_name,
      'reservation',
      COALESCE(rr.reservation_identifier, rr.id::text),
      MIN(rr.created_at),
      MAX(COALESCE(rr.updated_at, rr.created_at))
    FROM shared_resource_reservations rr
    WHERE rr.client_account_id IS NOT NULL
      AND NULLIF(TRIM(rr.email_address), '') IS NOT NULL
    GROUP BY rr.client_account_id, LOWER(TRIM(rr.email_address)), TRIM(COALESCE(rr.telephone, '')), COALESCE(rr.reservation_identifier, rr.id::text)
    ON CONFLICT (client_account_id, guest_email, guest_phone)
    DO UPDATE
    SET guest_first_name = COALESCE(NULLIF(EXCLUDED.guest_first_name, ''), guest_relationships.guest_first_name),
      guest_family_name = COALESCE(NULLIF(EXCLUDED.guest_family_name, ''), guest_relationships.guest_family_name),
      last_seen_at = GREATEST(guest_relationships.last_seen_at, EXCLUDED.last_seen_at),
        updated_at = CURRENT_TIMESTAMP
  `);

  await runOneTimeSiteDataResetIfNeeded();
}

async function findUserByEmail(email) {
  

  const result = await pool.query('SELECT * FROM users WHERE email = $1 LIMIT 1', [email]);
  return result.rows[0];
}

async function findUserByUsername(username) {
  

  const result = await pool.query('SELECT * FROM users WHERE username = $1 LIMIT 1', [username]);
  return result.rows[0];
}

async function createUser(username, email, passwordHash, profile = {}) {
  const firstName = String(profile.firstName || '').trim();
  const familyName = String(profile.familyName || '').trim();
  const countryOfResidence = normaliseCountryOfResidence(profile.country) || '';
  const isValidated = profile.isValidated === true;

  

  const result = await pool.query(
    `
      INSERT INTO users (username, email, password_hash, first_name, family_name, country_of_residence, is_validated)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, username, email, password_hash,
                first_name, family_name, country_of_residence, is_validated,
                stripe_account_id, stripe_onboarding_complete,
                stripe_charges_enabled, stripe_payouts_enabled,
                created_at
    `,
    [username, email, passwordHash, firstName, familyName, countryOfResidence, isValidated]
  );

  await ensureDefaultPropertyForUser(result.rows[0].id);
  await ensureClientAccountForUser(result.rows[0].id, result.rows[0].username);
  return result.rows[0];
}

function normaliseCountryOfResidence(value) {
  const country = String(value || '').trim();
  if (!country) {
    return null;
  }
  return country.slice(0, 120);
}

function validateStrongPassword(password) {
  const value = String(password || '');
  if (value.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters.' };
  }
  if (!/[A-Z]/.test(value)) {
    return { ok: false, error: 'Password must include at least one uppercase character.' };
  }
  if (!/[0-9]/.test(value)) {
    return { ok: false, error: 'Password must include at least one number.' };
  }
  if (!/[^A-Za-z0-9]/.test(value)) {
    return { ok: false, error: 'Password must include at least one special character.' };
  }
  return { ok: true };
}

async function generateUniqueUsernameFromEmail(email) {
  const localPart = String(email || '').split('@')[0].replace(/[^a-z0-9._-]/gi, '').toLowerCase();
  const base = (localPart || 'user').slice(0, 40);
  let username = base;
  let attempt = 0;
  while (await findUserByUsername(username)) {
    attempt += 1;
    username = (base + '-' + String(randomUUID()).slice(0, 8)).slice(0, 60);
    if (attempt > 10) {
      throw new Error('Could not generate unique username.');
    }
  }
  return username;
}

function normaliseOptionalEmail(value) {
  const email = String(value || '').trim();
  if (!email) {
    return null;
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) ? email.toLowerCase() : null;
}

function normaliseSharedResourceShortDescription(value) {
  return String(value || '').trim().slice(0, 160);
}

function normaliseSharedResourceMaxUnits(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function normaliseSharedResourceMaxAdvanceBookingDays(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
    return null;
  }
  return parsed;
}

function normaliseOptionalPositiveInteger(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function normaliseSharedResourceType(value) {
  const type = String(value || '').trim().toLowerCase();
  if (type === 'parking') {
    return 'parking';
  }
  return 'undefined';
}

const SHARED_RESOURCE_RESERVATION_STATUSES = new Set([
  'cash',
  'Cash Received',
  'Awaiting Bank Transfer',
  'Bank Transfer Confirmed',
  'Awaiting Online Confirmation',
  'Online Confirmation Received',
  'Confirmed'
]);

function normaliseSharedResourceReservationStatus(value) {
  const status = String(value || '').trim();
  return SHARED_RESOURCE_RESERVATION_STATUSES.has(status) ? status : null;
}

function normaliseSharedResourceReservationText(value, maxLen) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }
  return text.slice(0, maxLen || 200);
}

function normaliseSharedResourceReservationEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return null;
  }
  return email.slice(0, 254);
}

function normaliseSharedResourceReservationAmount(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Number(parsed.toFixed(2));
}

function normaliseSharedResourceReservationPaymentStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (!status) {
    return '';
  }
  const allowed = new Set(['pending', 'processing', 'succeeded', 'failed', 'canceled', 'requires_action']);
  return allowed.has(status) ? status : '';
}

function toMinorUnits(amount) {
  const numeric = normaliseSharedResourceReservationAmount(amount);
  if (numeric === null) {
    return null;
  }
  return Math.round(numeric * 100);
}

function getDefaultSharedResourceReservationStatus(resource) {
  if (resource && resource.cash_on_site === true) {
    return 'cash';
  }
  if (resource && resource.bank_transfer === true) {
    return 'Awaiting Bank Transfer';
  }
  if (resource && resource.online_payment === true) {
    return 'Awaiting Online Confirmation';
  }
  return 'Confirmed';
}

function getDateKeyFromEventDateTime(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function parseLocalDateTime(dateValue, timeValue) {
  const dateKey = normaliseDateKey(dateValue);
  const timeKey = String(timeValue || '').trim();
  if (!dateKey || !/^\d{2}:\d{2}$/.test(timeKey)) {
    return null;
  }
  const parsed = new Date(dateKey + 'T' + timeKey + ':00');
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function formatDateTimeForMessage(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value || '');
  }
  return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function normaliseSharedResourcePaymentOptions(input) {
  const freeOfCharge = input && (input.freeOfCharge === true || input.free_of_charge === true);
  if (freeOfCharge) {
    return {
      free_of_charge: true,
      cash_on_site: false,
      bank_transfer: false,
      online_payment: false
    };
  }

  return {
    free_of_charge: false,
    cash_on_site: input && (input.cashOnSite === true || input.cash_on_site === true),
    bank_transfer: input && (input.bankTransfer === true || input.bank_transfer === true),
    online_payment: input && (input.onlinePayment === true || input.online_payment === true)
  };
}

function normaliseSharedResourcePaymentMessages(input) {
  return {
    free_of_charge_message_html: sanitiseRichTextHtml(input && (input.freeOfChargeMessageHtml !== undefined
      ? input.freeOfChargeMessageHtml
      : input.free_of_charge_message_html)),
    cash_on_site_message_html: sanitiseRichTextHtml(input && (input.cashOnSiteMessageHtml !== undefined
      ? input.cashOnSiteMessageHtml
      : input.cash_on_site_message_html)),
    bank_transfer_message_html: sanitiseRichTextHtml(input && (input.bankTransferMessageHtml !== undefined
      ? input.bankTransferMessageHtml
      : input.bank_transfer_message_html)),
    online_payment_message_html: sanitiseRichTextHtml(input && (input.onlinePaymentMessageHtml !== undefined
      ? input.onlinePaymentMessageHtml
      : input.online_payment_message_html))
  };
}

function normaliseMoneyAmount(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }
  return Math.round(numeric * 100) / 100;
}

function normaliseHourlyRatesArray(value) {
  const source = Array.isArray(value)
    ? value
    : (() => {
        if (typeof value !== 'string' || !value.trim()) {
          return [];
        }
        try {
          const parsed = JSON.parse(value);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })();

  return source.slice(0, 24).map((item) => normaliseMoneyAmount(item));
}

function normaliseSharedResourceChargeConfig(input) {
  const chargeBasis = input && input.chargeBasis === 'hourly'
    ? 'hourly'
    : (input && (input.chargeBasis === 'daily' || input.charge_basis === 'daily') ? 'daily' : (input && input.charge_basis === 'hourly' ? 'hourly' : null));
  const dailyChargeMode = input && (input.dailyChargeMode === 'per_calendar_day' || input.daily_charge_mode === 'per_calendar_day')
    ? 'per_calendar_day'
    : ((input && (input.dailyChargeMode === 'per_24_hours' || input.daily_charge_mode === 'per_24_hours')) ? 'per_24_hours' : null);
  const hourlyChargeMode = input && (input.hourlyChargeMode === 'per_hour_of_day' || input.hourly_charge_mode === 'per_hour_of_day')
    ? 'per_hour_of_day'
    : ((input && (input.hourlyChargeMode === 'single_rate' || input.hourly_charge_mode === 'single_rate')) ? 'single_rate' : null);

  return {
    charge_basis: chargeBasis,
    daily_charge_mode: dailyChargeMode,
    daily_rate: normaliseMoneyAmount(input && (input.dailyRate !== undefined ? input.dailyRate : input.daily_rate)),
    hourly_charge_mode: hourlyChargeMode,
    hourly_rate: normaliseMoneyAmount(input && (input.hourlyRate !== undefined ? input.hourlyRate : input.hourly_rate)),
    hourly_rates: normaliseHourlyRatesArray(input && (input.hourlyRates !== undefined ? input.hourlyRates : input.hourly_rates_json))
  };
}

function validateSharedResourceChargeConfig(paymentOptions, chargeConfig) {
  if (paymentOptions.free_of_charge) {
    return {
      charge_basis: null,
      daily_charge_mode: null,
      daily_rate: null,
      hourly_charge_mode: null,
      hourly_rate: null,
      hourly_rates: []
    };
  }

  if (!chargeConfig.charge_basis) {
    return { error: 'Charge basis is required when the resource is not free of charge.' };
  }

  if (chargeConfig.charge_basis === 'daily') {
    if (!chargeConfig.daily_charge_mode) {
      return { error: 'Select either Per 24 hours or Per Calendar Day.' };
    }
    if (chargeConfig.daily_rate === null) {
      return { error: 'Enter a valid daily rate.' };
    }
    return {
      charge_basis: 'daily',
      daily_charge_mode: chargeConfig.daily_charge_mode,
      daily_rate: chargeConfig.daily_rate,
      hourly_charge_mode: null,
      hourly_rate: null,
      hourly_rates: []
    };
  }

  if (!chargeConfig.hourly_charge_mode) {
    return { error: 'Select either a simple hourly rate or separate hourly rates.' };
  }

  if (chargeConfig.hourly_charge_mode === 'single_rate') {
    if (chargeConfig.hourly_rate === null) {
      return { error: 'Enter a valid hourly rate.' };
    }
    return {
      charge_basis: 'hourly',
      daily_charge_mode: null,
      daily_rate: null,
      hourly_charge_mode: 'single_rate',
      hourly_rate: chargeConfig.hourly_rate,
      hourly_rates: []
    };
  }

  if (chargeConfig.hourly_rates.length !== 24 || chargeConfig.hourly_rates.some((rate) => rate === null)) {
    return { error: 'Enter a valid rate for each of the 24 hours in the day.' };
  }

  return {
    charge_basis: 'hourly',
    daily_charge_mode: null,
    daily_rate: null,
    hourly_charge_mode: 'per_hour_of_day',
    hourly_rate: null,
    hourly_rates: chargeConfig.hourly_rates
  };
}

function sanitiseRichTextHtml(value) {
  return sanitizeHtml(String(value || ''), {
    allowedTags: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li',
      'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'span'
    ],
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {},
    allowProtocolRelative: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', {
        target: '_blank',
        rel: 'noopener noreferrer'
      })
    }
  }).trim();
}

let scheduleEmailTransporter = null;
let scheduleEmailTransporterKey = null;

function getScheduleEmailTransportConfig() {
  const host = String(process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || '').trim().toLowerCase() === 'true';
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').trim();
  const from = String(process.env.SMTP_FROM || user).trim();

  if (!host || !Number.isInteger(port) || port <= 0 || !user || !pass || !from) {
    return null;
  }

  return { host, port, secure, user, pass, from };
}

function getScheduleEmailTransporter() {
  const config = getScheduleEmailTransportConfig();
  if (!config) {
    return { error: 'Schedule email is not configured on the server.' };
  }

  const nextKey = [config.host, config.port, config.secure, config.user, config.pass, config.from].join('|');
  if (!scheduleEmailTransporter || scheduleEmailTransporterKey !== nextKey) {
    scheduleEmailTransporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass
      }
    });
    scheduleEmailTransporterKey = nextKey;
  }

  return {
    transporter: scheduleEmailTransporter,
    from: config.from
  };
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

function isValidEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function getPostmarkErrorMessage(errorPayload, statusCode) {
  const payload = errorPayload && typeof errorPayload === 'object' ? errorPayload : null;
  const message = String((payload && payload.Message) || 'Postmark request failed.').trim();
  const code = payload && payload.ErrorCode !== undefined && payload.ErrorCode !== null
    ? String(payload.ErrorCode)
    : '';
  let text = message;
  if (statusCode) {
    text += ' (HTTP ' + String(statusCode) + ')';
  }
  if (code) {
    text += ' [Postmark code ' + code + ']';
  }
  return text;
}

function getPreferredAppBaseUrl(req) {
  if (APP_BASE_URL) {
    return APP_BASE_URL;
  }
  const requestBase = getRequestBaseUrl(req);
  if (requestBase) {
    return requestBase;
  }
  return null;
}

function buildAccountValidationSignature(userId, email, issuedAtMs) {
  const payload = [
    'account-validation',
    ACCOUNT_VALIDATION_TOKEN_VERSION,
    String(userId),
    String(email || '').trim().toLowerCase(),
    String(issuedAtMs)
  ].join(':');
  return createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
}

function buildPasswordResetSignature(userId, email, passwordHash, issuedAtMs) {
  const payload = [
    'password-reset',
    PASSWORD_RESET_TOKEN_VERSION,
    String(userId),
    String(email || '').trim().toLowerCase(),
    String(passwordHash || ''),
    String(issuedAtMs)
  ].join(':');
  return createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
}

function buildPasswordResetToken(user, issuedAtMs) {
  const userId = Number(user && user.id);
  const email = String(user && user.email || '').trim().toLowerCase();
  const passwordHash = String(user && user.password_hash || '');
  const issued = Number(issuedAtMs || Date.now());
  if (!Number.isInteger(userId) || userId <= 0 || !email || !passwordHash || !Number.isFinite(issued) || issued <= 0) {
    return null;
  }
  const signature = buildPasswordResetSignature(userId, email, passwordHash, issued);
  return [PASSWORD_RESET_TOKEN_VERSION, String(userId), String(issued), signature].join('.');
}

function parsePasswordResetToken(token) {
  const raw = String(token || '').trim();
  if (!raw) {
    return null;
  }

  const parts = raw.split('.');
  if (parts.length !== 4) {
    return null;
  }

  const version = String(parts[0] || '').trim();
  const userId = Number(parts[1]);
  const issuedAtMs = Number(parts[2]);
  const signature = String(parts[3] || '').trim();
  if (version !== PASSWORD_RESET_TOKEN_VERSION) {
    return null;
  }
  if (!Number.isInteger(userId) || userId <= 0) {
    return null;
  }
  if (!Number.isFinite(issuedAtMs) || issuedAtMs <= 0) {
    return null;
  }
  if (!/^[0-9a-fA-F]{64}$/.test(signature)) {
    return null;
  }

  return { userId, issuedAtMs, signature, raw };
}

async function validatePasswordResetToken(token) {
  const parsed = parsePasswordResetToken(token);
  if (!parsed) {
    return { error: 'Password reset link is invalid.' };
  }

  const now = Date.now();
  if ((now - parsed.issuedAtMs) > PASSWORD_RESET_TOKEN_TTL_MS) {
    return { error: 'Password reset link has expired. Please request a new one.' };
  }

  const user = await getUserById(parsed.userId);
  if (!user || !user.email || !user.password_hash) {
    return { error: 'Password reset link is invalid.' };
  }

  const expectedToken = buildPasswordResetToken(user, parsed.issuedAtMs);
  if (!expectedToken) {
    return { error: 'Password reset link is invalid.' };
  }

  const expectedBuffer = Buffer.from(expectedToken);
  const providedBuffer = Buffer.from(parsed.raw);
  if (expectedBuffer.length !== providedBuffer.length || !timingSafeEqual(expectedBuffer, providedBuffer)) {
    return { error: 'Password reset link is invalid.' };
  }

  return { user };
}

function buildAccountValidationToken(user, issuedAtMs) {
  const userId = Number(user && user.id);
  const email = String(user && user.email || '').trim().toLowerCase();
  const issued = Number(issuedAtMs || Date.now());
  if (!Number.isInteger(userId) || userId <= 0 || !email || !Number.isFinite(issued) || issued <= 0) {
    return null;
  }
  const signature = buildAccountValidationSignature(userId, email, issued);
  return [ACCOUNT_VALIDATION_TOKEN_VERSION, String(userId), String(issued), signature].join('.');
}

function parseAccountValidationToken(token) {
  const raw = String(token || '').trim();
  if (!raw) {
    return null;
  }

  const parts = raw.split('.');
  if (parts.length !== 4) {
    return null;
  }

  const version = String(parts[0] || '').trim();
  const userId = Number(parts[1]);
  const issuedAtMs = Number(parts[2]);
  const signature = String(parts[3] || '').trim();
  if (version !== ACCOUNT_VALIDATION_TOKEN_VERSION) {
    return null;
  }
  if (!Number.isInteger(userId) || userId <= 0) {
    return null;
  }
  if (!Number.isFinite(issuedAtMs) || issuedAtMs <= 0) {
    return null;
  }
  if (!/^[0-9a-fA-F]{64}$/.test(signature)) {
    return null;
  }

  return { userId, issuedAtMs, signature, raw };
}

async function validateAccountValidationToken(token) {
  const parsed = parseAccountValidationToken(token);
  if (!parsed) {
    return { error: 'Validation link is invalid.' };
  }

  const now = Date.now();
  if ((now - parsed.issuedAtMs) > ACCOUNT_VALIDATION_TOKEN_TTL_MS) {
    return { error: 'Validation link has expired. Request a new validation email.' };
  }

  const user = await getUserById(parsed.userId);
  if (!user || !user.email) {
    return { error: 'Validation link is invalid.' };
  }

  const expectedToken = buildAccountValidationToken(user, parsed.issuedAtMs);
  if (!expectedToken) {
    return { error: 'Validation link is invalid.' };
  }

  const expectedBuffer = Buffer.from(expectedToken);
  const providedBuffer = Buffer.from(parsed.raw);
  if (expectedBuffer.length !== providedBuffer.length || !timingSafeEqual(expectedBuffer, providedBuffer)) {
    return { error: 'Validation link is invalid.' };
  }

  return { user };
}

async function markUserValidated(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  

  await pool.query(
    `
      UPDATE users
      SET is_validated = TRUE
      WHERE id = $1
    `,
    [id]
  );

  await pool.query(
    `
      UPDATE client_memberships
      SET status = 'active',
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
        AND status = 'invited'
        AND role IN ('Manager', 'Staff')
    `,
    [id]
  );

  return getUserById(id);
}

async function sendAppEmail(input) {
  const to = normaliseOptionalEmail(input && input.to);
  const subject = String(input && input.subject || '').trim();
  const textBody = String(input && input.textBody || '').trim();
  if (!to || !subject || !textBody) {
    return { ok: false, error: 'Email payload is incomplete.' };
  }

  if (POSTMARK_SERVER_TOKEN && POSTMARK_FROM) {
    try {
      const postmarkRes = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Postmark-Server-Token': POSTMARK_SERVER_TOKEN
        },
        body: JSON.stringify({
          From: POSTMARK_FROM,
          To: to,
          Subject: subject,
          TextBody: textBody,
          MessageStream: POSTMARK_MESSAGE_STREAM
        })
      });

      const result = await postmarkRes.json().catch(() => ({}));
      if (!postmarkRes.ok) {
        return { ok: false, error: getPostmarkErrorMessage(result, postmarkRes.status) };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: 'Failed to send email via Postmark.' };
    }
  }

  const transportResult = getScheduleEmailTransporter();
  if (transportResult.error) {
    return { ok: false, error: 'Email delivery is not configured on the server.' };
  }

  try {
    await transportResult.transporter.sendMail({
      from: transportResult.from,
      to,
      subject,
      text: textBody
    });
    return { ok: true };
  } catch {
    return { ok: false, error: 'Failed to send email.' };
  }
}

async function sendSiteUserValidationEmail(req, user) {
  if (!user || !user.email) {
    return { ok: false, error: 'Cannot send validation email without a user email.' };
  }

  const baseUrl = getPreferredAppBaseUrl(req);
  if (!baseUrl) {
    return { ok: false, error: 'Cannot build validation URL because APP_BASE_URL is not configured.' };
  }

  const token = buildAccountValidationToken(user);
  if (!token) {
    return { ok: false, error: 'Could not generate validation token.' };
  }

  const validationUrl = baseUrl + '/validate-account.html?token=' + encodeURIComponent(token);
  const subject = 'Validate your site user account';
  const textBody = [
    'Welcome to Automatic People.',
    '',
    'Please validate your account by clicking this link:',
    validationUrl,
    '',
    'After validation, return to the login page and sign in.',
    '',
    'If you did not expect this email, you can ignore it.'
  ].join('\n');

  return sendAppEmail({
    to: user.email,
    subject,
    textBody
  });
}

async function sendPasswordResetEmail(req, user) {
  if (!user || !user.email) {
    return { ok: false, error: 'Cannot send password reset email without a user email.' };
  }

  const baseUrl = getPreferredAppBaseUrl(req);
  if (!baseUrl) {
    return { ok: false, error: 'Cannot build password reset URL because APP_BASE_URL is not configured.' };
  }

  const token = buildPasswordResetToken(user);
  if (!token) {
    return { ok: false, error: 'Could not generate password reset token.' };
  }

  const resetUrl = baseUrl + '/reset-password.html?token=' + encodeURIComponent(token);
  const subject = 'Reset your AutomaticPeople password';
  const textBody = [
    'A request was made to reset your AutomaticPeople password.',
    '',
    'Reset your password using this link:',
    resetUrl,
    '',
    'This link expires in 1 hour.',
    '',
    'If you did not request this reset, you can ignore this email.'
  ].join('\n');

  return sendAppEmail({
    to: user.email,
    subject,
    textBody
  });
}

async function getCleanersForUser(userId) {
  

  const result = await pool.query(
    `
      SELECT id, user_id, cleaner_user_id, first_name, last_name, email, telephone, created_at, updated_at
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

  

  try {
    const ownerContext = await getOrCreateAccessContextForUser(userId, null);
    const ownerClientAccountId = ownerContext && ownerContext.active
      ? Number(ownerContext.active.client_account_id)
      : null;

    let linkedUser = await findUserByEmail(email);
    if (!linkedUser) {
      const emailLocalPart = String(email || '').split('@')[0].replace(/[^a-z0-9._-]/gi, '').toLowerCase();
      const username = ('staff-' + (emailLocalPart || 'user') + '-' + String(Date.now())).slice(0, 60);
      linkedUser = await createUser(username, email, passwordHash);
    } else {
      await pool.query(
        `
          UPDATE users
          SET password_hash = $1
          WHERE id = $2
        `,
        [passwordHash, linkedUser.id]
      );
    }

    if (ownerClientAccountId) {
      await pool.query(
        `
          INSERT INTO client_memberships (client_account_id, user_id, role, status, invited_by_user_id)
          VALUES ($1, $2, 'Staff', 'active', $3)
          ON CONFLICT (client_account_id, user_id, role)
          DO UPDATE
          SET status = 'active', updated_at = CURRENT_TIMESTAMP, invited_by_user_id = EXCLUDED.invited_by_user_id
        `,
        [ownerClientAccountId, linkedUser.id, userId]
      );
    }

    const result = await pool.query(
      `
        INSERT INTO cleaners (user_id, client_account_id, cleaner_user_id, first_name, last_name, email, telephone, password_hash)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, user_id, cleaner_user_id, first_name, last_name, email, telephone, created_at, updated_at
      `,
      [userId, ownerClientAccountId, linkedUser.id, firstName, lastName, email, telephone, passwordHash]
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

  

  const existing = await pool.query(
    `
      SELECT id, client_account_id, cleaner_user_id
      FROM cleaners
      WHERE id = $1 AND user_id = $2
      LIMIT 1
    `,
    [cleanerId, userId]
  );
  if (!existing.rows[0]) {
    return { error: 'Cleaner not found.' };
  }

  const passwordHash = password ? await bcrypt.hash(password, SALT_ROUNDS) : null;

  try {
    let linkedUser = null;
    if (existing.rows[0].cleaner_user_id) {
      linkedUser = await getUserById(existing.rows[0].cleaner_user_id);
    }
    if (!linkedUser) {
      linkedUser = await findUserByEmail(email);
    }
    if (!linkedUser) {
      const emailLocalPart = String(email || '').split('@')[0].replace(/[^a-z0-9._-]/gi, '').toLowerCase();
      const username = ('staff-' + (emailLocalPart || 'user') + '-' + String(cleanerId)).slice(0, 60);
      linkedUser = await createUser(username, email, passwordHash || await bcrypt.hash('letmein1', SALT_ROUNDS));
    }

    if (passwordHash) {
      await pool.query(
        'UPDATE users SET password_hash = $1 WHERE id = $2',
        [passwordHash, linkedUser.id]
      );
    }

    if (existing.rows[0].client_account_id) {
      await pool.query(
        `
          INSERT INTO client_memberships (client_account_id, user_id, role, status, invited_by_user_id)
          VALUES ($1, $2, 'Staff', 'active', $3)
          ON CONFLICT (client_account_id, user_id, role)
          DO UPDATE
          SET status = 'active', updated_at = CURRENT_TIMESTAMP, invited_by_user_id = EXCLUDED.invited_by_user_id
        `,
        [existing.rows[0].client_account_id, linkedUser.id, userId]
      );
    }

    const result = await pool.query(
      `
        UPDATE cleaners
        SET first_name = $1,
            last_name = $2,
            email = $3,
            telephone = $4,
            password_hash = COALESCE($5, password_hash),
            cleaner_user_id = $6,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $7 AND user_id = $8
        RETURNING id, user_id, cleaner_user_id, first_name, last_name, email, telephone, created_at, updated_at
      `,
      [firstName, lastName, email, telephone, passwordHash, linkedUser.id, cleanerId, userId]
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

async function getUserById(userId) {
  if (!Number.isInteger(Number(userId)) || Number(userId) <= 0) {
    return null;
  }

  

  const result = await pool.query(
    `
        SELECT id, username, email, password_hash,
          first_name, family_name, country_of_residence, telephone, is_validated,
             stripe_account_id, stripe_onboarding_complete,
             stripe_charges_enabled, stripe_payouts_enabled,
             created_at
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );
  return result.rows[0] || null;
}

async function ensureClientAccountForUser(userId, displayName) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  

  const existingMembership = await pool.query(
    `
      SELECT cm.id, cm.client_account_id, cm.role, cm.status, ca.display_name
      FROM client_memberships cm
      JOIN client_accounts ca ON ca.id = cm.client_account_id
      WHERE cm.user_id = $1 AND cm.role = 'Client' AND cm.status = 'active'
      ORDER BY cm.id ASC
      LIMIT 1
    `,
    [id]
  );
  if (existingMembership.rows[0]) {
    return existingMembership.rows[0];
  }

  const accountResult = await pool.query(
    `
      INSERT INTO client_accounts (created_by_user_id, display_name)
      VALUES ($1, $2)
      RETURNING id, display_name
    `,
    [id, (String(displayName || ('User ' + id)).trim() || ('User ' + id)) + ' Client Account']
  );

  const account = accountResult.rows[0];
  const membershipResult = await pool.query(
    `
      INSERT INTO client_memberships (client_account_id, user_id, role, status, invited_by_user_id)
      VALUES ($1, $2, 'Client', 'active', $2)
      ON CONFLICT (client_account_id, user_id, role)
      DO UPDATE SET status = EXCLUDED.status, updated_at = CURRENT_TIMESTAMP
      RETURNING id, client_account_id, role, status
    `,
    [account.id, id]
  );

  await pool.query(
    `
      INSERT INTO client_memberships (client_account_id, user_id, role, status, invited_by_user_id)
      VALUES ($1, $2, 'Manager', 'active', $2)
      ON CONFLICT (client_account_id, user_id, role)
      DO UPDATE SET status = EXCLUDED.status, updated_at = CURRENT_TIMESTAMP
    `,
    [account.id, id]
  );

  return {
    ...membershipResult.rows[0],
    display_name: account.display_name
  };
}

async function getAccessMembershipsForUser(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    return [];
  }

  

  const result = await pool.query(
    `
      SELECT cm.id AS membership_id,
             cm.client_account_id,
             ca.display_name AS client_display_name,
             cm.role,
             cm.status
      FROM client_memberships cm
      JOIN client_accounts ca ON ca.id = cm.client_account_id
      WHERE cm.user_id = $1
        AND cm.status IN ('active', 'invited')
      ORDER BY ca.display_name ASC, cm.role ASC, cm.id ASC
    `,
    [id]
  );

  return result.rows;
}

function chooseAccessContextForUser(memberships, requestedClientAccountId) {
  const list = Array.isArray(memberships) ? memberships : [];
  if (!list.length) {
    return null;
  }

  // Access context is automatic by hierarchy only (Client > Manager > Staff > Guest).
  const sorted = list.slice().sort((a, b) => {
    const roleDelta = (ACCESS_ROLE_PRIORITY[b.role] || 0) - (ACCESS_ROLE_PRIORITY[a.role] || 0);
    if (roleDelta !== 0) return roleDelta;
    return Number(a.client_account_id) - Number(b.client_account_id);
  });

  return sorted[0] || null;
}

async function getOrCreateAccessContextForUser(userId, requestedClientAccountId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    return { memberships: [], active: null };
  }

  let memberships = await getAccessMembershipsForUser(id);
  if (!memberships.length) {
    const user = await getUserById(id);
    await ensureClientAccountForUser(id, user && user.username ? user.username : ('User ' + id));
    memberships = await getAccessMembershipsForUser(id);
  }

  return {
    memberships,
    active: chooseAccessContextForUser(memberships, requestedClientAccountId)
  };
}

function normaliseClientTeamRole(value) {
  const role = String(value || '').trim();
  return role === 'Manager' || role === 'Staff' ? role : '';
}

function deriveNamesFromUsername(username) {
  const raw = String(username || '').trim();
  if (!raw || raw.includes('@') || raw.toLowerCase().startsWith('staff-')) {
    return { firstName: '', familyName: '' };
  }

  const cleaned = raw.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return { firstName: '', familyName: '' };
  }

  const words = cleaned.split(' ').filter(Boolean);
  const toNameCase = (text) => text ? (text.charAt(0).toUpperCase() + text.slice(1).toLowerCase()) : '';
  const firstName = toNameCase(words[0] || '');
  const familyName = words.length > 1 ? toNameCase(words.slice(1).join(' ')) : '';
  return { firstName, familyName };
}

function normaliseClientTeamRoles(values) {
  const list = Array.isArray(values) ? values : [values];
  return Array.from(new Set(
    list
      .map((value) => normaliseClientTeamRole(value))
      .filter(Boolean)
  ));
}

async function getTeamMembershipsForClientAccount(clientAccountId) {
  const id = Number(clientAccountId);
  if (!Number.isInteger(id) || id <= 0) {
    return [];
  }

  const ownerUserId = await getClientOwnerUserId(id);
  if (Number.isInteger(ownerUserId) && ownerUserId > 0) {
    await ensureCleanerRowsForStaffMembers(id, ownerUserId);
  }

  const result = await pool.query(
    `
      SELECT cm.id,
             cm.client_account_id,
             cm.user_id,
             cm.role,
             cm.status,
             cm.created_at,
             cm.updated_at,
             c.id AS cleaner_id,
             u.email,
             u.first_name,
             u.family_name,
             u.country_of_residence,
             u.is_validated
      FROM client_memberships cm
      JOIN users u ON u.id = cm.user_id
      LEFT JOIN cleaners c ON c.client_account_id = cm.client_account_id AND c.cleaner_user_id = cm.user_id AND c.user_id = $2
      WHERE cm.client_account_id = $1
        AND cm.role IN ('Manager', 'Staff')
        AND cm.status IN ('active', 'invited')
      ORDER BY cm.role ASC, u.email ASC, cm.id ASC
    `,
    [id, ownerUserId || null]
  );

  return result.rows;
}

async function ensureCleanerRowsForStaffMembers(clientAccountId, ownerUserId) {
  const accountId = Number(clientAccountId);
  const ownerId = Number(ownerUserId);
  if (!Number.isInteger(accountId) || accountId <= 0 || !Number.isInteger(ownerId) || ownerId <= 0) {
    return [];
  }

  const result = await pool.query(
    `
      SELECT cm.user_id,
             u.first_name,
             u.family_name,
             u.email,
             u.telephone,
             u.password_hash
      FROM client_memberships cm
      JOIN users u ON u.id = cm.user_id
      LEFT JOIN cleaners c
        ON c.user_id = $2
       AND c.client_account_id = cm.client_account_id
       AND c.cleaner_user_id = cm.user_id
      WHERE cm.client_account_id = $1
        AND cm.role = 'Staff'
        AND cm.status IN ('active', 'invited')
        AND c.id IS NULL
      ORDER BY cm.id ASC
    `,
    [accountId, ownerId]
  );

  for (const row of result.rows) {
    await pool.query(
      `
        INSERT INTO cleaners (
          user_id,
          client_account_id,
          cleaner_user_id,
          first_name,
          last_name,
          email,
          telephone,
          password_hash
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (user_id, email)
        DO UPDATE SET
          client_account_id = EXCLUDED.client_account_id,
          cleaner_user_id = EXCLUDED.cleaner_user_id,
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          telephone = EXCLUDED.telephone,
          password_hash = EXCLUDED.password_hash,
          updated_at = CURRENT_TIMESTAMP
      `,
      [
        ownerId,
        accountId,
        Number(row.user_id),
        row.first_name || '',
        row.family_name || '',
        row.email || '',
        row.telephone || '',
        row.password_hash || ''
      ]
    );
  }

  return result.rows;
}

async function getUserByEmailStrict(email) {
  const normalized = normaliseOptionalEmail(email);
  if (!normalized) {
    return null;
  }
  return findUserByEmail(normalized);
}

async function hasPendingClientInviteForUser(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    return false;
  }

  const result = await pool.query(
    `
      SELECT id
      FROM client_memberships
      WHERE user_id = $1
        AND role IN ('Manager', 'Staff')
        AND status = 'invited'
        AND invited_by_user_id IS NOT NULL
        AND invited_by_user_id <> user_id
      ORDER BY id ASC
      LIMIT 1
    `,
    [id]
  );

  return Boolean(result.rows[0]);
}

async function createUnvalidatedSiteUserForInvite(input) {
  

  const email = normaliseOptionalEmail(input.email);
  const firstName = String(input.firstName || '').trim();
  const familyName = String(input.familyName || '').trim();
  const country = normaliseCountryOfResidence(input.country);
  const password = String(input.password || '');

  if (!email || !firstName || !familyName || !country || !password) {
    return { error: 'First name, family name, country, email, and password are required.' };
  }

  const passwordCheck = validateStrongPassword(password);
  if (!passwordCheck.ok) {
    return { error: passwordCheck.error };
  }

  let username;
  try {
    username = await generateUniqueUsernameFromEmail(email);
  } catch {
    return { error: 'Could not generate unique username for invited user.' };
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const result = await pool.query(
    `
      INSERT INTO users (username, email, password_hash, first_name, family_name, country_of_residence, is_validated)
      VALUES ($1, $2, $3, $4, $5, $6, FALSE)
      RETURNING id, username, email, first_name, family_name, country_of_residence, is_validated, created_at
    `,
    [username, email, passwordHash, firstName, familyName, country]
  );

  return { user: result.rows[0] };
}

async function setClientTeamRolesForUser(clientAccountId, invitedByUserId, targetUserId, rolesInput) {
  

  const roles = normaliseClientTeamRoles(rolesInput);
  const user = await getUserById(targetUserId);
  if (!user) {
    return { error: 'Site user not found.' };
  }

  const desiredStatus = user.is_validated === false ? 'invited' : 'active';
  const managerSelected = roles.includes('Manager');
  const staffSelected = roles.includes('Staff');
  const revokedManagerMembershipIds = [];

  if (managerSelected) {
    await pool.query(
      `
        INSERT INTO client_memberships (client_account_id, user_id, role, status, invited_by_user_id)
        VALUES ($1, $2, 'Manager', $3, $4)
        ON CONFLICT (client_account_id, user_id, role)
        DO UPDATE
        SET status = EXCLUDED.status,
            invited_by_user_id = EXCLUDED.invited_by_user_id,
            updated_at = CURRENT_TIMESTAMP
      `,
      [clientAccountId, targetUserId, desiredStatus, invitedByUserId]
    );
  } else {
    const managerRevoke = await pool.query(
      `
        UPDATE client_memberships
        SET status = 'revoked', updated_at = CURRENT_TIMESTAMP
        WHERE client_account_id = $1
          AND user_id = $2
          AND role = 'Manager'
          AND status IN ('active', 'invited')
        RETURNING id
      `,
      [clientAccountId, targetUserId]
    );
    managerRevoke.rows.forEach((row) => {
      const id = Number(row.id);
      if (Number.isInteger(id) && id > 0) {
        revokedManagerMembershipIds.push(id);
      }
    });
  }

  if (staffSelected) {
    await pool.query(
      `
        INSERT INTO client_memberships (client_account_id, user_id, role, status, invited_by_user_id)
        VALUES ($1, $2, 'Staff', $3, $4)
        ON CONFLICT (client_account_id, user_id, role)
        DO UPDATE
        SET status = EXCLUDED.status,
            invited_by_user_id = EXCLUDED.invited_by_user_id,
            updated_at = CURRENT_TIMESTAMP
      `,
      [clientAccountId, targetUserId, desiredStatus, invitedByUserId]
    );
  } else {
    await pool.query(
      `
        UPDATE client_memberships
        SET status = 'revoked', updated_at = CURRENT_TIMESTAMP
        WHERE client_account_id = $1
          AND user_id = $2
          AND role = 'Staff'
          AND status IN ('active', 'invited')
      `,
      [clientAccountId, targetUserId]
    );
  }

  if (revokedManagerMembershipIds.length) {
    await pool.query(
      'DELETE FROM manager_property_assignments WHERE manager_membership_id = ANY($1::bigint[])',
      [revokedManagerMembershipIds]
    );
    await pool.query(
      'DELETE FROM manager_listing_assignments WHERE manager_membership_id = ANY($1::bigint[])',
      [revokedManagerMembershipIds]
    );
  }

  await ensureCleanerRowsForStaffMembers(clientAccountId, invitedByUserId);

  const membershipsResult = await pool.query(
    `
      SELECT id, client_account_id, user_id, role, status, created_at, updated_at
      FROM client_memberships
      WHERE client_account_id = $1
        AND user_id = $2
        AND role IN ('Manager', 'Staff')
      ORDER BY role ASC
    `,
    [clientAccountId, targetUserId]
  );

  return {
    user: {
      id: Number(user.id),
      email: user.email,
      first_name: user.first_name || '',
      family_name: user.family_name || '',
      country_of_residence: user.country_of_residence || '',
      is_validated: user.is_validated !== false
    },
    memberships: membershipsResult.rows
  };
}

async function removeTeamMemberFromClientScope(clientAccountId, targetUserId) {
  

  const userId = Number(targetUserId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return { error: 'Invalid user id.' };
  }

  const user = await getUserById(userId);
  if (!user) {
    return { error: 'Site user not found.' };
  }

  const revokeResult = await pool.query(
    `
      UPDATE client_memberships
      SET status = 'revoked', updated_at = CURRENT_TIMESTAMP
      WHERE client_account_id = $1
        AND user_id = $2
        AND role IN ('Manager', 'Staff')
        AND status IN ('active', 'invited')
      RETURNING id, role
    `,
    [Number(clientAccountId), userId]
  );

  if (!revokeResult.rows.length) {
    return { error: 'This site user is not a team member in the current client scope.' };
  }

  const revokedManagerMembershipIds = revokeResult.rows
    .filter((row) => row.role === 'Manager')
    .map((row) => Number(row.id))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (revokedManagerMembershipIds.length) {
    await pool.query(
      'DELETE FROM manager_property_assignments WHERE manager_membership_id = ANY($1::bigint[])',
      [revokedManagerMembershipIds]
    );
    await pool.query(
      'DELETE FROM manager_listing_assignments WHERE manager_membership_id = ANY($1::bigint[])',
      [revokedManagerMembershipIds]
    );
  }

  const remainingMemberships = await pool.query(
    `
      SELECT id
      FROM client_memberships
      WHERE user_id = $1
        AND status IN ('active', 'invited')
        AND (
          role = 'Client'
          OR (role IN ('Manager', 'Staff') AND client_account_id <> $2)
        )
      LIMIT 1
    `,
    [userId, Number(clientAccountId)]
  );

  let deletedFromSite = false;
  if (!remainingMemberships.rows.length) {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    deletedFromSite = true;
  }

  return {
    removedRoles: revokeResult.rows.map((row) => row.role),
    deletedFromSite
  };
}

async function getTeamMemberRemovalImpact(clientAccountId, targetUserId) {
  

  const userId = Number(targetUserId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return { error: 'Invalid user id.' };
  }

  const user = await getUserById(userId);
  if (!user) {
    return { error: 'Site user not found.' };
  }

  const removableRolesResult = await pool.query(
    `
      SELECT role
      FROM client_memberships
      WHERE client_account_id = $1
        AND user_id = $2
        AND role IN ('Manager', 'Staff')
        AND status IN ('active', 'invited')
      ORDER BY role ASC
    `,
    [Number(clientAccountId), userId]
  );

  if (!removableRolesResult.rows.length) {
    return { error: 'This site user is not a team member in the current client scope.' };
  }

  const remainingMemberships = await pool.query(
    `
      SELECT id
      FROM client_memberships
      WHERE user_id = $1
        AND status IN ('active', 'invited')
        AND (
          role = 'Client'
          OR (role IN ('Manager', 'Staff') AND client_account_id <> $2)
        )
      LIMIT 1
    `,
    [userId, Number(clientAccountId)]
  );

  return {
    removedRoles: removableRolesResult.rows.map((row) => row.role),
    deletedFromSite: !remainingMemberships.rows.length
  };
}

async function updateUserInviteProfileIfMissing(userId, input) {
  

  const firstName = String(input.firstName || '').trim();
  const familyName = String(input.familyName || '').trim();
  const country = normaliseCountryOfResidence(input.country) || '';
  if (!firstName && !familyName && !country) {
    return;
  }

  await pool.query(
    `
      UPDATE users
      SET first_name = CASE
            WHEN NULLIF(TRIM(COALESCE(first_name, '')), '') IS NULL AND $2 <> '' THEN $2
            ELSE first_name
          END,
          family_name = CASE
            WHEN NULLIF(TRIM(COALESCE(family_name, '')), '') IS NULL AND $3 <> '' THEN $3
            ELSE family_name
          END,
          country_of_residence = CASE
            WHEN NULLIF(TRIM(COALESCE(country_of_residence, '')), '') IS NULL AND $4 <> '' THEN $4
            ELSE country_of_residence
          END
      WHERE id = $1
    `,
    [Number(userId), firstName, familyName, country]
  );
}

async function addClientMembershipByEmail(clientAccountId, invitedByUserId, email, role) {
  const nextRole = normaliseClientTeamRole(role);
  if (!nextRole) {
    return { error: 'Role must be Manager or Staff.' };
  }

  

  const user = await getUserByEmailStrict(email);
  if (!user) {
    return { error: 'User with this email does not exist yet. Ask them to create an account first.' };
  }

  const result = await pool.query(
    `
      INSERT INTO client_memberships (client_account_id, user_id, role, status, invited_by_user_id)
      VALUES ($1, $2, $3, 'active', $4)
      ON CONFLICT (client_account_id, user_id, role)
      DO UPDATE
      SET status = 'active', updated_at = CURRENT_TIMESTAMP, invited_by_user_id = EXCLUDED.invited_by_user_id
      RETURNING id, client_account_id, user_id, role, status, created_at, updated_at
    `,
    [clientAccountId, user.id, nextRole, invitedByUserId]
  );

  return { membership: result.rows[0], user: { id: user.id, email: user.email } };
}

async function revokeClientMembership(clientAccountId, membershipId) {
  

  const result = await pool.query(
    `
      UPDATE client_memberships
      SET status = 'revoked', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND client_account_id = $2 AND role IN ('Manager', 'Staff')
      RETURNING id, client_account_id, user_id, role, status
    `,
    [membershipId, clientAccountId]
  );

  if (!result.rows[0]) {
    return { error: 'Membership not found.' };
  }
  return { membership: result.rows[0] };
}

async function getManagerAssignmentSnapshot(clientAccountId) {
  

  const managersResult = await pool.query(
    `
      SELECT cm.id AS membership_id,
             cm.user_id,
             u.email
      FROM client_memberships cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.client_account_id = $1
        AND cm.role = 'Manager'
        AND cm.status = 'active'
      ORDER BY u.email ASC, cm.id ASC
    `,
    [clientAccountId]
  );

  const propertyResult = await pool.query(
    `
      SELECT mpa.manager_membership_id,
             mpa.property_id
      FROM manager_property_assignments mpa
      JOIN client_memberships cm ON cm.id = mpa.manager_membership_id
      WHERE cm.client_account_id = $1
    `,
    [clientAccountId]
  );

  const listingResult = await pool.query(
    `
      SELECT mla.manager_membership_id,
             mla.listing_id
      FROM manager_listing_assignments mla
      JOIN client_memberships cm ON cm.id = mla.manager_membership_id
      WHERE cm.client_account_id = $1
    `,
    [clientAccountId]
  );

  return {
    managers: managersResult.rows,
    propertyAssignments: propertyResult.rows,
    listingAssignments: listingResult.rows
  };
}

async function replaceManagerAssignments(clientAccountId, managerMembershipId, propertyIds, listingIds) {
  

  const membershipCheck = await pool.query(
    `
      SELECT id
      FROM client_memberships
      WHERE id = $1
        AND client_account_id = $2
        AND role = 'Manager'
        AND status = 'active'
      LIMIT 1
    `,
    [managerMembershipId, clientAccountId]
  );
  if (!membershipCheck.rows[0]) {
    return { error: 'Manager membership not found.' };
  }

  const normalizedPropertyIds = Array.isArray(propertyIds)
    ? propertyIds.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0)
    : [];
  const normalizedListingIds = Array.isArray(listingIds)
    ? listingIds.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0)
    : [];

  if (normalizedPropertyIds.length) {
    const propertyCheck = await pool.query(
      'SELECT id FROM properties WHERE client_account_id = $1 AND id = ANY($2::bigint[])',
      [clientAccountId, normalizedPropertyIds]
    );
    if (propertyCheck.rows.length !== normalizedPropertyIds.length) {
      return { error: 'One or more property ids are not in this client account.' };
    }
  }

  if (normalizedListingIds.length) {
    const listingCheck = await pool.query(
      'SELECT id FROM listings WHERE client_account_id = $1 AND id = ANY($2::bigint[])',
      [clientAccountId, normalizedListingIds]
    );
    if (listingCheck.rows.length !== normalizedListingIds.length) {
      return { error: 'One or more listing ids are not in this client account.' };
    }
  }

  await pool.query('DELETE FROM manager_property_assignments WHERE manager_membership_id = $1', [managerMembershipId]);
  await pool.query('DELETE FROM manager_listing_assignments WHERE manager_membership_id = $1', [managerMembershipId]);

  for (const propertyId of normalizedPropertyIds) {
    await pool.query(
      `
        INSERT INTO manager_property_assignments (manager_membership_id, property_id)
        VALUES ($1, $2)
        ON CONFLICT (manager_membership_id, property_id) DO NOTHING
      `,
      [managerMembershipId, propertyId]
    );
  }

  for (const listingId of normalizedListingIds) {
    await pool.query(
      `
        INSERT INTO manager_listing_assignments (manager_membership_id, listing_id)
        VALUES ($1, $2)
        ON CONFLICT (manager_membership_id, listing_id) DO NOTHING
      `,
      [managerMembershipId, listingId]
    );
  }

  return {
    managerMembershipId,
    propertyIds: normalizedPropertyIds,
    listingIds: normalizedListingIds
  };
}

async function getGuestsForClientAccount(clientAccountId) {
  

  const result = await pool.query(
    `
      SELECT id,
             client_account_id,
             guest_user_id,
             guest_email,
             guest_phone,
              guest_first_name,
              guest_family_name,
             source_type,
             source_id,
             first_seen_at,
             last_seen_at,
             created_at,
             updated_at
      FROM guest_relationships
      WHERE client_account_id = $1
      ORDER BY last_seen_at DESC, id DESC
    `,
    [clientAccountId]
  );

  return result.rows;
}

async function setUserStripeConnectState(userId, nextState) {
  const state = {
    stripe_account_id: nextState && nextState.stripe_account_id ? String(nextState.stripe_account_id).trim() : null,
    stripe_onboarding_complete: nextState && nextState.stripe_onboarding_complete === true,
    stripe_charges_enabled: nextState && nextState.stripe_charges_enabled === true,
    stripe_payouts_enabled: nextState && nextState.stripe_payouts_enabled === true
  };

  

  const result = await pool.query(
    `
      UPDATE users
      SET stripe_account_id = $1,
          stripe_onboarding_complete = $2,
          stripe_charges_enabled = $3,
          stripe_payouts_enabled = $4
      WHERE id = $5
      RETURNING id, username, email,
                stripe_account_id, stripe_onboarding_complete,
                stripe_charges_enabled, stripe_payouts_enabled,
                created_at
    `,
    [
      state.stripe_account_id,
      state.stripe_onboarding_complete,
      state.stripe_charges_enabled,
      state.stripe_payouts_enabled,
      userId
    ]
  );

  return result.rows[0] || null;
}

async function getPropertiesForUser(userId) {
  await ensureDefaultPropertyForUser(userId);

  

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

async function createPropertyForUser(userId, clientAccountId, name) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) {
    return { error: 'Property name is required.' };
  }

  const scopedClientAccountId = Number(clientAccountId);
  if (!Number.isInteger(scopedClientAccountId) || scopedClientAccountId <= 0) {
    return { error: 'Client account context is required.' };
  }

  

  try {
    const result = await pool.query(
      `
        INSERT INTO properties (user_id, client_account_id, name)
        VALUES ($1, $2, $3)
        RETURNING id, user_id, client_account_id, name, postal_address, manager_name, manager_email, is_default, created_at
      `,
      [userId, scopedClientAccountId, trimmedName]
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

  

  try {
    const existing = await getPropertyByIdForUser(propertyId, userId);
    if (!existing) {
      return { error: 'Property not found.' };
    }
    const result = await pool.query(
      `
        UPDATE properties
        SET name = $1,
            postal_address = $2,
            manager_name = $3,
            manager_email = $4,
            client_account_id = COALESCE(client_account_id, (
              SELECT client_account_id
              FROM client_memberships
              WHERE user_id = $6
                AND role = 'Client'
                AND status = 'active'
              ORDER BY id ASC
              LIMIT 1
            ))
        WHERE id = $5 AND user_id = $6
        RETURNING id, user_id, client_account_id, name, postal_address, manager_name, manager_email, is_default, created_at
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

  const propertyCountResult = await pool.query(
    'SELECT COUNT(*)::int AS count FROM properties WHERE user_id = $1',
    [userId]
  );
  if (Number(propertyCountResult.rows[0].count) <= 1) {
    return { error: 'This is the last remaining property and cannot be deleted. Please create another property first.' };
  }

  if (property.is_default === true) {
    return { error: 'The default property cannot be deleted.' };
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

async function getSharedResourcesForUser(userId) {
  

  const result = await pool.query(
    `
            SELECT id, user_id, short_description, full_description_html, max_units, max_days_advance_booking, property_id, listing_id, resource_type,
              free_of_charge, cash_on_site, bank_transfer, online_payment,
              charge_basis, daily_charge_mode, daily_rate, hourly_charge_mode, hourly_rate, hourly_rates_json,
              created_at, updated_at
      FROM shared_resources
      WHERE user_id = $1
      ORDER BY short_description ASC, id ASC
    `,
    [userId]
  );
  return result.rows.map((row) => ({
    ...row,
    max_days_advance_booking: normaliseSharedResourceMaxAdvanceBookingDays(row.max_days_advance_booking) || 365,
    resource_type: normaliseSharedResourceType(row.resource_type),
    ...normaliseSharedResourcePaymentOptions(row),
    ...normaliseSharedResourceChargeConfig(row),
    hourly_rates_json: JSON.stringify(normaliseSharedResourceChargeConfig(row).hourly_rates)
  }));
}

async function getSharedResourceByIdForUser(resourceId, userId) {
  

  const result = await pool.query(
    `
            SELECT id, user_id, short_description, full_description_html, max_units, max_days_advance_booking, property_id, listing_id, resource_type,
              free_of_charge, cash_on_site, bank_transfer, online_payment,
              free_of_charge_message_html, cash_on_site_message_html, bank_transfer_message_html, online_payment_message_html,
              charge_basis, daily_charge_mode, daily_rate, hourly_charge_mode, hourly_rate, hourly_rates_json,
              created_at, updated_at
      FROM shared_resources
      WHERE id = $1 AND user_id = $2
      LIMIT 1
    `,
    [resourceId, userId]
  );
  if (!result.rows[0]) {
    return null;
  }
  return {
    ...result.rows[0],
    max_days_advance_booking: normaliseSharedResourceMaxAdvanceBookingDays(result.rows[0].max_days_advance_booking) || 365,
    resource_type: normaliseSharedResourceType(result.rows[0].resource_type),
    ...normaliseSharedResourcePaymentOptions(result.rows[0]),
    ...normaliseSharedResourcePaymentMessages(result.rows[0]),
    ...normaliseSharedResourceChargeConfig(result.rows[0]),
    hourly_rates_json: JSON.stringify(normaliseSharedResourceChargeConfig(result.rows[0]).hourly_rates)
  };
}

async function getSharedResourceByIdPublic(resourceId) {
  

  const result = await pool.query(
    `
            SELECT id, user_id, short_description, full_description_html, max_units, max_days_advance_booking, resource_type,
              free_of_charge, cash_on_site, bank_transfer, online_payment,
              free_of_charge_message_html, cash_on_site_message_html, bank_transfer_message_html, online_payment_message_html,
              charge_basis, daily_charge_mode, daily_rate, hourly_charge_mode, hourly_rate, hourly_rates_json,
                    created_at, updated_at,
              property_id, listing_id
      FROM shared_resources
      WHERE id = $1
      LIMIT 1
    `,
    [resourceId]
  );
  if (!result.rows[0]) {
    return null;
  }
  const row = result.rows[0];
  return {
    id: row.id,
    user_id: row.user_id,
    short_description: row.short_description,
    full_description_html: row.full_description_html,
    max_units: row.max_units,
    max_days_advance_booking: row.max_days_advance_booking,
    resource_type: normaliseSharedResourceType(row.resource_type),
    free_of_charge: row.free_of_charge === true,
    cash_on_site: row.cash_on_site === true,
    bank_transfer: row.bank_transfer === true,
    online_payment: row.online_payment === true,
    free_of_charge_message_html: sanitiseRichTextHtml(row.free_of_charge_message_html),
    cash_on_site_message_html: sanitiseRichTextHtml(row.cash_on_site_message_html),
    bank_transfer_message_html: sanitiseRichTextHtml(row.bank_transfer_message_html),
    online_payment_message_html: sanitiseRichTextHtml(row.online_payment_message_html),
    charge_basis: row.charge_basis,
    daily_charge_mode: row.daily_charge_mode,
    daily_rate: row.daily_rate,
    hourly_charge_mode: row.hourly_charge_mode,
    hourly_rate: row.hourly_rate,
    hourly_rates_json: row.hourly_rates_json,
    created_at: row.created_at,
    updated_at: row.updated_at,
    property_id: row.property_id,
    listing_id: row.listing_id
  };
}

async function getListingIdsForSharedResource(resource) {
  const listings = await getListingsForUser(resource.user_id);
  if (resource.listing_id) {
    return listings
      .filter((listing) => Number(listing.id) === Number(resource.listing_id))
      .map((listing) => Number(listing.id));
  }
  if (resource.property_id) {
    return listings
      .filter((listing) => Number(listing.property_id) === Number(resource.property_id))
      .map((listing) => Number(listing.id));
  }
  return listings.map((listing) => Number(listing.id));
}

async function getReservationEventsForListing(listingId) {
  const cached = await getCachedEventsForListing(listingId);
  return (cached || [])
    .filter((entry) => !entry.error_text)
    .flatMap((entry) => {
      try {
        const events = JSON.parse(entry.events_json || '[]');
        return Array.isArray(events) ? events : [];
      } catch {
        return [];
      }
    })
    .filter((event) => event && event.isReservation !== false);
}

async function findMatchingCalendarListingId(listingIds, checkinDate, checkoutDate) {
  for (const listingId of listingIds) {
    const events = await getReservationEventsForListing(listingId);
    const found = events.some((event) => {
      const eventStart = getDateKeyFromEventDateTime(event.start);
      const eventEnd = getDateKeyFromEventDateTime(event.end);
      return eventStart === checkinDate && eventEnd === checkoutDate;
    });
    if (found) {
      return listingId;
    }
  }
  return null;
}

async function getSharedResourceReservationsByResourceId(resourceId) {
  

  const result = await pool.query(
    `
      SELECT id, user_id, shared_resource_id, reservation_identifier, listing_id,
             reservation_checkin_date::text AS reservation_checkin_date,
             reservation_checkout_date::text AS reservation_checkout_date,
              requested_start_at, requested_end_at, spaces_required,
              first_name, family_name, email_address, telephone, vehicle_registration, reservation_amount,
              payment_provider, payment_intent_id, payment_status, payment_currency,
              payment_amount_minor, application_fee_minor, payment_last_error, paid_at,
              status, created_at, updated_at
      FROM shared_resource_reservations
      WHERE shared_resource_id = $1
      ORDER BY requested_start_at ASC, id ASC
    `,
    [resourceId]
  );

  return result.rows.map((row) => ({
    ...row,
    payment_status: normaliseSharedResourceReservationPaymentStatus(row.payment_status),
    status: normaliseSharedResourceReservationStatus(row.status) || 'Confirmed'
  }));
}

function findCapacityConflictPeriod(existingReservations, requestedStartAt, requestedEndAt, requestedSpaces, maxUnits) {
  const requestStartMs = new Date(requestedStartAt).getTime();
  const requestEndMs = new Date(requestedEndAt).getTime();
  if (!Number.isFinite(requestStartMs) || !Number.isFinite(requestEndMs) || requestEndMs <= requestStartMs) {
    return null;
  }

  const intervals = existingReservations
    .map((row) => ({
      startMs: new Date(row.requested_start_at).getTime(),
      endMs: new Date(row.requested_end_at).getTime(),
      spaces: normaliseSharedResourceMaxUnits(row.spaces_required) || 1
    }))
    .filter((row) => Number.isFinite(row.startMs) && Number.isFinite(row.endMs) && row.endMs > row.startMs)
    .filter((row) => row.startMs < requestEndMs && row.endMs > requestStartMs);

  const boundaries = new Set([requestStartMs, requestEndMs]);
  intervals.forEach((row) => {
    boundaries.add(Math.max(requestStartMs, row.startMs));
    boundaries.add(Math.min(requestEndMs, row.endMs));
  });

  const points = Array.from(boundaries).sort((a, b) => a - b);
  let conflictStart = null;
  let conflictEnd = null;

  for (let index = 0; index < points.length - 1; index += 1) {
    const segmentStart = points[index];
    const segmentEnd = points[index + 1];
    if (segmentEnd <= segmentStart) {
      continue;
    }

    let usedSpaces = requestedSpaces;
    intervals.forEach((row) => {
      if (row.startMs < segmentEnd && row.endMs > segmentStart) {
        usedSpaces += row.spaces;
      }
    });

    if (usedSpaces > maxUnits) {
      if (conflictStart === null) {
        conflictStart = segmentStart;
      }
      conflictEnd = segmentEnd;
    } else if (conflictStart !== null) {
      break;
    }
  }

  if (conflictStart === null || conflictEnd === null) {
    return null;
  }

  return {
    start: new Date(conflictStart).toISOString(),
    end: new Date(conflictEnd).toISOString()
  };
}

function findAvailablePeriods(existingReservations, requestedStartAt, requestedEndAt, requestedSpaces, maxUnits) {
  const requestStartMs = new Date(requestedStartAt).getTime();
  const requestEndMs = new Date(requestedEndAt).getTime();
  if (!Number.isFinite(requestStartMs) || !Number.isFinite(requestEndMs) || requestEndMs <= requestStartMs) {
    return [];
  }

  const intervals = existingReservations
    .map((row) => ({
      startMs: new Date(row.requested_start_at).getTime(),
      endMs: new Date(row.requested_end_at).getTime(),
      spaces: normaliseSharedResourceMaxUnits(row.spaces_required) || 1
    }))
    .filter((row) => Number.isFinite(row.startMs) && Number.isFinite(row.endMs) && row.endMs > row.startMs)
    .filter((row) => row.startMs < requestEndMs && row.endMs > requestStartMs);

  const boundaries = new Set([requestStartMs, requestEndMs]);
  intervals.forEach((row) => {
    boundaries.add(Math.max(requestStartMs, row.startMs));
    boundaries.add(Math.min(requestEndMs, row.endMs));
  });

  const points = Array.from(boundaries).sort((a, b) => a - b);
  const available = [];
  let availStart = null;

  for (let index = 0; index < points.length - 1; index += 1) {
    const segStart = points[index];
    const segEnd = points[index + 1];
    if (segEnd <= segStart) {
      continue;
    }

    let usedSpaces = requestedSpaces;
    intervals.forEach((row) => {
      if (row.startMs < segEnd && row.endMs > segStart) {
        usedSpaces += row.spaces;
      }
    });

    if (usedSpaces <= maxUnits) {
      if (availStart === null) {
        availStart = segStart;
      }
    } else {
      if (availStart !== null) {
        available.push({ start: new Date(availStart).toISOString(), end: new Date(segStart).toISOString() });
        availStart = null;
      }
    }
  }

  if (availStart !== null) {
    available.push({ start: new Date(availStart).toISOString(), end: new Date(requestEndMs).toISOString() });
  }

  return available;
}

async function createSharedResourceReservation(input) {
  const status = normaliseSharedResourceReservationStatus(input.status) || 'Confirmed';
  const paymentStatus = normaliseSharedResourceReservationPaymentStatus(input.paymentStatus);
  const paymentProvider = String(input.paymentProvider || '').trim().slice(0, 40);
  const paymentIntentId = String(input.paymentIntentId || '').trim().slice(0, 120);
  const paymentCurrency = String(input.paymentCurrency || '').trim().toLowerCase().slice(0, 12);
  const paymentAmountMinor = Number.isInteger(Number(input.paymentAmountMinor)) ? Number(input.paymentAmountMinor) : null;
  const applicationFeeMinor = Number.isInteger(Number(input.applicationFeeMinor)) ? Number(input.applicationFeeMinor) : null;
  const paymentLastError = String(input.paymentLastError || '').trim().slice(0, 500);
  const paidAt = input.paidAt ? String(input.paidAt).trim() : null;
  const vehicleRegistration = String(input.vehicleRegistration || '').trim().slice(0, 60);

  

  const result = await pool.query(
    `
      INSERT INTO shared_resource_reservations (
        user_id, shared_resource_id, reservation_identifier, listing_id,
        reservation_checkin_date, reservation_checkout_date,
        requested_start_at, requested_end_at, spaces_required,
        first_name, family_name, email_address, telephone, vehicle_registration, reservation_amount,
        payment_provider, payment_intent_id, payment_status, payment_currency,
        payment_amount_minor, application_fee_minor, payment_last_error, paid_at,
        status
      )
      VALUES ($1, $2, $3, $4, $5::date, $6::date, $7::timestamptz, $8::timestamptz, $9,
              $10, $11, $12, $13, $14, $15,
              $16, $17, $18, $19, $20, $21, $22, $23::timestamptz,
              $24)
      RETURNING id, user_id, shared_resource_id, reservation_identifier, listing_id,
                reservation_checkin_date::text AS reservation_checkin_date,
                reservation_checkout_date::text AS reservation_checkout_date,
                requested_start_at, requested_end_at, spaces_required,
                first_name, family_name, email_address, telephone, vehicle_registration, reservation_amount,
                payment_provider, payment_intent_id, payment_status, payment_currency,
                payment_amount_minor, application_fee_minor, payment_last_error, paid_at,
                status, created_at, updated_at
    `,
    [
      input.userId,
      input.sharedResourceId,
      input.reservationIdentifier,
      input.listingId,
      input.reservationCheckinDate,
      input.reservationCheckoutDate,
      input.requestedStartAt,
      input.requestedEndAt,
      normaliseSharedResourceMaxUnits(input.spacesRequired) || 1,
      String(input.firstName || ''),
      String(input.familyName || ''),
      String(input.emailAddress || ''),
      String(input.telephone || ''),
      vehicleRegistration,
      normaliseSharedResourceReservationAmount(input.reservationAmount),
      paymentProvider,
      paymentIntentId || null,
      paymentStatus,
      paymentCurrency,
      paymentAmountMinor,
      applicationFeeMinor,
      paymentLastError || null,
      paidAt,
      status
    ]
  );
  return result.rows[0];
}

async function updateSharedResourceReservationPaymentById(reservationId, input) {
  const paymentStatus = normaliseSharedResourceReservationPaymentStatus(input.paymentStatus);
  const nextStatus = normaliseSharedResourceReservationStatus(input.status) || null;
  const paymentLastError = String(input.paymentLastError || '').trim().slice(0, 500);
  const paidAt = input.paidAt ? String(input.paidAt).trim() : null;

  

  const result = await pool.query(
    `
      UPDATE shared_resource_reservations
      SET payment_provider = COALESCE($1, payment_provider),
          payment_intent_id = COALESCE($2, payment_intent_id),
          payment_status = COALESCE(NULLIF($3, ''), payment_status),
          payment_currency = COALESCE(NULLIF($4, ''), payment_currency),
          payment_amount_minor = COALESCE($5, payment_amount_minor),
          application_fee_minor = COALESCE($6, application_fee_minor),
          payment_last_error = COALESCE($7, payment_last_error),
          paid_at = COALESCE($8::timestamptz, paid_at),
          status = COALESCE($9, status),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $10
      RETURNING id, user_id, shared_resource_id, reservation_identifier, listing_id,
                reservation_checkin_date::text AS reservation_checkin_date,
                reservation_checkout_date::text AS reservation_checkout_date,
                requested_start_at, requested_end_at, spaces_required,
                first_name, family_name, email_address, telephone, vehicle_registration, reservation_amount,
                payment_provider, payment_intent_id, payment_status, payment_currency,
                payment_amount_minor, application_fee_minor, payment_last_error, paid_at,
                status, created_at, updated_at
    `,
    [
      input.paymentProvider !== undefined ? String(input.paymentProvider || '').trim().slice(0, 40) : null,
      input.paymentIntentId !== undefined ? String(input.paymentIntentId || '').trim().slice(0, 120) : null,
      paymentStatus,
      input.paymentCurrency !== undefined ? String(input.paymentCurrency || '').trim().toLowerCase().slice(0, 12) : null,
      input.paymentAmountMinor !== undefined && Number.isInteger(Number(input.paymentAmountMinor)) ? Number(input.paymentAmountMinor) : null,
      input.applicationFeeMinor !== undefined && Number.isInteger(Number(input.applicationFeeMinor)) ? Number(input.applicationFeeMinor) : null,
      paymentLastError || null,
      paidAt,
      nextStatus,
      reservationId
    ]
  );

  return result.rows[0] || null;
}

async function getSharedResourceReservationByPaymentIntentId(paymentIntentId) {
  const id = String(paymentIntentId || '').trim();
  if (!id) {
    return null;
  }

  

  const result = await pool.query(
    `
      SELECT id, user_id, shared_resource_id, reservation_identifier, listing_id,
             reservation_checkin_date::text AS reservation_checkin_date,
             reservation_checkout_date::text AS reservation_checkout_date,
             requested_start_at, requested_end_at, spaces_required,
             first_name, family_name, email_address, telephone, vehicle_registration, reservation_amount,
             payment_provider, payment_intent_id, payment_status, payment_currency,
             payment_amount_minor, application_fee_minor, payment_last_error, paid_at,
             status, created_at, updated_at
      FROM shared_resource_reservations
      WHERE payment_intent_id = $1
      LIMIT 1
    `,
    [id]
  );

  return result.rows[0] || null;
}

async function getSharedResourceReservationByIdentifier(reservationIdentifier) {
  const id = String(reservationIdentifier || '').trim();
  if (!id) {
    return null;
  }

  

  const result = await pool.query(
    `
      SELECT id, user_id, shared_resource_id, reservation_identifier, listing_id,
             reservation_checkin_date::text AS reservation_checkin_date,
             reservation_checkout_date::text AS reservation_checkout_date,
             requested_start_at, requested_end_at, spaces_required,
             first_name, family_name, email_address, telephone, vehicle_registration, reservation_amount,
             payment_provider, payment_intent_id, payment_status, payment_currency,
             payment_amount_minor, application_fee_minor, payment_last_error, paid_at,
             status, created_at, updated_at
      FROM shared_resource_reservations
      WHERE reservation_identifier = $1
      LIMIT 1
    `,
    [id]
  );

  return result.rows[0] || null;
}

async function updateSharedResourceReservationStatusForUser(reservationId, resourceId, userId, status) {
  const nextStatus = normaliseSharedResourceReservationStatus(status);
  if (!nextStatus) {
    return { error: 'Invalid reservation status.' };
  }

  

  const result = await pool.query(
    `
      UPDATE shared_resource_reservations
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND shared_resource_id = $3 AND user_id = $4
      RETURNING id, user_id, shared_resource_id, reservation_identifier, listing_id,
                reservation_checkin_date::text AS reservation_checkin_date,
                reservation_checkout_date::text AS reservation_checkout_date,
                requested_start_at, requested_end_at, spaces_required, status, created_at, updated_at
    `,
    [nextStatus, reservationId, resourceId, userId]
  );

  if (!result.rows[0]) {
    return { error: 'Reservation not found.' };
  }
  return { reservation: result.rows[0] };
}

async function getSharedResourceReservationByIdForUser(reservationId, resourceId, userId) {
  

  const result = await pool.query(
    `
      SELECT id, user_id, shared_resource_id, reservation_identifier, listing_id,
             reservation_checkin_date::text AS reservation_checkin_date,
             reservation_checkout_date::text AS reservation_checkout_date,
             requested_start_at, requested_end_at, spaces_required,
              first_name, family_name, email_address, telephone, vehicle_registration, reservation_amount,
              payment_provider, payment_intent_id, payment_status, payment_currency,
              payment_amount_minor, application_fee_minor, payment_last_error, paid_at,
             status, created_at, updated_at
      FROM shared_resource_reservations
      WHERE id = $1 AND shared_resource_id = $2 AND user_id = $3
      LIMIT 1
    `,
    [reservationId, resourceId, userId]
  );

  return result.rows[0] || null;
}

async function updateSharedResourceReservationForUser(reservationId, resourceId, userId, input) {
  const nextStatus = normaliseSharedResourceReservationStatus(input.status);
  if (!nextStatus) {
    return { error: 'Invalid reservation status.' };
  }

  

  const result = await pool.query(
    `
      UPDATE shared_resource_reservations
      SET reservation_checkin_date = $1::date,
          reservation_checkout_date = $2::date,
          requested_start_at = $3::timestamptz,
          requested_end_at = $4::timestamptz,
          listing_id = $5,
          spaces_required = $6,
          first_name = $7,
          family_name = $8,
          email_address = $9,
          telephone = $10,
          vehicle_registration = $11,
          reservation_amount = $12,
          status = $13,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $14 AND shared_resource_id = $15 AND user_id = $16
      RETURNING id, user_id, shared_resource_id, reservation_identifier, listing_id,
                reservation_checkin_date::text AS reservation_checkin_date,
                reservation_checkout_date::text AS reservation_checkout_date,
                requested_start_at, requested_end_at, spaces_required,
                first_name, family_name, email_address, telephone, vehicle_registration, reservation_amount,
                payment_provider, payment_intent_id, payment_status, payment_currency,
                payment_amount_minor, application_fee_minor, payment_last_error, paid_at,
                status, created_at, updated_at
    `,
    [
      input.reservationCheckinDate,
      input.reservationCheckoutDate,
      input.requestedStartAt,
      input.requestedEndAt,
      normaliseOptionalPositiveInteger(input.listingId),
      normaliseSharedResourceMaxUnits(input.spacesRequired) || 1,
      String(input.firstName || ''),
      String(input.familyName || ''),
      String(input.emailAddress || ''),
      String(input.telephone || ''),
      String(input.vehicleRegistration || ''),
      normaliseSharedResourceReservationAmount(input.reservationAmount),
      nextStatus,
      reservationId,
      resourceId,
      userId
    ]
  );

  if (!result.rows[0]) {
    return { error: 'Reservation not found.' };
  }

  return { reservation: result.rows[0] };
}

async function createSharedResourceForUser(userId, clientAccountId, input) {
  const shortDescription = normaliseSharedResourceShortDescription(input.shortDescription);
  const fullDescriptionHtml = sanitiseRichTextHtml(input.fullDescriptionHtml);
  const maxUnits = normaliseSharedResourceMaxUnits(input.maxUnits) || 1;
  const maxDaysAdvanceBooking = normaliseSharedResourceMaxAdvanceBookingDays(input.maxDaysAdvanceBooking) || 365;
  const scopedClientAccountId = Number(clientAccountId);
  let propertyId = normaliseOptionalPositiveInteger(input.propertyId);
  const listingId = normaliseOptionalPositiveInteger(input.listingId);
  const resourceType = normaliseSharedResourceType(input.resourceType);
  const paymentOptions = normaliseSharedResourcePaymentOptions(input);
  const paymentMessages = normaliseSharedResourcePaymentMessages(input);
  const rawChargeConfig = normaliseSharedResourceChargeConfig(input);
  const hasChargeConfigInput = Boolean(
    input
      && (input.chargeBasis || input.dailyChargeMode || input.hourlyChargeMode
        || input.dailyRate !== undefined || input.hourlyRate !== undefined || input.hourlyRates !== undefined)
  );
  const chargeConfig = hasChargeConfigInput
    ? validateSharedResourceChargeConfig(paymentOptions, rawChargeConfig)
    : {
        charge_basis: null,
        daily_charge_mode: null,
        daily_rate: null,
        hourly_charge_mode: null,
        hourly_rate: null,
        hourly_rates: []
      };
  if (!shortDescription) {
    return { error: 'Short description is required.' };
  }
  if (!Number.isInteger(scopedClientAccountId) || scopedClientAccountId <= 0) {
    return { error: 'Client account context is required.' };
  }
  if (chargeConfig.error) {
    return { error: chargeConfig.error };
  }

  let selectedListing = null;
  if (listingId) {
    selectedListing = await getListingByIdForUser(listingId, userId);
    if (!selectedListing) {
      return { error: 'Listing not found.' };
    }
    if (propertyId && Number(selectedListing.property_id) !== Number(propertyId)) {
      return { error: 'Selected listing does not belong to the selected property.' };
    }
    propertyId = Number(selectedListing.property_id) || null;
  }

  if (propertyId) {
    const property = await getPropertyByIdForUser(propertyId, userId);
    if (!property) {
      return { error: 'Property not found.' };
    }
  }

  

  const result = await pool.query(
    `
      INSERT INTO shared_resources (
        user_id,
        client_account_id,
        short_description,
        full_description_html,
        max_units,
        max_days_advance_booking,
        property_id,
        listing_id,
        resource_type,
        free_of_charge,
        cash_on_site,
        bank_transfer,
        online_payment,
        free_of_charge_message_html,
        cash_on_site_message_html,
        bank_transfer_message_html,
        online_payment_message_html,
        charge_basis,
        daily_charge_mode,
        daily_rate,
        hourly_charge_mode,
        hourly_rate,
        hourly_rates_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
      RETURNING id, user_id, client_account_id, short_description, full_description_html, max_units, max_days_advance_booking, property_id, listing_id, resource_type,
                free_of_charge, cash_on_site, bank_transfer, online_payment,
              free_of_charge_message_html, cash_on_site_message_html, bank_transfer_message_html, online_payment_message_html,
                charge_basis, daily_charge_mode, daily_rate, hourly_charge_mode, hourly_rate, hourly_rates_json,
                created_at, updated_at
    `,
    [
      userId,
      scopedClientAccountId,
      shortDescription,
      fullDescriptionHtml,
      maxUnits,
      maxDaysAdvanceBooking,
      propertyId,
      listingId,
      resourceType,
      paymentOptions.free_of_charge,
      paymentOptions.cash_on_site,
      paymentOptions.bank_transfer,
      paymentOptions.online_payment,
      paymentMessages.free_of_charge_message_html,
      paymentMessages.cash_on_site_message_html,
      paymentMessages.bank_transfer_message_html,
      paymentMessages.online_payment_message_html,
      chargeConfig.charge_basis,
      chargeConfig.daily_charge_mode,
      chargeConfig.daily_rate,
      chargeConfig.hourly_charge_mode,
      chargeConfig.hourly_rate,
      JSON.stringify(chargeConfig.hourly_rates)
    ]
  );
  return { resource: result.rows[0] };
}

async function updateSharedResourceForUser(resourceId, userId, clientAccountId, input) {
  const shortDescription = normaliseSharedResourceShortDescription(input.shortDescription);
  const fullDescriptionHtml = sanitiseRichTextHtml(input.fullDescriptionHtml);
  const maxUnits = normaliseSharedResourceMaxUnits(input.maxUnits);
  const maxDaysAdvanceBooking = normaliseSharedResourceMaxAdvanceBookingDays(input.maxDaysAdvanceBooking);
  const scopedClientAccountId = Number(clientAccountId);
  let propertyId = normaliseOptionalPositiveInteger(input.propertyId);
  const listingId = normaliseOptionalPositiveInteger(input.listingId);
  const resourceType = normaliseSharedResourceType(input.resourceType);
  const paymentOptions = normaliseSharedResourcePaymentOptions(input);
  const paymentMessages = normaliseSharedResourcePaymentMessages(input);
  const chargeConfig = validateSharedResourceChargeConfig(paymentOptions, normaliseSharedResourceChargeConfig(input));

  if (!shortDescription) {
    return { error: 'Short description is required.' };
  }
  if (!Number.isInteger(scopedClientAccountId) || scopedClientAccountId <= 0) {
    return { error: 'Client account context is required.' };
  }
  if (!maxUnits) {
    return { error: 'Maximum units must be a whole number greater than zero.' };
  }
  if (!maxDaysAdvanceBooking) {
    return { error: 'Max days advance booking must be a whole number from 1 to 365.' };
  }
  if (chargeConfig.error) {
    return { error: chargeConfig.error };
  }

  let selectedListing = null;
  if (listingId) {
    selectedListing = await getListingByIdForUser(listingId, userId);
    if (!selectedListing) {
      return { error: 'Listing not found.' };
    }
    if (propertyId && Number(selectedListing.property_id) !== Number(propertyId)) {
      return { error: 'Selected listing does not belong to the selected property.' };
    }
    propertyId = Number(selectedListing.property_id) || null;
  }

  if (propertyId) {
    const property = await getPropertyByIdForUser(propertyId, userId);
    if (!property) {
      return { error: 'Property not found.' };
    }
  }

  

  const result = await pool.query(
    `
      UPDATE shared_resources
      SET short_description = $1,
          client_account_id = COALESCE(client_account_id, $24),
          full_description_html = $2,
          max_units = $3,
          max_days_advance_booking = $4,
          property_id = $5,
          listing_id = $6,
            resource_type = $7,
            free_of_charge = $8,
            cash_on_site = $9,
            bank_transfer = $10,
            online_payment = $11,
            free_of_charge_message_html = $12,
            cash_on_site_message_html = $13,
            bank_transfer_message_html = $14,
            online_payment_message_html = $15,
            charge_basis = $16,
            daily_charge_mode = $17,
            daily_rate = $18,
            hourly_charge_mode = $19,
            hourly_rate = $20,
            hourly_rates_json = $21,
          updated_at = CURRENT_TIMESTAMP
          WHERE id = $22 AND user_id = $23
          RETURNING id, user_id, client_account_id, short_description, full_description_html, max_units, max_days_advance_booking, property_id, listing_id, resource_type,
              free_of_charge, cash_on_site, bank_transfer, online_payment,
              free_of_charge_message_html, cash_on_site_message_html, bank_transfer_message_html, online_payment_message_html,
              charge_basis, daily_charge_mode, daily_rate, hourly_charge_mode, hourly_rate, hourly_rates_json,
              created_at, updated_at
    `,
    [
      shortDescription,
      fullDescriptionHtml,
      maxUnits,
      maxDaysAdvanceBooking,
      propertyId,
      listingId,
      resourceType,
      paymentOptions.free_of_charge,
      paymentOptions.cash_on_site,
      paymentOptions.bank_transfer,
      paymentOptions.online_payment,
      paymentMessages.free_of_charge_message_html,
      paymentMessages.cash_on_site_message_html,
      paymentMessages.bank_transfer_message_html,
      paymentMessages.online_payment_message_html,
      chargeConfig.charge_basis,
      chargeConfig.daily_charge_mode,
      chargeConfig.daily_rate,
      chargeConfig.hourly_charge_mode,
      chargeConfig.hourly_rate,
      JSON.stringify(chargeConfig.hourly_rates),
      resourceId,
      userId,
      scopedClientAccountId
    ]
  );

  if (!result.rows[0]) {
    return { error: 'Shared resource not found.' };
  }

  return { resource: result.rows[0] };
}

async function deleteSharedResourceForUser(resourceId, userId) {
  

  const result = await pool.query(
    'DELETE FROM shared_resources WHERE id = $1 AND user_id = $2 RETURNING id',
    [resourceId, userId]
  );
  if (!result.rows[0]) {
    return { error: 'Shared resource not found.' };
  }

  return { deletedResourceId: Number(result.rows[0].id) };
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
  

  const result = await pool.query(
    'SELECT id, email, created_at FROM users ORDER BY email ASC'
  );
  return result.rows;
}

async function getAllSiteUsersWithMemberships() {
  

  const result = await pool.query(
    `
      SELECT u.id,
             u.email,
             u.first_name,
             u.family_name,
             u.country_of_residence,
             u.is_validated,
             u.created_at,
             COALESCE(
               JSON_AGG(
                 JSON_BUILD_OBJECT(
                   'client_account_id', cm.client_account_id,
                   'client_display_name', ca.display_name,
                   'role', cm.role,
                   'status', cm.status
                 )
                 ORDER BY ca.display_name ASC, cm.role ASC, cm.id ASC
               ) FILTER (WHERE cm.id IS NOT NULL),
               '[]'::json
             ) AS memberships
      FROM users u
      LEFT JOIN client_memberships cm
        ON cm.user_id = u.id
       AND cm.status IN ('active', 'invited')
      LEFT JOIN client_accounts ca
        ON ca.id = cm.client_account_id
      GROUP BY u.id, u.email, u.first_name, u.family_name, u.country_of_residence, u.is_validated, u.created_at
      ORDER BY u.email ASC
    `
  );

  return result.rows.map((row) => ({
    ...row,
    id: Number(row.id),
    memberships: Array.isArray(row.memberships) ? row.memberships : []
  }));
}

async function getSiteUserForAdmin(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  const users = await getAllSiteUsersWithMemberships();
  const user = users.find((item) => Number(item.id) === id);
  return user || null;
}

async function updateSiteUserForAdmin(userId, input) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    return { error: 'Invalid user id.' };
  }

  const firstName = String(input.firstName || '').trim();
  const familyName = String(input.familyName || '').trim();
  const country = normaliseCountryOfResidence(input.country) || '';
  const email = normaliseOptionalEmail(input.email);
  const isValidated = input.isValidated === true;
  const newPassword = String(input.password || '');

  if (!firstName || !familyName || !country || !email) {
    return { error: 'First name, family name, country, and email are required.' };
  }

  let passwordHash = null;
  if (newPassword) {
    const passwordCheck = validateStrongPassword(newPassword);
    if (!passwordCheck.ok) {
      return { error: passwordCheck.error };
    }
    passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  }

  

  const emailConflict = await pool.query(
    'SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2 LIMIT 1',
    [email, id]
  );
  if (emailConflict.rows[0]) {
    return { error: 'Email address already in use.' };
  }

  const updateResult = await pool.query(
    `
      UPDATE users
      SET first_name = $1,
          family_name = $2,
          country_of_residence = $3,
          email = $4,
          is_validated = $5,
          password_hash = COALESCE($6, password_hash)
      WHERE id = $7
      RETURNING id
    `,
    [firstName, familyName, country, email, isValidated, passwordHash, id]
  );

  if (!updateResult.rows[0]) {
    return { error: 'User not found.' };
  }

  if (isValidated) {
    await pool.query(
      `
        UPDATE client_memberships
        SET status = 'active',
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
          AND status = 'invited'
          AND role IN ('Manager', 'Staff')
      `,
      [id]
    );
  } else {
    await pool.query(
      `
        UPDATE client_memberships
        SET status = 'invited',
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
          AND status = 'active'
          AND role IN ('Manager', 'Staff')
      `,
      [id]
    );
  }

  const updated = await getSiteUserForAdmin(id);
  return { user: updated };
}

async function deleteUserAndData(userId) {
  

  const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [userId]);
  if (!result.rows[0]) {
    return { error: 'User not found.' };
  }

  return { deletedUserId: Number(result.rows[0].id) };
}

async function getListingsForUser(userId) {
  const defaultProperty = await ensureDefaultPropertyForUser(userId);

  

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
      ORDER BY LOWER(p.name) ASC, LOWER(l.name) ASC
    `,
    [userId]
  );
  return result.rows;
}

async function getListingByIdForUser(listingId, userId) {
  const defaultProperty = await ensureDefaultPropertyForUser(userId);

  

  const result = await pool.query(
    `
      SELECT l.id, l.user_id, l.name, l.property_id, l.date_basis, l.usual_cleaner_id, l.empty_export, l.created_at, p.name AS property_name
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

async function getListingById(listingId) {
  

  const result = await pool.query(
    `
      SELECT l.id, l.user_id, l.name, l.property_id, l.date_basis, l.usual_cleaner_id, l.empty_export, l.created_at, p.name AS property_name
      FROM listings l
      LEFT JOIN properties p ON p.id = l.property_id
      WHERE l.id = $1
      LIMIT 1
    `,
    [listingId]
  );

  return result.rows[0] || null;
}

function buildIcsAccessToken(listing) {
  const payload = String(listing.id) + ':' + String(listing.user_id);
  return createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
}

function buildConsolidatedIcsToken(userId) {
  const normalisedUserId = Number(userId);
  if (!Number.isInteger(normalisedUserId) || normalisedUserId <= 0) {
    return null;
  }

  const userPart = String(normalisedUserId);
  const signature = createHmac('sha256', SESSION_SECRET)
    .update('consolidated-ics:' + userPart)
    .digest('hex');
  return userPart + '.' + signature;
}

function getUserIdFromConsolidatedIcsToken(token) {
  const raw = String(token || '').trim();
  if (!raw) {
    return null;
  }

  const dotIndex = raw.indexOf('.');
  if (dotIndex <= 0 || dotIndex === raw.length - 1) {
    return null;
  }

  const userPart = raw.slice(0, dotIndex);
  const signaturePart = raw.slice(dotIndex + 1);
  const userId = Number(userPart);
  if (!Number.isInteger(userId) || userId <= 0) {
    return null;
  }

  const expected = buildConsolidatedIcsToken(userId);
  if (!expected) {
    return null;
  }

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(raw);
  if (expectedBuffer.length !== providedBuffer.length) {
    return null;
  }

  if (!timingSafeEqual(expectedBuffer, providedBuffer)) {
    return null;
  }

  if (!/^[0-9a-fA-F]+$/.test(signaturePart)) {
    return null;
  }

  return userId;
}

function isValidIcsAccessToken(listing, token) {
  const provided = String(token || '').trim();
  if (!provided) {
    return false;
  }
  const expected = buildIcsAccessToken(listing);
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

async function createListingForUser(userId, name, propertyId, dateBasis, usualCleanerId) {
  

  try {
    const property = await resolvePropertyForListing(userId, propertyId);
    if (!property) {
      return { error: 'Property not found.' };
    }

    const result = await pool.query(
      `
        INSERT INTO listings (user_id, client_account_id, name, property_id, date_basis, usual_cleaner_id)
        VALUES (
          $1,
          (SELECT client_account_id FROM properties WHERE id = $3),
          $2,
          $3,
          $4,
          $5
        )
        RETURNING id, user_id, client_account_id, name, property_id, date_basis, usual_cleaner_id, created_at
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

async function updateListingForUser(listingId, userId, name, propertyId, dateBasis, usualCleanerId, emptyExport) {
  

  try {
    const property = await resolvePropertyForListing(userId, propertyId);
    if (!property) {
      return { error: 'Property not found.' };
    }

    const result = await pool.query(
      `
        UPDATE listings
        SET name = $1,
            property_id = $2,
            client_account_id = (SELECT client_account_id FROM properties WHERE id = $2),
            date_basis = $3,
            usual_cleaner_id = $4,
            empty_export = $7
        WHERE id = $5 AND user_id = $6
        RETURNING id, user_id, client_account_id, name, property_id, date_basis, usual_cleaner_id, empty_export, created_at
      `,
      [name, property.id, normaliseDateBasis(dateBasis), normaliseCleanerId(usualCleanerId), listingId, userId, emptyExport === true]
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

async function deleteListingForUser(listingId, userId) {
  const result = await pool.query(
    `
      DELETE FROM listings
      WHERE id = $1 AND user_id = $2
      RETURNING id
    `,
    [listingId, userId]
  );

  if (!result.rows[0]) {
    return { error: 'Listing not found.' };
  }

  return { deletedListingId: Number(result.rows[0].id) };
}

async function getBookedInChangesForUserByListings(userId, listingIds) {
  const uniqueListingIds = Array.from(new Set((listingIds || [])
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0)));

  if (!uniqueListingIds.length) {
    return [];
  }

  

  const result = await pool.query(
    `
      SELECT bic.id,
             bic.user_id,
             bic.property_id,
             bic.listing_id,
             reservation_checkin_date::text AS reservation_checkin_date,
             reservation_checkout_date::text AS reservation_checkout_date,
             changeover_date::text AS changeover_date,
             COALESCE(bic.cleaner_id, cleaner_by_id.id, cleaner_by_user_id.id) AS cleaner_id,
             bic.cleaner_user_id,
             COALESCE(
               NULLIF(TRIM(COALESCE(cleaner_by_id.first_name, cleaner_by_user_id.first_name, '') || ' ' || COALESCE(cleaner_by_id.last_name, cleaner_by_user_id.last_name, '')), ''),
               NULLIF(TRIM(COALESCE(cleaner_by_id.email, cleaner_by_user_id.email, '')), ''),
               'Unallocated'
             ) AS cleaner_name,
             bic.created_at,
             bic.updated_at
      FROM booked_in_changes bic
      LEFT JOIN cleaners cleaner_by_id ON cleaner_by_id.id = bic.cleaner_id
      LEFT JOIN cleaners cleaner_by_user_id
        ON cleaner_by_user_id.cleaner_user_id = bic.cleaner_user_id
       AND cleaner_by_user_id.user_id = bic.user_id
      WHERE bic.user_id = $1
        AND bic.listing_id = ANY($2::bigint[])
    `,
    [userId, uniqueListingIds]
  );
  return result.rows;
}

async function getGuestByIdForClientAccount(clientAccountId, guestId) {
  const result = await pool.query(
    `
      SELECT id,
             client_account_id,
             guest_user_id,
             guest_email,
             guest_phone,
             guest_first_name,
             guest_family_name,
             source_type,
             source_id,
             first_seen_at,
             last_seen_at,
             created_at,
             updated_at
      FROM guest_relationships
      WHERE client_account_id = $1
        AND id = $2
      LIMIT 1
    `,
    [clientAccountId, guestId]
  );

  return result.rows[0] || null;
}

async function createGuestForClientAccount(clientAccountId, payload) {
  const firstName = String(payload && payload.firstName || '').trim().slice(0, 120);
  const familyName = String(payload && payload.familyName || '').trim().slice(0, 120);
  const email = normaliseOptionalEmail(payload && payload.email);
  const phone = String(payload && payload.phone || '').trim().slice(0, 60);

  if (!email) {
    return { error: 'A valid guest email is required.' };
  }

  try {
    const result = await pool.query(
      `
        INSERT INTO guest_relationships (
          client_account_id,
          guest_email,
          guest_phone,
          guest_first_name,
          guest_family_name,
          source_type,
          source_id,
          first_seen_at,
          last_seen_at
        )
        VALUES ($1, $2, $3, $4, $5, 'manual', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id,
                  client_account_id,
                  guest_user_id,
                  guest_email,
                  guest_phone,
                  guest_first_name,
                  guest_family_name,
                  source_type,
                  source_id,
                  first_seen_at,
                  last_seen_at,
                  created_at,
                  updated_at
      `,
      [clientAccountId, email, phone, firstName, familyName]
    );

    return { guest: result.rows[0] };
  } catch (err) {
    if (err && err.code === '23505') {
      return { error: 'A guest with this email and phone already exists.' };
    }
    throw err;
  }
}

async function updateGuestForClientAccount(clientAccountId, guestId, payload) {
  const firstName = String(payload && payload.firstName || '').trim().slice(0, 120);
  const familyName = String(payload && payload.familyName || '').trim().slice(0, 120);
  const email = normaliseOptionalEmail(payload && payload.email);
  const phone = String(payload && payload.phone || '').trim().slice(0, 60);

  if (!email) {
    return { error: 'A valid guest email is required.' };
  }

  try {
    const result = await pool.query(
      `
        UPDATE guest_relationships
        SET guest_email = $1,
            guest_phone = $2,
            guest_first_name = $3,
            guest_family_name = $4,
            last_seen_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE client_account_id = $5
          AND id = $6
        RETURNING id,
                  client_account_id,
                  guest_user_id,
                  guest_email,
                  guest_phone,
                  guest_first_name,
                  guest_family_name,
                  source_type,
                  source_id,
                  first_seen_at,
                  last_seen_at,
                  created_at,
                  updated_at
      `,
      [email, phone, firstName, familyName, clientAccountId, guestId]
    );

    if (!result.rows[0]) {
      return { error: 'Guest not found.' };
    }

    return { guest: result.rows[0] };
  } catch (err) {
    if (err && err.code === '23505') {
      return { error: 'A guest with this email and phone already exists.' };
    }
    throw err;
  }
}

async function deleteGuestForClientAccount(clientAccountId, guestId) {
  const result = await pool.query(
    `
      DELETE FROM guest_relationships
      WHERE client_account_id = $1
        AND id = $2
      RETURNING id
    `,
    [clientAccountId, guestId]
  );

  if (!result.rows[0]) {
    return { error: 'Guest not found.' };
  }

  return { deletedGuestId: Number(result.rows[0].id) };
}

async function upsertBookedInChangesForUser(userId, changes) {
  const payload = Array.isArray(changes) ? changes : [];
  if (!payload.length) {
    return { saved: 0 };
  }

  const listings = await getListingsForUser(userId);
  const listingById = new Map((listings || []).map((listing) => [Number(listing.id), listing]));
  const cleaners = await getCleanersForUser(userId);
  const cleanerById = new Map(
    (cleaners || [])
      .filter((cleaner) => Number.isInteger(Number(cleaner.id)) && Number(cleaner.id) > 0)
      .map((cleaner) => [Number(cleaner.id), cleaner])
  );
  const cleanerByUserId = new Map(
    (cleaners || [])
      .filter((cleaner) => Number.isInteger(Number(cleaner.cleaner_user_id)) && Number(cleaner.cleaner_user_id) > 0)
      .map((cleaner) => [Number(cleaner.cleaner_user_id), cleaner])
  );

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

    let cleanerUserId = normaliseCleanerId(entry.cleanerUserId);
    let linkedCleaner = null;

    if (cleanerUserId) {
      linkedCleaner = cleanerByUserId.get(cleanerUserId) || null;
      if (!linkedCleaner) {
        return;
      }
    } else {
      const legacyCleanerId = normaliseCleanerId(entry.cleanerId);
      if (legacyCleanerId) {
        const legacyCleaner = cleanerById.get(legacyCleanerId) || null;
        if (!legacyCleaner) {
          return;
        }
        const linkedUserId = Number(legacyCleaner.cleaner_user_id || 0);
        if (!Number.isInteger(linkedUserId) || linkedUserId <= 0) {
          return;
        }
        cleanerUserId = linkedUserId;
        linkedCleaner = legacyCleaner;
      }
    }

    const cleanerId = linkedCleaner ? Number(linkedCleaner.id) : null;

    const listing = listingById.get(listingId);
    normalised.push({
      listingId,
      propertyId: listing && listing.property_id ? Number(listing.property_id) : null,
      reservationCheckinDate,
      reservationCheckoutDate,
      changeoverDate,
      cleanerId,
      cleanerUserId
    });
  });

  if (!normalised.length) {
    return { saved: 0 };
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
          cleaner_id,
          cleaner_user_id
        )
        VALUES ($1, $2, $3, $4::date, $5::date, $6::date, $7, $8)
        ON CONFLICT (user_id, listing_id, reservation_checkin_date, reservation_checkout_date)
        DO UPDATE SET
          property_id = EXCLUDED.property_id,
          changeover_date = EXCLUDED.changeover_date,
          cleaner_id = EXCLUDED.cleaner_id,
          cleaner_user_id = EXCLUDED.cleaner_user_id,
          updated_at = CURRENT_TIMESTAMP
      `,
      [
        userId,
        entry.propertyId,
        entry.listingId,
        entry.reservationCheckinDate,
        entry.reservationCheckoutDate,
        entry.changeoverDate,
        entry.cleanerId,
        entry.cleanerUserId
      ]
    );
  }

  return { saved: normalised.length };
}

async function deleteBookedInChangesForUser(userId, changes) {
  const payload = Array.isArray(changes) ? changes : [];
  if (!payload.length) {
    return { deleted: 0 };
  }

  const keys = payload
    .map((entry) => ({
      listingId: Number(entry.listingId),
      reservationCheckinDate: normaliseDateKey(entry.reservationCheckinDate),
      reservationCheckoutDate: normaliseDateKey(entry.reservationCheckoutDate)
    }))
    .filter((entry) => Number.isInteger(entry.listingId) && entry.listingId > 0 && entry.reservationCheckinDate && entry.reservationCheckoutDate);

  if (!keys.length) {
    return { deleted: 0 };
  }

  

  let deleted = 0;
  for (const entry of keys) {
    const result = await pool.query(
      `
        DELETE FROM booked_in_changes
        WHERE user_id = $1
          AND listing_id = $2
          AND reservation_checkin_date = $3::date
          AND reservation_checkout_date = $4::date
      `,
      [userId, entry.listingId, entry.reservationCheckinDate, entry.reservationCheckoutDate]
    );
    deleted += Number(result.rowCount || 0);
  }
  return { deleted };
}

async function getFeedsForListing(listingId, userId) {
  

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
  
  const result = await pool.query(
    'SELECT DISTINCT listing_id AS id FROM calendar_feeds ORDER BY listing_id ASC'
  );
  return result.rows;
}

async function getFeedsForListingInternal(listingId) {
  
  const result = await pool.query(
    'SELECT id, listing_id, label, url FROM calendar_feeds WHERE listing_id = $1 ORDER BY id ASC',
    [listingId]
  );
  return result.rows;
}

async function storeFeedCache(listingId, feedId, label, events, errorText) {
  const eventsJson = JSON.stringify(events || []);
  const now = new Date().toISOString();
  
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
      headers: {
        Accept: 'text/calendar,text/plain,*/*',
        'User-Agent': 'Mozilla/5.0 (compatible; CalendarSync/1.0; +https://render.com)'
      }
    };
    const minimalOptions = {
      signal: controller.signal
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
        const upstreamResult = await fetchCalendarUrlSafely(candidateUrl, options);
        if (upstreamResult && upstreamResult.error) {
          lastStatus = null;
          lastPreview = String(upstreamResult.error);
          continue;
        }

        const upstream = upstreamResult;

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

app.use(express.json({
  limit: '5mb',
  verify: (req, _res, buf) => {
    if (req.originalUrl === '/api/stripe/webhook') {
      req.rawBody = buf.toString('utf8');
    }
  }
}));
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

async function getValidatedSessionUser(req) {
  if (!(req.session && req.session.userId)) {
    return null;
  }
  const user = await getUserById(req.session.userId);
  return user || null;
}

function requireAdminAuth(req, res, next) {
  if (!ADMIN_AUTH_CONFIGURED) {
    return res.status(503).json({ error: 'Admin authentication is not configured on the server.' });
  }
  if (req.session && req.session.isAdmin === true) {
    return next();
  }
  res.status(401).json({ error: 'Admin unauthorised' });
}

const ACCESS_ROLE_PRIORITY = {
  Guest: 1,
  Staff: 2,
  Manager: 3,
  Client: 4
};

function hasRequiredRole(currentRole, minimumRole) {
  const current = ACCESS_ROLE_PRIORITY[String(currentRole || '').trim()] || 0;
  const required = ACCESS_ROLE_PRIORITY[String(minimumRole || '').trim()] || 0;
  return current >= required;
}

async function getClientOwnerUserId(clientAccountId) {
  const id = Number(clientAccountId);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  

  const result = await pool.query(
    `
      SELECT user_id
      FROM client_memberships
      WHERE client_account_id = $1
        AND role = 'Client'
        AND status = 'active'
      ORDER BY id ASC
      LIMIT 1
    `,
    [id]
  );

  const ownerUserId = result.rows[0] ? Number(result.rows[0].user_id) : null;
  return Number.isInteger(ownerUserId) && ownerUserId > 0 ? ownerUserId : null;
}

async function getManagerAssignmentScopeForContext(clientAccountId, userId, activeRole) {
  let managerMembershipId = null;
  let assignmentScope = {
    hasAssignments: false,
    propertyIdSet: new Set(),
    listingIdSet: new Set()
  };

  if (String(activeRole || '') !== 'Manager') {
    return { managerMembershipId, assignmentScope };
  }

  const managerMembership = await pool.query(
    `
      SELECT id
      FROM client_memberships
      WHERE client_account_id = $1
        AND user_id = $2
        AND role = 'Manager'
        AND status = 'active'
      ORDER BY id ASC
      LIMIT 1
    `,
    [Number(clientAccountId), Number(userId)]
  );
  managerMembershipId = managerMembership.rows[0] ? Number(managerMembership.rows[0].id) : null;

  if (Number.isInteger(managerMembershipId) && managerMembershipId > 0) {
    const [propertyResult, listingResult] = await Promise.all([
      pool.query(
        'SELECT property_id FROM manager_property_assignments WHERE manager_membership_id = $1',
        [managerMembershipId]
      ),
      pool.query(
        'SELECT listing_id FROM manager_listing_assignments WHERE manager_membership_id = $1',
        [managerMembershipId]
      )
    ]);

    const propertyIdSet = new Set(
      propertyResult.rows
        .map((row) => Number(row.property_id))
        .filter((id) => Number.isInteger(id) && id > 0)
    );
    const listingIdSet = new Set(
      listingResult.rows
        .map((row) => Number(row.listing_id))
        .filter((id) => Number.isInteger(id) && id > 0)
    );

    assignmentScope = {
      hasAssignments: propertyIdSet.size > 0 || listingIdSet.size > 0,
      propertyIdSet,
      listingIdSet
    };
  }

  return { managerMembershipId, assignmentScope };
}

async function resolveAccessContextForUser(userId, requestedClientAccountId, minimumRole) {
  const context = await getOrCreateAccessContextForUser(userId, requestedClientAccountId);
  const active = context.active || null;
  if (!active) {
    return { errorStatus: 403, error: 'No active client access context found.' };
  }

  if (minimumRole && !hasRequiredRole(active.role, minimumRole)) {
    return { errorStatus: 403, error: 'Insufficient role for this action.' };
  }

  const ownerUserId = await getClientOwnerUserId(active.client_account_id);
  const scopeState = await getManagerAssignmentScopeForContext(active.client_account_id, userId, active.role);

  return {
    accessContext: {
      activeClientAccountId: Number(active.client_account_id),
      activeRole: String(active.role || ''),
      effectiveOwnerUserId: ownerUserId || Number(userId),
      managerMembershipId: scopeState.managerMembershipId,
      assignmentScope: scopeState.assignmentScope
    },
    memberships: context.memberships || []
  };
}

function requireScopedRole(minimumRole) {
  return async (req, res, next) => {
    if (!(req.session && req.session.userId)) {
      return res.status(401).json({ error: 'Unauthorised' });
    }

    try {
      const resolved = await resolveAccessContextForUser(req.session.userId, req.session.activeClientAccountId, minimumRole);
      if (resolved.errorStatus) {
        return res.status(resolved.errorStatus).json({ error: resolved.error });
      }

      req.accessContext = resolved.accessContext;
      req.session.activeClientAccountId = Number(resolved.accessContext.activeClientAccountId);

      return next();
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to resolve access context.' });
    }
  };
}

app.use('/api', async (req, res, next) => {
  if (!(req.session && req.session.userId)) {
    return next();
  }
  if (req.session.isAdmin === true) {
    return next();
  }

  const pathValue = String(req.path || '');
  if (pathValue.startsWith('/admin/')) {
    return next();
  }

  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }

  if (pathValue === '/logout' || pathValue === '/account/validation-email/resend') {
    return next();
  }
  if (pathValue.startsWith('/public/')) {
    return next();
  }

  try {
    const user = await getValidatedSessionUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorised' });
    }
    if (user.is_validated === false) {
      return res.status(403).json({
        code: 'ACCOUNT_NOT_VALIDATED',
        error: 'Your account must be validated by email before you can change configuration.'
      });
    }
    return next();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to validate user status.' });
  }
});

function hasManagerAssignmentScope(req) {
  return Boolean(
    req
    && req.accessContext
    && req.accessContext.activeRole === 'Manager'
    && req.accessContext.assignmentScope
    && req.accessContext.assignmentScope.hasAssignments === true
  );
}

function isPropertyAllowedByScope(req, propertyId) {
  if (!hasManagerAssignmentScope(req)) {
    return true;
  }
  const id = Number(propertyId);
  return Number.isInteger(id) && id > 0 && req.accessContext.assignmentScope.propertyIdSet.has(id);
}

function isListingAllowedByScope(req, listing) {
  if (!hasManagerAssignmentScope(req)) {
    return true;
  }

  const listingId = Number(listing && listing.id);
  if (Number.isInteger(listingId) && listingId > 0 && req.accessContext.assignmentScope.listingIdSet.has(listingId)) {
    return true;
  }

  const propertyId = Number(listing && listing.property_id);
  if (Number.isInteger(propertyId) && propertyId > 0 && req.accessContext.assignmentScope.propertyIdSet.has(propertyId)) {
    return true;
  }

  return false;
}

function isSharedResourceAllowedByScope(req, resource) {
  if (!hasManagerAssignmentScope(req)) {
    return true;
  }

  const listingId = Number(resource && resource.listing_id);
  if (Number.isInteger(listingId) && listingId > 0 && req.accessContext.assignmentScope.listingIdSet.has(listingId)) {
    return true;
  }

  const propertyId = Number(resource && resource.property_id);
  if (Number.isInteger(propertyId) && propertyId > 0 && req.accessContext.assignmentScope.propertyIdSet.has(propertyId)) {
    return true;
  }

  return false;
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

function getRequestBaseUrl(req) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.get('host') || '').split(',')[0].trim();
  if (!host || /[\s\/\\]/.test(host)) {
    return null;
  }
  return proto + '://' + host;
}

function formatStripeConnectStatus(user) {
  return {
    stripeAccountId: user && user.stripe_account_id ? String(user.stripe_account_id) : '',
    onboardingComplete: Boolean(user && user.stripe_onboarding_complete === true),
    chargesEnabled: Boolean(user && user.stripe_charges_enabled === true),
    payoutsEnabled: Boolean(user && user.stripe_payouts_enabled === true)
  };
}

const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' }
});

const adminLoginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin login attempts. Please try again later.' }
});

const validationEmailResendRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many validation email requests. Please try again later.' }
});

const passwordResetRequestRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset requests. Please try again later.' }
});

// ── Routes ───────────────────────────────────────────────────────────────────

// POST /api/signup
app.post('/api/signup', async (req, res) => {
  const firstName = String(req.body.firstName || '').trim();
  const familyName = String(req.body.familyName || '').trim();
  const country = normaliseCountryOfResidence(req.body.country);
  const email = String(req.body.email || '').trim();
  const password = String(req.body.password || '');

  if (!firstName || !familyName || !country || !email || !password) {
    return res.status(400).json({ error: 'First name, family name, country, email, and password are required.' });
  }

  const passwordCheck = validateStrongPassword(password);
  if (!passwordCheck.ok) {
    return res.status(400).json({ error: passwordCheck.error });
  }

  // Basic email format check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  try {
    const normalisedEmail = email.trim().toLowerCase();
    const normalisedCountry = normaliseCountryOfResidence(country);

    if (await findUserByEmail(normalisedEmail)) {
      return res.status(409).json({ error: 'Email address already in use.' });
    }

    const normalisedUsername = await generateUniqueUsernameFromEmail(normalisedEmail);
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const createdUser = await createUser(normalisedUsername, normalisedEmail, passwordHash, {
      firstName,
      familyName,
      country: normalisedCountry,
      isValidated: false
    });

    const validationEmailResult = await sendSiteUserValidationEmail(req, createdUser);
    if (!validationEmailResult.ok) {
      return res.status(201).json({
        message: 'Account created, but validation email could not be sent automatically. Please contact support to validate your account.',
        validationEmailSent: false
      });
    }

    return res.status(201).json({
      message: 'Account created. Please check your email and click the validation link before logging in.',
      validationEmailSent: true
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// POST /api/login
app.post('/api/login', loginRateLimiter, async (req, res) => {
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

    let authenticatedUser = user;

    if (authenticatedUser.is_validated === false) {
      if (!ENABLE_INVITE_AUTO_VALIDATION) {
        return res.status(403).json({
          code: 'ACCOUNT_NOT_VALIDATED',
          error: 'Your account is not validated yet. Please click the validation link sent to your email before logging in.'
        });
      }

      const isInvitedClientUser = await hasPendingClientInviteForUser(authenticatedUser.id);
      if (!isInvitedClientUser) {
        return res.status(403).json({
          code: 'ACCOUNT_NOT_VALIDATED',
          error: 'Your account is not validated yet. Please click the validation link sent to your email before logging in.'
        });
      }

      const nowValidated = await markUserValidated(authenticatedUser.id);
      if (nowValidated) {
        authenticatedUser = nowValidated;
      }
    }

    // Regenerate session on login to prevent session fixation
    req.session.regenerate((err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error. Please try again.' });
      }
      req.session.userId = authenticatedUser.id;
      req.session.email = authenticatedUser.email;
      return res.json({ message: 'Login successful.' });
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// POST /api/admin/login
app.post('/api/admin/login', adminLoginRateLimiter, (req, res) => {
  if (!ADMIN_AUTH_CONFIGURED) {
    return res.status(503).json({ error: 'Admin authentication is not configured on the server.' });
  }

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
  if (!ADMIN_AUTH_CONFIGURED) {
    return res.status(503).json({ error: 'Admin authentication is not configured on the server.' });
  }

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

// GET /api/admin/site-users
app.get('/api/admin/site-users', requireAdminAuth, async (req, res) => {
  try {
    const users = await getAllSiteUsersWithMemberships();
    return res.json({ users });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load site users.' });
  }
});

// GET /api/admin/site-users/:userId
app.get('/api/admin/site-users/:userId', requireAdminAuth, async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid user id.' });
  }

  try {
    const user = await getSiteUserForAdmin(userId);
    if (!user) {
      return res.status(404).json({ error: 'Site user not found.' });
    }
    return res.json({ user });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load site user.' });
  }
});

// PUT /api/admin/site-users/:userId
app.put('/api/admin/site-users/:userId', requireAdminAuth, async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid user id.' });
  }

  try {
    const result = await updateSiteUserForAdmin(userId, req.body || {});
    if (result.error === 'User not found.') {
      return res.status(404).json({ error: result.error });
    }
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    return res.json({
      message: 'Site user updated.',
      user: result.user
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update site user.' });
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

// GET /api/admin/email/test/config
app.get('/api/admin/email/test/config', requireAdminAuth, (req, res) => {
  return res.json({
    from: POSTMARK_FROM,
    configured: Boolean(POSTMARK_SERVER_TOKEN && POSTMARK_FROM),
    messageStream: POSTMARK_MESSAGE_STREAM
  });
});

// POST /api/admin/email/test/send
app.post('/api/admin/email/test/send', requireAdminAuth, async (req, res) => {
  if (!POSTMARK_SERVER_TOKEN) {
    return res.status(500).json({ error: 'POSTMARK_SERVER_TOKEN is not configured on the server.' });
  }

  const to = String(req.body.to || '').trim();
  const subject = String(req.body.subject || '').trim();
  const body = String(req.body.body || '').trim();
  const from = String(req.body.from || POSTMARK_FROM).trim().toLowerCase();

  if (!isValidEmailAddress(to)) {
    return res.status(400).json({ error: 'Enter a valid To email address.' });
  }
  if (!subject) {
    return res.status(400).json({ error: 'Subject is required.' });
  }
  if (!body) {
    return res.status(400).json({ error: 'Body is required.' });
  }
  if (!from || !isValidEmailAddress(from) || !from.endsWith('@automaticpeople.com')) {
    return res.status(400).json({ error: 'From must be a valid @automaticpeople.com email address.' });
  }

  try {
    const postmarkRes = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': POSTMARK_SERVER_TOKEN
      },
      body: JSON.stringify({
        From: from,
        To: to,
        Subject: subject,
        TextBody: body,
        MessageStream: POSTMARK_MESSAGE_STREAM
      })
    });

    const result = await postmarkRes.json().catch(() => ({}));
    if (!postmarkRes.ok) {
      return res.status(502).json({ error: getPostmarkErrorMessage(result, postmarkRes.status) });
    }

    return res.json({
      ok: true,
      message: 'Test email sent successfully.',
      messageId: result && result.MessageID ? String(result.MessageID) : ''
    });
  } catch (err) {
    console.error('Postmark test email failed:', err);
    return res.status(500).json({ error: 'Failed to send test email.' });
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

// GET /api/access/context — memberships and active client context for current user
app.get('/api/access/context', requireAuth, async (req, res) => {
  try {
    const context = await getOrCreateAccessContextForUser(req.session.userId, req.session.activeClientAccountId);
    const active = context.active || null;
    if (active) {
      req.session.activeClientAccountId = Number(active.client_account_id);
    }

    return res.json({
      activeClientAccountId: active ? Number(active.client_account_id) : null,
      activeRole: active ? String(active.role || '') : '',
      memberships: context.memberships || []
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load access context.' });
  }
});

// POST /api/access/context/switch — manual switching removed (automatic hierarchy applies)
app.post('/api/access/context/switch', requireAuth, async (req, res) => {
  return res.status(410).json({ error: 'Manual access context switching is disabled. Access is selected automatically by role hierarchy.' });
});

// GET /api/access/team — list team memberships for the active client account
app.get('/api/access/team', requireScopedRole('Manager'), async (req, res) => {
  try {
    const team = await getTeamMembershipsForClientAccount(req.accessContext.activeClientAccountId);
    return res.json({ team });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load client team.' });
  }
});

// POST /api/access/team — add Manager/Staff membership to active client account
app.post('/api/access/team', requireScopedRole('Client'), async (req, res) => {
  const firstName = String(req.body.firstName || '').trim();
  const familyName = String(req.body.familyName || '').trim();
  const country = normaliseCountryOfResidence(req.body.country);
  const email = String(req.body.email || '').trim();
  const password = String(req.body.password || '');
  const roles = normaliseClientTeamRoles(req.body.roles);
  const confirmExisting = req.body.confirmExisting === true;

  if (!firstName || !familyName || !country || !email || !password) {
    return res.status(400).json({ error: 'First name, family name, country, email, and password are required.' });
  }
  if (!roles.length) {
    return res.status(400).json({ error: 'Select at least one role (Manager and/or Staff).' });
  }

  const passwordCheck = validateStrongPassword(password);
  if (!passwordCheck.ok) {
    return res.status(400).json({ error: passwordCheck.error });
  }

  try {
    const normalizedEmail = normaliseOptionalEmail(email);
    if (!normalizedEmail) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }

    let siteUser = await getUserByEmailStrict(normalizedEmail);

    if (siteUser && !confirmExisting) {
      return res.status(409).json({
        code: 'EXISTING_USER_CONFIRMATION_REQUIRED',
        error: 'Site user already exists, send invitation?'
      });
    }

    if (!siteUser) {
      const created = await createUnvalidatedSiteUserForInvite({
        firstName,
        familyName,
        country,
        email: normalizedEmail,
        password
      });
      if (created.error) {
        return res.status(400).json({ error: created.error });
      }
      siteUser = created.user;
    } else {
      await updateUserInviteProfileIfMissing(siteUser.id, {
        firstName,
        familyName,
        country
      });
    }

    const result = await setClientTeamRolesForUser(
      req.accessContext.activeClientAccountId,
      req.session.userId,
      siteUser.id,
      roles
    );
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    return res.status(201).json({
      invited: true,
      existingUser: Boolean(confirmExisting),
      user: result.user,
      memberships: result.memberships
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to invite team member.' });
  }
});

// PUT /api/access/team/:userId — update Manager/Staff roles for a site user in active client account
app.put('/api/access/team/:userId', requireScopedRole('Client'), async (req, res) => {
  const userId = Number(req.params.userId);
  const roles = normaliseClientTeamRoles(req.body.roles);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid user id.' });
  }

  try {
    const result = await setClientTeamRolesForUser(
      req.accessContext.activeClientAccountId,
      req.session.userId,
      userId,
      roles
    );
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update team member roles.' });
  }
});

// DELETE /api/access/team/:userId — remove site user from current client team and delete site user if no memberships remain
app.delete('/api/access/team/:userId', requireScopedRole('Client'), async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid user id.' });
  }

  if (Number(req.session.userId) === userId) {
    return res.status(400).json({ error: 'You cannot delete your own account from the team.' });
  }

  try {
    const result = await removeTeamMemberFromClientScope(
      req.accessContext.activeClientAccountId,
      userId
    );
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete team member.' });
  }
});

// GET /api/access/team/:userId/delete-impact — preview whether deletion is scope-only or site-wide
app.get('/api/access/team/:userId/delete-impact', requireScopedRole('Client'), async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid user id.' });
  }

  if (Number(req.session.userId) === userId) {
    return res.status(400).json({ error: 'You cannot delete your own account from the team.' });
  }

  try {
    const impact = await getTeamMemberRemovalImpact(
      req.accessContext.activeClientAccountId,
      userId
    );
    if (impact.error) {
      return res.status(400).json({ error: impact.error });
    }
    return res.json(impact);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load delete impact.' });
  }
});

// GET /api/access/manager-assignments — snapshot manager assignments in active client account
app.get('/api/access/manager-assignments', requireScopedRole('Manager'), async (req, res) => {
  try {
    const snapshot = await getManagerAssignmentSnapshot(req.accessContext.activeClientAccountId);
    return res.json(snapshot);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load manager assignments.' });
  }
});

// PUT /api/access/manager-assignments/:managerMembershipId — set manager property/listing scope
app.put('/api/access/manager-assignments/:managerMembershipId', requireScopedRole('Manager'), async (req, res) => {
  const managerMembershipId = Number(req.params.managerMembershipId);
  if (!Number.isInteger(managerMembershipId) || managerMembershipId <= 0) {
    return res.status(400).json({ error: 'Invalid manager membership id.' });
  }

  try {
    const result = await replaceManagerAssignments(
      req.accessContext.activeClientAccountId,
      managerMembershipId,
      req.body.propertyIds,
      req.body.listingIds
    );
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    return res.json({ assignment: result });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update manager assignments.' });
  }
});

// GET /api/access/guests — list guests for the active client account
app.get('/api/access/guests', requireScopedRole('Manager'), async (req, res) => {
  try {
    const guests = await getGuestsForClientAccount(req.accessContext.activeClientAccountId);
    return res.json({ guests });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load guest relationships.' });
  }
});

// GET /api/me — return current user info (requires auth)
app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const user = await getUserById(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorised' });
    }

    const context = await getOrCreateAccessContextForUser(req.session.userId, req.session.activeClientAccountId);
    const active = context.active || null;
    if (active) {
      req.session.activeClientAccountId = Number(active.client_account_id);
    }

    return res.json({
      firstName: user.first_name || '',
      familyName: user.family_name || '',
      email: user.email || req.session.email,
      isValidated: user.is_validated !== false,
      consolidated_ics_token: buildConsolidatedIcsToken(req.session.userId),
      stripeConnect: formatStripeConnectStatus(user),
      accessContext: {
        activeClientAccountId: active ? Number(active.client_account_id) : null,
        activeRole: active ? String(active.role || '') : '',
        memberships: context.memberships || []
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load current user profile.' });
  }
});

// GET /api/account/validate — mark account as validated via signed email link token
app.get('/api/account/validate', async (req, res) => {
  const token = String(req.query && req.query.token || '').trim();
  if (!token) {
    return res.status(400).json({ error: 'Validation token is required.' });
  }

  try {
    const validatedToken = await validateAccountValidationToken(token);
    if (validatedToken.error) {
      return res.status(400).json({ error: validatedToken.error });
    }

    const user = validatedToken.user;
    if (!user) {
      return res.status(400).json({ error: 'Validation link is invalid.' });
    }

    if (user.is_validated === true) {
      return res.json({
        validated: true,
        alreadyValidated: true,
        message: 'Your account is already validated. You can now log in.'
      });
    }

    await markUserValidated(user.id);
    return res.json({
      validated: true,
      alreadyValidated: false,
      message: 'Your account is now validated. You can now log in.'
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to validate account.' });
  }
});

// POST /api/account/validation-email/resend — resend validation link for logged-in unvalidated user
app.post('/api/account/validation-email/resend', validationEmailResendRateLimiter, requireAuth, async (req, res) => {
  try {
    const user = await getUserById(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorised' });
    }
    if (user.is_validated === true) {
      return res.json({ message: 'Your account is already validated.' });
    }

    const sendResult = await sendSiteUserValidationEmail(req, user);
    if (!sendResult.ok) {
      return res.status(503).json({ error: sendResult.error || 'Failed to resend validation email.' });
    }

    return res.json({ message: 'Validation email sent. Please check your inbox.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to resend validation email.' });
  }
});

// POST /api/account/password-reset/request — request a password reset link by email
app.post('/api/account/password-reset/request', passwordResetRequestRateLimiter, async (req, res) => {
  const email = String(req.body && req.body.email || '').trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  try {
    const user = await findUserByEmail(email);
    if (user && user.email) {
      await sendPasswordResetEmail(req, user);
    }

    return res.json({
      message: 'If an account exists for that email, a password reset link has been sent.'
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to process password reset request.' });
  }
});

// POST /api/account/password-reset/confirm — set a new password with a valid reset token
app.post('/api/account/password-reset/confirm', async (req, res) => {
  const token = String(req.body && req.body.token || '').trim();
  const password = String(req.body && req.body.password || '');

  if (!token || !password) {
    return res.status(400).json({ error: 'Reset token and new password are required.' });
  }

  const passwordCheck = validateStrongPassword(password);
  if (!passwordCheck.ok) {
    return res.status(400).json({ error: passwordCheck.error });
  }

  try {
    const validatedToken = await validatePasswordResetToken(token);
    if (validatedToken.error) {
      return res.status(400).json({ error: validatedToken.error });
    }

    const user = validatedToken.user;
    if (!user || !Number.isInteger(Number(user.id))) {
      return res.status(400).json({ error: 'Password reset link is invalid.' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    await pool.query(
      `
        UPDATE users
        SET password_hash = $1
        WHERE id = $2
      `,
      [passwordHash, Number(user.id)]
    );

    return res.json({ message: 'Your password has been reset. You can now log in.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to reset password.' });
  }
});

// GET /api/stripe/connect/status — current host Stripe Connect state
app.get('/api/stripe/connect/status', requireAuth, async (req, res) => {
  if (!stripeClient) {
    return res.status(503).json({ error: 'Stripe is not configured on the server.' });
  }

  try {
    const user = await getUserById(req.session.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (!user.stripe_account_id) {
      return res.json({ stripeConnect: formatStripeConnectStatus(user) });
    }

    const stripeAccount = await stripeClient.accounts.retrieve(String(user.stripe_account_id));
    const updated = await setUserStripeConnectState(req.session.userId, {
      stripe_account_id: stripeAccount.id,
      stripe_onboarding_complete: stripeAccount.details_submitted === true,
      stripe_charges_enabled: stripeAccount.charges_enabled === true,
      stripe_payouts_enabled: stripeAccount.payouts_enabled === true
    });

    return res.json({ stripeConnect: formatStripeConnectStatus(updated || user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load Stripe Connect status.' });
  }
});

// POST /api/stripe/connect/start — create/reuse connected account and return onboarding URL
app.post('/api/stripe/connect/start', requireAuth, async (req, res) => {
  if (!stripeClient) {
    return res.status(503).json({ error: 'Stripe is not configured on the server.' });
  }

  try {
    const user = await getUserById(req.session.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    let stripeAccountId = user.stripe_account_id ? String(user.stripe_account_id).trim() : '';

    if (!stripeAccountId) {
      const account = await stripeClient.accounts.create({
        type: 'express',
        country: STRIPE_CONNECT_DEFAULT_COUNTRY || 'GB',
        email: user.email,
        metadata: {
          app_user_id: String(user.id)
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true }
        }
      });
      stripeAccountId = account.id;

      await setUserStripeConnectState(req.session.userId, {
        stripe_account_id: stripeAccountId,
        stripe_onboarding_complete: account.details_submitted === true,
        stripe_charges_enabled: account.charges_enabled === true,
        stripe_payouts_enabled: account.payouts_enabled === true
      });
    }

    const baseUrl = getPreferredAppBaseUrl(req);
    if (!baseUrl) {
      return res.status(400).json({ error: 'Unable to determine application URL for Stripe onboarding.' });
    }

    const accountLink = await stripeClient.accountLinks.create({
      account: stripeAccountId,
      type: 'account_onboarding',
      refresh_url: baseUrl + '/dashboard.html?stripeConnect=refresh',
      return_url: baseUrl + '/dashboard.html?stripeConnect=return'
    });

    return res.json({
      onboardingUrl: accountLink.url,
      stripeAccountId
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to start Stripe Connect onboarding.' });
  }
});

// POST /api/stripe/webhook — Stripe event receiver for payment intent lifecycle
app.post('/api/stripe/webhook', async (req, res) => {
  if (!stripeClient || !STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Stripe webhook is not configured.' });
  }

  const signature = req.headers['stripe-signature'];
  if (!signature || !req.rawBody) {
    return res.status(400).json({ error: 'Missing Stripe signature or raw payload.' });
  }

  let event;
  try {
    event = stripeClient.webhooks.constructEvent(req.rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err && err.message ? err.message : err);
    return res.status(400).json({ error: 'Invalid Stripe webhook signature.' });
  }

  try {
    if (event.type && event.type.startsWith('payment_intent.')) {
      const paymentIntent = event.data && event.data.object ? event.data.object : null;
      const paymentIntentId = paymentIntent && paymentIntent.id ? String(paymentIntent.id) : '';
      if (paymentIntentId) {
        const reservation = await getSharedResourceReservationByPaymentIntentId(paymentIntentId);
        if (reservation) {
          const commonUpdate = {
            paymentProvider: 'stripe',
            paymentIntentId,
            paymentStatus: String(paymentIntent.status || '').toLowerCase(),
            paymentCurrency: String(paymentIntent.currency || 'gbp').toLowerCase(),
            paymentAmountMinor: Number.isInteger(paymentIntent.amount_received)
              ? paymentIntent.amount_received
              : (Number.isInteger(paymentIntent.amount) ? paymentIntent.amount : null),
            paymentLastError: paymentIntent.last_payment_error && paymentIntent.last_payment_error.message
              ? String(paymentIntent.last_payment_error.message)
              : ''
          };

          if (event.type === 'payment_intent.succeeded') {
            await updateSharedResourceReservationPaymentById(reservation.id, {
              ...commonUpdate,
              paidAt: new Date().toISOString(),
              status: 'Confirmed'
            });
          } else if (event.type === 'payment_intent.payment_failed') {
            await updateSharedResourceReservationPaymentById(reservation.id, {
              ...commonUpdate,
              status: 'Awaiting Online Confirmation'
            });
          } else if (event.type === 'payment_intent.canceled') {
            await updateSharedResourceReservationPaymentById(reservation.id, {
              ...commonUpdate,
              status: 'Declined'
            });
          } else {
            await updateSharedResourceReservationPaymentById(reservation.id, commonUpdate);
          }
        }
      }
    }

    return res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook handling failed:', err);
    return res.status(500).json({ error: 'Failed to process webhook event.' });
  }
});

// GET /api/cleaners — all cleaners for current user
app.get('/api/cleaners', requireScopedRole('Manager'), async (req, res) => {
  try {
    const cleaners = await getCleanersForUser(req.accessContext.effectiveOwnerUserId);
    return res.json({ cleaners });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load cleaners.' });
  }
});

// POST /api/cleaners — create cleaner for current user
app.post('/api/cleaners', requireScopedRole('Manager'), async (req, res) => {
  try {
    const { cleaner, error } = await createCleanerForUser(req.accessContext.effectiveOwnerUserId, {
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
app.put('/api/cleaners/:cleanerId', requireScopedRole('Manager'), async (req, res) => {
  const cleanerId = Number(req.params.cleanerId);
  if (!Number.isInteger(cleanerId) || cleanerId <= 0) {
    return res.status(400).json({ error: 'Invalid cleaner id.' });
  }

  try {
    const { cleaner, error } = await updateCleanerForUser(cleanerId, req.accessContext.effectiveOwnerUserId, {
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
app.post('/api/booked-in-changes/lookup', requireScopedRole('Staff'), async (req, res) => {
  let listingIds = Array.isArray(req.body.listingIds) ? req.body.listingIds : [];
  if (hasManagerAssignmentScope(req)) {
    listingIds = listingIds
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0 && req.accessContext.assignmentScope.listingIdSet.has(value));
  }

  try {
    const changes = await getBookedInChangesForUserByListings(req.accessContext.effectiveOwnerUserId, listingIds);
    return res.json({ changes });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load booked-in changes.' });
  }
});

// POST /api/booked-in-changes/upsert — persist changeover overrides for reservations
app.post('/api/booked-in-changes/upsert', requireScopedRole('Manager'), async (req, res) => {
  let changes = Array.isArray(req.body.changes) ? req.body.changes : [];
  if (hasManagerAssignmentScope(req)) {
    changes = changes.filter((entry) => {
      const listingId = Number(entry && entry.listingId);
      return Number.isInteger(listingId) && listingId > 0 && req.accessContext.assignmentScope.listingIdSet.has(listingId);
    });
  }

  try {
    const result = await upsertBookedInChangesForUser(req.accessContext.effectiveOwnerUserId, changes);
    return res.json({ saved: result.saved });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to save booked-in changes.' });
  }
});

// POST /api/booked-in-changes/delete — delete booked-in changes by reservation keys
app.post('/api/booked-in-changes/delete', requireScopedRole('Manager'), async (req, res) => {
  let changes = Array.isArray(req.body.changes) ? req.body.changes : [];
  if (hasManagerAssignmentScope(req)) {
    changes = changes.filter((entry) => {
      const listingId = Number(entry && entry.listingId);
      return Number.isInteger(listingId) && listingId > 0 && req.accessContext.assignmentScope.listingIdSet.has(listingId);
    });
  }

  try {
    const result = await deleteBookedInChangesForUser(req.accessContext.effectiveOwnerUserId, changes);
    return res.json({ deleted: result.deleted });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete booked-in changes.' });
  }
});

// POST /api/schedules/email — email txt schedule to a recipient
app.post('/api/schedules/email', requireScopedRole('Staff'), async (req, res) => {
  const to = normaliseOptionalEmail(req.body.email);
  const textContent = String(req.body.textContent || '');
  const subject = String(req.body.subject || 'Cleaning schedule').trim().slice(0, 160) || 'Cleaning schedule';
  const rawFileName = String(req.body.fileName || 'schedule.txt').trim();
  const safeFileName = rawFileName.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'schedule.txt';

  if (!to) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }

  if (!textContent.trim()) {
    return res.status(400).json({ error: 'Schedule text is required.' });
  }

  const transportResult = getScheduleEmailTransporter();
  if (transportResult.error) {
    return res.status(503).json({ error: transportResult.error });
  }

  try {
    await transportResult.transporter.sendMail({
      from: transportResult.from,
      to,
      subject,
      text: textContent,
      attachments: [
        {
          filename: safeFileName.toLowerCase().endsWith('.txt') ? safeFileName : (safeFileName + '.txt'),
          content: textContent,
          contentType: 'text/plain; charset=utf-8'
        }
      ]
    });
    return res.json({ message: 'Schedule email sent.' });
  } catch (err) {
    console.error('Failed to send schedule email:', err);
    return res.status(500).json({ error: 'Failed to send schedule email.' });
  }
});

// GET /api/shared-resources — all shared resources for current user
app.get('/api/shared-resources', requireScopedRole('Staff'), async (req, res) => {
  try {
    let resources = await getSharedResourcesForUser(req.accessContext.effectiveOwnerUserId);
    if (hasManagerAssignmentScope(req)) {
      resources = resources.filter((resource) => isSharedResourceAllowedByScope(req, resource));
    }
    return res.json({ resources });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load shared resources.' });
  }
});

// GET /api/shared-resources/all-reservations — consolidated reservations across all shared resources
app.get('/api/shared-resources/all-reservations', requireScopedRole('Staff'), async (req, res) => {
  try {
    let resources = await getSharedResourcesForUser(req.accessContext.effectiveOwnerUserId);
    if (hasManagerAssignmentScope(req)) {
      resources = resources.filter((resource) => isSharedResourceAllowedByScope(req, resource));
    }

    const reservationsArrays = await Promise.all(
      resources.map(async (resource) => {
        const rows = await getSharedResourceReservationsByResourceId(resource.id);
        return rows.map((row) => ({
          ...row,
          resource_short_description: resource.short_description || ''
        }));
      })
    );

    const reservations = reservationsArrays
      .flat()
      .sort((a, b) => new Date(a.requested_start_at).getTime() - new Date(b.requested_start_at).getTime());

    return res.json({ reservations });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load all reservations.' });
  }
});

// POST /api/shared-resources — create shared resource with short description
app.post('/api/shared-resources', requireScopedRole('Manager'), async (req, res) => {
  try {
    if (hasManagerAssignmentScope(req)) {
      const scopedPropertyId = Number(req.body.propertyId);
      const scopedListingId = Number(req.body.listingId);

      if (Number.isInteger(scopedListingId) && scopedListingId > 0) {
        const listing = await getListingByIdForUser(scopedListingId, req.accessContext.effectiveOwnerUserId);
        if (!listing || !isListingAllowedByScope(req, listing)) {
          return res.status(403).json({ error: 'You are not allowed to create facilities for this listing.' });
        }
      }

      if (Number.isInteger(scopedPropertyId) && scopedPropertyId > 0) {
        if (!isPropertyAllowedByScope(req, scopedPropertyId)) {
          return res.status(403).json({ error: 'You are not allowed to create facilities for this property.' });
        }
      }

      if ((!Number.isInteger(scopedPropertyId) || scopedPropertyId <= 0)
        && (!Number.isInteger(scopedListingId) || scopedListingId <= 0)) {
        return res.status(403).json({ error: 'Please select an assigned property or listing when creating a facility.' });
      }
    }

    const { resource, error } = await createSharedResourceForUser(
      req.accessContext.effectiveOwnerUserId,
      req.accessContext.activeClientAccountId,
      {
      shortDescription: req.body.shortDescription,
      fullDescriptionHtml: req.body.fullDescriptionHtml,
      maxUnits: req.body.maxUnits,
      maxDaysAdvanceBooking: req.body.maxDaysAdvanceBooking,
      propertyId: req.body.propertyId,
      listingId: req.body.listingId,
      resourceType: req.body.resourceType,
      freeOfCharge: req.body.freeOfCharge,
      cashOnSite: req.body.cashOnSite,
      bankTransfer: req.body.bankTransfer,
      onlinePayment: req.body.onlinePayment,
      freeOfChargeMessageHtml: req.body.freeOfChargeMessageHtml,
      cashOnSiteMessageHtml: req.body.cashOnSiteMessageHtml,
      bankTransferMessageHtml: req.body.bankTransferMessageHtml,
      onlinePaymentMessageHtml: req.body.onlinePaymentMessageHtml,
      chargeBasis: req.body.chargeBasis,
      dailyChargeMode: req.body.dailyChargeMode,
      dailyRate: req.body.dailyRate,
      hourlyChargeMode: req.body.hourlyChargeMode,
      hourlyRate: req.body.hourlyRate,
      hourlyRates: req.body.hourlyRates
    });
    if (error) {
      const status = error === 'Client account context is required.' ? 400 : 400;
      return res.status(status).json({ error });
    }
    return res.status(201).json({ resource });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create shared resource.' });
  }
});

// GET /api/shared-resources/:resourceId — one shared resource for current user
app.get('/api/shared-resources/:resourceId', requireScopedRole('Staff'), async (req, res) => {
  const resourceId = Number(req.params.resourceId);
  if (!Number.isInteger(resourceId) || resourceId <= 0) {
    return res.status(400).json({ error: 'Invalid shared resource id.' });
  }

  try {
    const resource = await getSharedResourceByIdForUser(resourceId, req.accessContext.effectiveOwnerUserId);
    if (!resource) {
      return res.status(404).json({ error: 'Shared resource not found.' });
    }
    if (!isSharedResourceAllowedByScope(req, resource)) {
      return res.status(404).json({ error: 'Shared resource not found.' });
    }
    return res.json({ resource });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load shared resource.' });
  }
});

// GET /api/public/shared-resources/:resourceId — public view of one shared resource
app.get('/api/public/shared-resources/:resourceId', async (req, res) => {
  const resourceId = Number(req.params.resourceId);
  if (!Number.isInteger(resourceId) || resourceId <= 0) {
    return res.status(400).json({ error: 'Invalid shared resource id.' });
  }

  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  try {
    const resource = await getSharedResourceByIdPublic(resourceId);
    if (!resource) {
      return res.status(404).json({ error: 'Shared resource not found.' });
    }
    const { user_id: _ignoreUserId, ...publicResource } = resource;
    return res.json({ resource: publicResource });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load shared resource.' });
  }
});

// GET /api/public/shared-resources/:resourceId/reservations — public reservation list for one shared resource
app.get('/api/public/shared-resources/:resourceId/reservations', async (req, res) => {
  const resourceId = Number(req.params.resourceId);
  if (!Number.isInteger(resourceId) || resourceId <= 0) {
    return res.status(400).json({ error: 'Invalid shared resource id.' });
  }

  try {
    const resource = await getSharedResourceByIdPublic(resourceId);
    if (!resource) {
      return res.status(404).json({ error: 'Shared resource not found.' });
    }
    const reservations = await getSharedResourceReservationsByResourceId(resourceId);
    return res.json({ reservations });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load shared resource reservations.' });
  }
});

// GET /api/shared-resources/:resourceId/reservations — authenticated reservation list
app.get('/api/shared-resources/:resourceId/reservations', requireScopedRole('Staff'), async (req, res) => {
  const resourceId = Number(req.params.resourceId);
  if (!Number.isInteger(resourceId) || resourceId <= 0) {
    return res.status(400).json({ error: 'Invalid shared resource id.' });
  }

  try {
    const resource = await getSharedResourceByIdForUser(resourceId, req.accessContext.effectiveOwnerUserId);
    if (!resource) {
      return res.status(404).json({ error: 'Shared resource not found.' });
    }
    if (!isSharedResourceAllowedByScope(req, resource)) {
      return res.status(404).json({ error: 'Shared resource not found.' });
    }
    const reservations = await getSharedResourceReservationsByResourceId(resourceId);
    return res.json({ reservations });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load shared resource reservations.' });
  }
});

// POST /api/public/shared-resources/:resourceId/check-availability — validate only (no reservation created)
app.post('/api/public/shared-resources/:resourceId/check-availability', async (req, res) => {
  const resourceId = Number(req.params.resourceId);
  if (!Number.isInteger(resourceId) || resourceId <= 0) {
    return res.status(400).json({ error: 'Invalid shared resource id.' });
  }

  const checkinDate = normaliseDateKey(req.body.checkinDate);
  const checkoutDate = normaliseDateKey(req.body.checkoutDate);
  const requestedStart = parseLocalDateTime(req.body.requestedStartDate, req.body.requestedStartTime);
  const requestedEnd = parseLocalDateTime(req.body.requestedEndDate, req.body.requestedEndTime);

  if (!checkinDate || !checkoutDate || !requestedStart || !requestedEnd) {
    return res.status(400).json({ error: 'Checkin/checkout dates and requested start/end date-times are required.' });
  }
  if (requestedEnd.getTime() <= requestedStart.getTime()) {
    return res.status(400).json({ error: 'Requested end must be after requested start.' });
  }

  try {
    const resource = await getSharedResourceByIdPublic(resourceId);
    if (!resource) {
      return res.status(404).json({ error: 'Shared resource not found.' });
    }

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const maxDays = normaliseSharedResourceMaxAdvanceBookingDays(resource.max_days_advance_booking) || 365;
    const latestAllowed = new Date(now.getTime());
    latestAllowed.setDate(latestAllowed.getDate() + maxDays);
    const checkinTime = new Date(checkinDate + 'T00:00:00');
    if (checkinTime.getTime() > latestAllowed.getTime()) {
      return res.status(400).json({ error: 'Requested checkin exceeds max days advance booking.' });
    }

    const listingIds = await getListingIdsForSharedResource(resource);
    const matchingListingId = await findMatchingCalendarListingId(listingIds, checkinDate, checkoutDate);
    if (!matchingListingId) {
      return res.status(400).json({ error: 'We can’t identify a matching listing, please check your reservation dates.' });
    }

    const existingReservations = await getSharedResourceReservationsByResourceId(resourceId);
    const maxUnits = normaliseSharedResourceMaxUnits(resource.max_units) || 1;
    const requestedSpacesRaw = normaliseSharedResourceMaxUnits(req.body.spacesRequired) || 1;
    const requestedSpaces = resource.resource_type === 'parking'
      ? Math.min(maxUnits, Math.max(1, requestedSpacesRaw))
      : 1;

    const conflict = findCapacityConflictPeriod(
      existingReservations,
      requestedStart.toISOString(),
      requestedEnd.toISOString(),
      requestedSpaces,
      maxUnits
    );

    if (conflict) {
      const availablePeriods = findAvailablePeriods(
        existingReservations,
        requestedStart.toISOString(),
        requestedEnd.toISOString(),
        requestedSpaces,
        maxUnits
      );

      let errorMessage;
      if (availablePeriods.length === 0) {
        errorMessage = 'No availability within your requested window.';
      } else {
        const periodList = availablePeriods
          .map((p) => formatDateTimeForMessage(p.start) + ' to ' + formatDateTimeForMessage(p.end))
          .join(', ');
        errorMessage = 'Not fully available for your requested dates. Available periods within your window: ' + periodList + '.';
      }

      return res.status(409).json({ error: errorMessage });
    }

    return res.json({
      message: 'Availability Confirmed'
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to check shared resource availability.' });
  }
});

// POST /api/public/shared-resources/:resourceId/online-payment/prepare — create provisional reservation + payment intent
app.post('/api/public/shared-resources/:resourceId/online-payment/prepare', async (req, res) => {
  if (!stripeClient || !STRIPE_PUBLISHABLE_KEY) {
    return res.status(503).json({ error: 'Stripe is not configured on the server.' });
  }

  const resourceId = Number(req.params.resourceId);
  if (!Number.isInteger(resourceId) || resourceId <= 0) {
    return res.status(400).json({ error: 'Invalid shared resource id.' });
  }

  const requestedStartAtRaw = String(req.body.requestedStartAt || '').trim();
  const requestedEndAtRaw = String(req.body.requestedEndAt || '').trim();
  const requestedStartAt = new Date(requestedStartAtRaw);
  const requestedEndAt = new Date(requestedEndAtRaw);

  if (Number.isNaN(requestedStartAt.getTime()) || Number.isNaN(requestedEndAt.getTime()) || requestedEndAt.getTime() <= requestedStartAt.getTime()) {
    return res.status(400).json({ error: 'Requested end must be after requested start.' });
  }

  const checkinDate = normaliseDateKey(req.body.checkinDate) || getDateKeyFromEventDateTime(requestedStartAtRaw);
  const checkoutDate = normaliseDateKey(req.body.checkoutDate) || getDateKeyFromEventDateTime(requestedEndAtRaw);
  if (!checkinDate || !checkoutDate) {
    return res.status(400).json({ error: 'Checkin and checkout dates are required.' });
  }

  const firstName = normaliseSharedResourceReservationText(req.body.firstName, 100);
  const familyName = normaliseSharedResourceReservationText(req.body.familyName, 100);
  const emailAddress = normaliseSharedResourceReservationEmail(req.body.emailAddress);
  const telephone = normaliseSharedResourceReservationText(req.body.telephone, 60);
  const vehicleRegistration = normaliseSharedResourceReservationText(req.body.vehicleRegistration, 60) || '';
  const reservationAmount = normaliseSharedResourceReservationAmount(req.body.reservationAmount);
  if (!firstName || !familyName || !emailAddress || !telephone) {
    return res.status(400).json({ error: 'First name, family name, email address and telephone are required.' });
  }
  if (reservationAmount === null || reservationAmount <= 0) {
    return res.status(400).json({ error: 'A valid reservation amount is required for online payment.' });
  }

  try {
    const resource = await getSharedResourceByIdPublic(resourceId);
    if (!resource) {
      return res.status(404).json({ error: 'Shared resource not found.' });
    }
    if (resource.online_payment !== true) {
      return res.status(400).json({ error: 'Online payment is not enabled for this resource.' });
    }

    const hostUser = await getUserById(Number(resource.user_id));
    if (!hostUser || !hostUser.stripe_account_id) {
      return res.status(400).json({ error: 'Host Stripe account is not connected yet.' });
    }

    const stripeAccount = await stripeClient.accounts.retrieve(String(hostUser.stripe_account_id));
    await setUserStripeConnectState(hostUser.id, {
      stripe_account_id: stripeAccount.id,
      stripe_onboarding_complete: stripeAccount.details_submitted === true,
      stripe_charges_enabled: stripeAccount.charges_enabled === true,
      stripe_payouts_enabled: stripeAccount.payouts_enabled === true
    });

    if (stripeAccount.charges_enabled !== true || stripeAccount.payouts_enabled !== true) {
      return res.status(400).json({ error: 'Host Stripe account onboarding is incomplete.' });
    }

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const maxDays = normaliseSharedResourceMaxAdvanceBookingDays(resource.max_days_advance_booking) || 365;
    const latestAllowed = new Date(now.getTime());
    latestAllowed.setDate(latestAllowed.getDate() + maxDays);
    const checkinTime = new Date(checkinDate + 'T00:00:00');
    if (checkinTime.getTime() > latestAllowed.getTime()) {
      return res.status(400).json({ error: 'Requested checkin exceeds max days advance booking.' });
    }

    const listingIds = await getListingIdsForSharedResource(resource);
    const matchingListingId = await findMatchingCalendarListingId(listingIds, checkinDate, checkoutDate);
    if (!matchingListingId) {
      return res.status(400).json({ error: 'We can’t identify a matching listing, please check your reservation dates.' });
    }

    const existingReservations = await getSharedResourceReservationsByResourceId(resourceId);
    const maxUnits = normaliseSharedResourceMaxUnits(resource.max_units) || 1;
    const requestedSpacesRaw = normaliseSharedResourceMaxUnits(req.body.spacesRequired) || 1;
    const requestedSpaces = resource.resource_type === 'parking'
      ? Math.min(maxUnits, Math.max(1, requestedSpacesRaw))
      : 1;

    const conflict = findCapacityConflictPeriod(
      existingReservations,
      requestedStartAt.toISOString(),
      requestedEndAt.toISOString(),
      requestedSpaces,
      maxUnits
    );
    if (conflict) {
      return res.status(409).json({ error: 'Not fully available for your requested dates.' });
    }

    const reservationIdentifier = 'SR-' + resourceId + '-' + Date.now();
    const reservation = await createSharedResourceReservation({
      userId: resource.user_id,
      sharedResourceId: resourceId,
      reservationIdentifier,
      listingId: matchingListingId,
      reservationCheckinDate: checkinDate,
      reservationCheckoutDate: checkoutDate,
      requestedStartAt: requestedStartAt.toISOString(),
      requestedEndAt: requestedEndAt.toISOString(),
      spacesRequired: requestedSpaces,
      firstName,
      familyName,
      emailAddress,
      telephone,
      vehicleRegistration,
      reservationAmount,
      status: 'Awaiting Online Confirmation',
      paymentProvider: 'stripe',
      paymentStatus: 'pending',
      paymentCurrency: 'gbp',
      paymentAmountMinor: toMinorUnits(reservationAmount)
    });

    const paymentIntent = await stripeClient.paymentIntents.create(
      {
        amount: toMinorUnits(reservationAmount),
        currency: 'gbp',
        automatic_payment_methods: { enabled: true },
        transfer_data: {
          destination: String(stripeAccount.id)
        },
        metadata: {
          reservation_id: String(reservation.id),
          reservation_identifier: String(reservation.reservation_identifier || reservationIdentifier),
          resource_id: String(resourceId),
          host_user_id: String(resource.user_id)
        },
        receipt_email: emailAddress
      },
      {
        idempotencyKey: 'pi-' + String(reservation.reservation_identifier || reservationIdentifier)
      }
    );

    await updateSharedResourceReservationPaymentById(reservation.id, {
      paymentProvider: 'stripe',
      paymentIntentId: paymentIntent.id,
      paymentStatus: String(paymentIntent.status || '').toLowerCase(),
      paymentCurrency: String(paymentIntent.currency || 'gbp').toLowerCase(),
      paymentAmountMinor: Number.isInteger(paymentIntent.amount) ? paymentIntent.amount : toMinorUnits(reservationAmount)
    });

    return res.status(201).json({
      reservationId: reservation.id,
      reservationIdentifier: reservation.reservation_identifier,
      publishableKey: STRIPE_PUBLISHABLE_KEY,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to prepare online payment.' });
  }
});

// GET /api/public/reservations/by-identifier/:identifier — fetch a reservation by its identifier
app.get('/api/public/reservations/by-identifier/:identifier', async (req, res) => {
  const identifier = String(req.params.identifier || '').trim();
  if (!identifier) {
    return res.status(400).json({ error: 'Reservation identifier is required.' });
  }

  try {
    const reservation = await getSharedResourceReservationByIdentifier(identifier);
    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found.' });
    }
    return res.json({ reservation });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load reservation.' });
  }
});

// POST /api/public/shared-resources/:resourceId/reservations — create a public reservation
app.post('/api/public/shared-resources/:resourceId/reservations', async (req, res) => {
  const resourceId = Number(req.params.resourceId);
  if (!Number.isInteger(resourceId) || resourceId <= 0) {
    return res.status(400).json({ error: 'Invalid shared resource id.' });
  }

  const requestedStartAtRaw = String(req.body.requestedStartAt || '').trim();
  const requestedEndAtRaw = String(req.body.requestedEndAt || '').trim();
  const requestedStartAt = new Date(requestedStartAtRaw);
  const requestedEndAt = new Date(requestedEndAtRaw);

  if (Number.isNaN(requestedStartAt.getTime()) || Number.isNaN(requestedEndAt.getTime()) || requestedEndAt.getTime() <= requestedStartAt.getTime()) {
    return res.status(400).json({ error: 'Requested end must be after requested start.' });
  }

  const checkinDate = normaliseDateKey(req.body.checkinDate) || getDateKeyFromEventDateTime(requestedStartAtRaw);
  const checkoutDate = normaliseDateKey(req.body.checkoutDate) || getDateKeyFromEventDateTime(requestedEndAtRaw);
  if (!checkinDate || !checkoutDate) {
    return res.status(400).json({ error: 'Checkin and checkout dates are required.' });
  }

  const firstName = normaliseSharedResourceReservationText(req.body.firstName, 100);
  const familyName = normaliseSharedResourceReservationText(req.body.familyName, 100);
  const emailAddress = normaliseSharedResourceReservationEmail(req.body.emailAddress);
  const telephone = normaliseSharedResourceReservationText(req.body.telephone, 60);
  const vehicleRegistration = normaliseSharedResourceReservationText(req.body.vehicleRegistration, 60) || '';
  const reservationAmount = normaliseSharedResourceReservationAmount(req.body.reservationAmount);
  const paymentOption = String(req.body.paymentOption || '').trim();
  if (!firstName || !familyName || !emailAddress || !telephone) {
    return res.status(400).json({ error: 'First name, family name, email address and telephone are required.' });
  }

  try {
    const resource = await getSharedResourceByIdPublic(resourceId);
    if (!resource) {
      return res.status(404).json({ error: 'Shared resource not found.' });
    }

    const optionConfig = {
      free_of_charge: {
        enabled: resource.free_of_charge === true,
        status: 'Confirmed',
        error: 'Free of charge is not enabled for this resource.'
      },
      cash_on_site: {
        enabled: resource.cash_on_site === true,
        status: 'cash',
        error: 'Cash on site is not enabled for this resource.'
      },
      bank_transfer: {
        enabled: resource.bank_transfer === true,
        status: 'Awaiting Bank Transfer',
        error: 'Bank transfer is not enabled for this resource.'
      },
      online_payment: {
        enabled: resource.online_payment === true,
        status: 'Awaiting Online Confirmation',
        error: 'Online payment is not enabled for this resource.'
      }
    };

    const selectedOption = optionConfig[paymentOption];
    if (!selectedOption) {
      return res.status(400).json({ error: 'Invalid payment option.' });
    }
    if (!selectedOption.enabled) {
      return res.status(400).json({ error: selectedOption.error });
    }

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const maxDays = normaliseSharedResourceMaxAdvanceBookingDays(resource.max_days_advance_booking) || 365;
    const latestAllowed = new Date(now.getTime());
    latestAllowed.setDate(latestAllowed.getDate() + maxDays);
    const checkinTime = new Date(checkinDate + 'T00:00:00');
    if (checkinTime.getTime() > latestAllowed.getTime()) {
      return res.status(400).json({ error: 'Requested checkin exceeds max days advance booking.' });
    }

    const listingIds = await getListingIdsForSharedResource(resource);
    const matchingListingId = await findMatchingCalendarListingId(listingIds, checkinDate, checkoutDate);
    if (!matchingListingId) {
      return res.status(400).json({ error: 'We can’t identify a matching listing, please check your reservation dates.' });
    }

    const existingReservations = await getSharedResourceReservationsByResourceId(resourceId);
    const maxUnits = normaliseSharedResourceMaxUnits(resource.max_units) || 1;
    const requestedSpacesRaw = normaliseSharedResourceMaxUnits(req.body.spacesRequired) || 1;
    const requestedSpaces = resource.resource_type === 'parking'
      ? Math.min(maxUnits, Math.max(1, requestedSpacesRaw))
      : 1;

    const conflict = findCapacityConflictPeriod(
      existingReservations,
      requestedStartAt.toISOString(),
      requestedEndAt.toISOString(),
      requestedSpaces,
      maxUnits
    );
    if (conflict) {
      return res.status(409).json({ error: 'Not fully available for your requested dates.' });
    }

    const reservation = await createSharedResourceReservation({
      userId: resource.user_id,
      sharedResourceId: resourceId,
      reservationIdentifier: 'SR-' + resourceId + '-' + Date.now(),
      listingId: matchingListingId,
      reservationCheckinDate: checkinDate,
      reservationCheckoutDate: checkoutDate,
      requestedStartAt: requestedStartAt.toISOString(),
      requestedEndAt: requestedEndAt.toISOString(),
      spacesRequired: requestedSpaces,
      firstName,
      familyName,
      emailAddress,
      telephone,
      vehicleRegistration,
      reservationAmount,
      status: selectedOption.status
    });

    return res.status(201).json({ reservation });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create reservation.' });
  }
});

// PUT /api/shared-resources/:resourceId — update shared resource
app.put('/api/shared-resources/:resourceId', requireScopedRole('Manager'), async (req, res) => {
  const resourceId = Number(req.params.resourceId);
  if (!Number.isInteger(resourceId) || resourceId <= 0) {
    return res.status(400).json({ error: 'Invalid shared resource id.' });
  }

  try {
    const existing = await getSharedResourceByIdForUser(resourceId, req.accessContext.effectiveOwnerUserId);
    if (!existing) {
      return res.status(404).json({ error: 'Shared resource not found.' });
    }
    if (!isSharedResourceAllowedByScope(req, existing)) {
      return res.status(404).json({ error: 'Shared resource not found.' });
    }

    const { resource, error } = await updateSharedResourceForUser(
      resourceId,
      req.accessContext.effectiveOwnerUserId,
      req.accessContext.activeClientAccountId,
      {
      shortDescription: req.body.shortDescription,
      fullDescriptionHtml: req.body.fullDescriptionHtml,
      maxUnits: req.body.maxUnits,
      maxDaysAdvanceBooking: req.body.maxDaysAdvanceBooking,
      propertyId: req.body.propertyId,
      listingId: req.body.listingId,
      resourceType: req.body.resourceType,
      freeOfCharge: req.body.freeOfCharge,
      cashOnSite: req.body.cashOnSite,
      bankTransfer: req.body.bankTransfer,
      onlinePayment: req.body.onlinePayment,
      freeOfChargeMessageHtml: req.body.freeOfChargeMessageHtml,
      cashOnSiteMessageHtml: req.body.cashOnSiteMessageHtml,
      bankTransferMessageHtml: req.body.bankTransferMessageHtml,
      onlinePaymentMessageHtml: req.body.onlinePaymentMessageHtml,
      chargeBasis: req.body.chargeBasis,
      dailyChargeMode: req.body.dailyChargeMode,
      dailyRate: req.body.dailyRate,
      hourlyChargeMode: req.body.hourlyChargeMode,
      hourlyRate: req.body.hourlyRate,
      hourlyRates: req.body.hourlyRates
    });
    if (error === 'Shared resource not found.') {
      return res.status(404).json({ error });
    }
    if (error) {
      return res.status(400).json({ error });
    }
    return res.json({ resource });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update shared resource.' });
  }
});

// PUT /api/shared-resources/:resourceId/reservations/:reservationId/status — update payment/confirmation status
app.put('/api/shared-resources/:resourceId/reservations/:reservationId/status', requireScopedRole('Manager'), async (req, res) => {
  const resourceId = Number(req.params.resourceId);
  const reservationId = Number(req.params.reservationId);
  if (!Number.isInteger(resourceId) || resourceId <= 0 || !Number.isInteger(reservationId) || reservationId <= 0) {
    return res.status(400).json({ error: 'Invalid resource or reservation id.' });
  }

  try {
    const resource = await getSharedResourceByIdForUser(resourceId, req.accessContext.effectiveOwnerUserId);
    if (!resource) {
      return res.status(404).json({ error: 'Shared resource not found.' });
    }
    if (!isSharedResourceAllowedByScope(req, resource)) {
      return res.status(404).json({ error: 'Shared resource not found.' });
    }

    const result = await updateSharedResourceReservationStatusForUser(
      reservationId,
      resourceId,
      req.accessContext.effectiveOwnerUserId,
      req.body.status
    );

    if (result.error === 'Reservation not found.') {
      return res.status(404).json({ error: result.error });
    }
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    return res.json({ reservation: result.reservation });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update reservation status.' });
  }
});

// GET /api/shared-resources/:resourceId/reservations/:reservationId — load one reservation for editing
app.get('/api/shared-resources/:resourceId/reservations/:reservationId', requireScopedRole('Staff'), async (req, res) => {
  const resourceId = Number(req.params.resourceId);
  const reservationId = Number(req.params.reservationId);
  if (!Number.isInteger(resourceId) || resourceId <= 0 || !Number.isInteger(reservationId) || reservationId <= 0) {
    return res.status(400).json({ error: 'Invalid resource or reservation id.' });
  }

  try {
    const resource = await getSharedResourceByIdForUser(resourceId, req.accessContext.effectiveOwnerUserId);
    if (!resource) {
      return res.status(404).json({ error: 'Shared resource not found.' });
    }
    if (!isSharedResourceAllowedByScope(req, resource)) {
      return res.status(404).json({ error: 'Shared resource not found.' });
    }

    const reservation = await getSharedResourceReservationByIdForUser(reservationId, resourceId, req.accessContext.effectiveOwnerUserId);
    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found.' });
    }

    return res.json({ reservation });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load reservation.' });
  }
});

// PUT /api/shared-resources/:resourceId/reservations/:reservationId — edit reservation details
app.put('/api/shared-resources/:resourceId/reservations/:reservationId', requireScopedRole('Manager'), async (req, res) => {
  const resourceId = Number(req.params.resourceId);
  const reservationId = Number(req.params.reservationId);
  if (!Number.isInteger(resourceId) || resourceId <= 0 || !Number.isInteger(reservationId) || reservationId <= 0) {
    return res.status(400).json({ error: 'Invalid resource or reservation id.' });
  }

  const requestedStartAtRaw = String(req.body.requestedStartAt || '').trim();
  const requestedEndAtRaw = String(req.body.requestedEndAt || '').trim();
  const requestedStartAt = new Date(requestedStartAtRaw);
  const requestedEndAt = new Date(requestedEndAtRaw);
  if (Number.isNaN(requestedStartAt.getTime()) || Number.isNaN(requestedEndAt.getTime()) || requestedEndAt.getTime() <= requestedStartAt.getTime()) {
    return res.status(400).json({ error: 'Requested end must be after requested start.' });
  }

  const checkinDate = normaliseDateKey(req.body.checkinDate) || getDateKeyFromEventDateTime(requestedStartAtRaw);
  const checkoutDate = normaliseDateKey(req.body.checkoutDate) || getDateKeyFromEventDateTime(requestedEndAtRaw);
  if (!checkinDate || !checkoutDate) {
    return res.status(400).json({ error: 'Checkin and checkout dates are required.' });
  }

  const firstName = normaliseSharedResourceReservationText(req.body.firstName, 100);
  const familyName = normaliseSharedResourceReservationText(req.body.familyName, 100);
  const emailAddress = normaliseSharedResourceReservationEmail(req.body.emailAddress);
  const telephone = normaliseSharedResourceReservationText(req.body.telephone, 60);
  const reservationAmount = normaliseSharedResourceReservationAmount(req.body.reservationAmount);
  const status = normaliseSharedResourceReservationStatus(req.body.status);
  if (!firstName || !familyName || !emailAddress || !telephone || !status) {
    return res.status(400).json({ error: 'First name, family name, email address, telephone and status are required.' });
  }

  try {
    const resource = await getSharedResourceByIdForUser(resourceId, req.accessContext.effectiveOwnerUserId);
    if (!resource) {
      return res.status(404).json({ error: 'Shared resource not found.' });
    }
    if (!isSharedResourceAllowedByScope(req, resource)) {
      return res.status(404).json({ error: 'Shared resource not found.' });
    }

    const listingIds = await getListingIdsForSharedResource(resource);
    const matchingListingId = await findMatchingCalendarListingId(listingIds, checkinDate, checkoutDate);
    if (!matchingListingId) {
      return res.status(400).json({ error: 'We can’t identify a matching listing, please check your reservation dates.' });
    }

    const existingReservations = await getSharedResourceReservationsByResourceId(resourceId);
    const maxUnits = normaliseSharedResourceMaxUnits(resource.max_units) || 1;
    const requestedSpacesRaw = normaliseSharedResourceMaxUnits(req.body.spacesRequired) || 1;
    const requestedSpaces = resource.resource_type === 'parking'
      ? Math.min(maxUnits, Math.max(1, requestedSpacesRaw))
      : 1;

    const conflict = findCapacityConflictPeriod(
      existingReservations.filter((row) => Number(row.id) !== reservationId),
      requestedStartAt.toISOString(),
      requestedEndAt.toISOString(),
      requestedSpaces,
      maxUnits
    );
    if (conflict) {
      return res.status(409).json({ error: 'Not fully available for the updated requested dates.' });
    }

    const result = await updateSharedResourceReservationForUser(
      reservationId,
      resourceId,
      req.accessContext.effectiveOwnerUserId,
      {
        reservationCheckinDate: checkinDate,
        reservationCheckoutDate: checkoutDate,
        requestedStartAt: requestedStartAt.toISOString(),
        requestedEndAt: requestedEndAt.toISOString(),
        listingId: matchingListingId,
        spacesRequired: requestedSpaces,
        firstName,
        familyName,
        emailAddress,
        telephone,
        reservationAmount,
        status
      }
    );

    if (result.error === 'Reservation not found.') {
      return res.status(404).json({ error: result.error });
    }
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    return res.json({ reservation: result.reservation });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update reservation.' });
  }
});

// DELETE /api/shared-resources/:resourceId — delete shared resource
app.delete('/api/shared-resources/:resourceId', requireScopedRole('Manager'), async (req, res) => {
  const resourceId = Number(req.params.resourceId);
  if (!Number.isInteger(resourceId) || resourceId <= 0) {
    return res.status(400).json({ error: 'Invalid shared resource id.' });
  }

  try {
    const existing = await getSharedResourceByIdForUser(resourceId, req.accessContext.effectiveOwnerUserId);
    if (!existing) {
      return res.status(404).json({ error: 'Shared resource not found.' });
    }
    if (!isSharedResourceAllowedByScope(req, existing)) {
      return res.status(404).json({ error: 'Shared resource not found.' });
    }

    const result = await deleteSharedResourceForUser(resourceId, req.accessContext.effectiveOwnerUserId);
    if (result.error === 'Shared resource not found.') {
      return res.status(404).json({ error: result.error });
    }
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    return res.json({ deletedResourceId: result.deletedResourceId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete shared resource.' });
  }
});

// GET /api/properties — all properties for current user
app.get('/api/properties', requireScopedRole('Staff'), async (req, res) => {
  try {
    let properties = await getPropertiesForUser(req.accessContext.effectiveOwnerUserId);
    if (hasManagerAssignmentScope(req)) {
      properties = properties.filter((property) => isPropertyAllowedByScope(req, property.id));
    }
    return res.json({ properties });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load properties.' });
  }
});

// POST /api/properties — create property for current user
app.post('/api/properties', requireScopedRole('Manager'), async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'Property name is required.' });
  }

  try {
    const { property, error } = await createPropertyForUser(
      req.accessContext.effectiveOwnerUserId,
      req.accessContext.activeClientAccountId,
      name
    );
    if (error) {
      const status = error === 'Client account context is required.' ? 400 : 409;
      return res.status(status).json({ error });
    }
    return res.status(201).json({ property });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create property.' });
  }
});

// GET /api/properties/:propertyId — get property details
app.get('/api/properties/:propertyId', requireScopedRole('Staff'), async (req, res) => {
  const propertyId = Number(req.params.propertyId);
  if (!Number.isInteger(propertyId) || propertyId <= 0) {
    return res.status(400).json({ error: 'Invalid property id.' });
  }

  try {
    const property = await getPropertyByIdForUser(propertyId, req.accessContext.effectiveOwnerUserId);
    if (!property) {
      return res.status(404).json({ error: 'Property not found.' });
    }
    if (!isPropertyAllowedByScope(req, property.id)) {
      return res.status(404).json({ error: 'Property not found.' });
    }
    return res.json({ property });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load property.' });
  }
});

// PUT /api/properties/:propertyId — update property details
app.put('/api/properties/:propertyId', requireScopedRole('Manager'), async (req, res) => {
  const propertyId = Number(req.params.propertyId);
  if (!Number.isInteger(propertyId) || propertyId <= 0) {
    return res.status(400).json({ error: 'Invalid property id.' });
  }

  try {
    const existing = await getPropertyByIdForUser(propertyId, req.accessContext.effectiveOwnerUserId);
    if (!existing || !isPropertyAllowedByScope(req, existing.id)) {
      return res.status(404).json({ error: 'Property not found.' });
    }

    const { property, error } = await updatePropertyForUser(propertyId, req.accessContext.effectiveOwnerUserId, {
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
app.delete('/api/properties/:propertyId', requireScopedRole('Manager'), async (req, res) => {
  const propertyId = Number(req.params.propertyId);
  if (!Number.isInteger(propertyId) || propertyId <= 0) {
    return res.status(400).json({ error: 'Invalid property id.' });
  }

  try {
    const existing = await getPropertyByIdForUser(propertyId, req.accessContext.effectiveOwnerUserId);
    if (!existing || !isPropertyAllowedByScope(req, existing.id)) {
      return res.status(404).json({ error: 'Property not found.' });
    }

    const result = await deletePropertyForUser(propertyId, req.accessContext.effectiveOwnerUserId);
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
app.get('/api/listings', requireScopedRole('Staff'), async (req, res) => {
  try {
    let listings = await getListingsForUser(req.accessContext.effectiveOwnerUserId);
    if (hasManagerAssignmentScope(req)) {
      listings = listings.filter((listing) => isListingAllowedByScope(req, listing));
    }
    return res.json({ listings });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load listings.' });
  }
});

// POST /api/listings — create listing (unique name per user)
app.post('/api/listings', requireScopedRole('Manager'), async (req, res) => {
  const name = String(req.body.name || '').trim();
  const propertyId = Number(req.body.propertyId);
  const dateBasis = normaliseDateBasis(req.body.dateBasis);
  const usualCleanerId = req.body.usualCleanerId;
  if (!name) {
    return res.status(400).json({ error: 'Listing name is required.' });
  }

  try {
    if (hasManagerAssignmentScope(req)) {
      const scopedPropertyId = Number.isInteger(propertyId) && propertyId > 0 ? propertyId : null;
      if (!scopedPropertyId || !isPropertyAllowedByScope(req, scopedPropertyId)) {
        return res.status(403).json({ error: 'You are not allowed to create listings for this property.' });
      }
    }

    const { listing, error } = await createListingForUser(
      req.accessContext.effectiveOwnerUserId,
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
app.get('/api/listings/:listingId', requireScopedRole('Staff'), async (req, res) => {
  const listingId = Number(req.params.listingId);
  if (!Number.isInteger(listingId) || listingId <= 0) {
    return res.status(400).json({ error: 'Invalid listing id.' });
  }

  try {
    const listing = await getListingByIdForUser(listingId, req.accessContext.effectiveOwnerUserId);
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found.' });
    }
    if (!isListingAllowedByScope(req, listing)) {
      return res.status(404).json({ error: 'Listing not found.' });
    }
    return res.json({
      listing: {
        ...listing,
        ics_token: buildIcsAccessToken(listing)
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load listing.' });
  }
});

// PUT /api/listings/:listingId — rename listing
app.put('/api/listings/:listingId', requireScopedRole('Manager'), async (req, res) => {
  const listingId = Number(req.params.listingId);
  const name = String(req.body.name || '').trim();
  const propertyId = Number(req.body.propertyId);
  const dateBasis = normaliseDateBasis(req.body.dateBasis);
  const usualCleanerId = req.body.usualCleanerId;
  const emptyExport = req.body.emptyExport === true || req.body.emptyExport === 'true';

  if (!Number.isInteger(listingId) || listingId <= 0) {
    return res.status(400).json({ error: 'Invalid listing id.' });
  }
  if (!name) {
    return res.status(400).json({ error: 'Listing name is required.' });
  }

  try {
    const existing = await getListingByIdForUser(listingId, req.accessContext.effectiveOwnerUserId);
    if (!existing || !isListingAllowedByScope(req, existing)) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    if (hasManagerAssignmentScope(req)) {
      const scopedPropertyId = Number.isInteger(propertyId) && propertyId > 0 ? propertyId : Number(existing.property_id || 0);
      if (!isPropertyAllowedByScope(req, scopedPropertyId)) {
        return res.status(403).json({ error: 'You are not allowed to move this listing to that property.' });
      }
    }

    const { listing, error } = await updateListingForUser(
      listingId,
      req.accessContext.effectiveOwnerUserId,
      name,
      Number.isInteger(propertyId) && propertyId > 0 ? propertyId : null,
      dateBasis,
      usualCleanerId,
      emptyExport
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

// DELETE /api/listings/:listingId — delete listing
app.delete('/api/listings/:listingId', requireScopedRole('Manager'), async (req, res) => {
  const listingId = Number(req.params.listingId);
  if (!Number.isInteger(listingId) || listingId <= 0) {
    return res.status(400).json({ error: 'Invalid listing id.' });
  }

  try {
    const existing = await getListingByIdForUser(listingId, req.accessContext.effectiveOwnerUserId);
    if (!existing || !isListingAllowedByScope(req, existing)) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    const result = await deleteListingForUser(listingId, req.accessContext.effectiveOwnerUserId);
    if (result.error) {
      return res.status(404).json({ error: result.error });
    }

    return res.json({ message: 'Listing deleted.', deletedListingId: result.deletedListingId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete listing.' });
  }
});

// GET /api/listings/:listingId/feeds — feeds for a listing
app.get('/api/listings/:listingId/feeds', requireScopedRole('Staff'), async (req, res) => {
  const listingId = Number(req.params.listingId);
  if (!Number.isInteger(listingId) || listingId <= 0) {
    return res.status(400).json({ error: 'Invalid listing id.' });
  }

  try {
    const listing = await getListingByIdForUser(listingId, req.accessContext.effectiveOwnerUserId);
    if (!listing || !isListingAllowedByScope(req, listing)) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    const feeds = await getFeedsForListing(listingId, req.accessContext.effectiveOwnerUserId);
    if (feeds === null) {
      return res.status(404).json({ error: 'Listing not found.' });
    }
    return res.json({ feeds });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load feeds.' });
  }
});

// POST /api/access/guests — create guest record in active client account
app.post('/api/access/guests', requireScopedRole('Manager'), async (req, res) => {
  try {
    const result = await createGuestForClientAccount(req.accessContext.activeClientAccountId, req.body || {});
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    return res.status(201).json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create guest relationship.' });
  }
});

// GET /api/access/guests/:guestId — get one guest record in active client account
app.get('/api/access/guests/:guestId', requireScopedRole('Manager'), async (req, res) => {
  const guestId = Number(req.params.guestId);
  if (!Number.isInteger(guestId) || guestId <= 0) {
    return res.status(400).json({ error: 'Invalid guest id.' });
  }

  try {
    const guest = await getGuestByIdForClientAccount(req.accessContext.activeClientAccountId, guestId);
    if (!guest) {
      return res.status(404).json({ error: 'Guest not found.' });
    }
    return res.json({ guest });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load guest relationship.' });
  }
});

// PUT /api/access/guests/:guestId — update one guest record in active client account
app.put('/api/access/guests/:guestId', requireScopedRole('Manager'), async (req, res) => {
  const guestId = Number(req.params.guestId);
  if (!Number.isInteger(guestId) || guestId <= 0) {
    return res.status(400).json({ error: 'Invalid guest id.' });
  }

  try {
    const result = await updateGuestForClientAccount(req.accessContext.activeClientAccountId, guestId, req.body || {});
    if (result.error === 'Guest not found.') {
      return res.status(404).json({ error: result.error });
    }
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update guest relationship.' });
  }
});

// DELETE /api/access/guests/:guestId — delete one guest record in active client account
app.delete('/api/access/guests/:guestId', requireScopedRole('Manager'), async (req, res) => {
  const guestId = Number(req.params.guestId);
  if (!Number.isInteger(guestId) || guestId <= 0) {
    return res.status(400).json({ error: 'Invalid guest id.' });
  }

  try {
    const result = await deleteGuestForClientAccount(req.accessContext.activeClientAccountId, guestId);
    if (result.error === 'Guest not found.') {
      return res.status(404).json({ error: result.error });
    }
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    return res.json({ message: 'Guest deleted.', deletedGuestId: result.deletedGuestId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete guest relationship.' });
  }
});

// GET /api/feed-sources — all configured feed source labels + chosen colors
app.get('/api/feed-sources', requireScopedRole('Staff'), async (req, res) => {
  try {
    let sources = await getFeedSourcesForUser(req.accessContext.effectiveOwnerUserId);

    if (hasManagerAssignmentScope(req)) {
      const listings = await getListingsForUser(req.accessContext.effectiveOwnerUserId);
      const allowedListings = listings.filter((listing) => isListingAllowedByScope(req, listing));
      const allowedLabels = new Set();

      for (const listing of allowedListings) {
        const feeds = await getFeedsForListing(listing.id, req.accessContext.effectiveOwnerUserId);
        (feeds || []).forEach((feed) => {
          const label = String(feed && feed.label ? feed.label : '').trim().toLowerCase();
          if (label) {
            allowedLabels.add(label);
          }
        });
      }

      sources = sources.filter((source) => allowedLabels.has(String(source.label || '').trim().toLowerCase()));
    }

    return res.json({ sources });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load feed sources.' });
  }
});

// PUT /api/feed-sources/color — set color for one feed source label
app.put('/api/feed-sources/color', requireScopedRole('Manager'), async (req, res) => {
  const label = String(req.body.label || '').trim();
  const color = normaliseColor(req.body.color);

  if (!label) {
    return res.status(400).json({ error: 'Feed source label is required.' });
  }
  if (!color) {
    return res.status(400).json({ error: 'Valid color is required (#RRGGBB).' });
  }

  try {
    let sources = await getFeedSourcesForUser(req.accessContext.effectiveOwnerUserId);

    if (hasManagerAssignmentScope(req)) {
      const listings = await getListingsForUser(req.accessContext.effectiveOwnerUserId);
      const allowedListings = listings.filter((listing) => isListingAllowedByScope(req, listing));
      const allowedLabels = new Set();

      for (const listing of allowedListings) {
        const feeds = await getFeedsForListing(listing.id, req.accessContext.effectiveOwnerUserId);
        (feeds || []).forEach((feed) => {
          const feedLabel = String(feed && feed.label ? feed.label : '').trim().toLowerCase();
          if (feedLabel) {
            allowedLabels.add(feedLabel);
          }
        });
      }

      sources = sources.filter((source) => allowedLabels.has(String(source.label || '').trim().toLowerCase()));
    }

    const exists = sources.some((source) => source.label.toLowerCase() === label.toLowerCase());
    if (!exists) {
      return res.status(404).json({ error: 'Feed source not found.' });
    }

    const saved = await upsertFeedSourceColorForUser(req.accessContext.effectiveOwnerUserId, label, color);
    return res.json({ source: saved });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to save source color.' });
  }
});

// POST /api/listings/:listingId/feeds — add a feed
app.post('/api/listings/:listingId/feeds', requireScopedRole('Manager'), async (req, res) => {
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
    const listing = await getListingByIdForUser(listingId, req.accessContext.effectiveOwnerUserId);
    if (!listing || !isListingAllowedByScope(req, listing)) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    const { feed, error } = await createFeedForListing(listingId, req.accessContext.effectiveOwnerUserId, label, url);
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
app.put('/api/listings/:listingId/feeds/:feedId', requireScopedRole('Manager'), async (req, res) => {
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
    const listing = await getListingByIdForUser(listingId, req.accessContext.effectiveOwnerUserId);
    if (!listing || !isListingAllowedByScope(req, listing)) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    const { feed, error } = await updateFeedForListing(feedId, listingId, req.accessContext.effectiveOwnerUserId, label, url);
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
  return parts.join('\r\n');
}

function addOneDayIcsDate(yyyymmdd) {
  const year = Number(yyyymmdd.slice(0, 4));
  const month = Number(yyyymmdd.slice(4, 6)) - 1;
  const day = Number(yyyymmdd.slice(6, 8));
  const d = new Date(Date.UTC(year, month, day));
  d.setUTCDate(d.getUTCDate() + 1);
  const pad = (n) => String(n).padStart(2, '0');
  return String(d.getUTCFullYear()) + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate());
}

function addOneHourIcsDateTime(yyyymmddThhmmssZ) {
  const year = Number(yyyymmddThhmmssZ.slice(0, 4));
  const month = Number(yyyymmddThhmmssZ.slice(4, 6)) - 1;
  const day = Number(yyyymmddThhmmssZ.slice(6, 8));
  const hour = Number(yyyymmddThhmmssZ.slice(9, 11));
  const minute = Number(yyyymmddThhmmssZ.slice(11, 13));
  const second = Number(yyyymmddThhmmssZ.slice(13, 15));
  const d = new Date(Date.UTC(year, month, day, hour, minute, second));
  d.setUTCHours(d.getUTCHours() + 1);
  const pad = (n) => String(n).padStart(2, '0');
  return String(d.getUTCFullYear()) + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) +
    'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
}

function isIcsEndAfterStart(startValue, endValue) {
  if (!startValue || !endValue) return false;
  if (/^\d{8}$/.test(startValue) && /^\d{8}$/.test(endValue)) {
    return Number(endValue) > Number(startValue);
  }
  const toUtcMillis = (value) => {
    if (!/^\d{8}T\d{6}Z$/.test(value)) return Number.NaN;
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6)) - 1;
    const day = Number(value.slice(6, 8));
    const hour = Number(value.slice(9, 11));
    const minute = Number(value.slice(11, 13));
    const second = Number(value.slice(13, 15));
    return Date.UTC(year, month, day, hour, minute, second);
  };
  const startMs = toUtcMillis(startValue);
  const endMs = toUtcMillis(endValue);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
  return endMs > startMs;
}

function buildIcsDateRange(event) {
  const dtstart = buildIcsDateString(event.start);
  if (!dtstart) {
    return null;
  }

  const isAllDay = /^\d{8}$/.test(dtstart);
  const rawEnd = buildIcsDateString(event.end);
  let dtend = rawEnd;

  if (isAllDay) {
    if (!/^\d{8}$/.test(String(dtend || ''))) {
      dtend = addOneDayIcsDate(dtstart);
    }
    if (!isIcsEndAfterStart(dtstart, dtend)) {
      dtend = addOneDayIcsDate(dtstart);
    }
  } else {
    if (!/^\d{8}T\d{6}Z$/.test(String(dtend || ''))) {
      dtend = addOneHourIcsDateTime(dtstart);
    }
    if (!isIcsEndAfterStart(dtstart, dtend)) {
      dtend = addOneHourIcsDateTime(dtstart);
    }
  }

  return { dtstart, dtend, isAllDay };
}

function buildIcsEventSummary(listing, event) {
  const listingName = String(
    (event && event.listingName)
      || (listing && listing.name)
      || ''
  ).trim();
  const propertyName = String(
    (event && event.propertyName)
      || (listing && listing.property_name)
      || ''
  ).trim();
  const source = String(event && event.source ? event.source : '').trim();
  let sourceLabel = source;

  const lower = source.toLowerCase();
  if (lower.includes('airbnb')) {
    sourceLabel = 'Airbnb';
  }
  if (lower.includes('booking')) {
    sourceLabel = 'Booking.com';
  }

  const parts = [sourceLabel, propertyName, listingName].filter(Boolean);
  if (parts.length) {
    return parts.join(' - ');
  }

  return 'Reservation';
}

function buildIcsCalendar(listing, events) {
  const now = buildIcsDateString(new Date().toISOString());
  const prodId = '-//AutomaticPeople//Listing ' + listing.id + '//EN';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:' + prodId,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + escapeIcsText(listing.name)
  ];

  events.forEach((event, idx) => {
    const range = buildIcsDateRange(event);
    if (!range) return;
    const { dtstart, dtend, isAllDay } = range;
    const uid = 'listing-' + listing.id + '-' + idx + '@automaticpeople';

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
    lines.push('SUMMARY:' + escapeIcsText(buildIcsEventSummary(listing, event)));
    if (event.description) {
      lines.push('DESCRIPTION:' + escapeIcsText(event.description));
    }
    if (event.location) {
      lines.push('LOCATION:' + escapeIcsText(event.location));
    }
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

function parseCachedEventsRows(cachedRows) {
  return (cachedRows || [])
    .filter((row) => !row.error_text)
    .flatMap((row) => {
      try {
        return JSON.parse(row.events_json || '[]');
      } catch {
        return [];
      }
    })
    .sort((a, b) => {
      const aTime = a.start ? new Date(a.start).getTime() : 0;
      const bTime = b.start ? new Date(b.start).getTime() : 0;
      return aTime - bTime;
    });
}

async function getIcsEventsForListing(listingId) {
  let cached = await getCachedEventsForListing(listingId);
  let events = parseCachedEventsRows(cached);

  if (events.length === 0) {
    try {
      await refreshEventsForListing(listingId);
      cached = await getCachedEventsForListing(listingId);
      events = parseCachedEventsRows(cached);
    } catch (refreshErr) {
      console.error('ICS refresh fallback failed for listing', listingId, refreshErr && refreshErr.message);
    }
  }

  return events;
}

// GET /api/listings/:listingId/calendar.ics — export merged calendar as ICS
app.get('/api/listings/:listingId/calendar.ics', async (req, res) => {
  const listingId = Number(req.params.listingId);
  if (!Number.isInteger(listingId) || listingId <= 0) {
    return res.status(400).send('Invalid listing id.');
  }

  try {
    let listing = null;
    if (req.session && Number.isInteger(req.session.userId)) {
      const resolved = await resolveAccessContextForUser(req.session.userId, req.session.activeClientAccountId, 'Staff');
      if (resolved.accessContext) {
        req.session.activeClientAccountId = Number(resolved.accessContext.activeClientAccountId);
        listing = await getListingByIdForUser(listingId, resolved.accessContext.effectiveOwnerUserId);
        if (listing && !isListingAllowedByScope({ accessContext: resolved.accessContext }, listing)) {
          listing = null;
        }
      }
    }

    if (!listing) {
      const token = String(req.query.token || '').trim();
      if (!token) {
        return res.status(401).send('Authentication required.');
      }
      listing = await getListingById(listingId);
      if (!listing || !isValidIcsAccessToken(listing, token)) {
        return res.status(404).send('Calendar not found.');
      }
    }

    if (!listing) {
      return res.status(404).send('Listing not found.');
    }

    const events = listing.empty_export ? [] : await getIcsEventsForListing(listingId);

    const icsContent = buildIcsCalendar(listing, events);
    const safeName = String(listing.name || 'listing').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + safeName + '.ics"');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Calendar-Event-Count', String(events.length));
    return res.send(icsContent);
  } catch (err) {
    console.error(err);
    return res.status(500).send('Failed to generate calendar.');
  }
});

// GET /api/calendar.ics — export consolidated calendar across all listings
app.get('/api/calendar.ics', async (req, res) => {
  try {
    let userId = null;
    let resolvedAccess = null;

    if (req.session && Number.isInteger(req.session.userId)) {
      const resolved = await resolveAccessContextForUser(req.session.userId, req.session.activeClientAccountId, 'Staff');
      if (resolved.accessContext) {
        resolvedAccess = resolved.accessContext;
        req.session.activeClientAccountId = Number(resolvedAccess.activeClientAccountId);
        userId = resolvedAccess.effectiveOwnerUserId;
      }
    }

    if (!userId) {
      const token = String(req.query.token || '').trim();
      userId = getUserIdFromConsolidatedIcsToken(token);
      if (!userId) {
        return res.status(401).send('Authentication required.');
      }
    }

    let listings = await getListingsForUser(userId);
    if (resolvedAccess && hasManagerAssignmentScope({ accessContext: resolvedAccess })) {
      listings = listings.filter((listing) => isListingAllowedByScope({ accessContext: resolvedAccess }, listing));
    }

    const combinedEvents = [];
    for (const listing of listings) {
      const listingEvents = await getIcsEventsForListing(listing.id);
      listingEvents.forEach((event) => {
        combinedEvents.push({
          ...event,
          listingName: listing.name,
          propertyName: listing.property_name || ''
        });
      });
    }

    combinedEvents.sort((a, b) => {
      const aTime = a.start ? new Date(a.start).getTime() : 0;
      const bTime = b.start ? new Date(b.start).getTime() : 0;
      return aTime - bTime;
    });

    const calendarListing = {
      id: 'all',
      name: 'All Listings',
      property_name: ''
    };
    const icsContent = buildIcsCalendar(calendarListing, combinedEvents);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="all-listings.ics"');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Calendar-Event-Count', String(combinedEvents.length));
    return res.send(icsContent);
  } catch (err) {
    console.error(err);
    return res.status(500).send('Failed to generate consolidated calendar.');
  }
});

// GET /api/listings/:listingId/events — serve events from the persistent cache
app.get('/api/listings/:listingId/events', requireScopedRole('Staff'), async (req, res) => {
  const listingId = Number(req.params.listingId);
  if (!Number.isInteger(listingId) || listingId <= 0) {
    return res.status(400).json({ error: 'Invalid listing id.' });
  }

  try {
    const listing = await getListingByIdForUser(listingId, req.accessContext.effectiveOwnerUserId);
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found.' });
    }
    if (!isListingAllowedByScope(req, listing)) {
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

    const bookedChanges = await getBookedInChangesForUserByListings(req.accessContext.effectiveOwnerUserId, [listingId]);
    const cleaners = await getCleanersForUser(req.accessContext.effectiveOwnerUserId);
    const cleanerNameById = new Map(
      (cleaners || []).map((cleaner) => {
        const fullName = [cleaner.first_name || '', cleaner.last_name || ''].join(' ').trim();
        return [Number(cleaner.id), fullName || 'Unallocated'];
      })
    );
    const cleaningChanges = (bookedChanges || []).map((row) => ({
      reservation_checkin_date: row.reservation_checkin_date,
      reservation_checkout_date: row.reservation_checkout_date,
      changeover_date: row.changeover_date,
      cleaner_id: row.cleaner_id ? Number(row.cleaner_id) : null,
      cleaner_name: row.cleaner_id ? (cleanerNameById.get(Number(row.cleaner_id)) || 'Unallocated') : 'Unallocated'
    }));

    return res.json({ listing, events, feedErrors, fetchedAt, cleaningChanges });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load listing events.' });
  }
});

// POST /api/listings/:listingId/events/refresh — trigger immediate cache refresh then return events
app.post('/api/listings/:listingId/events/refresh', requireScopedRole('Manager'), async (req, res) => {
  const listingId = Number(req.params.listingId);
  if (!Number.isInteger(listingId) || listingId <= 0) {
    return res.status(400).json({ error: 'Invalid listing id.' });
  }

  try {
    const listing = await getListingByIdForUser(listingId, req.accessContext.effectiveOwnerUserId);
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found.' });
    }
    if (!isListingAllowedByScope(req, listing)) {
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

    const bookedChanges = await getBookedInChangesForUserByListings(req.accessContext.effectiveOwnerUserId, [listingId]);
    const cleaners = await getCleanersForUser(req.accessContext.effectiveOwnerUserId);
    const cleanerNameById = new Map(
      (cleaners || []).map((cleaner) => {
        const fullName = [cleaner.first_name || '', cleaner.last_name || ''].join(' ').trim();
        return [Number(cleaner.id), fullName || 'Unallocated'];
      })
    );
    const cleaningChanges = (bookedChanges || []).map((row) => ({
      reservation_checkin_date: row.reservation_checkin_date,
      reservation_checkout_date: row.reservation_checkout_date,
      changeover_date: row.changeover_date,
      cleaner_id: row.cleaner_id ? Number(row.cleaner_id) : null,
      cleaner_name: row.cleaner_id ? (cleanerNameById.get(Number(row.cleaner_id)) || 'Unallocated') : 'Unallocated'
    }));

    return res.json({ listing, events, feedErrors, fetchedAt, cleaningChanges });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to refresh listing events.' });
  }
});

// GET /api/calendar-entries?url=... — load and parse ICS events
app.get('/api/calendar-entries', requireScopedRole('Staff'), async (req, res) => {
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
      console.log('User storage: Postgres');
      if (!ADMIN_AUTH_CONFIGURED) {
        console.warn('Admin authentication is disabled because ADMIN_USERNAME/ADMIN_PASSWORD are not set.');
      }
      if (!ENABLE_INVITE_AUTO_VALIDATION) {
        console.log('Invite auto-validation is disabled. Unvalidated users cannot log in until they validate by email.');
      }
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

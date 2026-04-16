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
const usersFile = path.join(__dirname, 'users.json');
const usePostgres = Boolean(process.env.DATABASE_URL);

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

async function initializeUserStore() {
  if (!usePostgres) {
    if (!fs.existsSync(usersFile)) {
      fs.writeFileSync(usersFile, '[]', 'utf8');
    }
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

// Serve static files from the public folder
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Auth guard ───────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorised' });
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

// GET /api/me — return current user info (requires auth)
app.get('/api/me', requireAuth, (req, res) => {
  res.json({
    username: req.session.username,
    email: req.session.email
  });
});

// GET /api/calendar-entries?url=... — load and parse ICS events
app.get('/api/calendar-entries', requireAuth, async (req, res) => {
  const calendarUrl = String(req.query.url || '').trim();

  if (!calendarUrl) {
    return res.status(400).json({ error: 'Calendar URL is required.' });
  }

  let parsed;
  try {
    parsed = new URL(calendarUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid calendar URL.' });
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return res.status(400).json({ error: 'Calendar URL must use http or https.' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const upstream = await fetch(parsed.toString(), { signal: controller.signal });
    clearTimeout(timeout);

    if (!upstream.ok) {
      return res.status(400).json({ error: 'Unable to fetch calendar feed.' });
    }

    const icsText = await upstream.text();
    if (!icsText.includes('BEGIN:VCALENDAR')) {
      return res.status(400).json({ error: 'URL did not return a valid ICS calendar.' });
    }

    const events = parseIcsEvents(icsText)
      .filter((event) => event.start || event.title || event.location)
      .slice(0, 200);

    return res.json({ events });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return res.status(504).json({ error: 'Calendar request timed out.' });
    }
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

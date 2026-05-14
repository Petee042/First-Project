'use strict';

const express = require('express');
const session = require('express-session');
const postmark = require('postmark');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const NODE_ENV = String(process.env.NODE_ENV || '').toLowerCase();
const SESSION_SECRET = String(process.env.SESSION_SECRET || 'change-me').trim();
const SHELL_LOGIN_USERNAME = String(process.env.SHELL_LOGIN_USERNAME || 'Peterku').trim();
const SHELL_LOGIN_PASSWORD = String(process.env.SHELL_LOGIN_PASSWORD || 'letmein1').trim();
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const POSTMARK_SERVER_TOKEN = String(process.env.POSTMARK_SERVER_TOKEN || '').trim();
const POSTMARK_FROM = String(process.env.POSTMARK_FROM || 'noreply@automaticpeople.com').trim();
const POSTMARK_MESSAGE_STREAM = String(process.env.POSTMARK_MESSAGE_STREAM || 'outbound').trim();

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    })
  : null;

function createMailer() {
  if (!POSTMARK_SERVER_TOKEN) {
    throw new Error('Postmark server token is not configured.');
  }

  return new postmark.ServerClient(POSTMARK_SERVER_TOKEN);
}

function getPostmarkErrorMessage(error) {
  if (!error) {
    return 'Unknown email provider error.';
  }

  const statusCode = error.statusCode || (error.response && error.response.statusCode) || null;
  const code = error.code || (error.response && error.response.body && error.response.body.ErrorCode) || null;
  const message = String(
    error.message
    || (error.response && error.response.body && error.response.body.Message)
    || 'Unknown email provider error.'
  ).trim();

  let combined = message;
  if (statusCode) {
    combined += ' (HTTP ' + String(statusCode) + ')';
  }
  if (code) {
    combined += ' [Postmark code ' + String(code) + ']';
  }
  return combined;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function requireShellAuth(req, res, next) {
  if (req.session && req.session.isShellAuthed === true) {
    return next();
  }
  return res.redirect('/login');
}

if (NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.get('/login', (req, res) => {
  if (req.session && req.session.isShellAuthed === true) {
    return res.redirect('/');
  }
  return res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '').trim();
  if (username === SHELL_LOGIN_USERNAME && password === SHELL_LOGIN_PASSWORD) {
    req.session.isShellAuthed = true;
    return res.redirect('/');
  }
  return res.status(401).sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/logout', (req, res) => {
  if (!req.session) {
    return res.redirect('/login');
  }
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// Allow logo/image assets to load on the public login page.
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));

app.get('/health', async (req, res) => {
  const status = { ok: true, app: 'AutomaticPeople' };

  if (!pool) {
    return res.json({ ...status, database: 'not-configured' });
  }

  try {
    await pool.query('SELECT 1');
    return res.json({ ...status, database: 'ok' });
  } catch (error) {
    return res.status(500).json({ ...status, database: 'error', error: 'Database unavailable.' });
  }
});

app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    emailConfigured: Boolean(POSTMARK_SERVER_TOKEN && POSTMARK_FROM),
    databaseConfigured: Boolean(pool)
  });
});

app.use(requireShellAuth);
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/send-email', async (req, res) => {
  const recipient = String(req.body.recipient || '').trim();
  const subject = String(req.body.subject || 'Welcome to AutomaticPeople').trim();
  const message = String(req.body.message || 'Thanks for visiting AutomaticPeople.').trim();

  console.log('[send-email] request received', {
    recipient,
    subjectLength: subject.length,
    messageLength: message.length
  });

  if (!isValidEmail(recipient)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }

  let mailer;
  try {
    mailer = createMailer();
  } catch (error) {
    console.error('[send-email] mailer configuration error:', error.message || error);
    return res.status(500).json({ error: error.message || 'Email service is not configured.' });
  }

  try {
    await mailer.sendEmail({
      From: POSTMARK_FROM,
      To: recipient,
      Subject: subject,
      TextBody: message + '\n\nSent from AutomaticPeople.',
      MessageStream: POSTMARK_MESSAGE_STREAM
    });

    console.log('[send-email] email sent successfully', { recipient });
    res.json({ ok: true, message: 'Email sent.' });
  } catch (error) {
    const providerMessage = getPostmarkErrorMessage(error);
    console.error('[send-email] Postmark send failed:', providerMessage);
    res.status(500).json({ error: providerMessage });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('AutomaticPeople listening on port ' + PORT);
  console.log('AutomaticPeople email configuration', {
    postmarkTokenConfigured: Boolean(POSTMARK_SERVER_TOKEN),
    postmarkFrom: POSTMARK_FROM,
    postmarkMessageStream: POSTMARK_MESSAGE_STREAM
  });
});

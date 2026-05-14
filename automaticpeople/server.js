'use strict';

const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const NODE_ENV = String(process.env.NODE_ENV || '').toLowerCase();
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const SMTP_HOST = String(process.env.SMTP_HOST || '').trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || '').trim().toLowerCase() === 'true';
const SMTP_USER = String(process.env.SMTP_USER || '').trim();
const SMTP_PASS = String(process.env.SMTP_PASS || '').trim();
const SMTP_FROM = String(process.env.SMTP_FROM || SMTP_USER || 'noreply@automaticpeople.com').trim();

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    })
  : null;

function createMailer() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error('SMTP is not configured.');
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

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
    emailConfigured: Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS),
    databaseConfigured: Boolean(pool)
  });
});

app.post('/api/send-email', async (req, res) => {
  const recipient = String(req.body.recipient || '').trim();
  const subject = String(req.body.subject || 'Welcome to AutomaticPeople').trim();
  const message = String(req.body.message || 'Thanks for visiting AutomaticPeople.').trim();

  if (!isValidEmail(recipient)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }

  let mailer;
  try {
    mailer = createMailer();
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Email service is not configured.' });
  }

  try {
    await mailer.sendMail({
      from: SMTP_FROM,
      to: recipient,
      subject,
      text: message + '\n\nSent from AutomaticPeople.'
    });

    res.json({ ok: true, message: 'Email sent.' });
  } catch (error) {
    res.status(500).json({ error: 'Unable to send email.' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('AutomaticPeople listening on port ' + PORT);
});

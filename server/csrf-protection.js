'use strict';

const { Tokens } = require('csrf');
const cookieParser = require('cookie-parser');

const tokens = new Tokens();

/**
 * CSRF Protection Middleware
 * Generates and validates CSRF tokens for state-changing operations
 */

function csrfProtection(req, res, next) {
  // Skip CSRF for:
  // 1. GET, HEAD, OPTIONS requests (safe methods)
  // 2. Stripe webhooks (they use signature verification)
  // 3. Public API endpoints that don't require auth
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }

  // Skip for Stripe webhook
  if (req.path === '/api/stripe/webhook') {
    return next();
  }

  // Skip for public endpoints that don't modify user data
  const publicEndpoints = [
    '/api/signup',
    '/api/login',
    '/api/account/validate',
    '/api/account/password-reset/request',
    '/api/account/password-reset/confirm'
  ];
  
  if (publicEndpoints.includes(req.path)) {
    return next();
  }

  // Get token from request
  const token = req.headers['x-csrf-token'] || req.body._csrf || req.query._csrf;
  const secret = req.session && req.session.csrfSecret;

  if (!secret) {
    return res.status(403).json({ error: 'CSRF token validation failed. Please refresh and try again.' });
  }

  if (!token || !tokens.verify(secret, token)) {
    return res.status(403).json({ error: 'CSRF token validation failed. Invalid or missing token.' });
  }

  next();
}

/**
 * Middleware to generate CSRF secret and attach token generator to response
 */
function csrfSetup(req, res, next) {
  // Generate secret if not exists
  if (!req.session.csrfSecret) {
    req.session.csrfSecret = tokens.secretSync();
  }

  // Add helper to generate tokens
  res.locals.csrfToken = () => {
    return tokens.create(req.session.csrfSecret);
  };

  next();
}

/**
 * Endpoint to get CSRF token
 */
function getCsrfToken(req, res) {
  if (!req.session.csrfSecret) {
    req.session.csrfSecret = tokens.secretSync();
  }
  
  const token = tokens.create(req.session.csrfSecret);
  res.json({ csrfToken: token });
}

module.exports = {
  csrfProtection,
  csrfSetup,
  getCsrfToken
};

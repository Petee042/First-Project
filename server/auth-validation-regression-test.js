'use strict';

const BASE_URL = String(process.env.TEST_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function uniqueEmail() {
  const stamp = Date.now();
  const rand = Math.floor(Math.random() * 1e6);
  return `validation-regression-${stamp}-${rand}@example.com`;
}

async function postJson(path, body) {
  const res = await fetch(BASE_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  return { res, data };
}

(async () => {
  const email = uniqueEmail();
  const password = 'StrongPass!123';

  console.log('Running auth validation regression test against', BASE_URL);
  console.log('Using test email:', email);

  const signup = await postJson('/api/signup', {
    firstName: 'Validation',
    familyName: 'Regression',
    country: 'GB',
    email,
    password
  });

  assert(
    signup.res.status === 201,
    'Expected signup HTTP 201, got ' + signup.res.status + ' with body ' + JSON.stringify(signup.data)
  );

  const login = await postJson('/api/login', {
    email,
    password
  });

  assert(
    login.res.status === 403,
    'Expected login HTTP 403 for unvalidated user, got ' + login.res.status + ' with body ' + JSON.stringify(login.data)
  );

  assert(
    login.data && login.data.code === 'ACCOUNT_NOT_VALIDATED',
    'Expected ACCOUNT_NOT_VALIDATED error code, got body ' + JSON.stringify(login.data)
  );

  console.log('PASS: unvalidated signup user is blocked from logging in.');
})().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});

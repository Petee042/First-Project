'use strict';

const LAST_LOGIN_EMAIL_KEY = 'lastLoginEmail';

// ── Tab switching ────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));

    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    document.getElementById(tab.dataset.tab).classList.remove('hidden');
  });
});

// ── Helpers ──────────────────────────────────────────────────
function setMessage(id, text, isError) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = 'message ' + (isError ? 'error' : 'success');
}

function rememberLoginEmail(email) {
  try {
    localStorage.setItem(LAST_LOGIN_EMAIL_KEY, email);
  } catch {
    // Ignore storage failures (private mode, disabled storage, etc.)
  }
}

function prefillRememberedLoginEmail() {
  try {
    const remembered = localStorage.getItem(LAST_LOGIN_EMAIL_KEY);
    if (!remembered) return;

    const emailInput = document.getElementById('li-email');
    emailInput.value = remembered;
    // Show login tab when we have remembered credentials context.
    document.querySelector('[data-tab="login"]').click();
  } catch {
    // Ignore storage read failures
  }
}

function isStrongPassword(password) {
  const value = String(password || '');
  return value.length >= 8
    && /[A-Z]/.test(value)
    && /[0-9]/.test(value)
    && /[^A-Za-z0-9]/.test(value);
}

async function postJSON(url, data) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const json = await res.json();
  return { ok: res.ok, data: json };
}

prefillRememberedLoginEmail();

// ── Signup ───────────────────────────────────────────────────
document.getElementById('signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;

  const firstName = document.getElementById('su-first-name').value.trim();
  const familyName = document.getElementById('su-family-name').value.trim();
  const country = document.getElementById('su-country').value.trim();
  const email = document.getElementById('su-email').value.trim();
  const password = document.getElementById('su-password').value;

  if (!isStrongPassword(password)) {
    setMessage('signup-message', 'Password must be at least 8 characters and include one uppercase, one number, and one special character.', true);
    btn.disabled = false;
    return;
  }

  try {
    const { ok, data } = await postJSON('/api/signup', { firstName, familyName, country, email, password });
    if (ok) {
      setMessage('signup-message', data.message, false);
      e.target.reset();
      // Switch to login tab
      setTimeout(() => {
        document.querySelector('[data-tab="login"]').click();
        document.getElementById('li-email').value = email;
        rememberLoginEmail(email);
      }, 1200);
    } else {
      setMessage('signup-message', data.error, true);
    }
  } catch {
    setMessage('signup-message', 'Network error. Please try again.', true);
  } finally {
    btn.disabled = false;
  }
});

// ── Login ────────────────────────────────────────────────────
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;

  const email    = document.getElementById('li-email').value.trim();
  const password = document.getElementById('li-password').value;

  try {
    const { ok, data } = await postJSON('/api/login', { email, password });
    if (ok) {
      rememberLoginEmail(email);
      setMessage('login-message', data.message, false);
      window.location.href = '/dashboard.html?tab=panel-dashboard';
    } else {
      if (data && data.code === 'ACCOUNT_NOT_VALIDATED') {
        setMessage('login-message', 'Your account is not validated yet. Please open the validation email and click the link before logging in.', true);
      } else {
        setMessage('login-message', data.error, true);
      }
    }
  } catch {
    setMessage('login-message', 'Network error. Please try again.', true);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('forgotPasswordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;

  const email = document.getElementById('fp-email').value.trim();
  if (!email) {
    setMessage('forgot-password-message', 'Email is required.', true);
    btn.disabled = false;
    return;
  }

  try {
    const { ok, data } = await postJSON('/api/account/password-reset/request', { email });
    if (ok) {
      setMessage('forgot-password-message', data.message || 'If an account exists for that email, a reset link has been sent.', false);
    } else {
      setMessage('forgot-password-message', data.error || 'Failed to request password reset.', true);
    }
  } catch {
    setMessage('forgot-password-message', 'Network error. Please try again.', true);
  } finally {
    btn.disabled = false;
  }
});

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

  const username = document.getElementById('su-username').value.trim();
  const email    = document.getElementById('su-email').value.trim();
  const password = document.getElementById('su-password').value;

  try {
    const { ok, data } = await postJSON('/api/signup', { username, email, password });
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
      window.location.href = '/dashboard.html';
    } else {
      setMessage('login-message', data.error, true);
    }
  } catch {
    setMessage('login-message', 'Network error. Please try again.', true);
  } finally {
    btn.disabled = false;
  }
});

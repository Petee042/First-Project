'use strict';

function setResetMessage(text, isError) {
  const status = document.getElementById('reset-status');
  status.textContent = text;
  status.className = 'message ' + (isError ? 'error' : 'success');
}

function setResetDetail(text, isError) {
  const detail = document.getElementById('reset-detail');
  detail.textContent = text;
  detail.className = 'message ' + (isError ? 'error' : 'success');
}

function isStrongPassword(password) {
  const value = String(password || '');
  return value.length >= 8
    && /[A-Z]/.test(value)
    && /[0-9]/.test(value)
    && /[^A-Za-z0-9]/.test(value);
}

document.getElementById('resetPasswordForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const params = new URLSearchParams(window.location.search);
  const token = String(params.get('token') || '').trim();
  const password = document.getElementById('rp-password').value;
  const passwordConfirm = document.getElementById('rp-password-confirm').value;
  const btn = e.target.querySelector('button[type="submit"]');

  if (!token) {
    setResetMessage('Password reset token is missing.', true);
    setResetDetail('Please use the full reset link from your email.', true);
    return;
  }

  if (!isStrongPassword(password)) {
    setResetMessage('Password is too weak.', true);
    setResetDetail('Use at least 8 characters and include one uppercase, one number, and one special character.', true);
    return;
  }

  if (password !== passwordConfirm) {
    setResetMessage('Passwords do not match.', true);
    setResetDetail('Please re-enter matching passwords.', true);
    return;
  }

  btn.disabled = true;
  try {
    const response = await fetch('/api/account/password-reset/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setResetMessage('Password reset failed.', true);
      setResetDetail(String(payload.error || 'Please request a new reset link and try again.'), true);
      return;
    }

    setResetMessage('Password reset successful.', false);
    setResetDetail(String(payload.message || 'You can now log in with your new password.'), false);
    document.getElementById('resetPasswordForm').reset();
  } catch {
    setResetMessage('Password reset failed.', true);
    setResetDetail('Network error while resetting password. Please try again.', true);
  } finally {
    btn.disabled = false;
  }
});

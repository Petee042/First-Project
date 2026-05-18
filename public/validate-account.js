'use strict';

function setValidationMessage(text, isError) {
  const status = document.getElementById('validation-status');
  status.textContent = text;
  status.className = 'message ' + (isError ? 'error' : 'success');
}

function setValidationDetail(text, isError) {
  const detail = document.getElementById('validation-detail');
  detail.textContent = text;
  detail.className = 'message ' + (isError ? 'error' : 'success');
}

async function validateAccount() {
  const params = new URLSearchParams(window.location.search);
  const token = String(params.get('token') || '').trim();

  if (!token) {
    setValidationMessage('Validation token is missing.', true);
    setValidationDetail('Please use the full validation link from your email.', true);
    return;
  }

  try {
    const response = await fetch('/api/account/validate?token=' + encodeURIComponent(token));
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setValidationMessage('Account validation failed.', true);
      setValidationDetail(String(payload.error || 'Please request a new validation email and try again.'), true);
      return;
    }

    setValidationMessage('Your account is validated.', false);
    setValidationDetail(String(payload.message || 'You can now log in to your account.'), false);
  } catch {
    setValidationMessage('Account validation failed.', true);
    setValidationDetail('Network error while validating your account. Please try again.', true);
  }
}

validateAccount();

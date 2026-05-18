'use strict';

let currentUserId = null;

function setMessage(text, isError) {
  const el = document.getElementById('editSiteUserMessage');
  if (!el) return;
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function getUserIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const value = Number(params.get('userId'));
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

function isStrongPassword(password) {
  const value = String(password || '');
  return value.length >= 8
    && /[A-Z]/.test(value)
    && /[0-9]/.test(value)
    && /[^A-Za-z0-9]/.test(value);
}

async function checkAdminSession() {
  const res = await fetch('/api/admin/me');
  if (!res.ok) {
    window.location.href = '/Admin/index.html';
    return false;
  }
  return true;
}

function populateForm(user) {
  document.getElementById('editUserId').value = String(user.id || '');
  document.getElementById('editUsername').value = user.username || '';
  document.getElementById('editFirstName').value = user.first_name || '';
  document.getElementById('editFamilyName').value = user.family_name || '';
  document.getElementById('editCountry').value = user.country_of_residence || '';
  document.getElementById('editEmail').value = user.email || '';
  document.getElementById('editIsValidated').checked = user.is_validated !== false;
  document.getElementById('editPassword').value = '';
}

async function loadSiteUser() {
  const res = await fetch('/api/admin/site-users/' + encodeURIComponent(String(currentUserId)));
  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    window.location.href = '/Admin/index.html';
    return;
  }

  if (!res.ok) {
    setMessage(data.error || 'Failed to load site user.', true);
    return;
  }

  populateForm(data.user || {});
}

async function saveSiteUser() {
  const username = document.getElementById('editUsername').value.trim();
  const firstName = document.getElementById('editFirstName').value.trim();
  const familyName = document.getElementById('editFamilyName').value.trim();
  const country = document.getElementById('editCountry').value.trim();
  const email = document.getElementById('editEmail').value.trim();
  const password = document.getElementById('editPassword').value;
  const isValidated = document.getElementById('editIsValidated').checked;

  if (!username || !firstName || !familyName || !country || !email) {
    setMessage('Username, first name, family name, country, and email are required.', true);
    return;
  }

  if (password && !isStrongPassword(password)) {
    setMessage('New password must be at least 8 characters and include one uppercase, one number, and one special character.', true);
    return;
  }

  const saveBtn = document.getElementById('saveSiteUserBtn');
  saveBtn.disabled = true;

  try {
    const res = await fetch('/api/admin/site-users/' + encodeURIComponent(String(currentUserId)), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        firstName,
        familyName,
        country,
        email,
        password,
        isValidated
      })
    });
    const data = await res.json().catch(() => ({}));

    if (res.status === 401) {
      window.location.href = '/Admin/index.html';
      return;
    }

    if (!res.ok) {
      setMessage(data.error || 'Failed to save site user.', true);
      return;
    }

    setMessage(data.message || 'Site user updated.', false);
    if (data.user) {
      populateForm(data.user);
    }
  } catch {
    setMessage('Network error while saving site user.', true);
  } finally {
    saveBtn.disabled = false;
  }
}

async function deleteSiteUser() {
  const confirmed = window.confirm('Delete this site user and all associated data? This cannot be undone.');
  if (!confirmed) {
    return;
  }

  const deleteBtn = document.getElementById('deleteSiteUserBtn');
  deleteBtn.disabled = true;

  try {
    const res = await fetch('/api/admin/users/' + encodeURIComponent(String(currentUserId)), {
      method: 'DELETE'
    });
    const data = await res.json().catch(() => ({}));

    if (res.status === 401) {
      window.location.href = '/Admin/index.html';
      return;
    }

    if (!res.ok) {
      setMessage(data.error || 'Failed to delete site user.', true);
      return;
    }

    window.location.href = '/Admin/site-users.html';
  } catch {
    setMessage('Network error while deleting site user.', true);
  } finally {
    deleteBtn.disabled = false;
  }
}

(async () => {
  currentUserId = getUserIdFromUrl();
  if (!currentUserId) {
    setMessage('Missing or invalid user id.', true);
    return;
  }

  if (!(await checkAdminSession())) {
    return;
  }

  await loadSiteUser();
})();

document.getElementById('saveSiteUserBtn').addEventListener('click', saveSiteUser);
document.getElementById('deleteSiteUserBtn').addEventListener('click', deleteSiteUser);
document.getElementById('adminLogoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/Admin/index.html';
});

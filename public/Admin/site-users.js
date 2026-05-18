'use strict';

let allSiteUsers = [];

function setSiteUsersMessage(text, isError) {
  const el = document.getElementById('siteUsersMessage');
  if (!el) {
    return;
  }
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function getUserSearchText(user) {
  return [
    user.first_name,
    user.family_name,
    user.email
  ]
    .map((value) => String(value || '').toLowerCase())
    .join(' ');
}

function getFilteredSiteUsers() {
  const searchInput = document.getElementById('siteUsersSearch');
  const query = String(searchInput ? searchInput.value : '').trim().toLowerCase();
  if (!query) {
    return allSiteUsers.slice();
  }
  return allSiteUsers.filter((user) => getUserSearchText(user).includes(query));
}

async function checkAdminSession() {
  const res = await fetch('/api/admin/me');
  if (!res.ok) {
    window.location.href = '/Admin/index.html';
    return false;
  }
  return true;
}

async function loadSiteUsers() {
  const tbody = document.getElementById('siteUsersTableBody');
  tbody.innerHTML = '<tr><td colspan="4">Loading users...</td></tr>';

  const res = await fetch('/api/admin/site-users');
  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    window.location.href = '/Admin/index.html';
    return;
  }

  if (!res.ok) {
    setSiteUsersMessage(data.error || 'Failed to load site users.', true);
    tbody.innerHTML = '<tr><td colspan="4">Could not load site users.</td></tr>';
    return;
  }

  allSiteUsers = Array.isArray(data.users) ? data.users : [];
  renderSiteUsers();
}

function renderSiteUsers() {
  const tbody = document.getElementById('siteUsersTableBody');
  const countEl = document.getElementById('siteUsersCount');
  if (!tbody) {
    return;
  }

  const users = getFilteredSiteUsers();
  if (countEl) {
    const total = allSiteUsers.length;
    const shown = users.length;
    countEl.textContent = total === shown
      ? (total + ' site user' + (total === 1 ? '' : 's') + ' loaded.')
      : (shown + ' of ' + total + ' site users shown.');
  }

  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="4">No matching users found.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  users.forEach((user) => {
    const row = document.createElement('tr');

    const firstNameCell = document.createElement('td');
    firstNameCell.textContent = user.first_name || '—';

    const familyNameCell = document.createElement('td');
    familyNameCell.textContent = user.family_name || '—';

    const emailCell = document.createElement('td');
    emailCell.textContent = user.email || '—';

    const actionCell = document.createElement('td');
    const editLink = document.createElement('a');
    editLink.className = 'btn secondary inline-btn';
    editLink.href = '/Admin/site-user-edit.html?userId=' + encodeURIComponent(String(user.id || ''));
    editLink.textContent = String.fromCharCode(9998);
    editLink.setAttribute('aria-label', 'Edit user ' + String(user.email || user.id || ''));
    actionCell.appendChild(editLink);

    row.appendChild(firstNameCell);
    row.appendChild(familyNameCell);
    row.appendChild(emailCell);
    row.appendChild(actionCell);
    tbody.appendChild(row);
  });
}

(async () => {
  try {
    if (!(await checkAdminSession())) {
      return;
    }
    await loadSiteUsers();
  } catch (err) {
    setSiteUsersMessage(err.message || 'Failed to initialize site users list.', true);
  }
})();

document.getElementById('siteUsersSearch').addEventListener('input', () => {
  renderSiteUsers();
});

document.getElementById('adminLogoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/Admin/index.html';
});

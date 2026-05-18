'use strict';

function setSiteUsersMessage(text, isError) {
  const el = document.getElementById('siteUsersMessage');
  if (!el) {
    return;
  }
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function formatFullName(user) {
  return [user.first_name, user.family_name].filter(Boolean).join(' ').trim() || '—';
}

function formatCreatedAt(value) {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString();
}

function groupMemberships(memberships) {
  const grouped = new Map();
  (memberships || []).forEach((membership) => {
    const key = String(membership.client_account_id || '') + '|' + String(membership.client_display_name || '');
    if (!grouped.has(key)) {
      grouped.set(key, {
        client_account_id: membership.client_account_id,
        client_display_name: membership.client_display_name || ('Client #' + membership.client_account_id),
        roles: new Set(),
        statuses: new Set()
      });
    }
    const item = grouped.get(key);
    if (membership.role) {
      item.roles.add(String(membership.role));
    }
    if (membership.status) {
      item.statuses.add(String(membership.status));
    }
  });
  return Array.from(grouped.values());
}

function renderMembershipCell(user) {
  const wrap = document.createElement('div');
  wrap.className = 'site-users-memberships';

  const memberships = groupMemberships(user.memberships || []);
  if (!memberships.length) {
    const empty = document.createElement('span');
    empty.textContent = 'No client associations';
    wrap.appendChild(empty);
    return wrap;
  }

  memberships.forEach((membership) => {
    const item = document.createElement('div');
    item.className = 'site-users-membership-item';

    const title = document.createElement('div');
    title.className = 'site-users-membership-title';
    title.textContent = membership.client_display_name;
    item.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'site-users-membership-meta';
    const roles = Array.from(membership.roles).sort().join(', ') || 'No role';
    const statuses = Array.from(membership.statuses).sort().join(', ');
    meta.textContent = roles + (statuses ? ' | ' + statuses : '');
    item.appendChild(meta);

    wrap.appendChild(item);
  });

  return wrap;
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
  tbody.innerHTML = '<tr><td colspan="8">Loading users...</td></tr>';

  const res = await fetch('/api/admin/site-users');
  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    window.location.href = '/Admin/index.html';
    return;
  }

  if (!res.ok) {
    setSiteUsersMessage(data.error || 'Failed to load site users.', true);
    tbody.innerHTML = '<tr><td colspan="8">Could not load site users.</td></tr>';
    return;
  }

  const users = Array.isArray(data.users) ? data.users : [];
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="8">No users found.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  users.forEach((user) => {
    const row = document.createElement('tr');

    const idCell = document.createElement('td');
    idCell.textContent = String(user.id || '');

    const usernameCell = document.createElement('td');
    usernameCell.textContent = user.username || '—';

    const nameCell = document.createElement('td');
    nameCell.textContent = formatFullName(user);

    const emailCell = document.createElement('td');
    emailCell.textContent = user.email || '—';

    const telephoneCell = document.createElement('td');
    telephoneCell.textContent = user.telephone || '—';

    const validatedCell = document.createElement('td');
    validatedCell.textContent = user.is_validated === false ? 'No' : 'Yes';

    const membershipsCell = document.createElement('td');
    membershipsCell.appendChild(renderMembershipCell(user));

    const createdCell = document.createElement('td');
    createdCell.textContent = formatCreatedAt(user.created_at);

    row.appendChild(idCell);
    row.appendChild(usernameCell);
    row.appendChild(nameCell);
    row.appendChild(emailCell);
    row.appendChild(telephoneCell);
    row.appendChild(validatedCell);
    row.appendChild(membershipsCell);
    row.appendChild(createdCell);
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

document.getElementById('adminLogoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/Admin/index.html';
});

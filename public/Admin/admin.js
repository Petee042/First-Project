'use strict';

function setAdminMessage(text, isError) {
  const el = document.getElementById('adminMessage');
  el.textContent = text;
  el.className = text ? 'message ' + (isError ? 'error' : 'success') : 'message';
}

function setAdminAuthenticated(isAuthenticated) {
  const loginSection = document.getElementById('adminLoginSection');
  const panelSection = document.getElementById('adminPanelSection');

  if (isAuthenticated) {
    loginSection.classList.add('hidden');
    panelSection.classList.remove('hidden');
  } else {
    loginSection.classList.remove('hidden');
    panelSection.classList.add('hidden');
  }
}

function renderUsers(users) {
  const select = document.getElementById('adminUserSelect');
  select.innerHTML = '';

  if (!users.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No users found';
    select.appendChild(option);
    select.disabled = true;
    document.getElementById('deleteUserBtn').disabled = true;
    return;
  }

  users.forEach((user) => {
    const option = document.createElement('option');
    option.value = String(user.id);
    option.textContent = user.username + ' (' + user.email + ')';
    select.appendChild(option);
  });

  select.disabled = false;
  document.getElementById('deleteUserBtn').disabled = false;
}

async function checkAdminSession() {
  const res = await fetch('/api/admin/me');
  if (!res.ok) {
    setAdminAuthenticated(false);
    return false;
  }

  setAdminAuthenticated(true);
  return true;
}

async function loadUsers() {
  const res = await fetch('/api/admin/users');
  if (res.status === 401) {
    setAdminAuthenticated(false);
    setAdminMessage('Admin login required.', true);
    return;
  }

  const data = await res.json();
  if (!res.ok) {
    setAdminMessage(data.error || 'Failed to load users.', true);
    return;
  }

  renderUsers(data.users || []);
}

(async () => {
  try {
    const isAuthed = await checkAdminSession();
    if (isAuthed) {
      await loadUsers();
    }
  } catch {
    setAdminMessage('Failed to load admin page.', true);
  }
})();

document.getElementById('adminLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const button = e.target.querySelector('button[type="submit"]');
  const username = document.getElementById('adminUsername').value.trim();
  const password = document.getElementById('adminPassword').value;

  if (!username || !password) {
    setAdminMessage('Username and password are required.', true);
    return;
  }

  button.disabled = true;
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    if (!res.ok) {
      setAdminMessage(data.error || 'Admin login failed.', true);
      return;
    }

    setAdminMessage('Admin login successful.', false);
    setAdminAuthenticated(true);
    await loadUsers();
  } catch {
    setAdminMessage('Network error during admin login.', true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('deleteUserBtn').addEventListener('click', async () => {
  const select = document.getElementById('adminUserSelect');
  const userId = Number(select.value);

  if (!Number.isInteger(userId) || userId <= 0) {
    setAdminMessage('Select a valid user first.', true);
    return;
  }

  const userLabel = select.options[select.selectedIndex]
    ? select.options[select.selectedIndex].textContent
    : 'selected user';

  const confirmed = window.confirm('Confirm delete user: ' + userLabel + '? This removes all associated data.');
  if (!confirmed) {
    return;
  }

  const button = document.getElementById('deleteUserBtn');
  button.disabled = true;
  try {
    const res = await fetch('/api/admin/users/' + encodeURIComponent(userId), {
      method: 'DELETE'
    });

    const data = await res.json();
    if (!res.ok) {
      setAdminMessage(data.error || 'Failed to delete user.', true);
      return;
    }

    setAdminMessage('User deleted successfully.', false);
    await loadUsers();
  } catch {
    setAdminMessage('Network error deleting user.', true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('adminLogoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/Admin/index.html';
});

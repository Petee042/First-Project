'use strict';

function setCalendarMessage(text, isError) {
  const el = document.getElementById('calendarMessage');
  el.textContent = text;
  el.className = text ? 'message ' + (isError ? 'error' : 'success') : 'message';
}

function renderCalendarRows(events) {
  const tbody = document.getElementById('calendarTableBody');
  tbody.innerHTML = '';

  if (!events.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.textContent = 'No events found in calendar feed.';
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  events.forEach((event) => {
    const row = document.createElement('tr');

    const startCell = document.createElement('td');
    startCell.textContent = event.start || '-';

    const titleCell = document.createElement('td');
    titleCell.textContent = event.title || '(untitled event)';

    const locationCell = document.createElement('td');
    locationCell.textContent = event.location || '-';

    row.appendChild(startCell);
    row.appendChild(titleCell);
    row.appendChild(locationCell);
    tbody.appendChild(row);
  });
}

(async () => {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) {
      // Not authenticated — redirect to login page
      window.location.href = '/';
      return;
    }

    const user = await res.json();
    document.getElementById('displayName').textContent     = user.username;
    document.getElementById('displayUsername').textContent = user.username;
    document.getElementById('displayEmail').textContent    = user.email;
  } catch {
    window.location.href = '/';
  }
})();

document.getElementById('loadCalendarBtn').addEventListener('click', async () => {
  const input = document.getElementById('calendarUrl');
  const button = document.getElementById('loadCalendarBtn');
  const calendarUrl = input.value.trim();

  if (!calendarUrl) {
    setCalendarMessage('Please enter a calendar URL.', true);
    return;
  }

  button.disabled = true;
  setCalendarMessage('Loading calendar...', false);

  try {
    const res = await fetch('/api/calendar-entries?url=' + encodeURIComponent(calendarUrl));
    const data = await res.json();

    if (!res.ok) {
      setCalendarMessage(data.error || 'Failed to load calendar.', true);
      return;
    }

    renderCalendarRows(data.events || []);
    setCalendarMessage('Loaded ' + (data.events || []).length + ' entries.', false);
  } catch {
    setCalendarMessage('Network error while loading calendar.', true);
  } finally {
    button.disabled = false;
  }
});

// ── Logout ───────────────────────────────────────────────────
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
});

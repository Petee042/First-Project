'use strict';

function setCalendarMessage(text, isError) {
  const el = document.getElementById('calendarMessage');
  el.textContent = text;
  el.className = text ? 'message ' + (isError ? 'error' : 'success') : 'message';
}

function formatDate(iso) {
  if (!iso) return '-';
  // For all-day dates (YYYY-MM-DD) show as-is, otherwise format as local date/time
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function buildTooltip(event) {
  const raw = event.raw || {};
  return Object.entries(raw)
    .map(([k, v]) => k + ': ' + v)
    .join('\n');
}

function renderCalendarRows(events) {
  const tbody = document.getElementById('calendarTableBody');
  tbody.innerHTML = '';

  if (!events.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.textContent = 'No events found in calendar feeds.';
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  events.forEach((event) => {
    const row = document.createElement('tr');
    row.title = buildTooltip(event);

    const sourceCell = document.createElement('td');
    sourceCell.textContent = event.source || '-';
    sourceCell.className = 'source-' + (event.source || '').toLowerCase().replace(/[^a-z]/g, '');

    const startCell = document.createElement('td');
    startCell.textContent = formatDate(event.start);

    const endCell = document.createElement('td');
    endCell.textContent = formatDate(event.end);

    const titleCell = document.createElement('td');
    titleCell.textContent = event.title || '(untitled)';

    const descCell = document.createElement('td');
    descCell.textContent = event.description || '-';

    row.appendChild(sourceCell);
    row.appendChild(startCell);
    row.appendChild(endCell);
    row.appendChild(titleCell);
    row.appendChild(descCell);
    tbody.appendChild(row);
  });
}

async function fetchCalendar(url, source) {
  const res = await fetch('/api/calendar-entries?url=' + encodeURIComponent(url));
  const data = await res.json();
  if (!res.ok) throw new Error(source + ': ' + (data.error || 'Failed to load'));
  return (data.events || []).map((e) => Object.assign({ source }, e));
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
  const airbnbUrl  = document.getElementById('airbnbUrl').value.trim();
  const bookingUrl = document.getElementById('bookingUrl').value.trim();
  const button     = document.getElementById('loadCalendarBtn');

  if (!airbnbUrl && !bookingUrl) {
    setCalendarMessage('Please enter at least one calendar URL.', true);
    return;
  }

  button.disabled = true;
  setCalendarMessage('Loading calendars...', false);

  try {
    const fetches = [];
    if (airbnbUrl)  fetches.push(fetchCalendar(airbnbUrl,  'Airbnb'));
    if (bookingUrl) fetches.push(fetchCalendar(bookingUrl, 'Booking.com'));

    const results = await Promise.allSettled(fetches);
    const errors  = [];
    let allEvents = [];

    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        allEvents = allEvents.concat(result.value);
      } else {
        errors.push(result.reason.message);
      }
    });

    // Sort by start date ascending
    allEvents.sort((a, b) => {
      const da = a.start ? new Date(a.start) : new Date(0);
      const db = b.start ? new Date(b.start) : new Date(0);
      return da - db;
    });

    renderCalendarRows(allEvents);

    if (errors.length) {
      setCalendarMessage(errors.join(' | '), true);
    } else {
      setCalendarMessage('Loaded ' + allEvents.length + ' entries.', false);
    }
  } catch {
    setCalendarMessage('Unexpected error loading calendars.', true);
  } finally {
    button.disabled = false;
  }
});

// ── Logout ───────────────────────────────────────────────────
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
});

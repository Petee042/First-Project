'use strict';

const params = new URLSearchParams(window.location.search);
const listingId = Number(params.get('id'));
let currentFeeds = [];

function setListingMessage(text, isError) {
  const el = document.getElementById('listingMessage');
  el.textContent = text;
  el.className = text ? 'message ' + (isError ? 'error' : 'success') : 'message';
}

function setCalendarMessage(text, isError) {
  const el = document.getElementById('calendarMessage');
  el.textContent = text;
  el.className = text ? 'message ' + (isError ? 'error' : 'success') : 'message';
}

function formatDate(iso) {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
  } catch {
    return iso;
  }
}

function buildTooltip(event) {
  const raw = event.raw || {};
  return Object.entries(raw).map(([k, v]) => k + ': ' + v).join('\n');
}

function toEventTime(value, fallbackValue) {
  const candidate = value || fallbackValue;
  if (!candidate) return null;
  const time = new Date(candidate).getTime();
  return Number.isNaN(time) ? null : time;
}

function getOverlapFlags(events) {
  const flags = new Array(events.length).fill(false);

  for (let i = 0; i < events.length; i += 1) {
    const aStart = toEventTime(events[i].start, events[i].end);
    const aEnd = toEventTime(events[i].end, events[i].start);
    if (aStart === null || aEnd === null) continue;

    for (let j = i + 1; j < events.length; j += 1) {
      const bStart = toEventTime(events[j].start, events[j].end);
      const bEnd = toEventTime(events[j].end, events[j].start);
      if (bStart === null || bEnd === null) continue;

      if (aStart < bEnd && bStart < aEnd) {
        flags[i] = true;
        flags[j] = true;
      }
    }
  }

  return flags;
}

function renderFeeds(feeds) {
  currentFeeds = feeds;
  const tbody = document.getElementById('feedsTableBody');
  tbody.innerHTML = '';

  if (!feeds.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.textContent = 'No feeds yet.';
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  feeds.forEach((feed) => {
    const row = document.createElement('tr');

    const labelCell = document.createElement('td');
    labelCell.textContent = feed.label;

    const urlCell = document.createElement('td');
    urlCell.textContent = feed.url;

    const actionCell = document.createElement('td');
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn secondary';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => {
      document.getElementById('feedId').value = String(feed.id);
      document.getElementById('feedLabel').value = feed.label;
      document.getElementById('feedUrl').value = feed.url;
      document.getElementById('saveFeedBtn').textContent = 'Save Feed';
      document.getElementById('cancelFeedEditBtn').classList.remove('hidden');
      setListingMessage('Editing feed: ' + feed.label, false);
    });

    actionCell.appendChild(editBtn);
    row.appendChild(labelCell);
    row.appendChild(urlCell);
    row.appendChild(actionCell);
    tbody.appendChild(row);
  });
}

function renderEvents(events) {
  const tbody = document.getElementById('calendarTableBody');
  tbody.innerHTML = '';

  if (!events.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.textContent = 'No events found for this listing.';
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  const overlapFlags = getOverlapFlags(events);

  events.forEach((event, idx) => {
    const row = document.createElement('tr');
    row.title = buildTooltip(event);
    if (overlapFlags[idx]) {
      row.classList.add('conflict-row');
    }

    const sourceCell = document.createElement('td');
    sourceCell.textContent = event.source || '-';

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

function clearFeedEditMode() {
  document.getElementById('feedId').value = '';
  document.getElementById('feedLabel').value = '';
  document.getElementById('feedUrl').value = '';
  document.getElementById('saveFeedBtn').textContent = 'Add Feed';
  document.getElementById('cancelFeedEditBtn').classList.add('hidden');
}

async function loadListing() {
  const listingRes = await fetch('/api/listings/' + listingId);
  if (listingRes.status === 401) {
    window.location.href = '/';
    return;
  }
  if (listingRes.status === 404) {
    setListingMessage('Listing not found.', true);
    return;
  }

  const listingData = await listingRes.json();
  if (!listingRes.ok) {
    throw new Error(listingData.error || 'Failed to load listing.');
  }

  const listing = listingData.listing;
  document.getElementById('listingTitle').textContent = 'Listing: ' + listing.name;
  document.getElementById('listingName').value = listing.name;

  const feedsRes = await fetch('/api/listings/' + listingId + '/feeds');
  const feedsData = await feedsRes.json();
  if (!feedsRes.ok) {
    throw new Error(feedsData.error || 'Failed to load feeds.');
  }

  renderFeeds(feedsData.feeds || []);
}

async function updateCalendars() {
  const button = document.getElementById('updateCalendarsBtn');
  button.disabled = true;
  setCalendarMessage('Updating calendars...', false);

  try {
    const res = await fetch('/api/listings/' + listingId + '/events');
    const data = await res.json();

    if (!res.ok) {
      setCalendarMessage(data.error || 'Failed to load events.', true);
      return;
    }

    renderEvents(data.events || []);

    if (data.feedErrors && data.feedErrors.length) {
      const parts = data.feedErrors.map((e) => e.source + ': ' + e.error);
      setCalendarMessage('Loaded with feed issues: ' + parts.join(' | '), true);
    } else {
      setCalendarMessage('Loaded ' + (data.events || []).length + ' events.', false);
    }
  } catch {
    setCalendarMessage('Network error loading events.', true);
  } finally {
    button.disabled = false;
  }
}

(async () => {
  if (!Number.isInteger(listingId) || listingId <= 0) {
    setListingMessage('Invalid listing id.', true);
    return;
  }

  try {
    const meRes = await fetch('/api/me');
    if (!meRes.ok) {
      window.location.href = '/';
      return;
    }

    await loadListing();
  } catch (err) {
    setListingMessage(err.message || 'Failed to load listing page.', true);
  }
})();

document.getElementById('renameListingForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = e.target.querySelector('button[type="submit"]');
  const name = document.getElementById('listingName').value.trim();

  if (!name) {
    setListingMessage('Listing name is required.', true);
    return;
  }

  button.disabled = true;
  try {
    const res = await fetch('/api/listings/' + listingId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();

    if (!res.ok) {
      setListingMessage(data.error || 'Failed to save listing name.', true);
      return;
    }

    document.getElementById('listingTitle').textContent = 'Listing: ' + data.listing.name;
    setListingMessage('Listing name updated.', false);
  } catch {
    setListingMessage('Network error saving listing name.', true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('feedForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const feedId = document.getElementById('feedId').value.trim();
  const label = document.getElementById('feedLabel').value.trim();
  const url = document.getElementById('feedUrl').value.trim();
  const saveBtn = document.getElementById('saveFeedBtn');

  if (!label || !url) {
    setListingMessage('Feed source and URL are required.', true);
    return;
  }

  saveBtn.disabled = true;
  try {
    const isEdit = Boolean(feedId);
    const endpoint = isEdit
      ? '/api/listings/' + listingId + '/feeds/' + encodeURIComponent(feedId)
      : '/api/listings/' + listingId + '/feeds';
    const method = isEdit ? 'PUT' : 'POST';

    const res = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, url })
    });
    const data = await res.json();

    if (!res.ok) {
      setListingMessage(data.error || 'Failed to save feed.', true);
      return;
    }

    clearFeedEditMode();
    setListingMessage(isEdit ? 'Feed updated.' : 'Feed added.', false);
    await loadListing();
  } catch {
    setListingMessage('Network error saving feed.', true);
  } finally {
    saveBtn.disabled = false;
  }
});

document.getElementById('cancelFeedEditBtn').addEventListener('click', () => {
  clearFeedEditMode();
  setListingMessage('', false);
});

document.getElementById('updateCalendarsBtn').addEventListener('click', updateCalendars);

document.getElementById('backBtn').addEventListener('click', () => {
  window.location.href = '/dashboard.html';
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
});

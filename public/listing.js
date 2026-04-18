'use strict';

const params = new URLSearchParams(window.location.search);
const listingId = Number(params.get('id'));
let currentFeeds = [];
let currentEvents = [];
let currentMonthDate = new Date();

const sourceColorMap = {};
const sourcePalette = ['#ff5a5f', '#003580', '#2a9d8f', '#e76f51', '#264653', '#f4a261', '#8a5cf6'];

function normaliseSourceKey(source) {
  return String(source || 'Unknown').trim().toLowerCase();
}

function getSourceColor(source) {
  const key = normaliseSourceKey(source);
  if (!sourceColorMap[key]) {
    const idx = Object.keys(sourceColorMap).length % sourcePalette.length;
    sourceColorMap[key] = sourcePalette[idx];
  }
  return sourceColorMap[key];
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function keyFromUtcDate(date) {
  return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate());
}

function utcDateFromKey(key) {
  const parts = key.split('-').map((v) => Number(v));
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

function addUtcDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function toDateKey(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return keyFromUtcDate(d);
}

function formatMonthLabel(date) {
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return monthNames[date.getUTCMonth()] + ' ' + date.getUTCFullYear();
}

function formatDateKeyForTooltip(key) {
  if (!key) return 'Unknown';
  const date = utcDateFromKey(key);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return date.getUTCDate() + ' ' + monthNames[date.getUTCMonth()] + ' ' + date.getUTCFullYear();
}

function getEventSummary(event) {
  return event.title || (event.raw && event.raw.SUMMARY) || '(untitled)';
}

function buildBarTooltip(events) {
  if (!events || !events.length) return '';

  return events.map((event) => {
    const checkin = formatDateKeyForTooltip(toDateKey(event.start));
    const checkout = formatDateKeyForTooltip(toDateKey(event.end));
    return 'Summary: ' + getEventSummary(event)
      + '\nCheck-in: ' + checkin
      + '\nCheck-out: ' + checkout;
  }).join('\n\n');
}

function monthStartUtc(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function buildDayIndex(events) {
  const index = {};

  function ensureDay(key) {
    if (!index[key]) {
      index[key] = {
        stays: new Set(),
        checkins: new Set(),
        checkouts: new Set(),
        stayEventsBySource: {},
        checkinEventsBySource: {},
        checkoutEventsBySource: {},
        events: [],
        conflict: false
      };
    }
    return index[key];
  }

  function addSourceEvent(day, fieldName, source, event) {
    if (!day[fieldName][source]) {
      day[fieldName][source] = [];
    }
    day[fieldName][source].push(event);
  }

  events.forEach((event) => {
    const source = event.source || 'Unknown';
    const startKey = toDateKey(event.start);
    const rawEndKey = toDateKey(event.end);
    if (!startKey) return;

    const startDate = utcDateFromKey(startKey);
    let endDate = rawEndKey ? utcDateFromKey(rawEndKey) : addUtcDays(startDate, 1);

    if (endDate <= startDate) {
      endDate = addUtcDays(startDate, 1);
    }

    const checkinDay = ensureDay(startKey);
    checkinDay.checkins.add(source);
    addSourceEvent(checkinDay, 'checkinEventsBySource', source, event);

    const checkoutKey = keyFromUtcDate(endDate);
    const checkoutDay = ensureDay(checkoutKey);
    checkoutDay.checkouts.add(source);
    addSourceEvent(checkoutDay, 'checkoutEventsBySource', source, event);

    for (let cursor = new Date(startDate.getTime()); cursor < endDate; cursor = addUtcDays(cursor, 1)) {
      const day = ensureDay(keyFromUtcDate(cursor));
      day.stays.add(source);
      day.events.push(event);
      addSourceEvent(day, 'stayEventsBySource', source, event);
    }
  });

  Object.keys(index).forEach((key) => {
    if (index[key].stays.size > 1) {
      index[key].conflict = true;
    }
  });

  return index;
}

function buildDayTooltip(dayEntry) {
  if (!dayEntry || !dayEntry.events.length) return '';

  return dayEntry.events.map((event) => {
    const rawLines = Object.entries(event.raw || {}).map(([k, v]) => k + ': ' + v).join(' | ');
    const title = event.title ? event.title : '(untitled)';
    return (event.source || 'Unknown') + ' - ' + title + (rawLines ? ' - ' + rawLines : '');
  }).join('\n');
}

function renderLegend(events) {
  const legend = document.getElementById('calendarLegend');
  legend.innerHTML = '';

  const labels = new Set();
  currentFeeds.forEach((feed) => labels.add(feed.label));
  events.forEach((event) => labels.add(event.source || 'Unknown'));

  if (!labels.size) {
    legend.textContent = 'No feed sources yet.';
    return;
  }

  Array.from(labels).forEach((label) => {
    const item = document.createElement('div');
    item.className = 'legend-item';

    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.style.backgroundColor = getSourceColor(label);

    const text = document.createElement('span');
    text.textContent = label;

    item.appendChild(swatch);
    item.appendChild(text);
    legend.appendChild(item);
  });
}

function getCalendarSources(events) {
  const sources = [];
  const seen = new Set();

  function addSource(source) {
    const label = String(source || 'Unknown').trim() || 'Unknown';
    const key = normaliseSourceKey(label);
    if (seen.has(key)) return;
    seen.add(key);
    sources.push(label);
  }

  currentFeeds.forEach((feed) => addSource(feed.label));
  events.forEach((event) => addSource(event.source || 'Unknown'));
  return sources;
}

function renderReservationCalendar(events) {
  const calendar = document.getElementById('reservationCalendar');
  const monthLabel = document.getElementById('monthLabel');
  const monthStart = monthStartUtc(currentMonthDate);
  const dayIndex = buildDayIndex(events);
  const sources = getCalendarSources(events);

  monthLabel.textContent = formatMonthLabel(monthStart);
  calendar.innerHTML = '';

  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const corner = document.createElement('div');
  corner.className = 'calendar-weekday calendar-weekday-corner';
  corner.textContent = 'Channels';
  calendar.appendChild(corner);

  weekdayNames.forEach((name) => {
    const header = document.createElement('div');
    header.className = 'calendar-weekday';
    header.textContent = name;
    calendar.appendChild(header);
  });

  const firstDayOfWeek = monthStart.getUTCDay();
  const nextMonthStart = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
  const daysInMonth = Math.round((nextMonthStart - monthStart) / 86400000);

  const dayNumbers = [];
  for (let i = 0; i < firstDayOfWeek; i += 1) {
    dayNumbers.push(null);
  }

  for (let dayNum = 1; dayNum <= daysInMonth; dayNum += 1) {
    dayNumbers.push(dayNum);
  }

  while (dayNumbers.length % 7 !== 0) {
    dayNumbers.push(null);
  }

  const daySources = sources.length ? sources : ['Unknown'];

  for (let weekStart = 0; weekStart < dayNumbers.length; weekStart += 7) {
    if (weekStart === 0) {
      const labelsCell = document.createElement('div');
      labelsCell.className = 'calendar-channel-labels';

      daySources.forEach((source) => {
        const row = document.createElement('div');
        row.className = 'calendar-channel-label-row';

        const swatch = document.createElement('span');
        swatch.className = 'calendar-channel-label-swatch';
        swatch.style.backgroundColor = getSourceColor(source);

        const text = document.createElement('span');
        text.className = 'calendar-channel-label-text';
        text.textContent = source;
        text.title = source;

        row.appendChild(swatch);
        row.appendChild(text);
        labelsCell.appendChild(row);
      });

      calendar.appendChild(labelsCell);
    } else {
      const spacer = document.createElement('div');
      spacer.className = 'calendar-channel-labels-spacer';
      calendar.appendChild(spacer);
    }

    for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
      const dayNum = dayNumbers[weekStart + dayOffset];

      if (dayNum === null) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'calendar-day calendar-day-empty';
        calendar.appendChild(emptyCell);
        continue;
      }

      const date = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), dayNum));
      const key = keyFromUtcDate(date);
      const dayEntry = dayIndex[key];

      const cell = document.createElement('div');
      cell.className = 'calendar-day';
      if (dayEntry && dayEntry.conflict) {
        cell.classList.add('calendar-day-conflict');
      }
      cell.title = buildDayTooltip(dayEntry);

      const num = document.createElement('div');
      num.className = 'calendar-day-number';
      num.textContent = String(dayNum);
      cell.appendChild(num);

      const bars = document.createElement('div');
      bars.className = 'calendar-day-bars';

      daySources.forEach((source) => {
        const slot = document.createElement('div');
        slot.className = 'day-bar-slot';

        const bar = document.createElement('div');
        bar.className = 'day-bar';

        if (!dayEntry) {
          bar.classList.add('day-bar-empty');
          slot.appendChild(bar);
          bars.appendChild(slot);
          return;
        }

        const hasCheckout = dayEntry.checkouts.has(source);
        const hasCheckin = dayEntry.checkins.has(source);
        const hasStay = dayEntry.stays.has(source);
        const color = getSourceColor(source);
        const transparentStop = color.length === 7
          ? color + '00'
          : 'rgba(0,0,0,0)';

        if (hasCheckout && hasCheckin) {
          bar.classList.add('day-transition-bar');
          bar.style.background = 'linear-gradient(90deg, ' + color + ' 0 50%, ' + color + ' 50% 100%)';
          bar.title = buildBarTooltip((dayEntry.checkoutEventsBySource[source] || []).concat(dayEntry.checkinEventsBySource[source] || []));
        } else if (hasCheckout) {
          bar.classList.add('day-transition-bar');
          bar.style.background = 'linear-gradient(90deg, ' + color + ' 0 50%, ' + transparentStop + ' 50% 100%)';
          bar.title = buildBarTooltip(dayEntry.checkoutEventsBySource[source] || []);
        } else if (hasCheckin) {
          bar.classList.add('day-transition-bar');
          bar.style.background = 'linear-gradient(90deg, ' + transparentStop + ' 0 50%, ' + color + ' 50% 100%)';
          bar.title = buildBarTooltip(dayEntry.checkinEventsBySource[source] || []);
        } else if (hasStay) {
          bar.style.backgroundColor = color;
          bar.title = buildBarTooltip(dayEntry.stayEventsBySource[source] || []);
        } else {
          bar.classList.add('day-bar-empty');
        }

        slot.appendChild(bar);
        bars.appendChild(slot);
      });

      cell.appendChild(bars);
      calendar.appendChild(cell);
    }
  }
}

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

  renderLegend(currentEvents);
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
  renderReservationCalendar(currentEvents);
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

    currentEvents = data.events || [];
    renderLegend(currentEvents);
    renderReservationCalendar(currentEvents);

    if (data.feedErrors && data.feedErrors.length) {
      const parts = data.feedErrors.map((e) => e.source + ': ' + e.error);
      setCalendarMessage('Loaded with feed issues: ' + parts.join(' | '), true);
    } else {
      setCalendarMessage('Loaded ' + currentEvents.length + ' events.', false);
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
    renderLegend(currentEvents);
    renderReservationCalendar(currentEvents);
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

document.getElementById('prevMonthBtn').addEventListener('click', () => {
  currentMonthDate = new Date(Date.UTC(currentMonthDate.getUTCFullYear(), currentMonthDate.getUTCMonth() - 1, 1));
  renderReservationCalendar(currentEvents);
});

document.getElementById('nextMonthBtn').addEventListener('click', () => {
  currentMonthDate = new Date(Date.UTC(currentMonthDate.getUTCFullYear(), currentMonthDate.getUTCMonth() + 1, 1));
  renderReservationCalendar(currentEvents);
});

document.getElementById('backBtn').addEventListener('click', () => {
  window.location.href = '/dashboard.html';
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
});

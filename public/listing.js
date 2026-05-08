'use strict';

const params = new URLSearchParams(window.location.search);
const listingId = Number(params.get('id'));
let currentFeeds = [];
let currentEvents = [];
let currentMonthDate = new Date();
let sourceColorPreferences = {};
let currentProperties = [];
let currentCleaningChanges = [];
let cleanerInitialsById = new Map();
let cleanerNameById = new Map();
let currentListingMeta = null;

const sourceColorMap = {};
const sourcePalette = ['#ff5a5f', '#003580', '#2a9d8f', '#e76f51', '#264653', '#f4a261', '#8a5cf6'];

function normaliseSourceKey(source) {
  return String(source || 'Unknown').trim().toLowerCase();
}

function normaliseHexColor(value) {
  const color = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : null;
}

function setSourceColorPreferences(sources) {
  sourceColorPreferences = {};
  (sources || []).forEach((source) => {
    const key = normaliseSourceKey(source.label);
    const color = normaliseHexColor(source.color);
    if (key && color) {
      sourceColorPreferences[key] = color;
    }
  });
}

function getSourceColor(source) {
  const key = normaliseSourceKey(source);
  if (sourceColorPreferences[key]) {
    return sourceColorPreferences[key];
  }
  if (!sourceColorMap[key]) {
    const idx = Object.keys(sourceColorMap).length % sourcePalette.length;
    sourceColorMap[key] = sourcePalette[idx];
  }
  return sourceColorMap[key];
}

async function loadSourceColorPreferences() {
  const res = await fetch('/api/feed-sources');
  if (res.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load feed source colors.');
  }

  setSourceColorPreferences(data.sources || []);
}

async function loadProperties() {
  const res = await fetch('/api/properties');
  if (res.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load properties.');
  }

  currentProperties = data.properties || [];
  const select = document.getElementById('listingPropertyId');
  select.innerHTML = '';
  currentProperties.forEach((property) => {
    const option = document.createElement('option');
    option.value = String(property.id);
    option.textContent = property.name;
    select.appendChild(option);
  });
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

function dateKeyLess(a, b) {
  return String(a || '') < String(b || '');
}

function dateKeyGreater(a, b) {
  return String(a || '') > String(b || '');
}

function eachDateKeyInclusive(startKey, endKey, callback) {
  if (!startKey || !endKey) return;
  const startDate = utcDateFromKey(startKey);
  const endDate = utcDateFromKey(endKey);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return;
  const step = startDate <= endDate ? 1 : -1;
  for (let cursor = new Date(startDate.getTime()); ; cursor = addUtcDays(cursor, step)) {
    callback(keyFromUtcDate(cursor));
    if (cursor.getTime() === endDate.getTime()) {
      break;
    }
  }
}

function initialsFromName(name) {
  const tokens = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return '';
  if (tokens.length === 1) return tokens[0].charAt(0).toUpperCase();
  return (tokens[0].charAt(0) + tokens[tokens.length - 1].charAt(0)).toUpperCase();
}

function getCleanerInitials(change) {
  if (change && change.cleaner_id && cleanerInitialsById.has(Number(change.cleaner_id))) {
    return cleanerInitialsById.get(Number(change.cleaner_id));
  }
  const cleanerName = String(change && change.cleaner_name ? change.cleaner_name : '').trim();
  if (!cleanerName || cleanerName.toLowerCase() === 'unallocated') {
    return '';
  }
  return initialsFromName(cleanerName);
}

function deriveCleaningChangesFromEvents(events, listingMeta) {
  const cleanerId = listingMeta && listingMeta.usual_cleaner_id
    ? Number(listingMeta.usual_cleaner_id)
    : null;
  const cleanerName = cleanerId && cleanerNameById.has(cleanerId)
    ? cleanerNameById.get(cleanerId)
    : '';
  const dateBasis = listingMeta && listingMeta.date_basis === 'checkin' ? 'checkin' : 'checkout';

  return (events || [])
    .filter((event) => event && event.isReservation !== false)
    .map((event) => {
      const checkinKey = toDateKey(event.start);
      const checkoutKey = toDateKey(event.end);
      if (!checkinKey || !checkoutKey) {
        return null;
      }
      return {
        reservation_checkin_date: checkinKey,
        reservation_checkout_date: checkoutKey,
        changeover_date: dateBasis === 'checkin' ? checkinKey : checkoutKey,
        cleaner_id: cleanerId || null,
        cleaner_name: cleanerName || 'Unallocated'
      };
    })
    .filter(Boolean);
}

function buildCleaningInitialsByDate(changes) {
  const byDate = {};
  (changes || []).forEach((change) => {
    const checkinKey = toDateKey(change.reservation_checkin_date);
    const checkoutKey = toDateKey(change.reservation_checkout_date);
    const cleanKey = toDateKey(change.changeover_date);
    if (!checkinKey || !checkoutKey || !cleanKey) {
      return;
    }

    const initials = getCleanerInitials(change);
    if (!initials) {
      return;
    }

    let startKey = cleanKey;
    let endKey = cleanKey;

    if (dateKeyLess(cleanKey, checkinKey)) {
      startKey = cleanKey;
      endKey = checkinKey;
    } else if (dateKeyGreater(cleanKey, checkoutKey)) {
      startKey = checkoutKey;
      endKey = cleanKey;
    }

    eachDateKeyInclusive(startKey, endKey, (dateKey) => {
      if (!byDate[dateKey]) {
        byDate[dateKey] = new Set();
      }
      byDate[dateKey].add(initials);
    });
  });

  return byDate;
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

function isAirbnbNotAvailableEvent(event, sourceLabel) {
  const sourceKey = normaliseSourceKey(sourceLabel || (event && event.source));
  if (!sourceKey.includes('airbnb')) {
    return false;
  }
  const summary = String(getEventSummary(event) || '').toLowerCase();
  return summary.includes('not available');
}

function shouldDimBar(events, sourceLabel) {
  return (events || []).some((event) => isAirbnbNotAvailableEvent(event, sourceLabel));
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

function hasDisplayUnavailable(events) {
  return (events || []).some((event) => event && event.isUnavailableBlock);
}

function hasReservationEligible(events) {
  return (events || []).some((event) => event && event.isReservation !== false);
}

function applyUnavailableHatch(bar) {
  bar.classList.add('day-bar-unavailable');
  const hatch = document.createElement('span');
  hatch.className = 'day-bar-hatch';
  bar.appendChild(hatch);
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
  const cleanerInitialsByDate = buildCleaningInitialsByDate(currentCleaningChanges);
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

      const dayCleanerInitials = cleanerInitialsByDate[key] ? Array.from(cleanerInitialsByDate[key]) : [];
      if (dayCleanerInitials.length) {
        const cleanersEl = document.createElement('div');
        cleanersEl.className = 'calendar-day-cleaners';
        dayCleanerInitials.forEach((initials) => {
          const badge = document.createElement('span');
          badge.className = 'calendar-day-cleaner-badge';
          badge.textContent = initials;
          cleanersEl.appendChild(badge);
        });
        cell.appendChild(cleanersEl);
      }

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
          const transitionEvents = (dayEntry.checkoutEventsBySource[source] || []).concat(dayEntry.checkinEventsBySource[source] || []);
          bar.classList.add('day-transition-bar');
          // Same-channel checkout + checkin on one day: show a thin center split/gap.
          bar.style.background = 'linear-gradient(90deg, ' + color + ' 0 47%, ' + transparentStop + ' 47% 53%, ' + color + ' 53% 100%)';
          if (shouldDimBar(transitionEvents, source)) {
            bar.style.opacity = '0.5';
          }
          bar.title = buildBarTooltip(transitionEvents);
          if (hasDisplayUnavailable(transitionEvents) && !hasReservationEligible(transitionEvents)) {
            applyUnavailableHatch(bar);
          }
        } else if (hasCheckout) {
          const checkoutEvents = dayEntry.checkoutEventsBySource[source] || [];
          bar.classList.add('day-transition-bar');
          bar.style.background = 'linear-gradient(90deg, ' + color + ' 0 50%, ' + transparentStop + ' 50% 100%)';
          if (shouldDimBar(checkoutEvents, source)) {
            bar.style.opacity = '0.5';
          }
          bar.title = buildBarTooltip(checkoutEvents);
          if (hasDisplayUnavailable(checkoutEvents) && !hasReservationEligible(checkoutEvents)) {
            applyUnavailableHatch(bar);
          }
        } else if (hasCheckin) {
          const checkinEvents = dayEntry.checkinEventsBySource[source] || [];
          bar.classList.add('day-transition-bar');
          bar.style.background = 'linear-gradient(90deg, ' + transparentStop + ' 0 50%, ' + color + ' 50% 100%)';
          if (shouldDimBar(checkinEvents, source)) {
            bar.style.opacity = '0.5';
          }
          bar.title = buildBarTooltip(checkinEvents);
          if (hasDisplayUnavailable(checkinEvents) && !hasReservationEligible(checkinEvents)) {
            applyUnavailableHatch(bar);
          }
        } else if (hasStay) {
          const stayEvents = dayEntry.stayEventsBySource[source] || [];
          bar.style.backgroundColor = color;
          if (shouldDimBar(stayEvents, source)) {
            bar.style.opacity = '0.5';
          }
          bar.title = buildBarTooltip(stayEvents);
          if (hasDisplayUnavailable(stayEvents) && !hasReservationEligible(stayEvents)) {
            applyUnavailableHatch(bar);
          }
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

function formatEntityId(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return '';
  }
  return String(numeric).padStart(8, '0');
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
  await loadSourceColorPreferences();
  await loadProperties();

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
  currentListingMeta = listing;
  document.getElementById('listingTitle').textContent = 'Listing: ' + listing.name;
  document.getElementById('listingPublicId').value = formatEntityId(listing.id);
  document.getElementById('listingName').value = listing.name;
  document.getElementById('listingPropertyId').value = String(listing.property_id || '');
  document.getElementById('listingDateBasis').value = listing.date_basis === 'checkin' ? 'checkin' : 'checkout';

  const cleaners = await loadCleaners();
  populateUsualCleanerSelect(cleaners, listing.usual_cleaner_id || null);

  const icsUrlInput = document.getElementById('icsExportUrl');
  if (icsUrlInput) {
    const baseUrl = window.location.origin + '/api/listings/' + listingId + '/calendar.ics';
    if (listing.ics_token) {
      icsUrlInput.value = baseUrl + '?token=' + encodeURIComponent(listing.ics_token);
    } else {
      icsUrlInput.value = baseUrl;
    }
  }

  const feedsRes = await fetch('/api/listings/' + listingId + '/feeds');
  const feedsData = await feedsRes.json();
  if (!feedsRes.ok) {
    throw new Error(feedsData.error || 'Failed to load feeds.');
  }

  renderFeeds(feedsData.feeds || []);
  renderReservationCalendar(currentEvents);
}

function setFetchedAt(isoString) {
  const el = document.getElementById('calendarFetchedAt');
  if (!el) return;
  if (!isoString) {
    el.textContent = '';
    return;
  }
  const d = new Date(isoString);
  el.textContent = 'Last updated: ' + d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function applyEventsData(data) {
  currentListingMeta = data.listing || currentListingMeta;
  currentEvents = data.events || [];
  const apiCleaningChanges = data.cleaningChanges || [];
  currentCleaningChanges = apiCleaningChanges.length
    ? apiCleaningChanges
    : deriveCleaningChangesFromEvents(currentEvents, currentListingMeta);
  renderLegend(currentEvents);
  renderReservationCalendar(currentEvents);
  setFetchedAt(data.fetchedAt || null);

  if (data.feedErrors && data.feedErrors.length) {
    const parts = data.feedErrors.map((e) => e.source + ': ' + e.error);
    setCalendarMessage('Loaded with feed issues: ' + parts.join(' | '), true);
  } else {
    setCalendarMessage('Loaded ' + currentEvents.length + ' events.', false);
  }
}

async function loadCachedCalendar() {
  setCalendarMessage('Loading calendar...', false);
  try {
    const res = await fetch('/api/listings/' + listingId + '/events');
    if (res.status === 401) { window.location.href = '/'; return; }
    const data = await res.json();
    if (!res.ok) {
      setCalendarMessage(data.error || 'Failed to load events.', true);
      return;
    }
    applyEventsData(data);
  } catch {
    setCalendarMessage('Network error loading events.', true);
  }
}

async function updateCalendars() {
  const button = document.getElementById('updateCalendarsBtn');
  button.disabled = true;
  setCalendarMessage('Refreshing...', false);

  try {
    const res = await fetch('/api/listings/' + listingId + '/events/refresh', { method: 'POST' });
    if (res.status === 401) { window.location.href = '/'; return; }
    const data = await res.json();

    if (!res.ok) {
      setCalendarMessage(data.error || 'Failed to refresh events.', true);
      return;
    }

    applyEventsData(data);
  } catch {
    setCalendarMessage('Network error refreshing events.', true);
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
    await loadCachedCalendar();
  } catch (err) {
    setListingMessage(err.message || 'Failed to load listing page.', true);
  }
})();

async function loadCleaners() {
  const res = await fetch('/api/cleaners');
  if (!res.ok) return [];
  const data = await res.json();
  const cleaners = data.cleaners || [];
  cleanerNameById = new Map(
    cleaners.map((cleaner) => {
      const fullName = [cleaner.first_name || '', cleaner.last_name || ''].join(' ').trim();
      return [Number(cleaner.id), fullName];
    })
  );
  cleanerInitialsById = new Map(
    cleaners.map((cleaner) => {
      const fullName = [cleaner.first_name || '', cleaner.last_name || ''].join(' ').trim();
      return [Number(cleaner.id), initialsFromName(fullName)];
    })
  );
  return cleaners;
}

function populateUsualCleanerSelect(cleaners, selectedId) {
  const select = document.getElementById('listingUsualCleaner');
  select.innerHTML = '<option value="">— None —</option>';
  cleaners.forEach((cleaner) => {
    const option = document.createElement('option');
    option.value = String(cleaner.id);
    option.textContent = (cleaner.first_name || '') + ' ' + (cleaner.last_name || '');
    select.appendChild(option);
  });
  select.value = selectedId ? String(selectedId) : '';
}


document.getElementById('renameListingForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = e.target.querySelector('button[type="submit"]');
  const name = document.getElementById('listingName').value.trim();
  const propertyId = Number(document.getElementById('listingPropertyId').value);
  const dateBasis = document.getElementById('listingDateBasis').value === 'checkin' ? 'checkin' : 'checkout';
  const usualCleanerRaw = document.getElementById('listingUsualCleaner').value;
  const usualCleanerId = usualCleanerRaw ? Number(usualCleanerRaw) : null;

  if (!name) {
    setListingMessage('Listing name is required.', true);
    return;
  }

  if (!Number.isInteger(propertyId) || propertyId <= 0) {
    setListingMessage('Property selection is required.', true);
    return;
  }

  button.disabled = true;
  try {
    const res = await fetch('/api/listings/' + listingId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, propertyId, dateBasis, usualCleanerId })
    });
    const data = await res.json();

    if (!res.ok) {
      setListingMessage(data.error || 'Failed to save listing.', true);
      return;
    }

    document.getElementById('listingTitle').textContent = 'Listing: ' + data.listing.name;
    setListingMessage('Listing updated.', false);
  } catch {
    setListingMessage('Network error saving listing.', true);
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

document.getElementById('copyIcsUrlBtn').addEventListener('click', async () => {
  const url = document.getElementById('icsExportUrl').value;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    const btn = document.getElementById('copyIcsUrlBtn');
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1800);
  } catch {
    setListingMessage('Could not copy to clipboard.', true);
  }
});

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

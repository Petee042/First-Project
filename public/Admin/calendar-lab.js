'use strict';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const calendarStates = {};

function getCalendarStorageKey(calendarId) {
  return 'calendarLabState-' + String(calendarId || '');
}

function loadPersistedCalendarState(calendarId) {
  const key = getCalendarStorageKey(calendarId);
  try {
    const raw = String(localStorage.getItem(key) || '').trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function persistCalendarState(state) {
  if (!state || !state.id) return;
  const key = getCalendarStorageKey(state.id);
  const payload = {
    events: (state.events || []).map((event) => ({
      start: String(event.start || ''),
      end: String(event.end || ''),
      source: event.source === 'imported' ? 'imported' : 'local',
      eventType: String(event.eventType || 'Reservation'),
      eventSource: String(event.eventSource || ''),
      eventOrigin: String(event.eventOrigin || ''),
      summary: String(event.summary || '')
    })),
    importUrl: String(state.importUrl || ''),
    viewDate: state.viewDate instanceof Date ? state.viewDate.toISOString() : null
  };

  try {
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Ignore storage quota/access failures.
  }
}

function setPageMessage(text, isError) {
  const el = document.getElementById('calendarLabMessage');
  if (!el) return;
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function setCalendarStatus(state, text, isError) {
  if (!state || !state.statusEl) return;
  state.statusEl.textContent = text || '';
  state.statusEl.className = text ? ('hint ' + (isError ? 'message error' : 'message success')) : 'hint';
}

function monthStartUtc(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addUtcDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function toDateKey(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function parseDateKey(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key || ''))) {
    return null;
  }
  const parts = key.split('-').map((v) => Number(v));
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateKeyFromIcs(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/(\d{4})(\d{2})(\d{2})/);
  if (!match) return null;
  return match[1] + '-' + match[2] + '-' + match[3];
}

function formatMonthLabel(date) {
  return MONTH_NAMES[date.getUTCMonth()] + ' ' + date.getUTCFullYear();
}

function overlaps(event, startKey, endKey) {
  return event.start < endKey && event.end > startKey;
}

function normalizeEvent(event) {
  if (!event) return null;
  const start = String(event.start || '').trim();
  const end = String(event.end || '').trim();
  const rawSource = String(event.source || '').trim().toLowerCase();
  const rawOrigin = String(event.eventOrigin || '').trim().toLowerCase();
  const source = rawSource === 'imported'
    ? 'imported'
    : (rawSource === 'local' ? 'local' : (rawOrigin === 'remote' ? 'imported' : 'local'));
  const eventType = String(event.eventType || '').trim().toLowerCase() === 'block' ? 'Block' : 'Reservation';
  const eventSource = String(event.eventSource || '').trim();
  const eventOrigin = String(event.eventOrigin || '').trim() || (source === 'local' ? 'Local' : 'Remote');
  const summary = String(event.summary || '').trim();
  if (!parseDateKey(start) || !parseDateKey(end) || end <= start) return null;
  return {
    start,
    end,
    source,
    eventType,
    eventSource,
    eventOrigin,
    summary
  };
}

function escapeIcsText(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function parseApMetadataFromDescription(descriptionText) {
  const metadata = {
    type: '',
    source: '',
    origin: '',
    scope: ''
  };

  String(descriptionText || '')
    .split(/\n|\\n/)
    .forEach((line) => {
      const text = String(line || '').trim();
      if (!text) return;

      const idx = text.indexOf(':');
      if (idx <= 0) return;
      const key = text.slice(0, idx).trim().toUpperCase();
      const value = text.slice(idx + 1).trim();
      if (!value) return;

      if (key === 'AP-TYPE') metadata.type = value;
      if (key === 'AP-SOURCE') metadata.source = value;
      if (key === 'AP-ORIGIN') metadata.origin = value;
      if (key === 'AP-SCOPE') metadata.scope = value;
    });

  return metadata;
}

function stripApMetadataFromDescription(descriptionText) {
  return String(descriptionText || '')
    .split(/\n|\\n/)
    .map((line) => String(line || '').trim())
    .filter((line) => line && !/^AP-(TYPE|SOURCE|ORIGIN|SCOPE)\s*:/i.test(line))
    .join('\n');
}

function isBlockSummary(summaryText) {
  const summary = String(summaryText || '').trim().toLowerCase();
  if (!summary) return false;
  if (summary === 'not available') return true;
  if (summary.includes('blocked by')) return true;
  return false;
}

function buildCalendarLabEventTooltip(events) {
  if (!events || !events.length) {
    return '';
  }

  return events.map((event) => {
    const start = String(event.start || '');
    const end = String(event.end || '');
    const eventType = String(event.eventType || 'Reservation');
    const eventSource = String(event.eventSource || (event.source === 'local' ? 'This calendar' : 'Imported source'));
    const origin = String(event.eventOrigin || (event.source === 'local' ? 'Local' : 'Remote'));
    const summary = String(event.summary || eventType).trim();
    return 'Type: ' + eventType
      + '\nSource: ' + eventSource
      + '\nOrigin: ' + origin
      + '\nSummary: ' + summary
      + '\nStart: ' + start
      + '\nEnd: ' + end;
  }).join('\n\n');
}

function buildIcs(state) {
  const dtStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AutomaticPeople//CalendarLab//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Calendar ' + state.id
  ];

  const exportEvents = (state.events || []).filter((event) => {
    if (!event) return false;
    const source = String(event.source || '').trim().toLowerCase();
    const origin = String(event.eventOrigin || '').trim().toLowerCase();
    // Only export events created locally in the lab; never re-export remote/imported events.
    return source === 'local' && origin !== 'remote';
  });

  exportEvents.forEach((event, idx) => {
    const start = event.start.replace(/-/g, '');
    const end = event.end.replace(/-/g, '');
    const eventType = String(event.eventType || 'Reservation');
    const eventSource = String(event.eventSource || ('Calendar ' + state.id));
    const eventOrigin = String(event.eventOrigin || (event.source === 'local' ? 'Local' : 'Remote'));
    const summary = String(event.summary || eventType).trim() || eventType;
    const plainDescription = stripApMetadataFromDescription(event.description || '');
    const metadataDescription = [
      'AP-TYPE: ' + eventType,
      'AP-SOURCE: ' + eventSource,
      'AP-ORIGIN: ' + eventOrigin,
      'AP-SCOPE: CalendarLab'
    ].join('\n');
    const description = [plainDescription, metadataDescription].filter(Boolean).join('\n');

    lines.push('BEGIN:VEVENT');
    lines.push('UID:calendar-lab-' + state.id + '-' + idx + '@automaticpeople');
    lines.push('DTSTAMP:' + dtStamp);
    lines.push('DTSTART;VALUE=DATE:' + start);
    lines.push('DTEND;VALUE=DATE:' + end);
    lines.push('SUMMARY:' + escapeIcsText(summary));
    lines.push('DESCRIPTION:' + escapeIcsText(description));
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

function makeRandomHex(length) {
  const size = Math.max(8, Number(length) || 32);
  const bytes = new Uint8Array(Math.ceil(size / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, size);
}

function getOrCreateExportKey(calendarId) {
  const storageKey = 'calendarLabExportKey-' + String(calendarId || '');
  let key = '';
  try {
    key = String(localStorage.getItem(storageKey) || '').trim();
  } catch {
    key = '';
  }

  if (!/^[a-zA-Z0-9_-]{16,120}$/.test(key)) {
    key = String(calendarId || '').toLowerCase() + '-' + makeRandomHex(32);
    try {
      localStorage.setItem(storageKey, key);
    } catch {
      // Ignore storage failures; key will be ephemeral for this session.
    }
  }

  return key;
}

async function publishCalendarExport(state, icsText) {
  const key = String(state && state.exportKey || '').trim();
  if (!key) {
    return;
  }

  try {
    let res = await fetch('/api/calendar-lab/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, icsText })
    });

    if (!res.ok && (res.status === 404 || res.status === 405)) {
      res = await fetch('/api/admin/calendar-lab/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, icsText })
      });
    }

    if (!res.ok) {
      setCalendarStatus(state, 'Unable to publish latest ICS snapshot (HTTP ' + res.status + ').', true);
    }
  } catch {
    setCalendarStatus(state, 'Unable to publish latest ICS snapshot.', true);
  }
}

function updateExportLink(state) {
  if (!state || !state.exportUrlInput) return;
  const icsText = buildIcs(state);
  const url = window.location.origin + '/api/calendar-lab/export.ics?key=' + encodeURIComponent(state.exportKey);
  state.exportUrlInput.value = url;
  publishCalendarExport(state, icsText);
}

function parseIcsEvents(icsText) {
  const text = String(icsText || '');
  const blocks = text.split(/BEGIN:VEVENT/i).slice(1);
  const events = [];

  blocks.forEach((block) => {
    const endSplit = block.split(/END:VEVENT/i);
    const body = endSplit[0] || '';
    const dtStartLine = body.match(/\nDTSTART[^:]*:([^\r\n]+)/i);
    const dtEndLine = body.match(/\nDTEND[^:]*:([^\r\n]+)/i);
    const summaryLine = body.match(/\nSUMMARY:([^\r\n]+)/i);
    const descriptionLine = body.match(/\nDESCRIPTION:([^\r\n]+)/i);
    const startKey = dateKeyFromIcs(dtStartLine && dtStartLine[1]);
    let endKey = dateKeyFromIcs(dtEndLine && dtEndLine[1]);
    const summary = String(summaryLine && summaryLine[1] || '').replace(/\\n/gi, '\n').trim();
    const description = String(descriptionLine && descriptionLine[1] || '').replace(/\\n/gi, '\n').trim();
    const metadata = parseApMetadataFromDescription(description);
    const metadataType = String(metadata.type || '').trim().toLowerCase();
    const eventType = metadataType === 'block' || isBlockSummary(summary) ? 'Block' : 'Reservation';

    if (!startKey) return;
    if (!endKey) {
      const startDate = parseDateKey(startKey);
      if (!startDate) return;
      endKey = toDateKey(addUtcDays(startDate, 1));
    }
    if (endKey <= startKey) {
      const startDate = parseDateKey(startKey);
      if (!startDate) return;
      endKey = toDateKey(addUtcDays(startDate, 1));
    }

    events.push({
      start: startKey,
      end: endKey,
      source: 'imported',
      eventType,
      eventSource: String(metadata.source || '').trim() || 'Imported ICS',
      eventOrigin: 'Remote',
      summary
    });
  });

  return events;
}

function renderCalendar(state) {
  const monthStart = monthStartUtc(state.viewDate);
  state.monthLabelEl.textContent = formatMonthLabel(monthStart);
  state.gridEl.innerHTML = '';

  WEEKDAY_NAMES.forEach((name) => {
    const h = document.createElement('div');
    h.className = 'calendar-weekday';
    h.textContent = name;
    state.gridEl.appendChild(h);
  });

  const firstDayOfWeek = monthStart.getUTCDay();
  const nextMonthStart = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
  const daysInMonth = Math.round((nextMonthStart - monthStart) / 86400000);

  const dayNumbers = [];
  for (let i = 0; i < firstDayOfWeek; i += 1) dayNumbers.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) dayNumbers.push(day);
  while (dayNumbers.length % 7 !== 0) dayNumbers.push(null);

  dayNumbers.forEach((dayNum) => {
    const cell = document.createElement('div');
    cell.className = 'calendar-day';

    if (dayNum === null) {
      cell.classList.add('calendar-day-empty');
      state.gridEl.appendChild(cell);
      return;
    }

    const date = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), dayNum));
    const key = toDateKey(date);

    const dayEvents = state.events.filter((event) => key >= event.start && key < event.end);

    const hasLocal = dayEvents.some((event) => event.source === 'local');
    const hasImported = dayEvents.some((event) => event.source === 'imported');

    const num = document.createElement('div');
    num.className = 'calendar-day-number';
    num.textContent = String(dayNum);
    cell.appendChild(num);

    const bars = document.createElement('div');
    bars.className = 'calendar-day-bars';

    if (hasLocal || hasImported) {
      const slot = document.createElement('div');
      slot.className = 'day-bar-slot';

      const bar = document.createElement('div');
      bar.className = 'day-bar';
      bar.title = buildCalendarLabEventTooltip(dayEvents);
      if (hasLocal && hasImported) {
        bar.classList.add('admin-lab-bar-mixed');
      } else if (hasImported) {
        bar.classList.add('admin-lab-bar-imported');
      } else {
        bar.classList.add('admin-lab-bar-local');
      }

      slot.appendChild(bar);
      bars.appendChild(slot);
    }

    cell.appendChild(bars);
    state.gridEl.appendChild(cell);
  });
}

function applyDeleteRange(events, deleteStart, deleteEnd) {
  const output = [];
  events.forEach((event) => {
    if (!overlaps(event, deleteStart, deleteEnd)) {
      output.push(event);
      return;
    }

    if (deleteStart <= event.start && deleteEnd >= event.end) {
      return;
    }

    if (deleteStart > event.start) {
      const left = normalizeEvent({
        start: event.start,
        end: deleteStart,
        source: event.source,
        eventType: event.eventType,
        eventSource: event.eventSource,
        eventOrigin: event.eventOrigin,
        summary: event.summary
      });
      if (left) output.push(left);
    }

    if (deleteEnd < event.end) {
      const right = normalizeEvent({
        start: deleteEnd,
        end: event.end,
        source: event.source,
        eventType: event.eventType,
        eventSource: event.eventSource,
        eventOrigin: event.eventOrigin,
        summary: event.summary
      });
      if (right) output.push(right);
    }
  });

  return output.sort((a, b) => (a.start + a.end).localeCompare(b.start + b.end));
}

function applyStateUpdate(state) {
  updateExportLink(state);
  renderCalendar(state);
  persistCalendarState(state);
}

function replaceImportedEvents(state, importedEvents) {
  const localOnly = state.events.filter((event) => {
    const source = String(event && event.source || '').trim().toLowerCase();
    const origin = String(event && event.eventOrigin || '').trim().toLowerCase();
    return source === 'local' && origin !== 'remote';
  });
  state.events = [...localOnly, ...importedEvents]
    .map(normalizeEvent)
    .filter(Boolean)
    .sort((a, b) => (a.start + a.end).localeCompare(b.start + b.end));
}

function clearRemoteEvents(state) {
  replaceImportedEvents(state, []);
}

async function importFromUrl(state, url) {
  let requestUrl = String(url || '').trim();
  const requestHeaders = {};

  try {
    const parsed = new URL(requestUrl, window.location.origin);
    const isSameOrigin = parsed.origin === window.location.origin;
    const isListingExport = /^\/api\/listings\/\d+\/calendar\.ics$/i.test(parsed.pathname);
    if (isSameOrigin && isListingExport) {
      const sourceLabel = 'Calendar ' + String(state && state.id || '');
      // Always force the request source to the importing calendar to avoid mirror-loop duplication.
      parsed.searchParams.set('source', sourceLabel);
      parsed.searchParams.delete('feedSource');
      requestHeaders['X-Calendar-Source'] = sourceLabel;
      requestUrl = parsed.toString();
    }
  } catch {
    // Keep original URL if parsing fails.
  }

  const response = await fetch(requestUrl, {
    cache: 'no-store',
    headers: requestHeaders
  });
  if (!response.ok) {
    throw new Error('Unable to fetch ICS URL (HTTP ' + response.status + ').');
  }

  const text = await response.text();
  const imported = parseIcsEvents(text);
  replaceImportedEvents(state, imported);
  applyStateUpdate(state);
  return {
    importedCount: imported.length,
    rawPayload: text,
    requestUrl
  };
}

async function logIcsTransactionFromCalendarLab(state, details) {
  const payload = {
    listingId: null,
    channelId: null,
    importingChannelLabel: 'Calendar Lab ' + String(state && state.id || '').trim(),
    exportingChannelLabel: '',
    importUrl: String(details && details.importUrl || '').trim(),
    status: String(details && details.status || 'success').toLowerCase() === 'error' ? 'error' : 'success',
    eventCount: Math.max(Number(details && details.eventCount) || 0, 0),
    rawPayload: String(details && details.rawPayload || ''),
    errorText: details && details.errorText ? String(details.errorText) : null
  };

  try {
    await fetch('/api/admin/ics-log/client-import', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (_e) {
    // Do not block Calendar Lab UX if logging fails.
  }
}

function attachCalendarHandlers(state) {
  const createBtn = state.rootEl.querySelector('[data-action="create"]');
  const deleteBtn = state.rootEl.querySelector('[data-action="delete"]');
  const deleteAllBtn = state.rootEl.querySelector('[data-action="delete-all-events"]');
  const prevBtn = state.rootEl.querySelector('[data-action="prev-month"]');
  const nextBtn = state.rootEl.querySelector('[data-action="next-month"]');
  const syncBtn = state.rootEl.querySelector('[data-action="sync-ics"]');
  const copyExportBtn = state.rootEl.querySelector('[data-action="copy-export-url"]');

  createBtn.addEventListener('click', () => {
    const start = String(state.createStartEl.value || '').trim();
    const end = String(state.createEndEl.value || '').trim();
    if (!parseDateKey(start) || !parseDateKey(end) || end <= start) {
      setCalendarStatus(state, 'Create Reservation requires a valid start and end date (end after start).', true);
      return;
    }

    state.events.push({
      start,
      end,
      source: 'local',
      eventType: 'Reservation',
      eventSource: 'Calendar ' + state.id,
      eventOrigin: 'Local',
      summary: 'Reservation'
    });
    state.events.sort((a, b) => (a.start + a.end).localeCompare(b.start + b.end));
    applyStateUpdate(state);
    setCalendarStatus(state, 'Reservation created.', false);
  });

  deleteBtn.addEventListener('click', () => {
    const start = String(state.deleteStartEl.value || '').trim();
    const end = String(state.deleteEndEl.value || '').trim();
    if (!parseDateKey(start) || !parseDateKey(end) || end <= start) {
      setCalendarStatus(state, 'Delete Reservation requires a valid start and end date (end after start).', true);
      return;
    }

    const before = state.events.length;
    state.events = applyDeleteRange(state.events, start, end);
    applyStateUpdate(state);
    const removed = before - state.events.length;
    setCalendarStatus(state, removed > 0 ? 'Delete applied: ' + removed + ' reservation segment(s) removed/trimmed.' : 'No reservation dates matched the delete period.', false);
  });

  if (deleteAllBtn) {
    deleteAllBtn.addEventListener('click', () => {
      const hadEvents = state.events.length > 0;
      state.events = [];
      applyStateUpdate(state);
      setCalendarStatus(state, hadEvents ? 'All calendar events deleted.' : 'Calendar already has no events.', false);
    });
  }

  prevBtn.addEventListener('click', () => {
    state.viewDate = new Date(Date.UTC(state.viewDate.getUTCFullYear(), state.viewDate.getUTCMonth() - 1, 1));
    renderCalendar(state);
  });

  nextBtn.addEventListener('click', () => {
    state.viewDate = new Date(Date.UTC(state.viewDate.getUTCFullYear(), state.viewDate.getUTCMonth() + 1, 1));
    renderCalendar(state);
  });

  copyExportBtn.addEventListener('click', async () => {
    const value = String(state.exportUrlInput && state.exportUrlInput.value || '').trim();
    if (!value) {
      setCalendarStatus(state, 'No export URL available to copy yet.', true);
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setCalendarStatus(state, 'Export URL copied.', false);
    } catch {
      state.exportUrlInput.focus();
      state.exportUrlInput.select();
      const copied = document.execCommand('copy');
      setCalendarStatus(state, copied ? 'Export URL copied.' : 'Unable to copy automatically. Select and copy the URL manually.', !copied);
    }
  });

  state.importUrlInput.addEventListener('change', () => {
    state.importUrl = String(state.importUrlInput.value || '').trim();
  });

  syncBtn.addEventListener('click', async () => {
    let url = String(state.importUrlInput && state.importUrlInput.value || state.importUrl || '').trim();
    if (!url) {
      state.importUrl = '';
      state.events = [];
      applyStateUpdate(state);
      setCalendarStatus(state, 'Import URL is blank. Calendar cleared.', false);
      return;
    }

    try {
      state.importUrl = url;
      state.importUrlInput.value = url;
      // Always remove previously imported events before sync so only active remote events remain.
      clearRemoteEvents(state);
      applyStateUpdate(state);
      const result = await importFromUrl(state, url);
      await logIcsTransactionFromCalendarLab(state, {
        importUrl: result.requestUrl || url,
        status: 'success',
        eventCount: result.importedCount,
        rawPayload: result.rawPayload,
        errorText: null
      });
      setCalendarStatus(state, 'Sync complete: ' + result.importedCount + ' imported event(s) refreshed.', false);
    } catch (err) {
      await logIcsTransactionFromCalendarLab(state, {
        importUrl: url,
        status: 'error',
        eventCount: 0,
        rawPayload: '',
        errorText: err && err.message ? err.message : 'Failed to sync ICS.'
      });
      setCalendarStatus(state, err.message || 'Failed to sync ICS.', true);
    }
  });
}

function registerCalendar(rootEl) {
  const id = String(rootEl.getAttribute('data-calendar-id') || '').trim();
  if (!id) return;

  const state = {
    id,
    rootEl,
    events: [],
    viewDate: monthStartUtc(new Date()),
    gridEl: rootEl.querySelector('[data-role="calendar-grid"]'),
    monthLabelEl: rootEl.querySelector('[data-role="month-label"]'),
    statusEl: rootEl.querySelector('[data-role="status"]'),
    exportUrlInput: rootEl.querySelector('[data-role="export-url"]'),
    importUrlInput: rootEl.querySelector('[data-role="import-url"]'),
    createStartEl: rootEl.querySelector('#createStart' + id),
    createEndEl: rootEl.querySelector('#createEnd' + id),
    deleteStartEl: rootEl.querySelector('#deleteStart' + id),
    deleteEndEl: rootEl.querySelector('#deleteEnd' + id),
    exportKey: getOrCreateExportKey(id),
    importUrl: ''
  };

  const persisted = loadPersistedCalendarState(id);
  if (persisted) {
    const restoredEvents = Array.isArray(persisted.events)
      ? persisted.events.map(normalizeEvent).filter(Boolean)
      : [];
    state.events = restoredEvents;
    state.importUrl = String(persisted.importUrl || '').trim();
    if (state.importUrlInput) {
      state.importUrlInput.value = state.importUrl;
    }

    const restoredViewDate = new Date(String(persisted.viewDate || ''));
    if (!Number.isNaN(restoredViewDate.getTime())) {
      state.viewDate = monthStartUtc(restoredViewDate);
    }
  }

  calendarStates[id] = state;
  attachCalendarHandlers(state);
  applyStateUpdate(state);
}

async function init() {
  try {
    const meRes = await fetch('/api/admin/me', { cache: 'no-store' });
    if (!meRes.ok) {
      setPageMessage('Admin login required. Redirecting...', true);
      window.location.href = '/Admin/index.html';
      return;
    }

    const grid = document.getElementById('calendarLabGrid');
    grid.classList.remove('hidden');
    Array.from(grid.querySelectorAll('[data-calendar-id]')).forEach(registerCalendar);
    setPageMessage('Ready. Create blue reservations, export ICS, and import into another calendar for red reservations.', false);
  } catch {
    setPageMessage('Failed to initialize Calendar ICS Test Lab.', true);
  }
}

document.getElementById('adminLabLogoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/Admin/index.html';
});

init();

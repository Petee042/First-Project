'use strict';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const calendarStates = {};

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
  const source = event.source === 'imported' ? 'imported' : 'local';
  if (!parseDateKey(start) || !parseDateKey(end) || end <= start) return null;
  return { start, end, source };
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

  state.events.forEach((event, idx) => {
    const start = event.start.replace(/-/g, '');
    const end = event.end.replace(/-/g, '');
    const summary = event.source === 'imported' ? 'Imported Reservation' : 'Reservation';
    lines.push('BEGIN:VEVENT');
    lines.push('UID:calendar-lab-' + state.id + '-' + idx + '@automaticpeople');
    lines.push('DTSTAMP:' + dtStamp);
    lines.push('DTSTART;VALUE=DATE:' + start);
    lines.push('DTEND;VALUE=DATE:' + end);
    lines.push('SUMMARY:' + summary);
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

function updateExportLink(state) {
  if (!state || !state.exportUrlInput) return;
  if (state.exportUrl) {
    URL.revokeObjectURL(state.exportUrl);
    state.exportUrl = null;
  }

  const icsText = buildIcs(state);
  const blob = new Blob([icsText], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  state.exportUrl = url;
  state.exportUrlInput.value = url;
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
    const startKey = dateKeyFromIcs(dtStartLine && dtStartLine[1]);
    let endKey = dateKeyFromIcs(dtEndLine && dtEndLine[1]);

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

    events.push({ start: startKey, end: endKey, source: 'imported' });
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

    const hasLocal = state.events.some((event) => event.source === 'local' && key >= event.start && key < event.end);
    const hasImported = state.events.some((event) => event.source === 'imported' && key >= event.start && key < event.end);

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
      if (hasLocal && hasImported) {
        bar.classList.add('admin-lab-bar-mixed');
        bar.title = 'Local + Imported reservation date';
      } else if (hasImported) {
        bar.classList.add('admin-lab-bar-imported');
        bar.title = 'Imported reservation date';
      } else {
        bar.classList.add('admin-lab-bar-local');
        bar.title = 'Local reservation date';
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
      const left = normalizeEvent({ start: event.start, end: deleteStart, source: event.source });
      if (left) output.push(left);
    }

    if (deleteEnd < event.end) {
      const right = normalizeEvent({ start: deleteEnd, end: event.end, source: event.source });
      if (right) output.push(right);
    }
  });

  return output.sort((a, b) => (a.start + a.end).localeCompare(b.start + b.end));
}

function applyStateUpdate(state) {
  updateExportLink(state);
  renderCalendar(state);
}

function replaceImportedEvents(state, importedEvents) {
  const localOnly = state.events.filter((event) => event.source !== 'imported');
  state.events = [...localOnly, ...importedEvents]
    .map(normalizeEvent)
    .filter(Boolean)
    .sort((a, b) => (a.start + a.end).localeCompare(b.start + b.end));
}

async function importFromUrl(state, url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Unable to fetch ICS URL (HTTP ' + response.status + ').');
  }

  const text = await response.text();
  const imported = parseIcsEvents(text);
  if (!imported.length) {
    throw new Error('No valid events found in ICS.');
  }

  replaceImportedEvents(state, imported);
  applyStateUpdate(state);
  return imported.length;
}

function attachCalendarHandlers(state) {
  const createBtn = state.rootEl.querySelector('[data-action="create"]');
  const deleteBtn = state.rootEl.querySelector('[data-action="delete"]');
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

    state.events.push({ start, end, source: 'local' });
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
      setCalendarStatus(state, 'Paste an Import ICS URL first, then click Sync.', true);
      return;
    }

    try {
      state.importUrl = url;
      state.importUrlInput.value = url;
      const importedCount = await importFromUrl(state, url);
      setCalendarStatus(state, 'Sync complete: ' + importedCount + ' imported reservation(s) refreshed.', false);
    } catch (err) {
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
    exportUrl: null,
    importUrl: ''
  };

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

window.addEventListener('beforeunload', () => {
  Object.values(calendarStates).forEach((state) => {
    if (state.exportUrl) {
      URL.revokeObjectURL(state.exportUrl);
      state.exportUrl = null;
    }
  });
});

document.getElementById('adminLabLogoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/Admin/index.html';
});

init();

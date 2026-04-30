'use strict';

const SOURCE_COLOR_OPTIONS = [
  { name: 'Red', value: '#e63946' },
  { name: 'Blue', value: '#1d4ed8' },
  { name: 'Green', value: '#2e7d32' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Teal', value: '#0f766e' },
  { name: 'Navy', value: '#1e3a8a' },
  { name: 'Pink', value: '#db2777' },
  { name: 'Yellow', value: '#ca8a04' }
];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_SHORT_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let currentListings = [];
let currentProperties = [];
let currentCleaners = [];
let schedulePreviewRequestId = 0;
let currentScheduleRows = [];
let currentScheduleErrors = [];

function setMessage(text, isError) {
  const el = document.getElementById('dashboardMessage');
  el.textContent = text;
  el.className = text ? 'message ' + (isError ? 'error' : 'success') : 'message';
}

function renderListings(listings) {
  const tbody = document.getElementById('listingsTableBody');
  tbody.innerHTML = '';

  if (!listings.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.textContent = 'No listings yet.';
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  listings.forEach((listing) => {
    const row = document.createElement('tr');

    const nameCell = document.createElement('td');
    nameCell.textContent = listing.name;

    const propertyCell = document.createElement('td');
    propertyCell.textContent = listing.property_name || 'default';

    const actionCell = document.createElement('td');
    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'btn secondary';
    openBtn.textContent = 'View / Edit';
    openBtn.addEventListener('click', () => {
      window.location.href = '/listing.html?id=' + encodeURIComponent(listing.id);
    });

    actionCell.appendChild(openBtn);
    row.appendChild(nameCell);
    row.appendChild(propertyCell);
    row.appendChild(actionCell);
    tbody.appendChild(row);
  });
}

function renderProperties(properties) {
  currentProperties = properties || [];

  const tbody = document.getElementById('propertiesTableBody');
  tbody.innerHTML = '';

  if (!currentProperties.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.textContent = 'No properties yet.';
    row.appendChild(cell);
    tbody.appendChild(row);
  } else {
    currentProperties.forEach((property) => {
      const row = document.createElement('tr');

      const nameCell = document.createElement('td');
      nameCell.textContent = property.name;

      const managerCell = document.createElement('td');
      managerCell.textContent = property.manager_name || property.manager_email || 'Not set';

      const actionCell = document.createElement('td');
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'btn secondary';
      openBtn.textContent = 'View / Edit';
      openBtn.addEventListener('click', () => {
        window.location.href = '/property.html?id=' + encodeURIComponent(property.id);
      });

      actionCell.appendChild(openBtn);
      row.appendChild(nameCell);
      row.appendChild(managerCell);
      row.appendChild(actionCell);
      tbody.appendChild(row);
    });
  }

  const select = document.getElementById('listingPropertyId');
  select.innerHTML = '';
  currentProperties.forEach((property) => {
    const option = document.createElement('option');
    option.value = String(property.id);
    option.textContent = property.name;
    select.appendChild(option);
  });
}

function resetCleanerForm() {
  document.getElementById('cleanerId').value = '';
  document.getElementById('cleanerFirstName').value = '';
  document.getElementById('cleanerLastName').value = '';
  document.getElementById('cleanerEmail').value = '';
  document.getElementById('cleanerTelephone').value = '';
  document.getElementById('cleanerPassword').value = '';
  document.getElementById('cleanerPassword').required = true;
  document.getElementById('cleanerPassword').placeholder = '';
  document.getElementById('cleanerFormTitle').textContent = 'Add Changeover Staff';
  document.getElementById('saveCleanerBtn').textContent = 'Add Changeover Staff';
  document.getElementById('cancelCleanerEditBtn').classList.add('hidden');
}

function startCleanerEdit(cleanerId) {
  const cleaner = currentCleaners.find((item) => Number(item.id) === Number(cleanerId));
  if (!cleaner) {
    setMessage('Changeover staff entry not found.', true);
    return;
  }

  document.getElementById('cleanerId').value = String(cleaner.id);
  document.getElementById('cleanerFirstName').value = cleaner.first_name || '';
  document.getElementById('cleanerLastName').value = cleaner.last_name || '';
  document.getElementById('cleanerEmail').value = cleaner.email || '';
  document.getElementById('cleanerTelephone').value = cleaner.telephone || '';
  document.getElementById('cleanerPassword').value = '';
  document.getElementById('cleanerPassword').required = false;
  document.getElementById('cleanerPassword').placeholder = 'Leave blank to keep current password';
  document.getElementById('cleanerFormTitle').textContent = 'Edit Changeover Staff';
  document.getElementById('saveCleanerBtn').textContent = 'Save Changeover Staff';
  document.getElementById('cancelCleanerEditBtn').classList.remove('hidden');
}

function renderCleaners(cleaners) {
  currentCleaners = cleaners || [];

  const tbody = document.getElementById('cleanersTableBody');
  tbody.innerHTML = '';

  if (!currentCleaners.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.textContent = 'No changeover staff configured yet.';
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  currentCleaners.forEach((cleaner) => {
    const row = document.createElement('tr');

    const firstNameCell = document.createElement('td');
    firstNameCell.textContent = cleaner.first_name || '';

    const lastNameCell = document.createElement('td');
    lastNameCell.textContent = cleaner.last_name || '';

    const actionCell = document.createElement('td');
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn secondary';
    editBtn.textContent = 'View Details/Edit';
    editBtn.addEventListener('click', () => {
      startCleanerEdit(cleaner.id);
    });

    actionCell.appendChild(editBtn);

    row.appendChild(firstNameCell);
    row.appendChild(lastNameCell);
    row.appendChild(actionCell);

    tbody.appendChild(row);
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

function toDateKey(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return keyFromUtcDate(d);
}

function renderCleaningListings(listings) {
  const container = document.getElementById('cleaningListings');
  container.innerHTML = '';

  if (!listings.length) {
    const text = document.createElement('p');
    text.className = 'cleaning-empty';
    text.textContent = 'No listings available.';
    container.appendChild(text);
    return;
  }

  listings.forEach((listing) => {
    const row = document.createElement('label');
    row.className = 'cleaning-listing-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'cleaning-listing-checkbox';
    checkbox.value = String(listing.id);
    checkbox.setAttribute('data-listing-name', listing.name);
    checkbox.setAttribute('data-property-name', listing.property_name || '');
    checkbox.setAttribute('data-date-basis', listing.date_basis === 'checkin' ? 'checkin' : 'checkout');
    checkbox.setAttribute('data-usual-cleaner-id', listing.usual_cleaner_id ? String(listing.usual_cleaner_id) : '');

    const name = document.createElement('span');
    name.className = 'cleaning-listing-name';
    name.textContent = listing.name;

    row.appendChild(checkbox);
    row.appendChild(name);
    container.appendChild(row);
  });
}

function getSelectedCleaningListings() {
  const checked = Array.from(document.querySelectorAll('.cleaning-listing-checkbox:checked'));
  return checked.map((box) => ({
    id: Number(box.value),
    name: box.getAttribute('data-listing-name') || 'Listing',
    propertyName: box.getAttribute('data-property-name') || '',
    dateBasis: box.getAttribute('data-date-basis') === 'checkin' ? 'checkin' : 'checkout',
    usualCleanerId: box.getAttribute('data-usual-cleaner-id') ? Number(box.getAttribute('data-usual-cleaner-id')) : null
  }));
}

function formatCleaningScheduleLine(dayKey, listingNames) {
  const date = utcDateFromKey(dayKey);
  const weekday = WEEKDAY_NAMES[date.getUTCDay()];
  const day = date.getUTCDate();
  const month = MONTH_SHORT_NAMES[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const text = listingNames.length ? listingNames.join(', ') : 'No checkouts';
  return weekday + ' ' + day + ' ' + month + ' ' + year + ': ' + text;
}

function formatPreparationScheduleLine(dayKey, listingNames) {
  const date = utcDateFromKey(dayKey);
  const weekday = WEEKDAY_NAMES[date.getUTCDay()];
  const day = date.getUTCDate();
  const month = MONTH_SHORT_NAMES[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const text = listingNames.length ? listingNames.join(', ') : 'No checkins';
  return weekday + ' ' + day + ' ' + month + ' ' + year + ': ' + text;
}

function csvEscape(value) {
  const text = String(value || '');
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

function rowsToCsv(rows) {
  const header = 'Checkin Date,Checkout Date,Change Date,Property,Listing,Cleaner';
  const body = rows.map((row) => {
    return [
      csvEscape(row.checkinDate || ''),
      csvEscape(row.checkoutDate || ''),
      csvEscape(row.changeDate || row.date || ''),
      csvEscape(row.property),
      csvEscape(row.listing),
      csvEscape(row.cleanerName || 'Unallocated')
    ].join(',');
  });
  return [header].concat(body).join('\n');
}

function preparationRowsToCsv(rows) {
  const header = 'Date,Checkout Date,Property,Listing';
  const body = rows.map((row) => {
    return [
      csvEscape(row.date),
      csvEscape(row.checkoutDate || ''),
      csvEscape(row.property),
      csvEscape(row.listing)
    ].join(',');
  });
  return [header].concat(body).join('\n');
}

function rowsToText(rows, lineFormatter) {
  const grouped = {};
  rows.forEach((row) => {
    const changeDateKey = row.changeDate || row.date;
    if (!grouped[changeDateKey]) {
      grouped[changeDateKey] = [];
    }
    const cleanerText = row.cleanerName || 'Unallocated';
    grouped[changeDateKey].push((row.property ? row.property + ' - ' + row.listing : row.listing) + ' [' + cleanerText + ']');
  });

  return Object.keys(grouped)
    .sort()
    .map((dateKey) => lineFormatter(dateKey, grouped[dateKey].sort((a, b) => a.localeCompare(b))))
    .join('\n');
}

function downloadTextFile(fileName, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function toDateInputValue(date) {
  return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate());
}

function getSelectedStartDateUtc() {
  const raw = document.getElementById('cleaningStartDate').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return utcDateFromKey(raw);
}

function reservationKey(listingId, checkinDate, checkoutDate) {
  return String(listingId) + '|' + String(checkinDate || '') + '|' + String(checkoutDate || '');
}

function renderNotificationLog(lines) {
  const container = document.getElementById('notificationLog');
  if (!container) return;

  container.innerHTML = '';

  if (!lines.length) {
    const empty = document.createElement('p');
    empty.className = 'cleaning-empty';
    empty.textContent = 'No notifications.';
    container.appendChild(empty);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'notification-list';
  lines.forEach((line) => {
    const item = document.createElement('li');
    item.textContent = line;
    list.appendChild(item);
  });
  container.appendChild(list);
}

async function buildSchedule(selectedListings, days, startDateUtc) {
  const rangeKeySet = new Set();
  for (let i = 0; i < days; i += 1) {
    rangeKeySet.add(keyFromUtcDate(addUtcDays(startDateUtc, i)));
  }

  const rows = [];
  const errors = [];

  await Promise.all(selectedListings.map(async (listing) => {
    try {
      const res = await fetch('/api/listings/' + encodeURIComponent(listing.id) + '/events');
      if (res.status === 401) {
        window.location.href = '/';
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        errors.push(listing.name + ': ' + (data.error || 'Failed to load events.'));
        return;
      }

      (data.events || []).forEach((event) => {
        if (event && event.isReservation === false) {
          return;
        }

        const checkinKey = toDateKey(event.start);
        const checkoutKey = toDateKey(event.end);
        if (!checkinKey || !checkoutKey) {
          return;
        }

        const basis = listing.dateBasis === 'checkin' ? 'checkin' : 'checkout';
        const basisDate = basis === 'checkin' ? checkinKey : checkoutKey;
        if (!rangeKeySet.has(basisDate)) {
          return;
        }

        const cleanerById = new Map((currentCleaners || []).map((c) => [Number(c.id), c]));
        const usualCleanerId = listing.usualCleanerId || null;
        let defaultCleanerId = null;
        let defaultCleanerName = 'Unallocated';
        if (usualCleanerId && cleanerById.has(usualCleanerId)) {
          const uc = cleanerById.get(usualCleanerId);
          defaultCleanerId = usualCleanerId;
          defaultCleanerName = (uc.first_name || '') + ' ' + (uc.last_name || '');
        }

        rows.push({
          listingId: Number(listing.id),
          property: listing.propertyName || '',
          listing: listing.name || '',
          listingDateBasis: basis,
          checkinDate: checkinKey,
          checkoutDate: checkoutKey,
          date: basisDate,
          reservationKey: reservationKey(listing.id, checkinKey, checkoutKey),
          changeDate: basisDate,
          cleanerId: defaultCleanerId,
          cleanerName: defaultCleanerName
        });
      });
    } catch {
      errors.push(listing.name + ': Network error while loading events.');
    }
  }));

  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.property !== b.property) return a.property.localeCompare(b.property);
    return a.listing.localeCompare(b.listing);
  });

  let bookedChanges = [];
  try {
    const lookupRes = await fetch('/api/booked-in-changes/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingIds: selectedListings.map((listing) => Number(listing.id)) })
    });

    if (lookupRes.status === 401) {
      window.location.href = '/';
      return { rows: [], errors: [], text: '', csv: '', rowCount: 0, notifications: [] };
    }

    const lookupData = await lookupRes.json();
    if (lookupRes.ok) {
      bookedChanges = lookupData.changes || [];
    }
  } catch {
    errors.push('Could not load booked-in changes.');
  }

  const bookedMap = new Map();
  bookedChanges.forEach((row) => {
    const key = reservationKey(row.listing_id, row.reservation_checkin_date, row.reservation_checkout_date);
    bookedMap.set(key, row);
  });

  const cleanerById = new Map((currentCleaners || []).map((cleaner) => [Number(cleaner.id), cleaner]));
  rows.forEach((row) => {
    const existing = bookedMap.get(row.reservationKey);
    if (!existing) {
      return;
    }
    row.changeDate = existing.changeover_date || row.changeDate;
    row.cleanerId = existing.cleaner_id ? Number(existing.cleaner_id) : null;
    if (row.cleanerId && cleanerById.has(row.cleanerId)) {
      const cleaner = cleanerById.get(row.cleanerId);
      row.cleanerName = (cleaner.first_name || '') + ' ' + (cleaner.last_name || '');
    }
  });

  const reservationKeySet = new Set(rows.map((row) => row.reservationKey));
  const notifications = bookedChanges
    .filter((row) => !reservationKeySet.has(reservationKey(row.listing_id, row.reservation_checkin_date, row.reservation_checkout_date)))
    .map((row) => {
      const listing = selectedListings.find((item) => Number(item.id) === Number(row.listing_id));
      const listingName = listing ? listing.name : ('Listing #' + row.listing_id);
      return listingName + ': booked-in change ' + row.reservation_checkin_date + ' to ' + row.reservation_checkout_date + ' no longer matches a reservation.';
    });

  return {
    text: rowsToText(rows, formatCleaningScheduleLine),
    csv: rowsToCsv(rows),
    rows,
    rowCount: rows.length,
    errors,
    notifications
  };
}

function formatDisplayDate(dateKey) {
  if (!dateKey) return '';
  const utcDate = utcDateFromKey(dateKey);
  const dayName = WEEKDAY_NAMES[utcDate.getUTCDay()].substring(0, 3);
  const day = utcDate.getUTCDate();
  const monthName = MONTH_SHORT_NAMES[utcDate.getUTCMonth()];
  const year = String(utcDate.getUTCFullYear()).slice(-2);
  return dayName + ' ' + day + ' ' + monthName + ' ' + year;
}

function renderSchedulePreviewTable(rows, errors, notifications) {
  const container = document.getElementById('schedulePreview');
  container.innerHTML = '';
  renderNotificationLog(notifications || []);

  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'cleaning-empty';
    empty.textContent = 'No schedule entries for the selected listings and date range.';
    container.appendChild(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'calendar-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const headers = ['Checkin Date', 'Checkout Date', 'Property', 'Listing'];
  headers.forEach((label) => {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.forEach((row, idx) => {
    // Main data row
    const mainRow = document.createElement('tr');
    mainRow.className = 'schedule-main-row';

    const dateCell = document.createElement('td');
    dateCell.textContent = formatDisplayDate(row.checkinDate || row.date);
    mainRow.appendChild(dateCell);

    const checkoutCell = document.createElement('td');
    checkoutCell.textContent = formatDisplayDate(row.checkoutDate || row.date);
    mainRow.appendChild(checkoutCell);

    const propertyCell = document.createElement('td');
    propertyCell.textContent = row.property || '';
    mainRow.appendChild(propertyCell);

    const listingCell = document.createElement('td');
    listingCell.textContent = row.listing || '';
    mainRow.appendChild(listingCell);

    tbody.appendChild(mainRow);

    // Sub-row with Change Date and Cleaner
    const subRow = document.createElement('tr');
    subRow.className = 'schedule-sub-row';

    const controlsCell = document.createElement('td');
    controlsCell.colSpan = headers.length;
    controlsCell.className = 'schedule-controls-cell';

    const controlsContainer = document.createElement('div');
    controlsContainer.className = 'schedule-controls';

    // Change Date input
    const dateInputDiv = document.createElement('div');
    dateInputDiv.className = 'schedule-control-group';
    const dateLabel = document.createElement('label');
    dateLabel.textContent = 'Change Date:';
    dateLabel.className = 'schedule-control-label';
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.value = row.changeDate || row.date;
    dateInput.className = 'schedule-change-date';
    dateInput.dataset.rowIndex = idx;
    dateInput.addEventListener('change', (event) => {
      const rowIndex = Number(event.target.dataset.rowIndex);
      if (!Number.isInteger(rowIndex) || !currentScheduleRows[rowIndex]) return;
      currentScheduleRows[rowIndex].changeDate = event.target.value || currentScheduleRows[rowIndex].changeDate;
    });
    dateInputDiv.appendChild(dateLabel);
    dateInputDiv.appendChild(dateInput);
    controlsContainer.appendChild(dateInputDiv);

    // Cleaner select
    const cleanerDiv = document.createElement('div');
    cleanerDiv.className = 'schedule-control-group';
    const cleanerLabel = document.createElement('label');
    cleanerLabel.textContent = 'Cleaner:';
    cleanerLabel.className = 'schedule-control-label';
    const cleanerSelect = document.createElement('select');
    cleanerSelect.className = 'schedule-cleaner';
    cleanerSelect.dataset.rowIndex = idx;

    const unallocatedOption = document.createElement('option');
    unallocatedOption.value = '';
    unallocatedOption.textContent = 'Unallocated';
    cleanerSelect.appendChild(unallocatedOption);

    currentCleaners.forEach((cleaner) => {
      const option = document.createElement('option');
      option.value = cleaner.id;
      option.textContent = (cleaner.first_name || '') + ' ' + (cleaner.last_name || '');
      cleanerSelect.appendChild(option);
    });
    cleanerSelect.value = row.cleanerId ? String(row.cleanerId) : '';
    cleanerSelect.addEventListener('change', (event) => {
      const rowIndex = Number(event.target.dataset.rowIndex);
      if (!Number.isInteger(rowIndex) || !currentScheduleRows[rowIndex]) return;
      const cleanerId = event.target.value ? Number(event.target.value) : null;
      currentScheduleRows[rowIndex].cleanerId = cleanerId;
      currentScheduleRows[rowIndex].cleanerName = cleanerId
        ? event.target.options[event.target.selectedIndex].textContent
        : 'Unallocated';
    });

    cleanerDiv.appendChild(cleanerLabel);
    cleanerDiv.appendChild(cleanerSelect);
    controlsContainer.appendChild(cleanerDiv);

    controlsCell.appendChild(controlsContainer);
    subRow.appendChild(controlsCell);

    tbody.appendChild(subRow);
  });
  table.appendChild(tbody);
  container.appendChild(table);

  if (errors && errors.length) {
    const warning = document.createElement('p');
    warning.className = 'hint';
    warning.textContent = 'Some listings could not be loaded: ' + errors.join(' | ');
    container.appendChild(warning);
  }
}

async function updateSchedulePreview() {
  const container = document.getElementById('schedulePreview');
  const daysValue = Number(document.getElementById('cleaningDays').value);
  const startDateUtc = getSelectedStartDateUtc();
  const selectedListings = getSelectedCleaningListings();
  const requestId = ++schedulePreviewRequestId;

  if (!selectedListings.length) {
    container.innerHTML = '<p class="cleaning-empty">Select listings to preview the schedule.</p>';
    return;
  }
  if (!Number.isInteger(daysValue) || daysValue < 1 || daysValue > 365 || !startDateUtc) {
    container.innerHTML = '<p class="cleaning-empty">Choose a valid start date and day range to preview the schedule.</p>';
    return;
  }

  container.innerHTML = '<p class="cleaning-empty">Loading schedule preview...</p>';

  try {
    const result = await buildSchedule(selectedListings, daysValue, startDateUtc);

    if (requestId !== schedulePreviewRequestId) {
      return;
    }

    currentScheduleRows = result.rows || [];
    currentScheduleErrors = result.errors || [];
    renderSchedulePreviewTable(currentScheduleRows, currentScheduleErrors, result.notifications || []);
  } catch {
    if (requestId !== schedulePreviewRequestId) {
      return;
    }
    container.innerHTML = '<p class="cleaning-empty">Failed to build schedule preview.</p>';
    renderNotificationLog([]);
  }
}

function renderFeedSources(sources) {
  const tbody = document.getElementById('feedSourcesTableBody');
  tbody.innerHTML = '';

  if (!sources.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 2;
    cell.textContent = 'No feed sources configured yet.';
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  sources.forEach((source) => {
    const row = document.createElement('tr');

    const labelCell = document.createElement('td');
    labelCell.textContent = source.label;

    const colorCell = document.createElement('td');
    colorCell.className = 'source-color-cell';

    const select = document.createElement('select');
    select.className = 'source-color-select';
    select.setAttribute('aria-label', 'Primary color for ' + source.label);

    SOURCE_COLOR_OPTIONS.forEach((opt) => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.name;
      if ((source.color || '').toLowerCase() === opt.value.toLowerCase()) {
        option.selected = true;
      }
      select.appendChild(option);
    });

    if (!source.color && SOURCE_COLOR_OPTIONS.length) {
      select.value = SOURCE_COLOR_OPTIONS[0].value;
    }

    const preview = document.createElement('span');
    preview.className = 'source-color-preview';
    preview.style.backgroundColor = select.value;

    select.addEventListener('change', async () => {
      const chosen = select.value;
      preview.style.backgroundColor = chosen;

      select.disabled = true;
      try {
        const res = await fetch('/api/feed-sources/color', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: source.label, color: chosen })
        });
        const data = await res.json();

        if (!res.ok) {
          setMessage(data.error || 'Failed to save source color.', true);
          return;
        }

        setMessage('Saved color for ' + source.label + '.', false);
      } catch {
        setMessage('Network error saving source color.', true);
      } finally {
        select.disabled = false;
      }
    });

    colorCell.appendChild(select);
    colorCell.appendChild(preview);
    row.appendChild(labelCell);
    row.appendChild(colorCell);
    tbody.appendChild(row);
  });
}

async function fetchListings() {
  const res = await fetch('/api/listings');
  if (res.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load listings.');
  }

  currentListings = data.listings || [];
  renderListings(currentListings);
  renderCleaningListings(currentListings);
}

async function fetchProperties() {
  const res = await fetch('/api/properties');
  if (res.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load properties.');
  }

  renderProperties(data.properties || []);
}

async function fetchFeedSources() {
  const res = await fetch('/api/feed-sources');
  if (res.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load feed sources.');
  }

  renderFeedSources(data.sources || []);
}

async function fetchCleaners() {
  const res = await fetch('/api/cleaners');
  if (res.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load changeover staff.');
  }

  renderCleaners(data.cleaners || []);
}

async function persistCurrentScheduleChanges() {
  if (!currentScheduleRows.length) {
    return { ok: false, error: 'Generate a schedule preview before saving changes.' };
  }

  const saveRes = await fetch('/api/booked-in-changes/upsert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      changes: currentScheduleRows.map((row) => ({
        listingId: row.listingId,
        reservationCheckinDate: row.checkinDate,
        reservationCheckoutDate: row.checkoutDate,
        changeoverDate: row.changeDate || row.date,
        cleanerId: row.cleanerId
      }))
    })
  });

  if (saveRes.status === 401) {
    window.location.href = '/';
    return { ok: false, error: 'Session expired.' };
  }

  const saveData = await saveRes.json();
  if (!saveRes.ok) {
    return { ok: false, error: saveData.error || 'Failed to save schedule changes.' };
  }

  return { ok: true, saved: Number(saveData.saved || 0) };
}

(async () => {
  try {
    const meRes = await fetch('/api/me');
    if (!meRes.ok) {
      window.location.href = '/';
      return;
    }

    await fetchProperties();
    await fetchListings();
    await fetchFeedSources();
    await fetchCleaners();

    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    document.getElementById('cleaningStartDate').value = toDateInputValue(todayUtc);
    resetCleanerForm();
  } catch (err) {
    setMessage(err.message || 'Failed to load page.', true);
  }
})();

document.getElementById('addListingForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = e.target.querySelector('button[type="submit"]');
  const name = document.getElementById('listingName').value.trim();
  const propertyId = Number(document.getElementById('listingPropertyId').value);

  if (!name) {
    setMessage('Listing name is required.', true);
    return;
  }

  if (!Number.isInteger(propertyId) || propertyId <= 0) {
    setMessage('Property selection is required.', true);
    return;
  }

  button.disabled = true;
  try {
    const res = await fetch('/api/listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, propertyId, dateBasis: 'checkout' })
    });

    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || 'Failed to create listing.', true);
      return;
    }

    document.getElementById('listingName').value = '';
    setMessage('Listing added.', false);
    await fetchProperties();
    await fetchListings();
    await fetchFeedSources();
  } catch {
    setMessage('Network error creating listing.', true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('addPropertyForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const button = e.target.querySelector('button[type="submit"]');
  const name = document.getElementById('propertyName').value.trim();

  if (!name) {
    setMessage('Property name is required.', true);
    return;
  }

  button.disabled = true;
  try {
    const res = await fetch('/api/properties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();

    if (!res.ok) {
      setMessage(data.error || 'Failed to create property.', true);
      return;
    }

    document.getElementById('propertyName').value = '';
    setMessage('Property added.', false);
    await fetchProperties();
    await fetchListings();
  } catch {
    setMessage('Network error creating property.', true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
});

document.getElementById('refreshScheduleBtn').addEventListener('click', async () => {
  const button = document.getElementById('refreshScheduleBtn');
  button.disabled = true;
  try {
    await updateSchedulePreview();
  } finally {
    button.disabled = false;
  }
});

document.getElementById('cleaningScheduleForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const button = document.getElementById('downloadCleaningScheduleBtn');
  const daysValue = Number(document.getElementById('cleaningDays').value);
  const format = document.getElementById('cleaningFormat').value;
  const startDateUtc = getSelectedStartDateUtc();
  const selectedListings = getSelectedCleaningListings();

  if (!selectedListings.length) {
    setMessage('Select at least one listing for the schedule.', true);
    return;
  }

  if (!Number.isInteger(daysValue) || daysValue < 1 || daysValue > 365) {
    setMessage('Number of days must be between 1 and 365.', true);
    return;
  }

  if (!startDateUtc) {
    setMessage('Please select a valid start date.', true);
    return;
  }

  button.disabled = true;
  setMessage('Building schedule from latest feeds...', false);

  try {
    const result = await buildSchedule(selectedListings, daysValue, startDateUtc);
    currentScheduleRows = result.rows || [];
    currentScheduleErrors = result.errors || [];
    renderSchedulePreviewTable(currentScheduleRows, currentScheduleErrors, result.notifications || []);

    const startKey = keyFromUtcDate(startDateUtc);
    if (result.rowCount < 1) {
      setMessage('No reservations found in the selected range.', true);
      return;
    }

    const saveResult = await persistCurrentScheduleChanges();
    if (!saveResult.ok) {
      setMessage(saveResult.error || 'Failed to save schedule changes.', true);
      return;
    }

    if (format === 'csv') {
      const fileName = 'schedule-' + startKey + '.csv';
      downloadTextFile(fileName, rowsToCsv(currentScheduleRows) + '\n');
    } else {
      const fileName = 'schedule-' + startKey + '.txt';
      downloadTextFile(fileName, rowsToText(currentScheduleRows, formatCleaningScheduleLine) + '\n');
    }

    if (currentScheduleErrors.length) {
      setMessage('Downloaded with some issues: ' + currentScheduleErrors.join(' | '), true);
    } else {
      setMessage('Schedule downloaded.', false);
    }
  } catch {
    setMessage('Failed to build schedule.', true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('saveScheduleChangesBtn').addEventListener('click', async () => {
  const button = document.getElementById('saveScheduleChangesBtn');
  button.disabled = true;
  try {
    const saveResult = await persistCurrentScheduleChanges();
    if (!saveResult.ok) {
      setMessage(saveResult.error || 'Failed to save schedule changes.', true);
      return;
    }
    setMessage('Saved ' + saveResult.saved + ' schedule change(s).', false);
  } catch {
    setMessage('Failed to save schedule changes.', true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('cleanerForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const cleanerId = Number(document.getElementById('cleanerId').value);
  const isEdit = Number.isInteger(cleanerId) && cleanerId > 0;

  const button = document.getElementById('saveCleanerBtn');
  const firstName = document.getElementById('cleanerFirstName').value.trim();
  const lastName = document.getElementById('cleanerLastName').value.trim();
  const email = document.getElementById('cleanerEmail').value.trim();
  const telephone = document.getElementById('cleanerTelephone').value.trim();
  const password = document.getElementById('cleanerPassword').value;

  if (!firstName || !lastName || !email || !telephone) {
    setMessage('First name, last name, email, and telephone are required.', true);
    return;
  }

  if (!isEdit && !password) {
    setMessage('Password is required when adding changeover staff.', true);
    return;
  }

  button.disabled = true;
  try {
    const res = await fetch(
      isEdit ? '/api/cleaners/' + encodeURIComponent(cleanerId) : '/api/cleaners',
      {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, email, telephone, password })
      }
    );

    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || 'Failed to save changeover staff.', true);
      return;
    }

    setMessage(isEdit ? 'Changeover staff updated.' : 'Changeover staff added.', false);
    resetCleanerForm();
    await fetchCleaners();
  } catch {
    setMessage('Network error saving changeover staff.', true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('cancelCleanerEditBtn').addEventListener('click', () => {
  resetCleanerForm();
});

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
  document.getElementById('cleanerFormTitle').textContent = 'Add Cleaner';
  document.getElementById('saveCleanerBtn').textContent = 'Add Cleaner';
  document.getElementById('cancelCleanerEditBtn').classList.add('hidden');
}

function startCleanerEdit(cleanerId) {
  const cleaner = currentCleaners.find((item) => Number(item.id) === Number(cleanerId));
  if (!cleaner) {
    setMessage('Cleaner not found.', true);
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
  document.getElementById('cleanerFormTitle').textContent = 'Edit Cleaner';
  document.getElementById('saveCleanerBtn').textContent = 'Save Cleaner';
  document.getElementById('cancelCleanerEditBtn').classList.remove('hidden');
}

function renderCleaners(cleaners) {
  currentCleaners = cleaners || [];

  const tbody = document.getElementById('cleanersTableBody');
  tbody.innerHTML = '';

  if (!currentCleaners.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    cell.textContent = 'No cleaners configured yet.';
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

    const emailCell = document.createElement('td');
    emailCell.textContent = cleaner.email || '';

    const phoneCell = document.createElement('td');
    phoneCell.textContent = cleaner.telephone || '';

    const passwordCell = document.createElement('td');
    passwordCell.textContent = '********';

    const actionCell = document.createElement('td');
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn secondary';
    editBtn.textContent = 'Edit Cleaner';
    editBtn.addEventListener('click', () => {
      startCleanerEdit(cleaner.id);
    });

    actionCell.appendChild(editBtn);

    row.appendChild(firstNameCell);
    row.appendChild(lastNameCell);
    row.appendChild(emailCell);
    row.appendChild(phoneCell);
    row.appendChild(passwordCell);
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

    const name = document.createElement('span');
    name.className = 'cleaning-listing-name';
    name.textContent = listing.name;

    row.appendChild(checkbox);
    row.appendChild(name);
    container.appendChild(row);
  });
}

function renderPreparationListings(listings) {
  const container = document.getElementById('preparationListings');
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
    checkbox.className = 'preparation-listing-checkbox';
    checkbox.value = String(listing.id);
    checkbox.setAttribute('data-listing-name', listing.name);
    checkbox.setAttribute('data-property-name', listing.property_name || '');

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
    propertyName: box.getAttribute('data-property-name') || ''
  }));
}

function getSelectedPreparationListings() {
  const checked = Array.from(document.querySelectorAll('.preparation-listing-checkbox:checked'));
  return checked.map((box) => ({
    id: Number(box.value),
    name: box.getAttribute('data-listing-name') || 'Listing',
    propertyName: box.getAttribute('data-property-name') || ''
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
  const header = 'Date,Property,Listing';
  const body = rows.map((row) => {
    return [csvEscape(row.date), csvEscape(row.property), csvEscape(row.listing)].join(',');
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
    if (!grouped[row.date]) {
      grouped[row.date] = [];
    }
    grouped[row.date].push(row.property ? row.property + ' - ' + row.listing : row.listing);
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

function getSelectedPreparationStartDateUtc() {
  const raw = document.getElementById('preparationStartDate').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return utcDateFromKey(raw);
}

async function buildCleaningSchedule(selectedListings, days, startDateUtc) {
  const rangeKeys = [];
  const checkoutsByDay = {};

  for (let i = 0; i < days; i += 1) {
    const dayKey = keyFromUtcDate(addUtcDays(startDateUtc, i));
    rangeKeys.push(dayKey);
    checkoutsByDay[dayKey] = new Set();
  }

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
        const checkoutKey = toDateKey(event.end);
        if (checkoutKey && checkoutsByDay[checkoutKey]) {
          const rowKey = (listing.propertyName || '') + '||' + listing.name;
          checkoutsByDay[checkoutKey].add(rowKey);
        }
      });
    } catch {
      errors.push(listing.name + ': Network error while loading events.');
    }
  }));

  const rows = [];
  rangeKeys.forEach((dayKey) => {
    Array.from(checkoutsByDay[dayKey]).forEach((key) => {
      const split = key.split('||');
      rows.push({
        date: dayKey,
        property: split[0] || '',
        listing: split[1] || ''
      });
    });
  });

  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.property !== b.property) return a.property.localeCompare(b.property);
    return a.listing.localeCompare(b.listing);
  });

  return {
    text: rowsToText(rows, formatCleaningScheduleLine),
    csv: rowsToCsv(rows),
    rowCount: rows.length,
    errors
  };
}

async function buildPreparationSchedule(selectedListings, days, startDateUtc) {
  const rangeKeys = [];
  const checkinsByDay = {};

  for (let i = 0; i < days; i += 1) {
    const dayKey = keyFromUtcDate(addUtcDays(startDateUtc, i));
    rangeKeys.push(dayKey);
    checkinsByDay[dayKey] = new Set();
  }

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
        if (checkinKey && checkinsByDay[checkinKey]) {
          const rowKey = (listing.propertyName || '') + '||' + listing.name + '||' + (checkoutKey || '');
          checkinsByDay[checkinKey].add(rowKey);
        }
      });
    } catch {
      errors.push(listing.name + ': Network error while loading events.');
    }
  }));

  const rows = [];
  rangeKeys.forEach((dayKey) => {
    Array.from(checkinsByDay[dayKey]).forEach((key) => {
      const split = key.split('||');
      rows.push({
        date: dayKey,
        property: split[0] || '',
        listing: split[1] || '',
        checkoutDate: split[2] || ''
      });
    });
  });

  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.property !== b.property) return a.property.localeCompare(b.property);
    return a.listing.localeCompare(b.listing);
  });

  return {
    text: rowsToText(rows, formatPreparationScheduleLine),
    csv: preparationRowsToCsv(rows),
    rowCount: rows.length,
    errors
  };
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
  renderPreparationListings(currentListings);
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
    throw new Error(data.error || 'Failed to load cleaners.');
  }

  renderCleaners(data.cleaners || []);
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
    document.getElementById('preparationStartDate').value = toDateInputValue(todayUtc);
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
      body: JSON.stringify({ name, propertyId })
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

document.getElementById('cleaningScheduleForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const button = document.getElementById('downloadCleaningScheduleBtn');
  const daysValue = Number(document.getElementById('cleaningDays').value);
  const format = document.getElementById('cleaningFormat').value;
  const startDateUtc = getSelectedStartDateUtc();
  const selectedListings = getSelectedCleaningListings();

  if (!selectedListings.length) {
    setMessage('Select at least one listing for the cleaning schedule.', true);
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
  setMessage('Building cleaning schedule from latest feeds...', false);

  try {
    const result = await buildCleaningSchedule(selectedListings, daysValue, startDateUtc);
    const startKey = keyFromUtcDate(startDateUtc);
    if (result.rowCount < 1) {
      setMessage('No checkout events found in the selected range.', true);
      return;
    }

    if (format === 'csv') {
      const fileName = 'cleaning-schedule-' + startKey + '.csv';
      downloadTextFile(fileName, result.csv + '\n');
    } else {
      const fileName = 'cleaning-schedule-' + startKey + '.txt';
      downloadTextFile(fileName, result.text + '\n');
    }

    if (result.errors.length) {
      setMessage('Downloaded with some issues: ' + result.errors.join(' | '), true);
    } else {
      setMessage('Cleaning schedule downloaded.', false);
    }
  } catch {
    setMessage('Failed to build cleaning schedule.', true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('preparationScheduleForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const button = document.getElementById('downloadPreparationScheduleBtn');
  const daysValue = Number(document.getElementById('preparationDays').value);
  const format = document.getElementById('preparationFormat').value;
  const startDateUtc = getSelectedPreparationStartDateUtc();
  const selectedListings = getSelectedPreparationListings();

  if (!selectedListings.length) {
    setMessage('Select at least one listing for the preparation schedule.', true);
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
  setMessage('Building preparation schedule from latest feeds...', false);

  try {
    const result = await buildPreparationSchedule(selectedListings, daysValue, startDateUtc);
    const startKey = keyFromUtcDate(startDateUtc);
    if (result.rowCount < 1) {
      setMessage('No checkin events found in the selected range.', true);
      return;
    }

    if (format === 'csv') {
      const fileName = 'preparation-schedule-' + startKey + '.csv';
      downloadTextFile(fileName, result.csv + '\n');
    } else {
      const fileName = 'preparation-schedule-' + startKey + '.txt';
      downloadTextFile(fileName, result.text + '\n');
    }

    if (result.errors.length) {
      setMessage('Downloaded with some issues: ' + result.errors.join(' | '), true);
    } else {
      setMessage('Preparation schedule downloaded.', false);
    }
  } catch {
    setMessage('Failed to build preparation schedule.', true);
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
    setMessage('Password is required when adding a cleaner.', true);
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
      setMessage(data.error || 'Failed to save cleaner.', true);
      return;
    }

    setMessage(isEdit ? 'Cleaner updated.' : 'Cleaner added.', false);
    resetCleanerForm();
    await fetchCleaners();
  } catch {
    setMessage('Network error saving cleaner.', true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('cancelCleanerEditBtn').addEventListener('click', () => {
  resetCleanerForm();
});

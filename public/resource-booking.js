'use strict';

let currentResource = null;
let availabilityConfirmed = false;
let currentCalculatedRate = null;

function setBookingMessage(text, isError) {
  const el = document.getElementById('resourceBookingMessage');
  if (!el) {
    return;
  }
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function getSelectedResourceId() {
  const select = document.getElementById('resourceBookingResourceSelect');
  if (!select) {
    return null;
  }
  const id = Number(select.value || 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function setBookingFormEnabled(enabled) {
  const form = document.getElementById('publicBookingRequestForm');
  if (!form) {
    return;
  }

  Array.from(form.querySelectorAll('input, select, button')).forEach((el) => {
    if (el.id === 'resourceBookingResourceSelect') {
      return;
    }
    el.disabled = !enabled;
  });
}

function resetBookingContext() {
  currentResource = null;
  availabilityConfirmed = false;
  currentCalculatedRate = null;
  document.getElementById('publicBookingResourceName').textContent = 'Resource';
  document.getElementById('publicBookingDescription').innerHTML = '<p class="public-booking-placeholder">Select a facility to begin.</p>';
  document.getElementById('bookingPaymentSelect').innerHTML = '<option value="">Select a payment option</option>';
  document.getElementById('bookingRateLine').textContent = 'The rate for the reservation will be: --';

  const spacesRow = document.getElementById('bookingSpacesRequiredRow');
  const spacesInput = document.getElementById('spacesRequired');
  spacesRow.classList.add('hidden');
  spacesRow.style.display = 'none';
  spacesInput.disabled = true;
  spacesInput.value = '1';

  setBookingFormEnabled(false);
}

function isEnabledValue(value) {
  if (value === true || value === 1) {
    return true;
  }
  if (typeof value === 'string') {
    const normalised = value.trim().toLowerCase();
    return normalised === 'true' || normalised === '1' || normalised === 't' || normalised === 'yes' || normalised === 'y';
  }
  return false;
}

function getEnabledPaymentOptions(resource) {
  if (!resource) {
    return [];
  }

  const options = [
    { key: 'free_of_charge', label: 'Free Of Charge', enabled: isEnabledValue(resource.free_of_charge) },
    { key: 'cash_on_site', label: 'Cash On Site', enabled: isEnabledValue(resource.cash_on_site) },
    { key: 'bank_transfer', label: 'Bank Transfer', enabled: isEnabledValue(resource.bank_transfer) },
    { key: 'online_payment', label: 'Online Payment', enabled: isEnabledValue(resource.online_payment) }
  ];

  return options.filter((option) => option.enabled);
}

function populatePaymentSelectionDropdown(resource) {
  const select = document.getElementById('bookingPaymentSelect');
  if (!select) {
    return;
  }

  const options = getEnabledPaymentOptions(resource);
  select.innerHTML = '<option value="">Select a payment option</option>';

  options.forEach((option) => {
    const optionEl = document.createElement('option');
    optionEl.value = option.key;
    optionEl.textContent = option.label;
    select.appendChild(optionEl);
  });

  select.value = '';
}

function syncMirroredField(sourceId, targetId) {
  const source = document.getElementById(sourceId);
  const target = document.getElementById(targetId);
  if (!source || !target) {
    return;
  }

  const isManualOverride = target.dataset.manualOverride === 'true';
  if (!isManualOverride) {
    target.value = source.value;
  }

  const syncFromSource = () => {
    if (target.dataset.manualOverride === 'true') {
      return;
    }
    target.value = source.value;
  };

  source.addEventListener('input', syncFromSource);
  source.addEventListener('change', syncFromSource);

  const updateManualOverride = () => {
    target.dataset.manualOverride = target.value !== source.value ? 'true' : 'false';
  };

  target.addEventListener('input', updateManualOverride);
  target.addEventListener('change', updateManualOverride);
}

function configureSpacesRequiredInput(maxValue) {
  const input = document.getElementById('spacesRequired');
  const hint = document.getElementById('spacesRequiredHint');
  if (!input) {
    return;
  }

  input.min = '1';
  input.step = '1';
  input.max = String(maxValue);

  const parsed = Number(input.value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maxValue) {
    input.value = '1';
  }

  const normalise = () => {
    if (input.value.trim() === '') {
      input.value = '1';
      return;
    }
    const numeric = Number(input.value);
    if (!Number.isFinite(numeric)) {
      input.value = '1';
      return;
    }
    const clamped = Math.min(maxValue, Math.max(1, Math.floor(numeric)));
    input.value = String(clamped);
  };

  input.onblur = normalise;
  input.onchange = normalise;

  if (hint) {
    hint.textContent = 'Allowed range: 1 to ' + maxValue + ' spaces.';
  }
}

function parseLocalDateTime(dateValue, timeValue) {
  const dateKey = String(dateValue || '').trim();
  const timeKey = String(timeValue || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !/^\d{2}:\d{2}$/.test(timeKey)) {
    return null;
  }
  const parsed = new Date(dateKey + 'T' + timeKey + ':00');
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function getTimeStringFromInputs(hourInputId, minuteInputId) {
  const hourEl = document.getElementById(hourInputId);
  const minuteEl = document.getElementById(minuteInputId);
  if (!hourEl || !minuteEl) {
    return '';
  }
  const hour = String(hourEl.value || '').trim();
  const minute = String(minuteEl.value || '').trim();
  if (!/^\d{1,2}$/.test(hour) || !/^\d{1,2}$/.test(minute)) {
    return '';
  }
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
}

function toMoney(value) {
  return Math.round(value * 100) / 100;
}

function parseConfiguredRate(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }
  return numeric;
}

function getChargeConfigValue(resource, snakeKey, camelKey) {
  if (!resource) {
    return null;
  }
  if (resource[snakeKey] !== undefined && resource[snakeKey] !== null) {
    return resource[snakeKey];
  }
  if (camelKey && resource[camelKey] !== undefined && resource[camelKey] !== null) {
    return resource[camelKey];
  }
  return null;
}

function getInclusiveCalendarDayCount(start, end) {
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  const spanDays = Math.floor((endUtc - startUtc) / 86400000);
  return spanDays + 1;
}

function readHourlyRates(resource) {
  const source = getChargeConfigValue(resource, 'hourly_rates_json', 'hourlyRatesJson');
  let parsed = [];

  if (Array.isArray(source)) {
    parsed = source;
  } else if (typeof source === 'string' && source.trim()) {
    try {
      const json = JSON.parse(source);
      parsed = Array.isArray(json) ? json : [];
    } catch {
      parsed = [];
    }
  }

  if (parsed.length !== 24) {
    return null;
  }

  const numeric = parsed.map((rate) => Number(rate));
  if (numeric.some((rate) => !Number.isFinite(rate) || rate < 0)) {
    return null;
  }

  return numeric;
}

function calculateReservationRate(resource, start, end) {
  if (!resource || !start || !end || end.getTime() <= start.getTime()) {
    return null;
  }

  const hourlyChargeMode = String(getChargeConfigValue(resource, 'hourly_charge_mode', 'hourlyChargeMode') || '');
  const hourlyRate = parseConfiguredRate(getChargeConfigValue(resource, 'hourly_rate', 'hourlyRate'));
  const hasSingleHourlyRate = hourlyRate !== null;
  const hasPositiveSingleHourlyRate = hourlyRate !== null && hourlyRate > 0;

  const chargeBasis = String(getChargeConfigValue(resource, 'charge_basis', 'chargeBasis') || '');

  const totalMinutes = Math.ceil((end.getTime() - start.getTime()) / 60000);
  if (totalMinutes <= 0) {
    return null;
  }

  if (chargeBasis === 'daily') {
    const dailyRate = parseConfiguredRate(getChargeConfigValue(resource, 'daily_rate', 'dailyRate'));
    if (dailyRate === null) {
      return null;
    }

    const inclusiveDays = getInclusiveCalendarDayCount(start, end);
    if (inclusiveDays <= 0) {
      return null;
    }

    const dailyChargeMode = String(getChargeConfigValue(resource, 'daily_charge_mode', 'dailyChargeMode') || '');

    if (dailyChargeMode === 'per_calendar_day') {
      return toMoney(inclusiveDays * dailyRate);
    }

    if (dailyChargeMode === 'per_24_hours') {
      const billedDays = Math.ceil(totalMinutes / (24 * 60));
      return toMoney(billedDays * dailyRate);
    }

    return null;
  }

  if (chargeBasis === 'hourly') {
    const useSingleRate = hourlyChargeMode === 'single_rate'
      || (hourlyChargeMode !== 'per_hour_of_day' && hasSingleHourlyRate);

    if (useSingleRate) {
      if (!hasSingleHourlyRate) {
        return null;
      }
      const fullHours = Math.floor(totalMinutes / 60);
      const hasRemainder = totalMinutes % 60 > 0;
      const chargedHours = fullHours + (hasRemainder ? 1 : 0);
      return toMoney(chargedHours * hourlyRate);
    }

    if (hourlyChargeMode === 'per_hour_of_day') {
      const hourlyRates = readHourlyRates(resource);
      if (!hourlyRates) {
        if (hasSingleHourlyRate) {
          const fullHours = Math.floor(totalMinutes / 60);
          const hasRemainder = totalMinutes % 60 > 0;
          const chargedHours = fullHours + (hasRemainder ? 1 : 0);
          return toMoney(chargedHours * hourlyRate);
        }
        return null;
      }

      const hourlyGridHasAnyPositiveRate = hourlyRates.some((rate) => rate > 0);
      if (!hourlyGridHasAnyPositiveRate && hasPositiveSingleHourlyRate) {
        const fullHours = Math.floor(totalMinutes / 60);
        const hasRemainder = totalMinutes % 60 > 0;
        const chargedHours = fullHours + (hasRemainder ? 1 : 0);
        return toMoney(chargedHours * hourlyRate);
      }

      let total = 0;
      let cursor = new Date(start.getTime());

      while (cursor.getTime() < end.getTime()) {
        total += hourlyRates[cursor.getHours()];
        const next = new Date(cursor.getTime());
        next.setMinutes(0, 0, 0);
        next.setHours(next.getHours() + 1);
        cursor = next;
      }

      return toMoney(total);
    }
  }

  return null;
}

function updateReservationRateDisplay() {
  const line = document.getElementById('bookingRateLine');
  if (!line) {
    return;
  }

  const requestedStartDate = document.getElementById('requestedBookingStartDate').value;
  const requestedStartTime = getTimeStringFromInputs('requestedBookingStartHour', 'requestedBookingStartMinute');
  const requestedEndDate = document.getElementById('requestedBookingEndDate').value;
  const requestedEndTime = getTimeStringFromInputs('requestedBookingEndHour', 'requestedBookingEndMinute');

  const start = parseLocalDateTime(requestedStartDate, requestedStartTime);
  const end = parseLocalDateTime(requestedEndDate, requestedEndTime);

  const total = calculateReservationRate(currentResource, start, end);
  currentCalculatedRate = total;
  if (total === null) {
    line.textContent = 'The rate for the reservation will be: --';
    return;
  }

  line.textContent = 'The rate for the reservation will be: ' + total.toFixed(2);
}

function getCheckAvailabilityPayload(resource) {
  const checkinDate = document.getElementById('guestCheckinDate').value;
  const checkoutDate = document.getElementById('guestCheckoutDate').value;
  const requestedStartDate = document.getElementById('requestedBookingStartDate').value;
  const requestedStartTime = getTimeStringFromInputs('requestedBookingStartHour', 'requestedBookingStartMinute');
  const requestedEndDate = document.getElementById('requestedBookingEndDate').value;
  const requestedEndTime = getTimeStringFromInputs('requestedBookingEndHour', 'requestedBookingEndMinute');

  if (!checkinDate || !checkoutDate || !requestedStartDate || !requestedStartTime || !requestedEndDate || !requestedEndTime) {
    return { error: 'Please complete checkin/checkout and requested start/end date-times.' };
  }

  const spacesInput = document.getElementById('spacesRequired');
  const rawSpaces = Number(spacesInput ? spacesInput.value : 1);
  const spacesRequired = Number.isInteger(rawSpaces) && rawSpaces > 0 ? rawSpaces : 1;

  return {
    payload: {
      checkinDate,
      checkoutDate,
      requestedStartDate,
      requestedStartTime,
      requestedEndDate,
      requestedEndTime,
      spacesRequired: resource && String(resource.resource_type || '').toLowerCase() === 'parking' ? spacesRequired : 1
    }
  };
}

function getReservationPageUrl(paymentKey) {
  const resourceId = getSelectedResourceId();
  const pageMap = {
    free_of_charge: '/public-pages/free-of-charge-reservation.html',
    cash_on_site: '/public-pages/cash-on-site-reservation.html',
    bank_transfer: '/public-pages/bank-transfer-reservation.html',
    online_payment: '/public-pages/online-payment-reservation.html'
  };

  const pageName = pageMap[paymentKey] || '/public-pages/free-of-charge-reservation.html';

  const startDate = document.getElementById('requestedBookingStartDate') ? document.getElementById('requestedBookingStartDate').value : '';
  const startTime = getTimeStringFromInputs('requestedBookingStartHour', 'requestedBookingStartMinute');
  const endDate = document.getElementById('requestedBookingEndDate') ? document.getElementById('requestedBookingEndDate').value : '';
  const endTime = getTimeStringFromInputs('requestedBookingEndHour', 'requestedBookingEndMinute');
  const checkinDate = document.getElementById('guestCheckinDate') ? document.getElementById('guestCheckinDate').value : '';
  const checkoutDate = document.getElementById('guestCheckoutDate') ? document.getElementById('guestCheckoutDate').value : '';
  const spacesRequired = document.getElementById('spacesRequired') ? document.getElementById('spacesRequired').value : '';
  const startDateTime = (startDate && startTime) ? (startDate + 'T' + startTime) : '';
  const endDateTime = (endDate && endTime) ? (endDate + 'T' + endTime) : '';
  const price = currentCalculatedRate !== null ? String(currentCalculatedRate) : '';

  return pageName
    + '?resourceId=' + encodeURIComponent(resourceId)
    + '&paymentOption=' + encodeURIComponent(paymentKey)
    + (startDateTime ? '&startDateTime=' + encodeURIComponent(startDateTime) : '')
    + (endDateTime ? '&endDateTime=' + encodeURIComponent(endDateTime) : '')
    + (checkinDate ? '&checkinDate=' + encodeURIComponent(checkinDate) : '')
    + (checkoutDate ? '&checkoutDate=' + encodeURIComponent(checkoutDate) : '')
    + (spacesRequired ? '&spacesRequired=' + encodeURIComponent(spacesRequired) : '')
    + (price !== '' ? '&price=' + encodeURIComponent(price) : '');
}

function initialiseBookingRequestForm() {
  syncMirroredField('guestCheckinDate', 'requestedBookingStartDate');
  syncMirroredField('guestCheckinHour', 'requestedBookingStartHour');
  syncMirroredField('guestCheckinMinute', 'requestedBookingStartMinute');
  syncMirroredField('guestCheckoutDate', 'requestedBookingEndDate');
  syncMirroredField('guestCheckoutHour', 'requestedBookingEndHour');
  syncMirroredField('guestCheckoutMinute', 'requestedBookingEndMinute');

  const form = document.getElementById('publicBookingRequestForm');
  if (form) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
    });
  }

  [
    'guestCheckinDate',
    'guestCheckinHour',
    'guestCheckinMinute',
    'guestCheckoutDate',
    'guestCheckoutHour',
    'guestCheckoutMinute',
    'requestedBookingStartDate',
    'requestedBookingStartHour',
    'requestedBookingStartMinute',
    'requestedBookingEndDate',
    'requestedBookingEndHour',
    'requestedBookingEndMinute'
  ].forEach((id) => {
    const input = document.getElementById(id);
    if (!input) {
      return;
    }
    input.addEventListener('input', () => {
      availabilityConfirmed = false;
      updateReservationRateDisplay();
    });
    input.addEventListener('change', () => {
      availabilityConfirmed = false;
      updateReservationRateDisplay();
    });
  });

  const reserveBtn = document.getElementById('reserveBtn');
  if (reserveBtn) {
    reserveBtn.addEventListener('click', () => {
      const resourceId = getSelectedResourceId();
      if (!resourceId) {
        setBookingMessage('Please select a facility first.', true);
        return;
      }

      const select = document.getElementById('bookingPaymentSelect');
      if (!select || !select.value) {
        setBookingMessage('Please select a payment option.', true);
        return;
      }

      if (!availabilityConfirmed) {
        setBookingMessage('Please check availability before reserving.', true);
        return;
      }

      window.location.href = getReservationPageUrl(select.value);
    });
  }
}

function populateResourceSelect(resources) {
  const select = document.getElementById('resourceBookingResourceSelect');
  if (!select) {
    return;
  }

  const sorted = (Array.isArray(resources) ? resources : []).slice().sort((a, b) => {
    const aName = String(a.short_description || a.name || '').toLowerCase();
    const bName = String(b.short_description || b.name || '').toLowerCase();
    return aName.localeCompare(bName);
  });

  select.innerHTML = '<option value="">Select a facility</option>';
  sorted.forEach((resource) => {
    const option = document.createElement('option');
    option.value = String(resource.id || '');
    option.textContent = String(resource.short_description || ('Facility #' + String(resource.id || '')));
    select.appendChild(option);
  });

  const fromQuery = Number(new URLSearchParams(window.location.search).get('resourceId') || 0);
  if (Number.isInteger(fromQuery) && fromQuery > 0) {
    select.value = String(fromQuery);
  } else if (sorted.length === 1) {
    select.value = String(sorted[0].id);
  }
}

async function loadSelectedResource() {
  const resourceId = getSelectedResourceId();
  if (!resourceId) {
    resetBookingContext();
    return;
  }

  const requestUrl = '/api/public/shared-resources/' + resourceId + '?_ts=' + Date.now();
  const res = await fetch(requestUrl, { cache: 'no-store' });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'Failed to load shared resource.');
  }

  const resource = data.resource;
  currentResource = resource;
  availabilityConfirmed = false;

  document.getElementById('publicBookingResourceName').textContent = resource.short_description || 'Shared Resource';
  document.getElementById('publicBookingDescription').innerHTML = resource.full_description_html || '<p>No description provided.</p>';

  populatePaymentSelectionDropdown(resource);
  updateReservationRateDisplay();

  const spacesRow = document.getElementById('bookingSpacesRequiredRow');
  const spacesInput = document.getElementById('spacesRequired');
  const isParking = String(resource.resource_type || '').toLowerCase() === 'parking';

  if (isParking) {
    const maxUnits = Number(resource.max_units);
    const maxValue = Number.isInteger(maxUnits) && maxUnits > 0 ? maxUnits : 1;
    spacesRow.classList.remove('hidden');
    spacesRow.style.display = '';
    spacesInput.disabled = false;
    configureSpacesRequiredInput(maxValue);
  } else {
    spacesRow.classList.add('hidden');
    spacesRow.style.display = 'none';
    spacesInput.disabled = true;
    spacesInput.removeAttribute('max');
    spacesInput.value = '1';
    const hint = document.getElementById('spacesRequiredHint');
    if (hint) {
      hint.textContent = '';
    }
  }

  setBookingFormEnabled(true);
}

function setupCheckAvailability() {
  const button = document.getElementById('checkAvailabilityBtn');
  if (!button) {
    return;
  }

  button.addEventListener('click', async () => {
    const resourceId = getSelectedResourceId();
    if (!resourceId || !currentResource) {
      setBookingMessage('Select a facility before checking availability.', true);
      return;
    }

    const prepared = getCheckAvailabilityPayload(currentResource);
    if (prepared.error) {
      setBookingMessage(prepared.error, true);
      return;
    }

    button.disabled = true;
    availabilityConfirmed = false;

    try {
      await loadSelectedResource();

      const res = await fetch('/api/public/shared-resources/' + resourceId + '/check-availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prepared.payload)
      });

      const data = await res.json();
      if (!res.ok) {
        setBookingMessage(data.error || 'Availability check failed.', true);
        return;
      }

      availabilityConfirmed = true;
      setBookingMessage(data.message || 'Availability Confirmed', false);
    } catch {
      setBookingMessage('Network error checking availability.', true);
    } finally {
      button.disabled = false;
    }
  });
}

(async () => {
  try {
    const meRes = await fetch('/api/me');
    if (!meRes.ok) {
      window.location.href = '/';
      return;
    }

    initialiseBookingRequestForm();
    setupCheckAvailability();
    resetBookingContext();

    const resourcesRes = await fetch('/api/shared-resources');
    const resourcesData = await resourcesRes.json();
    if (!resourcesRes.ok) {
      throw new Error(resourcesData.error || 'Failed to load facilities.');
    }

    const resources = Array.isArray(resourcesData.resources) ? resourcesData.resources : [];
    populateResourceSelect(resources);

    const resourceSelect = document.getElementById('resourceBookingResourceSelect');
    resourceSelect.addEventListener('change', async () => {
      try {
        await loadSelectedResource();
      } catch (err) {
        resetBookingContext();
        setBookingMessage(err.message || 'Unable to load selected facility.', true);
      }
    });

    if (getSelectedResourceId()) {
      await loadSelectedResource();
    }
  } catch (err) {
    setBookingMessage(err.message || 'Unable to load booking page.', true);
  }
})();

document.getElementById('backBtn').addEventListener('click', () => {
  window.location.href = '/dashboard.html?tab=panel-dashboard';
});

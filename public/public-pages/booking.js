'use strict';

let currentResource = null;
let availabilityConfirmed = false;

function setBookingMessage(text, isError) {
  const el = document.getElementById('publicBookingMessage');
  if (!el) {
    return;
  }
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function getResourceIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const direct = Number(params.get('resourceId'));
  if (Number.isInteger(direct) && direct > 0) {
    return direct;
  }

  const fallback = Number(params.get('id'));
  if (Number.isInteger(fallback) && fallback > 0) {
    return fallback;
  }

  return null;
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

  source.addEventListener('input', () => {
    if (target.dataset.manualOverride === 'true') {
      return;
    }
    target.value = source.value;
  });

  target.addEventListener('input', () => {
    target.dataset.manualOverride = target.value !== source.value ? 'true' : 'false';
  });
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

function toMoney(value) {
  return Math.round(value * 100) / 100;
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

  const chargeBasis = String(getChargeConfigValue(resource, 'charge_basis', 'chargeBasis') || '');
  const totalMinutes = Math.ceil((end.getTime() - start.getTime()) / 60000);
  if (totalMinutes <= 0) {
    return null;
  }

  if (chargeBasis === 'daily') {
    const dailyRate = Number(getChargeConfigValue(resource, 'daily_rate', 'dailyRate'));
    if (!Number.isFinite(dailyRate) || dailyRate < 0) {
      return null;
    }

    // Updated business rule: any part day at start/end is billed as a full day.
    const inclusiveDays = getInclusiveCalendarDayCount(start, end);
    if (inclusiveDays <= 0) {
      return null;
    }

    const dailyChargeMode = String(getChargeConfigValue(resource, 'daily_charge_mode', 'dailyChargeMode') || '');

    if (dailyChargeMode === 'per_calendar_day') {
      return toMoney(inclusiveDays * dailyRate);
    }

    if (dailyChargeMode === 'per_24_hours') {
      return toMoney(inclusiveDays * dailyRate);
    }

    return null;
  }

  if (chargeBasis === 'hourly') {
    const hourlyChargeMode = String(getChargeConfigValue(resource, 'hourly_charge_mode', 'hourlyChargeMode') || '');

    if (hourlyChargeMode === 'single_rate') {
      const hourlyRate = Number(getChargeConfigValue(resource, 'hourly_rate', 'hourlyRate'));
      if (!Number.isFinite(hourlyRate) || hourlyRate < 0) {
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
        return null;
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

  const start = parseLocalDateTime(
    document.getElementById('requestedBookingStartDate').value,
    document.getElementById('requestedBookingStartTime').value
  );
  const end = parseLocalDateTime(
    document.getElementById('requestedBookingEndDate').value,
    document.getElementById('requestedBookingEndTime').value
  );

  const total = calculateReservationRate(currentResource, start, end);
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
  const requestedStartTime = document.getElementById('requestedBookingStartTime').value;
  const requestedEndDate = document.getElementById('requestedBookingEndDate').value;
  const requestedEndTime = document.getElementById('requestedBookingEndTime').value;

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
  const resourceId = getResourceIdFromUrl();
  const pageMap = {
    free_of_charge: 'free-of-charge-reservation.html',
    cash_on_site: 'cash-on-site-reservation.html',
    bank_transfer: 'bank-transfer-reservation.html',
    online_payment: 'online-payment-reservation.html'
  };

  const pageName = pageMap[paymentKey] || 'free-of-charge-reservation.html';
  return pageName + '?resourceId=' + encodeURIComponent(resourceId) + '&paymentOption=' + encodeURIComponent(paymentKey);
}

function initialiseBookingRequestForm() {
  syncMirroredField('guestCheckinDate', 'requestedBookingStartDate');
  syncMirroredField('guestCheckinTime', 'requestedBookingStartTime');
  syncMirroredField('guestCheckoutDate', 'requestedBookingEndDate');
  syncMirroredField('guestCheckoutTime', 'requestedBookingEndTime');

  const form = document.getElementById('publicBookingRequestForm');
  if (form) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
    });
  }

  [
    'guestCheckinDate',
    'guestCheckinTime',
    'guestCheckoutDate',
    'guestCheckoutTime',
    'requestedBookingStartDate',
    'requestedBookingStartTime',
    'requestedBookingEndDate',
    'requestedBookingEndTime'
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

function setupCheckAvailability(resourceId) {
  const button = document.getElementById('checkAvailabilityBtn');
  if (!button) {
    return;
  }

  button.addEventListener('click', async () => {
    if (!currentResource) {
      setBookingMessage('Shared resource is not loaded yet.', true);
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
      // Refresh resource first so calculation/payment options use latest admin config.
      await loadPublicResource();

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

async function loadPublicResource() {
  const resourceId = getResourceIdFromUrl();
  if (!resourceId) {
    setBookingMessage('Invalid or missing shared resource id in URL.', true);
    return;
  }

  const res = await fetch('/api/public/shared-resources/' + resourceId);
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
}

(async () => {
  try {
    const resourceId = getResourceIdFromUrl();
    if (!resourceId) {
      setBookingMessage('Invalid or missing shared resource id in URL.', true);
      return;
    }

    initialiseBookingRequestForm();
    setupCheckAvailability(resourceId);
    await loadPublicResource();
  } catch (err) {
    setBookingMessage(err.message || 'Unable to load booking page.', true);
  }
})();

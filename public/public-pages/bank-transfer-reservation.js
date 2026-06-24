'use strict';

const params = new URLSearchParams(window.location.search);
const resourceId = Number(params.get('resourceId'));
const paymentOption = String(params.get('paymentOption') || '');
const startDateTimeParam = params.get('startDateTime') || '';
const endDateTimeParam = params.get('endDateTime') || '';
const priceParam = params.get('price') || '';
const checkinDateParam = params.get('checkinDate') || '';
const checkoutDateParam = params.get('checkoutDate') || '';
const spacesRequiredParam = params.get('spacesRequired') || '';

let currentResource = null;
let reservationGuestOptions = [];

function formatReservationDateTime(isoStr) {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function renderReservationDetails() {
  const startEl = document.getElementById('reservationStart');
  const endEl = document.getElementById('reservationEnd');
  const priceEl = document.getElementById('reservationPrice');
  const parsedPrice = Number(priceParam);

  if (startEl) startEl.textContent = formatReservationDateTime(startDateTimeParam);
  if (endEl) endEl.textContent = formatReservationDateTime(endDateTimeParam);
  if (priceEl) priceEl.textContent = Number.isFinite(parsedPrice) ? ('£' + parsedPrice.toFixed(2)) : '-';
}

function getGuestPayload() {
  const firstName = document.getElementById('guestFirstName') ? document.getElementById('guestFirstName').value.trim() : '';
  const familyName = document.getElementById('guestFamilyName') ? document.getElementById('guestFamilyName').value.trim() : '';
  const emailAddress = document.getElementById('guestEmailAddress') ? document.getElementById('guestEmailAddress').value.trim() : '';
  const telephone = document.getElementById('guestTelephone') ? document.getElementById('guestTelephone').value.trim() : '';

  if (!firstName || !familyName || !emailAddress || !telephone) {
    return { error: 'Please enter first name, family name, email address and telephone.' };
  }

  return {
    payload: {
      firstName,
      familyName,
      emailAddress,
      telephone
    }
  };
}

function setReservationMessage(text, isError) {
  const el = document.getElementById('reservationMessage');
  if (!el) {
    return;
  }
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function getPaymentMessageField(paymentKey) {
  const fieldMap = {
    free_of_charge: 'free_of_charge_message_html',
    cash_on_site: 'cash_on_site_message_html',
    bank_transfer: 'bank_transfer_message_html',
    online_payment: 'online_payment_message_html'
  };
  return fieldMap[paymentKey] || 'free_of_charge_message_html';
}

function renderPaymentMethodMessage(resource, paymentKey) {
  const container = document.getElementById('paymentMethodMessage');
  if (!container || !resource) {
    return;
  }

  const fieldName = getPaymentMessageField(paymentKey);
  const messageHtml = String(resource[fieldName] || '').trim();
  if (!messageHtml) {
    container.innerHTML = '<p class="public-booking-placeholder">No payment instructions configured.</p>';
    return;
  }

  container.innerHTML = messageHtml;
}

function toLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function toLocalTimeKey(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return hours + ':' + minutes;
}

function buildAvailabilityPayload() {
  const startDate = new Date(startDateTimeParam);
  const endDate = new Date(endDateTimeParam);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return null;
  }

  return {
    checkinDate: checkinDateParam,
    checkoutDate: checkoutDateParam,
    requestedStartDate: toLocalDateKey(startDate),
    requestedStartTime: toLocalTimeKey(startDate),
    requestedEndDate: toLocalDateKey(endDate),
    requestedEndTime: toLocalTimeKey(endDate),
    requestedStartAt: startDateTimeParam,
    requestedEndAt: endDateTimeParam,
    spacesRequired: spacesRequiredParam
  };
}

async function recheckAvailabilityOrThrow() {
  const payload = buildAvailabilityPayload();
  if (!payload) {
    throw new Error('Reservation start and end date/time are missing.');
  }

  const res = await fetch('/api/public/shared-resources/' + resourceId + '/check-availability', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'The selected facility is no longer available for those dates/times.');
  }
}

function populateExistingGuestSelect(guestUsers) {
  const select = document.getElementById('existingGuestSelect');
  if (!select) {
    return;
  }

  const list = Array.isArray(guestUsers) ? guestUsers : [];
  const seenKeys = new Set();
  reservationGuestOptions = list.filter((guest) => {
    const email = String(guest && guest.email || '').trim().toLowerCase();
    const firstName = String(guest && guest.firstName || '').trim().toLowerCase();
    const familyName = String(guest && guest.familyName || '').trim().toLowerCase();
    const key = email || (firstName + '|' + familyName);
    if (!key || seenKeys.has(key)) {
      return false;
    }
    seenKeys.add(key);
    return true;
  });
  select.innerHTML = '<option value="">Select existing guest (optional)</option>';

  reservationGuestOptions.forEach((guest, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    const name = String(guest.displayName || '').trim();
    const email = String(guest.email || '').trim();
    option.textContent = name && email ? (name + ' (' + email + ')') : (name || email || 'Guest');
    select.appendChild(option);
  });
}

function applyExistingGuest(indexValue) {
  const index = Number(indexValue);
  if (!Number.isInteger(index) || index < 0 || index >= reservationGuestOptions.length) {
    return;
  }

  const guest = reservationGuestOptions[index] || {};
  const firstName = String(guest.firstName || '').trim();
  const familyName = String(guest.familyName || '').trim();
  const email = String(guest.email || '').trim();
  const telephone = String(guest.telephone || '').trim();

  if (firstName) {
    document.getElementById('guestFirstName').value = firstName;
  }
  if (familyName) {
    document.getElementById('guestFamilyName').value = familyName;
  }
  if (email) {
    document.getElementById('guestEmailAddress').value = email;
  }
  if (telephone) {
    document.getElementById('guestTelephone').value = telephone;
  }
}

async function loadReservationGuestOptions() {
  const select = document.getElementById('existingGuestSelect');
  if (!select) {
    return;
  }

  try {
    const res = await fetch('/api/shared-reservations/guest-users');
    if (res.status === 401) {
      window.location.href = '/';
      return;
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to load existing guests.');
    }

    populateExistingGuestSelect(Array.isArray(data.guestUsers) ? data.guestUsers : []);
  } catch {
    populateExistingGuestSelect([]);
  }
}

async function loadPublicResource() {
  if (!Number.isInteger(resourceId) || resourceId <= 0) {
    setReservationMessage('Invalid resource id.', true);
    return;
  }

  try {
    const res = await fetch('/api/public/shared-resources/' + resourceId);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to load shared resource.');
    }

    currentResource = data.resource;
    document.getElementById('reservationTitle').textContent = (currentResource.short_description || 'Reservation') + ' - Bank Transfer';

    renderPaymentMethodMessage(currentResource, paymentOption);
  } catch (err) {
    setReservationMessage(err.message || 'Unable to load reservation page.', true);
  }
}

(async () => {
  try {
    await loadPublicResource();
    renderReservationDetails();
    await loadReservationGuestOptions();
  } catch (err) {
    setReservationMessage(err.message || 'Failed to initialize reservation page.', true);
  }
})();

const existingGuestSelect = document.getElementById('existingGuestSelect');
if (existingGuestSelect) {
  existingGuestSelect.addEventListener('change', () => {
    applyExistingGuest(existingGuestSelect.value);
  });
}

document.getElementById('backToPaymentBtn').addEventListener('click', () => {
  window.history.back();
});

document.getElementById('submitReservationBtn').addEventListener('click', async () => {
  const guest = getGuestPayload();
  if (guest.error) {
    setReservationMessage(guest.error, true);
    return;
  }

  if (!startDateTimeParam || !endDateTimeParam) {
    setReservationMessage('Reservation start and end date/time are missing.', true);
    return;
  }

  const submitBtn = document.getElementById('submitReservationBtn');
  if (submitBtn) {
    submitBtn.disabled = true;
  }

  setReservationMessage('Submitting reservation...', false);

  try {
    await recheckAvailabilityOrThrow();

    const res = await fetch('/api/public/shared-resources/' + resourceId + '/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentOption,
        checkinDate: checkinDateParam,
        checkoutDate: checkoutDateParam,
        requestedStartAt: startDateTimeParam,
        requestedEndAt: endDateTimeParam,
        spacesRequired: spacesRequiredParam,
        reservationAmount: priceParam,
        firstName: guest.payload.firstName,
        familyName: guest.payload.familyName,
        emailAddress: guest.payload.emailAddress,
        telephone: guest.payload.telephone
      })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to submit reservation.');
    }

    window.location.href = '/dashboard.html?tab=panel-dashboard';
  } catch (err) {
    setReservationMessage(err.message || 'Failed to submit reservation.', true);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
    }
  }
});

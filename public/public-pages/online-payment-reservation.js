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
    document.getElementById('reservationTitle').textContent = (currentResource.short_description || 'Reservation') + ' - Online Payment';

    renderPaymentMethodMessage(currentResource, paymentOption);
  } catch (err) {
    setReservationMessage(err.message || 'Unable to load reservation page.', true);
  }
}

(async () => {
  try {
    await loadPublicResource();
    renderReservationDetails();
  } catch (err) {
    setReservationMessage(err.message || 'Failed to initialize reservation page.', true);
  }
})();

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

    const reference = data && data.reservation && data.reservation.reservation_identifier
      ? data.reservation.reservation_identifier
      : '';
    setReservationMessage(
      reference ? ('Reservation confirmed. Reference: ' + reference) : 'Reservation confirmed.',
      false
    );
  } catch (err) {
    setReservationMessage(err.message || 'Failed to submit reservation.', true);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
    }
  }
});

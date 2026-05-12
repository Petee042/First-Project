'use strict';

const params = new URLSearchParams(window.location.search);
const resourceId = Number(params.get('resourceId'));
const paymentOption = String(params.get('paymentOption') || '');

let currentResource = null;

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
    document.getElementById('reservationTitle').textContent = (currentResource.short_description || 'Reservation') + ' - Cash On Site';

    renderPaymentMethodMessage(currentResource, paymentOption);
  } catch (err) {
    setReservationMessage(err.message || 'Unable to load reservation page.', true);
  }
}

(async () => {
  try {
    await loadPublicResource();
  } catch (err) {
    setReservationMessage(err.message || 'Failed to initialize reservation page.', true);
  }
})();

document.getElementById('backToPaymentBtn').addEventListener('click', () => {
  window.history.back();
});

document.getElementById('submitReservationBtn').addEventListener('click', async () => {
  setReservationMessage('Submitting reservation...', false);
  // TODO: Implement actual reservation submission logic
  setReservationMessage('This feature is coming soon.', true);
});

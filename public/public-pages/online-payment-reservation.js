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
let stripeClient = null;
let stripeElements = null;
let stripePaymentElement = null;
let preparedPayment = null;

function isParkingResource(resource) {
  if (!resource) {
    return false;
  }
  const resourceType = String(resource.resource_type || resource.resourceType || '').trim().toLowerCase();
  return resourceType === 'parking';
}

function renderVehicleRegistrationField(resource) {
  const labelEl = document.getElementById('guestVehicleRegistrationLabel');
  const inputEl = document.getElementById('guestVehicleRegistration');
  if (!labelEl || !inputEl) {
    return;
  }

  const showField = isParkingResource(resource);
  labelEl.classList.toggle('hidden', !showField);
  inputEl.classList.toggle('hidden', !showField);

  inputEl.required = showField;
  if (!showField) {
    inputEl.value = '';
  }
}

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
  const vehicleRegistration = document.getElementById('guestVehicleRegistration')
    ? document.getElementById('guestVehicleRegistration').value.trim()
    : '';

  if (!firstName || !familyName || !emailAddress || !telephone) {
    return { error: 'Please enter first name, family name, email address and telephone.' };
  }

  if (isParkingResource(currentResource) && !vehicleRegistration) {
    return { error: 'Please enter vehicle registration for parking reservations.' };
  }

  return {
    payload: {
      firstName,
      familyName,
      emailAddress,
      telephone,
      vehicleRegistration
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

function setSubmitButtonState(text, disabled) {
  const submitBtn = document.getElementById('submitReservationBtn');
  if (!submitBtn) {
    return;
  }
  if (text) {
    submitBtn.textContent = text;
  }
  submitBtn.disabled = Boolean(disabled);
}

function showStripePaymentSection(show) {
  const section = document.getElementById('stripePaymentSection');
  if (!section) {
    return;
  }
  section.classList.toggle('hidden', !show);
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
    renderVehicleRegistrationField(currentResource);
  } catch (err) {
    setReservationMessage(err.message || 'Unable to load reservation page.', true);
  }
}

async function prepareOnlinePayment(guestPayload) {
  const response = await fetch('/api/public/shared-resources/' + resourceId + '/online-payment/prepare', {
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
      firstName: guestPayload.firstName,
      familyName: guestPayload.familyName,
      emailAddress: guestPayload.emailAddress,
      telephone: guestPayload.telephone,
      vehicleRegistration: guestPayload.vehicleRegistration
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to prepare online payment.');
  }
  if (!data.publishableKey || !data.clientSecret) {
    throw new Error('Payment setup response is missing Stripe details.');
  }
  if (!window.Stripe) {
    throw new Error('Stripe.js did not load.');
  }

  stripeClient = window.Stripe(data.publishableKey);
  stripeElements = stripeClient.elements({ clientSecret: data.clientSecret });
  stripePaymentElement = stripeElements.create('payment');
  stripePaymentElement.mount('#stripePaymentElement');

  preparedPayment = {
    reservationId: data.reservationId,
    reservationIdentifier: data.reservationIdentifier || '',
    paymentIntentId: data.paymentIntentId || '',
    clientSecret: data.clientSecret
  };
}

async function confirmPreparedPayment() {
  if (!stripeClient || !stripeElements || !preparedPayment) {
    throw new Error('Payment form is not ready yet.');
  }

  const result = await stripeClient.confirmPayment({
    elements: stripeElements,
    redirect: 'if_required'
  });

  if (result.error) {
    throw new Error(result.error.message || 'Payment confirmation failed.');
  }
  if (!result.paymentIntent) {
    throw new Error('Stripe did not return a payment result.');
  }

  const status = String(result.paymentIntent.status || '').toLowerCase();
  if (status === 'requires_payment_method') {
    throw new Error('Payment was not completed. Please try another card or method.');
  }
  return status;
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

  setSubmitButtonState(null, true);

  try {
    if (!preparedPayment) {
      setReservationMessage('Preparing secure payment form...', false);
      await prepareOnlinePayment(guest.payload);
      showStripePaymentSection(true);
      setSubmitButtonState('Pay and Confirm Reservation', false);
      setReservationMessage('Payment form is ready. Enter card details and click Pay and Confirm Reservation.', false);
      return;
    }

    setReservationMessage('Confirming payment...', false);
    const status = await confirmPreparedPayment();
    const reference = preparedPayment.reservationIdentifier || '';
    const statusSuffix = status ? (' Status: ' + status + '.') : '';
    setReservationMessage(
      reference
        ? ('Payment submitted. Reservation reference: ' + reference + '.' + statusSuffix)
        : ('Payment submitted.' + statusSuffix),
      false
    );
    setSubmitButtonState('Payment Submitted', true);
  } catch (err) {
    setReservationMessage(err.message || 'Failed to process payment.', true);
    if (preparedPayment) {
      setSubmitButtonState('Pay and Confirm Reservation', false);
    } else {
      setSubmitButtonState('Load Payment Form', false);
    }
  } finally {
    if (!preparedPayment) {
      setSubmitButtonState('Load Payment Form', false);
    }
  }
});

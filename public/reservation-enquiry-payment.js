'use strict';

const reservationEnquiryPaymentParams = new URLSearchParams(window.location.search);
const reservationEnquiryPaymentSlug = String(reservationEnquiryPaymentParams.get('landingPage') || '').trim();
const RESERVATION_ENQUIRY_SELECTION_STORAGE_KEY = 'reservationEnquirySelectionContext';
let reservationEnquirySelection = null;
let reservationEnquiryStripeClient = null;
let reservationEnquiryStripeElements = null;
let reservationEnquiryStripePaymentElement = null;
let reservationEnquiryPreparedPayment = null;

function setReservationEnquiryPaymentMessage(text, isError) {
  const el = document.getElementById('reservationEnquiryPaymentMessage');
  if (!el) {
    return;
  }
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function formatReservationEnquiryPaymentMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return '-';
  }
  return 'GBP ' + amount.toFixed(2);
}

function formatReservationEnquiryPaymentDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text || '-';
  }
  const dt = new Date(text + 'T00:00:00Z');
  if (!Number.isFinite(dt.getTime())) {
    return text;
  }
  return dt.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

function loadReservationEnquirySelection() {
  const raw = window.sessionStorage.getItem(RESERVATION_ENQUIRY_SELECTION_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getReservationEnquiryGuestPayload() {
  const firstName = String(document.getElementById('reservationEnquiryGuestFirstName').value || '').trim();
  const familyName = String(document.getElementById('reservationEnquiryGuestFamilyName').value || '').trim();
  const emailAddress = String(document.getElementById('reservationEnquiryGuestEmailAddress').value || '').trim();
  const telephone = String(document.getElementById('reservationEnquiryGuestTelephone').value || '').trim();
  if (!firstName || !familyName || !emailAddress || !telephone) {
    return { error: 'First name, family name, email address and telephone are required.' };
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

function setReservationEnquirySubmitButton(text, disabled) {
  const button = document.getElementById('reservationEnquiryPaymentSubmitBtn');
  if (!button) {
    return;
  }
  if (text) {
    button.textContent = text;
  }
  button.disabled = Boolean(disabled);
}

function isReservationEnquiryTermsConfirmed() {
  const checkbox = document.getElementById('reservationEnquiryConfirmTerms');
  return Boolean(checkbox && checkbox.checked);
}

function renderReservationEnquiryPaymentPage() {
  if (!reservationEnquirySelection) {
    return;
  }
  document.getElementById('reservationEnquiryPaymentTitle').textContent = String(reservationEnquirySelection.title || 'Reservation Enquiry');
  document.getElementById('reservationEnquiryPaymentStay').textContent = formatReservationEnquiryPaymentDate(reservationEnquirySelection.arrivalDate) + ' to ' + formatReservationEnquiryPaymentDate(reservationEnquirySelection.departureDate);
  document.getElementById('reservationEnquiryPaymentGuests').textContent = String(reservationEnquirySelection.guestCount || '');
  document.getElementById('reservationEnquiryPaymentOption').textContent = String(reservationEnquirySelection.option && reservationEnquirySelection.option.label || '');
  const payableAmount = reservationEnquirySelection.paymentMethod === 'online' || Number(reservationEnquirySelection.option && reservationEnquirySelection.option.discountedTotalPrice || 0) > 0
    ? Number(reservationEnquirySelection.option && reservationEnquirySelection.option.discountedTotalPrice || reservationEnquirySelection.option && reservationEnquirySelection.option.totalPrice || 0)
    : Number(reservationEnquirySelection.option && reservationEnquirySelection.option.totalPrice || 0);
  document.getElementById('reservationEnquiryPaymentAmount').textContent = formatReservationEnquiryPaymentMoney(payableAmount);
  document.getElementById('reservationEnquiryPaymentMethod').textContent = reservationEnquirySelection.paymentMethod === 'online' ? 'Online' : 'Bank Transfer';

  if (reservationEnquirySelection.paymentMethod === 'online') {
    setReservationEnquirySubmitButton('Load Payment Form', false);
  } else {
    setReservationEnquirySubmitButton('Confirm Reservation', false);
  }

  const confirmCheckbox = document.getElementById('reservationEnquiryConfirmTerms');
  if (confirmCheckbox) {
    confirmCheckbox.addEventListener('change', () => {
      setReservationEnquirySubmitButton(
        reservationEnquirySelection.paymentMethod === 'online'
          ? (reservationEnquiryPreparedPayment ? 'Pay and Confirm Reservation' : 'Load Payment Form')
          : 'Confirm Reservation',
        !isReservationEnquiryTermsConfirmed()
      );
    });
  }
}

async function submitBankTransferReservation(guestPayload) {
  const response = await fetch('/api/public/reservation-enquiry-landing-pages/' + encodeURIComponent(reservationEnquiryPaymentSlug) + '/bank-transfer-submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      arrivalDate: reservationEnquirySelection.arrivalDate,
      departureDate: reservationEnquirySelection.departureDate,
      guestCount: reservationEnquirySelection.guestCount,
      optionKey: reservationEnquirySelection.optionKey,
      firstName: guestPayload.firstName,
      familyName: guestPayload.familyName,
      emailAddress: guestPayload.emailAddress,
      telephone: guestPayload.telephone
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to submit reservation enquiry.');
  }
  return data;
}

async function prepareReservationEnquiryOnlinePayment(guestPayload) {
  const response = await fetch('/api/public/reservation-enquiry-landing-pages/' + encodeURIComponent(reservationEnquiryPaymentSlug) + '/online-payment/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      arrivalDate: reservationEnquirySelection.arrivalDate,
      departureDate: reservationEnquirySelection.departureDate,
      guestCount: reservationEnquirySelection.guestCount,
      optionKey: reservationEnquirySelection.optionKey,
      firstName: guestPayload.firstName,
      familyName: guestPayload.familyName,
      emailAddress: guestPayload.emailAddress,
      telephone: guestPayload.telephone
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to prepare online payment.');
  }
  if (!window.Stripe || !data.publishableKey || !data.clientSecret) {
    throw new Error('Stripe payment details are unavailable.');
  }
  reservationEnquiryStripeClient = window.Stripe(data.publishableKey);
  reservationEnquiryStripeElements = reservationEnquiryStripeClient.elements({ clientSecret: data.clientSecret });
  reservationEnquiryStripePaymentElement = reservationEnquiryStripeElements.create('payment');
  reservationEnquiryStripePaymentElement.mount('#reservationEnquiryStripePaymentElement');
  reservationEnquiryPreparedPayment = {
    clientSecret: data.clientSecret,
    paymentIntentId: data.paymentIntentId || ''
  };
  document.getElementById('reservationEnquiryStripeSection').classList.remove('hidden');
}

async function confirmReservationEnquiryOnlinePayment() {
  if (!reservationEnquiryStripeClient || !reservationEnquiryStripeElements) {
    throw new Error('Payment form is not ready yet.');
  }
  const result = await reservationEnquiryStripeClient.confirmPayment({
    elements: reservationEnquiryStripeElements,
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

document.getElementById('reservationEnquiryPaymentBackBtn').addEventListener('click', () => {
  window.history.back();
});

document.getElementById('reservationEnquiryPaymentSubmitBtn').addEventListener('click', async () => {
  const guest = getReservationEnquiryGuestPayload();
  if (guest.error) {
    setReservationEnquiryPaymentMessage(guest.error, true);
    return;
  }
  if (!isReservationEnquiryTermsConfirmed()) {
    setReservationEnquiryPaymentMessage('Please confirm the Terms and Conditions of Reservation before continuing.', true);
    return;
  }
  setReservationEnquirySubmitButton(null, true);

  try {
    if (reservationEnquirySelection.paymentMethod === 'bank_transfer') {
      setReservationEnquiryPaymentMessage('Submitting reservation enquiry...', false);
      const data = await submitBankTransferReservation(guest.payload);
      const payableAmount = reservationEnquirySelection.option && reservationEnquirySelection.option.discountedTotalPrice
        ? Number(reservationEnquirySelection.option.discountedTotalPrice)
        : Number(reservationEnquirySelection.option && reservationEnquirySelection.option.totalPrice || 0);
      const completionData = {
        arrivalDate: reservationEnquirySelection.arrivalDate,
        departureDate: reservationEnquirySelection.departureDate,
        guestCount: reservationEnquirySelection.guestCount,
        option: reservationEnquirySelection.option,
        totalAmount: payableAmount,
        bankAccount: data.bankAccount || {}
      };
      window.sessionStorage.setItem('reservationEnquiryCompletionContext', JSON.stringify(completionData));
      window.sessionStorage.removeItem(RESERVATION_ENQUIRY_SELECTION_STORAGE_KEY);
      window.location.href = '/reservation-enquiry-complete.html';
      return;
    }

    if (!reservationEnquiryPreparedPayment) {
      setReservationEnquiryPaymentMessage('Preparing secure payment form...', false);
      await prepareReservationEnquiryOnlinePayment(guest.payload);
      setReservationEnquiryPaymentMessage('Payment form is ready. Enter card details and click Pay and Confirm Reservation.', false);
      setReservationEnquirySubmitButton('Pay and Confirm Reservation', false);
      return;
    }

    setReservationEnquiryPaymentMessage('Confirming payment...', false);
    const status = await confirmReservationEnquiryOnlinePayment();
    setReservationEnquiryPaymentMessage('Payment submitted successfully. Status: ' + status + '.', false);
    setReservationEnquirySubmitButton('Payment Submitted', true);
    window.sessionStorage.removeItem(RESERVATION_ENQUIRY_SELECTION_STORAGE_KEY);
  } catch (err) {
    setReservationEnquiryPaymentMessage(err.message || 'Failed to process reservation enquiry.', true);
    if (reservationEnquiryPreparedPayment) {
      setReservationEnquirySubmitButton('Pay and Confirm Reservation', false);
    } else {
      setReservationEnquirySubmitButton(
        reservationEnquirySelection && reservationEnquirySelection.paymentMethod === 'online' ? 'Load Payment Form' : 'Confirm Reservation',
        false
      );
    }
  }
});

(function initReservationEnquiryPaymentPage() {
  reservationEnquirySelection = loadReservationEnquirySelection();
  if (!reservationEnquirySelection || reservationEnquirySelection.slug !== reservationEnquiryPaymentSlug) {
    setReservationEnquiryPaymentMessage('Reservation enquiry selection data is missing. Please return to the landing page and choose an option again.', true);
    setReservationEnquirySubmitButton('Confirm Reservation', true);
    return;
  }
  renderReservationEnquiryPaymentPage();
  const confirmCheckbox = document.getElementById('reservationEnquiryConfirmTerms');
  if (confirmCheckbox) {
    confirmCheckbox.addEventListener('change', () => {
      setReservationEnquirySubmitButton(
        reservationEnquirySelection.paymentMethod === 'online'
          ? (reservationEnquiryPreparedPayment ? 'Pay and Confirm Reservation' : 'Load Payment Form')
          : 'Confirm Reservation',
        !isReservationEnquiryTermsConfirmed()
      );
    });
  }
  setReservationEnquirySubmitButton(
    reservationEnquirySelection.paymentMethod === 'online'
      ? 'Load Payment Form'
      : 'Confirm Reservation',
    !isReservationEnquiryTermsConfirmed()
  );
})();
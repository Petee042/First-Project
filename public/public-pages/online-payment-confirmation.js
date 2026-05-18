'use strict';

const params = new URLSearchParams(window.location.search);
const reservationIdentifier = String(params.get('reference') || '').trim();

let reservation = null;

function formatReservationDateTime(isoStr) {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function calculateDuration(startStr, endStr) {
  if (!startStr || !endStr) return '-';
  const start = new Date(startStr);
  const end = new Date(endStr);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return '-';
  
  const diffMs = end.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  
  if (diffDays > 0 && diffHours > 0) {
    return `${diffDays} day${diffDays !== 1 ? 's' : ''} ${diffHours} hour${diffHours !== 1 ? 's' : ''}`;
  } else if (diffDays > 0) {
    return `${diffDays} day${diffDays !== 1 ? 's' : ''}`;
  } else if (diffHours > 0) {
    return `${diffHours} hour${diffHours !== 1 ? 's' : ''}`;
  }
  return '-';
}

function normalizePaymentStatus(status) {
  const statusMap = {
    'succeeded': 'Payment Confirmed',
    'processing': 'Payment Processing',
    'requires_payment_method': 'Payment Required',
    'pending': 'Payment Pending',
    'failed': 'Payment Failed'
  };
  return statusMap[String(status || '').toLowerCase()] || String(status || '-');
}

function isParkingResource(reservation) {
  // Check if the reservation's resource is a parking type
  // For now we'll just check if vehicle_registration is present
  return reservation && reservation.vehicle_registration && reservation.vehicle_registration.trim() !== '';
}

function renderReservationDetails() {
  if (!reservation) return;

  const refEl = document.getElementById('reservationReference');
  const startEl = document.getElementById('reservationStart');
  const endEl = document.getElementById('reservationEnd');
  const durationEl = document.getElementById('reservationDuration');
  const priceEl = document.getElementById('reservationPrice');
  const statusEl = document.getElementById('paymentStatus');
  const nameEl = document.getElementById('guestName');
  const emailEl = document.getElementById('guestEmail');
  const phoneEl = document.getElementById('guestPhone');
  const vehicleLabelEl = document.getElementById('vehicleLabel');
  const vehicleEl = document.getElementById('guestVehicle');

  if (refEl) refEl.textContent = reservation.reservation_identifier || '-';
  if (startEl) startEl.textContent = formatReservationDateTime(reservation.requested_start_at);
  if (endEl) endEl.textContent = formatReservationDateTime(reservation.requested_end_at);
  if (durationEl) durationEl.textContent = calculateDuration(reservation.requested_start_at, reservation.requested_end_at);
  
  if (priceEl) {
    const price = Number(reservation.reservation_amount);
    priceEl.textContent = Number.isFinite(price) ? ('£' + price.toFixed(2)) : '-';
  }

  if (statusEl) statusEl.textContent = normalizePaymentStatus(reservation.payment_status);
  if (nameEl) nameEl.textContent = (reservation.first_name || '') + ' ' + (reservation.family_name || '');
  if (emailEl) emailEl.textContent = reservation.email_address || '-';
  if (phoneEl) phoneEl.textContent = reservation.telephone || '-';

  if (isParkingResource(reservation)) {
    if (vehicleLabelEl) vehicleLabelEl.classList.remove('hidden');
    if (vehicleEl) {
      vehicleEl.classList.remove('hidden');
      vehicleEl.textContent = reservation.vehicle_registration || '-';
    }
  } else {
    if (vehicleLabelEl) vehicleLabelEl.classList.add('hidden');
    if (vehicleEl) vehicleEl.classList.add('hidden');
  }
}

async function loadReservation() {
  if (!reservationIdentifier) {
    const messageEl = document.getElementById('confirmationMessage');
    if (messageEl) {
      messageEl.textContent = 'Invalid reservation reference. Please check your confirmation email.';
      messageEl.className = 'message error';
    }
    return;
  }

  try {
    const res = await fetch('/api/public/reservations/by-identifier/' + encodeURIComponent(reservationIdentifier));
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to load reservation.');
    }

    reservation = data.reservation;
    renderReservationDetails();
  } catch (err) {
    const messageEl = document.getElementById('confirmationMessage');
    if (messageEl) {
      messageEl.textContent = err.message || 'Unable to load reservation details.';
      messageEl.className = 'message error';
    }
  }
}

(async () => {
  await loadReservation();
})();

document.getElementById('backHomeBtn').addEventListener('click', () => {
  window.location.href = '/';
});

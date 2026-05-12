'use strict';

const params = new URLSearchParams(window.location.search);
const resourceId = Number(params.get('resourceId'));
const reservationId = Number(params.get('reservationId'));

let loadedReservation = null;

function setReservationEditMessage(text, isError) {
  const el = document.getElementById('reservationEditMessage');
  if (!el) {
    return;
  }
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function toInputDate(value) {
  if (!value) {
    return '';
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function toInputTime(value) {
  if (!value) {
    return '';
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  const hour = String(d.getHours()).padStart(2, '0');
  const minute = String(d.getMinutes()).padStart(2, '0');
  return hour + ':' + minute;
}

function getInputValue(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

function populateReservationForm(reservation) {
  document.getElementById('editCheckinDate').value = String(reservation.reservation_checkin_date || '');
  document.getElementById('editCheckoutDate').value = String(reservation.reservation_checkout_date || '');
  document.getElementById('editStartDate').value = toInputDate(reservation.requested_start_at);
  document.getElementById('editStartTime').value = toInputTime(reservation.requested_start_at);
  document.getElementById('editEndDate').value = toInputDate(reservation.requested_end_at);
  document.getElementById('editEndTime').value = toInputTime(reservation.requested_end_at);
  document.getElementById('editFirstName').value = String(reservation.first_name || '');
  document.getElementById('editFamilyName').value = String(reservation.family_name || '');
  document.getElementById('editEmailAddress').value = String(reservation.email_address || '');
  document.getElementById('editTelephone').value = String(reservation.telephone || '');
  document.getElementById('editReservationAmount').value = reservation.reservation_amount === null || reservation.reservation_amount === undefined
    ? ''
    : String(reservation.reservation_amount);
  document.getElementById('editSpacesRequired').value = Number(reservation.spaces_required || 1) > 0
    ? String(Number(reservation.spaces_required || 1))
    : '1';
  document.getElementById('editStatus').value = String(reservation.status || 'cash');
}

function buildRequestPayload() {
  const checkinDate = getInputValue('editCheckinDate');
  const checkoutDate = getInputValue('editCheckoutDate');
  const startDate = getInputValue('editStartDate');
  const startTime = getInputValue('editStartTime');
  const endDate = getInputValue('editEndDate');
  const endTime = getInputValue('editEndTime');
  const firstName = getInputValue('editFirstName');
  const familyName = getInputValue('editFamilyName');
  const emailAddress = getInputValue('editEmailAddress');
  const telephone = getInputValue('editTelephone');
  const reservationAmount = getInputValue('editReservationAmount');
  const spacesRequired = getInputValue('editSpacesRequired');
  const status = getInputValue('editStatus');

  if (!checkinDate || !checkoutDate || !startDate || !startTime || !endDate || !endTime || !firstName || !familyName || !emailAddress || !telephone || !spacesRequired || !status) {
    return { error: 'Please complete all required fields.' };
  }

  return {
    payload: {
      checkinDate,
      checkoutDate,
      requestedStartAt: startDate + 'T' + startTime,
      requestedEndAt: endDate + 'T' + endTime,
      firstName,
      familyName,
      emailAddress,
      telephone,
      reservationAmount,
      spacesRequired,
      status
    }
  };
}

async function loadReservation() {
  if (!Number.isInteger(resourceId) || resourceId <= 0 || !Number.isInteger(reservationId) || reservationId <= 0) {
    setReservationEditMessage('Invalid resource or reservation id.', true);
    return;
  }

  const meRes = await fetch('/api/me');
  if (!meRes.ok) {
    window.location.href = '/';
    return;
  }

  const res = await fetch('/api/shared-resources/' + resourceId + '/reservations/' + reservationId);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load reservation.');
  }

  loadedReservation = data.reservation;
  populateReservationForm(loadedReservation);
}

(async () => {
  try {
    await loadReservation();
  } catch (err) {
    setReservationEditMessage(err.message || 'Unable to load reservation.', true);
  }
})();

document.getElementById('backToResourceBtn').addEventListener('click', () => {
  if (!Number.isInteger(resourceId) || resourceId <= 0) {
    window.location.href = 'dashboard.html';
    return;
  }
  window.location.href = 'shared-resource.html?id=' + encodeURIComponent(resourceId);
});

document.getElementById('saveReservationBtn').addEventListener('click', async () => {
  const built = buildRequestPayload();
  if (built.error) {
    setReservationEditMessage(built.error, true);
    return;
  }

  setReservationEditMessage('Saving reservation...', false);

  const btn = document.getElementById('saveReservationBtn');
  btn.disabled = true;

  try {
    const res = await fetch('/api/shared-resources/' + resourceId + '/reservations/' + reservationId, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(built.payload)
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to save reservation.');
    }

    loadedReservation = data.reservation;
    populateReservationForm(loadedReservation);
    setReservationEditMessage('Reservation updated.', false);
  } catch (err) {
    setReservationEditMessage(err.message || 'Failed to save reservation.', true);
  } finally {
    btn.disabled = false;
  }
});

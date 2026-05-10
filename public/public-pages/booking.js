'use strict';

let currentResource = null;

function setBookingMessage(text, isError) {
  const el = document.getElementById('publicBookingMessage');
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
}

function configureSpacesRequiredInput(maxValue) {
  const input = document.getElementById('spacesRequired');
  const hint = document.getElementById('spacesRequiredHint');

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

function formatDateTimeForDisplay(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value || '');
  }
  return parsed.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function renderSharedReservationsTable(resource, reservations) {
  const body = document.getElementById('publicSharedReservationsBody');
  if (!body) {
    return;
  }

  const rows = Array.isArray(reservations) ? reservations : [];
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="5" class="public-resource-reservations-empty">No reservations yet.</td></tr>';
    return;
  }

  const resourceLabel = resource && resource.short_description ? resource.short_description : 'Shared Resource';
  body.innerHTML = rows.map((row) => {
    const reservationId = row.reservation_identifier || String(row.id || '');
    return '<tr>'
      + '<td>' + reservationId + '</td>'
      + '<td>' + resourceLabel + '</td>'
      + '<td>' + formatDateTimeForDisplay(row.requested_start_at) + '</td>'
      + '<td>' + formatDateTimeForDisplay(row.requested_end_at) + '</td>'
      + '<td>' + String(row.status || '') + '</td>'
      + '</tr>';
  }).join('');
}

async function loadSharedReservations(resourceId) {
  const res = await fetch('/api/public/shared-resources/' + resourceId + '/reservations');
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load shared resource reservations.');
  }
  renderSharedReservationsTable(currentResource, data.reservations || []);
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
      spacesRequired: resource && resource.resource_type === 'parking' ? spacesRequired : 1
    }
  };
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
    try {
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

      setBookingMessage(data.message || 'Availability Confirmed', false);
      renderSharedReservationsTable(currentResource, data.reservations || []);
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
  document.getElementById('publicBookingResourceName').textContent = resource.short_description || 'Shared Resource';
  document.getElementById('publicBookingDescription').innerHTML = resource.full_description_html || '<p>No description provided.</p>';

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
    await loadSharedReservations(resourceId);
  } catch (err) {
    setBookingMessage(err.message || 'Unable to load booking page.', true);
  }
})();

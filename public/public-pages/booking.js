'use strict';

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
  document.getElementById('publicBookingResourceName').textContent = resource.short_description || 'Shared Resource';
  document.getElementById('publicBookingDescription').innerHTML = resource.full_description_html || '<p>No description provided.</p>';
}

(async () => {
  try {
    initialiseBookingRequestForm();
    await loadPublicResource();
  } catch (err) {
    setBookingMessage(err.message || 'Unable to load booking page.', true);
  }
})();

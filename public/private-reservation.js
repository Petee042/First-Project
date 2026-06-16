'use strict';

let allListings = [];
// availabilityMap: listingId -> 'available' | 'unavailable' | 'loading' | null
const availabilityMap = {};
let availabilityCheckId = 0;

function setMessage(text, isError) {
  const el = document.getElementById('reservationMessage');
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function toDateOnlyString(value) {
  if (!value) return '';
  const s = String(value);
  // ISO datetime: take first 10 chars
  return s.length >= 10 ? s.slice(0, 10) : s;
}

// Returns true if the event (with start/end date strings) overlaps arrival..departure
// iCal end dates are exclusive (checkout day), so we use: start < departure && end > arrival
function eventOverlapsDates(event, arrival, departure) {
  const eStart = toDateOnlyString(event.start);
  const eEnd = toDateOnlyString(event.end);
  if (!eStart || !eEnd) return false;
  return eStart < departure && eEnd > arrival;
}

function renderListings(listings) {
  const container = document.getElementById('listingsCheckboxList');
  if (!listings || !listings.length) {
    container.innerHTML = '<p class="cleaning-empty">No listings available.</p>';
    return;
  }
  // Preserve existing checked state
  const checkedIds = new Set(
    Array.from(container.querySelectorAll('.cleaning-listing-checkbox:checked'))
      .map(function(cb) { return cb.value; })
  );
  container.innerHTML = listings.map(function(listing) {
    const id = 'listing-chk-' + listing.id;
    const name = String(listing.name || listing.id);
    const avail = availabilityMap[listing.id];
    let indicatorHtml;
    if (avail === 'loading') {
      indicatorHtml = '<span class="avail-indicator avail-loading" aria-label="Checking">&#8943;</span>';
    } else if (avail === 'available') {
      indicatorHtml = '<span class="avail-indicator avail-yes" aria-label="Available">&#10003;</span>';
    } else if (avail === 'unavailable') {
      indicatorHtml = '<span class="avail-indicator avail-no" aria-label="Not available">&#10007;</span>';
    } else {
      indicatorHtml = '<span class="avail-indicator avail-unknown" aria-label=""></span>';
    }
    const checked = checkedIds.has(String(listing.id)) ? ' checked' : '';
    return (
      '<label class="cleaning-listing-row" for="' + id + '">' +
        indicatorHtml +
        '<input class="cleaning-listing-checkbox" type="checkbox" id="' + id + '" value="' + listing.id + '"' + checked + ' />' +
        '<span class="cleaning-listing-name">' + name + '</span>' +
      '</label>'
    );
  }).join('');
}

async function checkAvailability(arrival, departure) {
  if (!arrival || !departure || departure <= arrival) {
    // Clear indicators
    allListings.forEach(function(l) { delete availabilityMap[l.id]; });
    renderListings(allListings);
    return;
  }

  // Mark all as loading
  const thisCheckId = ++availabilityCheckId;
  allListings.forEach(function(l) { availabilityMap[l.id] = 'loading'; });
  renderListings(allListings);

  await Promise.all(allListings.map(async function(listing) {
    try {
      const res = await fetch('/api/listings/' + listing.id + '/events');
      if (thisCheckId !== availabilityCheckId) return; // superseded
      if (!res.ok) {
        availabilityMap[listing.id] = null;
        return;
      }
      const data = await res.json();
      const events = (data.events || []).filter(function(e) { return e && e.isReservation !== false; });
      const conflict = events.some(function(e) { return eventOverlapsDates(e, arrival, departure); });
      availabilityMap[listing.id] = conflict ? 'unavailable' : 'available';
    } catch {
      if (thisCheckId === availabilityCheckId) availabilityMap[listing.id] = null;
    }
  }));

  if (thisCheckId !== availabilityCheckId) return;
  renderListings(allListings);
}

function getSelectedListingIds() {
  return Array.from(
    document.querySelectorAll('#listingsCheckboxList .cleaning-listing-checkbox:checked')
  ).map(function(cb) { return Number(cb.value); });
}

document.getElementById('backBtn').addEventListener('click', function() {
  window.location.href = '/dashboard.html?tab=panel-dashboard';
});

document.getElementById('cancelReservationBtn').addEventListener('click', function() {
  window.location.href = '/dashboard.html?tab=panel-dashboard';
});

// Trigger availability check when either date changes
(function() {
  var debounceTimer = null;
  function onDateChange() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function() {
      var arrival = document.getElementById('arrivalDate').value;
      var departure = document.getElementById('departureDate').value;
      checkAvailability(arrival, departure);
    }, 300);
  }
  document.getElementById('arrivalDate').addEventListener('change', onDateChange);
  document.getElementById('departureDate').addEventListener('change', onDateChange);
})();

document.getElementById('privateReservationForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  setMessage('', false);

  const arrivalDate = document.getElementById('arrivalDate').value;
  const departureDate = document.getElementById('departureDate').value;
  const listingIds = getSelectedListingIds();
  const firstName = document.getElementById('guestFirstName').value.trim();
  const familyName = document.getElementById('guestFamilyName').value.trim();
  const email = document.getElementById('guestEmail').value.trim();
  const cost = document.getElementById('reservationCost').value;
  const holdHours = document.getElementById('holdHours').value;

  if (!arrivalDate) { setMessage('Arrival date is required.', true); return; }
  if (!departureDate) { setMessage('Departure date is required.', true); return; }
  if (departureDate <= arrivalDate) { setMessage('Departure date must be after arrival date.', true); return; }
  if (!listingIds.length) { setMessage('Please select at least one listing.', true); return; }
  if (!firstName) { setMessage('First name is required.', true); return; }
  if (!familyName) { setMessage('Family name is required.', true); return; }
  if (!email) { setMessage('Email address is required.', true); return; }

  setMessage('Saving reservation\u2026', false);
  document.getElementById('saveReservationBtn').disabled = true;

  try {
    const res = await fetch('/api/private-reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        arrivalDate,
        departureDate,
        listingIds,
        firstName,
        familyName,
        email,
        cost: cost ? Number(cost) : null,
        holdHours: holdHours ? Number(holdHours) : null
      })
    });

    if (res.status === 401) {
      window.location.href = '/';
      return;
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to save reservation.');
    }

    setMessage('Reservation saved.', false);
    setTimeout(function() {
      window.location.href = '/dashboard.html?tab=panel-dashboard';
    }, 1200);
  } catch (err) {
    setMessage(err.message || 'Failed to save reservation.', true);
    document.getElementById('saveReservationBtn').disabled = false;
  }
});

// ── Initialise ────────────────────────────────────────────────

(async function init() {
  try {
    const meRes = await fetch('/api/me');
    if (!meRes.ok) {
      window.location.href = '/';
      return;
    }

    const listingsRes = await fetch('/api/listings');
    if (listingsRes.status === 401) {
      window.location.href = '/';
      return;
    }
    if (listingsRes.ok) {
      const data = await listingsRes.json();
      allListings = data.listings || [];
      renderListings(allListings);
    } else {
      renderListings([]);
    }
  } catch (err) {
    setMessage('Failed to load page data. Please try again.', true);
  }
})();

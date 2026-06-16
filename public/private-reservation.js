'use strict';

function setMessage(text, isError) {
  const el = document.getElementById('reservationMessage');
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function renderListings(listings) {
  const container = document.getElementById('listingsCheckboxList');
  if (!listings || !listings.length) {
    container.innerHTML = '<p class="cleaning-empty">No listings available.</p>';
    return;
  }
  container.innerHTML = listings.map(function(listing) {
    const id = 'listing-chk-' + listing.id;
    const name = String(listing.name || listing.id);
    return (
      '<label class="cleaning-listing-row" for="' + id + '">' +
        '<input class="cleaning-listing-checkbox" type="checkbox" id="' + id + '" value="' + listing.id + '" />' +
        '<span class="cleaning-listing-name">' + name + '</span>' +
      '</label>'
    );
  }).join('');
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
      renderListings(data.listings || []);
    } else {
      renderListings([]);
    }
  } catch (err) {
    setMessage('Failed to load page data. Please try again.', true);
  }
})();

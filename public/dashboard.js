'use strict';

function setMessage(text, isError) {
  const el = document.getElementById('dashboardMessage');
  el.textContent = text;
  el.className = text ? 'message ' + (isError ? 'error' : 'success') : 'message';
}

function renderListings(listings) {
  const tbody = document.getElementById('listingsTableBody');
  tbody.innerHTML = '';

  if (!listings.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 2;
    cell.textContent = 'No listings yet.';
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  listings.forEach((listing) => {
    const row = document.createElement('tr');

    const nameCell = document.createElement('td');
    nameCell.textContent = listing.name;

    const actionCell = document.createElement('td');
    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'btn secondary';
    openBtn.textContent = 'View / Edit';
    openBtn.addEventListener('click', () => {
      window.location.href = '/listing.html?id=' + encodeURIComponent(listing.id);
    });

    actionCell.appendChild(openBtn);
    row.appendChild(nameCell);
    row.appendChild(actionCell);
    tbody.appendChild(row);
  });
}

async function fetchListings() {
  const res = await fetch('/api/listings');
  if (res.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load listings.');
  }

  renderListings(data.listings || []);
}

(async () => {
  try {
    const meRes = await fetch('/api/me');
    if (!meRes.ok) {
      window.location.href = '/';
      return;
    }

    await fetchListings();
  } catch (err) {
    setMessage(err.message || 'Failed to load page.', true);
  }
})();

document.getElementById('addListingForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = e.target.querySelector('button[type="submit"]');
  const name = document.getElementById('listingName').value.trim();

  if (!name) {
    setMessage('Listing name is required.', true);
    return;
  }

  button.disabled = true;
  try {
    const res = await fetch('/api/listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });

    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || 'Failed to create listing.', true);
      return;
    }

    document.getElementById('listingName').value = '';
    setMessage('Listing added.', false);
    await fetchListings();
  } catch {
    setMessage('Network error creating listing.', true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
});

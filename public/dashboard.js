'use strict';

const SOURCE_COLOR_OPTIONS = [
  { name: 'Red', value: '#e63946' },
  { name: 'Blue', value: '#1d4ed8' },
  { name: 'Green', value: '#2e7d32' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Teal', value: '#0f766e' },
  { name: 'Navy', value: '#1e3a8a' },
  { name: 'Pink', value: '#db2777' },
  { name: 'Yellow', value: '#ca8a04' }
];

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

function renderFeedSources(sources) {
  const tbody = document.getElementById('feedSourcesTableBody');
  tbody.innerHTML = '';

  if (!sources.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 2;
    cell.textContent = 'No feed sources configured yet.';
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  sources.forEach((source) => {
    const row = document.createElement('tr');

    const labelCell = document.createElement('td');
    labelCell.textContent = source.label;

    const colorCell = document.createElement('td');
    colorCell.className = 'source-color-cell';

    const select = document.createElement('select');
    select.className = 'source-color-select';
    select.setAttribute('aria-label', 'Primary color for ' + source.label);

    SOURCE_COLOR_OPTIONS.forEach((opt) => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.name;
      if ((source.color || '').toLowerCase() === opt.value.toLowerCase()) {
        option.selected = true;
      }
      select.appendChild(option);
    });

    if (!source.color && SOURCE_COLOR_OPTIONS.length) {
      select.value = SOURCE_COLOR_OPTIONS[0].value;
    }

    const preview = document.createElement('span');
    preview.className = 'source-color-preview';
    preview.style.backgroundColor = select.value;

    select.addEventListener('change', async () => {
      const chosen = select.value;
      preview.style.backgroundColor = chosen;

      select.disabled = true;
      try {
        const res = await fetch('/api/feed-sources/color', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: source.label, color: chosen })
        });
        const data = await res.json();

        if (!res.ok) {
          setMessage(data.error || 'Failed to save source color.', true);
          return;
        }

        setMessage('Saved color for ' + source.label + '.', false);
      } catch {
        setMessage('Network error saving source color.', true);
      } finally {
        select.disabled = false;
      }
    });

    colorCell.appendChild(select);
    colorCell.appendChild(preview);
    row.appendChild(labelCell);
    row.appendChild(colorCell);
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

async function fetchFeedSources() {
  const res = await fetch('/api/feed-sources');
  if (res.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load feed sources.');
  }

  renderFeedSources(data.sources || []);
}

(async () => {
  try {
    const meRes = await fetch('/api/me');
    if (!meRes.ok) {
      window.location.href = '/';
      return;
    }

    await fetchListings();
    await fetchFeedSources();
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
    await fetchFeedSources();
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

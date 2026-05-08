'use strict';

const params = new URLSearchParams(window.location.search);
const resourceId = Number(params.get('id'));
let currentProperties = [];
let currentListings = [];

function setSharedResourceMessage(text, isError) {
  const el = document.getElementById('sharedResourceMessage');
  el.textContent = text;
  el.className = text ? 'message ' + (isError ? 'error' : 'success') : 'message';
}

function getEditorHtml() {
  return document.getElementById('fullDescriptionEditor').innerHTML.trim();
}

function applyEditorCommand(command) {
  document.execCommand(command, false, null);
  document.getElementById('fullDescriptionEditor').focus();
}

function renderPropertyOptions(selectedPropertyId) {
  const select = document.getElementById('sharedResourcePropertyId');
  select.innerHTML = '';

  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = 'All Properties';
  select.appendChild(allOption);

  currentProperties.forEach((property) => {
    const option = document.createElement('option');
    option.value = String(property.id);
    option.textContent = property.name || 'Property';
    select.appendChild(option);
  });

  select.value = selectedPropertyId ? String(selectedPropertyId) : '';
}

function renderListingOptions(selectedListingId) {
  const propertyId = Number(document.getElementById('sharedResourcePropertyId').value || 0);
  const select = document.getElementById('sharedResourceListingId');
  select.innerHTML = '';

  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = 'All Listings';
  select.appendChild(allOption);

  const filteredListings = (currentListings || []).filter((listing) => {
    if (!propertyId) {
      return true;
    }
    return Number(listing.property_id) === propertyId;
  });

  filteredListings.forEach((listing) => {
    const option = document.createElement('option');
    option.value = String(listing.id);
    option.textContent = listing.name || 'Listing';
    select.appendChild(option);
  });

  const selectedValue = selectedListingId ? String(selectedListingId) : '';
  const hasSelected = Array.from(select.options).some((opt) => opt.value === selectedValue);
  select.value = hasSelected ? selectedValue : '';
}

async function loadPropertiesAndListings() {
  const [propertiesRes, listingsRes] = await Promise.all([
    fetch('/api/properties'),
    fetch('/api/listings')
  ]);

  if (propertiesRes.status === 401 || listingsRes.status === 401) {
    window.location.href = '/';
    return false;
  }

  const propertiesData = await propertiesRes.json();
  const listingsData = await listingsRes.json();

  if (!propertiesRes.ok) {
    throw new Error(propertiesData.error || 'Failed to load properties.');
  }
  if (!listingsRes.ok) {
    throw new Error(listingsData.error || 'Failed to load listings.');
  }

  currentProperties = propertiesData.properties || [];
  currentListings = listingsData.listings || [];
  renderPropertyOptions(null);
  renderListingOptions(null);
  return true;
}

async function loadSharedResource() {
  const res = await fetch('/api/shared-resources/' + resourceId);
  if (res.status === 401) {
    window.location.href = '/';
    return;
  }
  if (res.status === 404) {
    setSharedResourceMessage('Shared resource not found.', true);
    return;
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load shared resource.');
  }

  const resource = data.resource;
  document.getElementById('sharedResourceTitle').textContent = 'Shared Resource: ' + (resource.short_description || '');
  document.getElementById('shortDescription').value = resource.short_description || '';
  document.getElementById('fullDescriptionEditor').innerHTML = resource.full_description_html || '';
  document.getElementById('maxUnits').value = Number(resource.max_units) > 0 ? Number(resource.max_units) : 1;
  renderPropertyOptions(Number(resource.property_id) || null);
  renderListingOptions(Number(resource.listing_id) || null);
}

(async () => {
  if (!Number.isInteger(resourceId) || resourceId <= 0) {
    setSharedResourceMessage('Invalid shared resource id.', true);
    return;
  }

  try {
    const meRes = await fetch('/api/me');
    if (!meRes.ok) {
      window.location.href = '/';
      return;
    }

    const loaded = await loadPropertiesAndListings();
    if (!loaded) {
      return;
    }

    await loadSharedResource();
  } catch (err) {
    setSharedResourceMessage(err.message || 'Failed to load shared resource page.', true);
  }
})();

document.getElementById('sharedResourcePropertyId').addEventListener('change', () => {
  renderListingOptions(null);
});

document.getElementById('sharedResourceListingId').addEventListener('change', () => {
  const listingId = Number(document.getElementById('sharedResourceListingId').value || 0);
  if (!listingId) {
    return;
  }
  const listing = currentListings.find((item) => Number(item.id) === listingId);
  if (!listing) {
    return;
  }
  document.getElementById('sharedResourcePropertyId').value = String(listing.property_id || '');
  renderListingOptions(listingId);
});

document.querySelectorAll('.editor-btn').forEach((button) => {
  button.addEventListener('click', () => {
    const command = button.getAttribute('data-command');
    if (command) {
      applyEditorCommand(command);
    }
  });
});

document.getElementById('sharedResourceForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const button = e.target.querySelector('button[type="submit"]');
  const shortDescription = document.getElementById('shortDescription').value.trim();
  const maxUnits = Number(document.getElementById('maxUnits').value);
  const fullDescriptionHtml = getEditorHtml();
  const propertyId = document.getElementById('sharedResourcePropertyId').value || null;
  const listingId = document.getElementById('sharedResourceListingId').value || null;

  if (!shortDescription) {
    setSharedResourceMessage('Short description is required.', true);
    return;
  }

  if (!Number.isInteger(maxUnits) || maxUnits <= 0) {
    setSharedResourceMessage('Maximum units must be a whole number greater than zero.', true);
    return;
  }

  button.disabled = true;
  try {
    const res = await fetch('/api/shared-resources/' + resourceId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shortDescription, fullDescriptionHtml, maxUnits, propertyId, listingId })
    });
    const data = await res.json();

    if (!res.ok) {
      setSharedResourceMessage(data.error || 'Failed to save shared resource.', true);
      return;
    }

    document.getElementById('sharedResourceTitle').textContent = 'Shared Resource: ' + (data.resource.short_description || '');
    setSharedResourceMessage('Shared resource saved.', false);
  } catch {
    setSharedResourceMessage('Network error saving shared resource.', true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('deleteSharedResourceBtn').addEventListener('click', async () => {
  const shortDescription = document.getElementById('shortDescription').value.trim() || 'this shared resource';
  const confirmed = window.confirm(
    'Are you sure you want to delete shared resource: ' + shortDescription + '?\n\nAll reservation data for this resource will be irrevocably lost.'
  );
  if (!confirmed) {
    return;
  }

  const button = document.getElementById('deleteSharedResourceBtn');
  button.disabled = true;
  try {
    const res = await fetch('/api/shared-resources/' + resourceId, {
      method: 'DELETE'
    });
    const data = await res.json();

    if (!res.ok) {
      setSharedResourceMessage(data.error || 'Failed to delete shared resource.', true);
      return;
    }

    window.location.href = '/dashboard.html';
  } catch {
    setSharedResourceMessage('Network error deleting shared resource.', true);
  } finally {
    if (!window.location.href.endsWith('/dashboard.html')) {
      button.disabled = false;
    }
  }
});

document.getElementById('backBtn').addEventListener('click', () => {
  window.location.href = '/dashboard.html';
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
});

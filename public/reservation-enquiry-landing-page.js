'use strict';

const params = new URLSearchParams(window.location.search);
const landingPageIdParam = Number(params.get('id'));
const isCreateMode = String(params.get('new') || '').trim() === '1' || !(Number.isInteger(landingPageIdParam) && landingPageIdParam > 0);
let landingPageId = Number.isInteger(landingPageIdParam) && landingPageIdParam > 0 ? landingPageIdParam : null;
let canManageLandingPages = false;

function setLandingPageMessage(text, isError) {
  const el = document.getElementById('landingPageMessage');
  if (!el) {
    return;
  }
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function goBackToConfig() {
  window.location.href = '/dashboard.html?tab=panel-config';
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function getPayload() {
  const name = String(document.getElementById('landingPageName').value || '').trim();
  const slugRaw = String(document.getElementById('landingPageSlug').value || '').trim();
  const preferredListingIdRaw = String(document.getElementById('landingPagePreferredListing').value || '').trim();
  const isActive = !!document.getElementById('landingPageIsActive').checked;

  if (!name) {
    return { error: 'Name is required.' };
  }

  const publicSlug = slugify(slugRaw || name);
  if (!publicSlug) {
    return { error: 'Public slug is required.' };
  }

  const preferredListingId = preferredListingIdRaw ? Number(preferredListingIdRaw) : null;
  if (preferredListingIdRaw && (!Number.isInteger(preferredListingId) || preferredListingId <= 0)) {
    return { error: 'Preferred listing is invalid.' };
  }

  return {
    payload: {
      name,
      publicSlug,
      preferredListingId,
      isActive
    }
  };
}

async function loadListings() {
  const select = document.getElementById('landingPagePreferredListing');
  if (!select) {
    return;
  }

  const response = await fetch('/api/listings');
  if (response.status === 401) {
    window.location.href = '/';
    return;
  }
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to load listings.');
  }

  const listings = Array.isArray(data.listings) ? data.listings : [];
  const selected = String(select.value || '');
  select.innerHTML = '<option value="">None</option>';
  listings.forEach((listing) => {
    const option = document.createElement('option');
    option.value = String(listing.id);
    option.textContent = String(listing.name || ('Listing #' + listing.id));
    select.appendChild(option);
  });

  if (selected && Array.from(select.options).some((opt) => opt.value === selected)) {
    select.value = selected;
  }
}

async function loadLandingPage() {
  const response = await fetch('/api/reservation-enquiry-landing-pages/' + encodeURIComponent(landingPageId));
  if (response.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to load landing page.');
  }

  const landingPage = data.landingPage || {};
  document.getElementById('landingPageTitle').textContent = 'Landing Page: ' + (landingPage.name || ('#' + landingPage.id));
  document.getElementById('landingPageName').value = landingPage.name || '';
  document.getElementById('landingPageSlug').value = landingPage.public_slug || '';
  document.getElementById('landingPagePreferredListing').value = landingPage.preferred_listing_id ? String(landingPage.preferred_listing_id) : '';
  document.getElementById('landingPageIsActive').checked = landingPage.is_active !== false;
}

(async () => {
  try {
    const meRes = await fetch('/api/me');
    if (!meRes.ok) {
      window.location.href = '/';
      return;
    }

    const meData = await meRes.json();
    const activeRole = String((meData && meData.accessContext && meData.accessContext.activeRole) || '');
    canManageLandingPages = activeRole === 'Client' || activeRole === 'Manager';

    await loadListings();

    if (isCreateMode) {
      document.getElementById('landingPageTitle').textContent = 'Create Reservation Enquiry Landing Page';
      document.getElementById('deleteLandingPageBtn').classList.add('hidden');
      return;
    }

    await loadLandingPage();

    if (!canManageLandingPages) {
      document.getElementById('saveLandingPageBtn').disabled = true;
      document.getElementById('deleteLandingPageBtn').disabled = true;
      setLandingPageMessage('Read-only access: your role cannot edit landing pages.', false);
    }

    const slugInput = document.getElementById('landingPageSlug');
    if (slugInput) {
      slugInput.value = slugify(slugInput.value || '');
    }
  } catch (err) {
    setLandingPageMessage(err.message || 'Failed to load landing page.', true);
  }
})();

document.getElementById('landingPageName').addEventListener('input', () => {
  const slugInput = document.getElementById('landingPageSlug');
  if (!slugInput) {
    return;
  }
  if (!String(slugInput.value || '').trim()) {
    slugInput.value = slugify(document.getElementById('landingPageName').value || '');
  }
});

document.getElementById('landingPageSlug').addEventListener('blur', () => {
  const slugInput = document.getElementById('landingPageSlug');
  slugInput.value = slugify(slugInput.value || '');
});

document.getElementById('landingPageForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!canManageLandingPages) {
    setLandingPageMessage('Your role cannot save landing pages.', true);
    return;
  }

  const body = getPayload();
  if (body.error) {
    setLandingPageMessage(body.error, true);
    return;
  }

  const button = document.getElementById('saveLandingPageBtn');
  button.disabled = true;

  try {
    const endpoint = isCreateMode
      ? '/api/reservation-enquiry-landing-pages'
      : ('/api/reservation-enquiry-landing-pages/' + encodeURIComponent(landingPageId));
    const method = isCreateMode ? 'POST' : 'PUT';

    const response = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body.payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to save landing page.');
    }

    const saved = data.landingPage || {};
    setLandingPageMessage('Landing page saved.', false);

    if (isCreateMode && Number.isInteger(Number(saved.id)) && Number(saved.id) > 0) {
      window.location.href = '/reservation-enquiry-landing-page.html?id=' + encodeURIComponent(saved.id);
      return;
    }

    if (saved.public_slug) {
      document.getElementById('landingPageSlug').value = saved.public_slug;
    }
  } catch (err) {
    setLandingPageMessage(err.message || 'Failed to save landing page.', true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('deleteLandingPageBtn').addEventListener('click', async () => {
  if (isCreateMode) {
    return;
  }

  if (!canManageLandingPages) {
    setLandingPageMessage('Your role cannot delete landing pages.', true);
    return;
  }

  if (!window.confirm('Delete this landing page?')) {
    return;
  }

  const button = document.getElementById('deleteLandingPageBtn');
  button.disabled = true;

  try {
    const response = await fetch('/api/reservation-enquiry-landing-pages/' + encodeURIComponent(landingPageId), {
      method: 'DELETE'
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete landing page.');
    }

    goBackToConfig();
  } catch (err) {
    setLandingPageMessage(err.message || 'Failed to delete landing page.', true);
    button.disabled = false;
  }
});

document.getElementById('backBtn').addEventListener('click', goBackToConfig);
document.getElementById('cancelLandingPageBtn').addEventListener('click', goBackToConfig);

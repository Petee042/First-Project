'use strict';

const params = new URLSearchParams(window.location.search);
const propertyId = Number(params.get('id'));

function setPropertyMessage(text, isError) {
  const el = document.getElementById('propertyMessage');
  el.textContent = text;
  el.className = text ? 'message ' + (isError ? 'error' : 'success') : 'message';
}

async function loadProperty() {
  const res = await fetch('/api/properties/' + propertyId);
  if (res.status === 401) {
    window.location.href = '/';
    return;
  }
  if (res.status === 404) {
    setPropertyMessage('Property not found.', true);
    return;
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load property.');
  }

  const property = data.property;
  document.getElementById('propertyTitle').textContent = 'Property: ' + property.name;
  document.getElementById('propertyName').value = property.name || '';
  document.getElementById('postalAddress').value = property.postal_address || '';
  document.getElementById('managerName').value = property.manager_name || '';
  document.getElementById('managerEmail').value = property.manager_email || '';
}

(async () => {
  if (!Number.isInteger(propertyId) || propertyId <= 0) {
    setPropertyMessage('Invalid property id.', true);
    return;
  }

  try {
    const meRes = await fetch('/api/me');
    if (!meRes.ok) {
      window.location.href = '/';
      return;
    }

    await loadProperty();
  } catch (err) {
    setPropertyMessage(err.message || 'Failed to load property page.', true);
  }
})();

document.getElementById('propertyForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const button = e.target.querySelector('button[type="submit"]');
  const name = document.getElementById('propertyName').value.trim();
  const postalAddress = document.getElementById('postalAddress').value.trim();
  const managerName = document.getElementById('managerName').value.trim();
  const managerEmail = document.getElementById('managerEmail').value.trim();

  if (!name) {
    setPropertyMessage('Property name is required.', true);
    return;
  }

  button.disabled = true;
  try {
    const res = await fetch('/api/properties/' + propertyId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, postalAddress, managerName, managerEmail })
    });
    const data = await res.json();

    if (!res.ok) {
      setPropertyMessage(data.error || 'Failed to save property.', true);
      return;
    }

    document.getElementById('propertyTitle').textContent = 'Property: ' + data.property.name;
    setPropertyMessage('Property saved.', false);
  } catch {
    setPropertyMessage('Network error saving property.', true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('backBtn').addEventListener('click', () => {
  window.location.href = '/dashboard.html';
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
});

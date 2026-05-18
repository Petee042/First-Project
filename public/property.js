'use strict';

const params = new URLSearchParams(window.location.search);
const propertyId = Number(params.get('id'));
let canEditProperty = false;
let currentAccessRole = '';
let currentUserEmail = '';
let managerScopeState = {
  hasAssignments: false,
  propertyIdSet: new Set()
};

function setPropertyMessage(text, isError) {
  const el = document.getElementById('propertyMessage');
  el.textContent = text;
  el.className = text ? 'message ' + (isError ? 'error' : 'success') : 'message';
}

function formatEntityId(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return '';
  }
  return String(numeric).padStart(8, '0');
}

function setPropertyScopeHint(text) {
  const el = document.getElementById('propertyScopeHint');
  if (!el) return;
  el.textContent = text || '';
}

async function loadPropertyManagerScope() {
  managerScopeState = {
    hasAssignments: false,
    propertyIdSet: new Set()
  };

  if (currentAccessRole !== 'Manager') {
    return;
  }

  const res = await fetch('/api/access/manager-assignments');
  if (!res.ok) {
    return;
  }

  const data = await res.json();
  const managers = Array.isArray(data.managers) ? data.managers : [];
  const manager = managers.find((row) => String(row.email || '').toLowerCase() === currentUserEmail) || null;
  if (!manager) {
    return;
  }

  const membershipId = Number(manager.membership_id);
  const propertyIdSet = new Set(
    (data.propertyAssignments || [])
      .filter((row) => Number(row.manager_membership_id) === membershipId)
      .map((row) => Number(row.property_id))
      .filter((value) => Number.isInteger(value) && value > 0)
  );

  managerScopeState = {
    hasAssignments: propertyIdSet.size > 0,
    propertyIdSet
  };
}

function applyPropertyAccess(role) {
  canEditProperty = role === 'Manager' || role === 'Client';

  const form = document.getElementById('propertyForm');
  const deleteBtn = document.getElementById('deletePropertyBtn');
  if (!form) {
    return;
  }

  const fields = Array.from(form.querySelectorAll('input, textarea, select, button'));
  fields.forEach((field) => {
    if (field.id === 'propertyPublicId') {
      return;
    }
    if (field.id === 'deletePropertyBtn') {
      return;
    }
    field.disabled = !canEditProperty;
  });

  if (deleteBtn) {
    deleteBtn.disabled = !canEditProperty;
  }

  if (!canEditProperty) {
    setPropertyMessage('Read-only access: your current role can view this property but cannot edit it.', false);
  }
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
  document.getElementById('propertyPublicId').value = formatEntityId(property.id);
  document.getElementById('propertyName').value = property.name || '';
  document.getElementById('postalAddress').value = property.postal_address || '';
  document.getElementById('managerName').value = property.manager_name || '';
  document.getElementById('managerEmail').value = property.manager_email || '';
  document.getElementById('deletePropertyBtn').disabled = !canEditProperty || property.is_default === true;

  if (currentAccessRole === 'Manager') {
    if (!managerScopeState.hasAssignments) {
      setPropertyScopeHint('Scope: manager access currently has no explicit assignments, so all client properties are visible.');
    } else if (managerScopeState.propertyIdSet.has(Number(property.id))) {
      setPropertyScopeHint('Scope: visible through direct property assignment.');
    } else {
      setPropertyScopeHint('Scope: visible in manager context.');
    }
  } else {
    setPropertyScopeHint('');
  }
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

    const meData = await meRes.json();
    currentAccessRole = String((meData && meData.accessContext && meData.accessContext.activeRole) || '');
    currentUserEmail = String(meData.email || '').toLowerCase();
    applyPropertyAccess(currentAccessRole);
    await loadPropertyManagerScope();

    await loadProperty();
  } catch (err) {
    setPropertyMessage(err.message || 'Failed to load property page.', true);
  }
})();

document.getElementById('propertyForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!canEditProperty) {
    setPropertyMessage('Read-only access: editing is not allowed for your role.', true);
    return;
  }

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

document.getElementById('deletePropertyBtn').addEventListener('click', async () => {
  if (!canEditProperty) {
    setPropertyMessage('Read-only access: deleting is not allowed for your role.', true);
    return;
  }

  const propertyName = document.getElementById('propertyName').value.trim() || 'this property';
  const confirmed = window.confirm(
    'Confirm delete property: ' + propertyName + '? This will only work if no listings are assigned to it.'
  );
  if (!confirmed) {
    return;
  }

  const button = document.getElementById('deletePropertyBtn');
  button.disabled = true;
  try {
    const res = await fetch('/api/properties/' + propertyId, {
      method: 'DELETE'
    });
    const data = await res.json();

    if (!res.ok) {
      setPropertyMessage(data.error || 'Failed to delete property.', true);
      return;
    }

    window.location.href = '/dashboard.html';
  } catch {
    setPropertyMessage('Network error deleting property.', true);
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

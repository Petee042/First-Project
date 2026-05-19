'use strict';

const params = new URLSearchParams(window.location.search);
const propertyIdParam = Number(params.get('id'));
const isCreateMode = String(params.get('new') || '').trim() === '1' || !(Number.isInteger(propertyIdParam) && propertyIdParam > 0);
let propertyId = Number.isInteger(propertyIdParam) && propertyIdParam > 0 ? propertyIdParam : null;
let canEditProperty = false;
let currentAccessRole = '';
let currentUserEmail = '';
let initialPropertyFormState = '';
let suppressBeforeunload = false;
let managerScopeState = {
  hasAssignments: false,
  propertyIdSet: new Set()
};
let currentManagerAssignments = {
  managers: [],
  propertyAssignments: [],
  listingAssignments: []
};

function getPropertyFormState() {
  return JSON.stringify({
    name: String(document.getElementById('propertyName').value || ''),
    postalAddress: String(document.getElementById('postalAddress').value || '')
  });
}

function hasUnsavedPropertyChanges() {
  return getPropertyFormState() !== initialPropertyFormState;
}

function confirmDiscardPropertyChanges() {
  if (!hasUnsavedPropertyChanges()) {
    return true;
  }
  return window.confirm('You have unsaved changes. Cancel changes and continue?');
}

function goBackToConfig() {
  window.location.href = '/dashboard.html?tab=panel-config';
}

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
  if (!propertyId) {
    return;
  }

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

async function fetchPropertyManagers() {
  if (!propertyId && !isCreateMode) {
    applyPropertyAssignmentEditor(null);
    return;
  }

  const res = await fetch('/api/access/manager-assignments');
  if (res.status === 401) {
    window.location.href = '/';
    return;
  }
  if (res.status === 403) {
    applyPropertyAssignmentEditor(null);
    return;
  }

  const data = await res.json();
  if (!res.ok) {
    return;
  }

  currentManagerAssignments = data;
  applyPropertyAssignmentEditor(data);
}

function applyPropertyAssignmentEditor(snapshot) {
  const editor = document.getElementById('propertyAssignmentEditor');
  if (!editor) {
    return;
  }

  if (currentAccessRole !== 'Client') {
    editor.classList.add('hidden');
    return;
  }

  editor.classList.remove('hidden');

  const container = document.getElementById('propertyManagersContainer');
  if (!container) {
    return;
  }

  if (!snapshot || !Array.isArray(snapshot.managers) || snapshot.managers.length === 0) {
    container.innerHTML = '<p class="cleaning-empty">No managers available.</p>';
    return;
  }

  const propertyAssignments = new Set(
    (snapshot.propertyAssignments || [])
      .filter((row) => Number(row.property_id) === propertyId)
      .map((row) => Number(row.manager_membership_id))
  );

  container.innerHTML = '';
  snapshot.managers.forEach((manager) => {
    const row = document.createElement('label');
    row.className = 'cleaning-listing-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'property-manager-checkbox';
    checkbox.value = String(manager.membership_id);
    checkbox.checked = propertyAssignments.has(Number(manager.membership_id));

    const text = document.createElement('span');
    text.className = 'cleaning-listing-name';
    text.textContent = manager.email || ('Manager #' + manager.membership_id);

    row.appendChild(checkbox);
    row.appendChild(text);
    container.appendChild(row);
  });
}

async function savePropertyManagerAssignments() {
  if (currentAccessRole !== 'Client') {
    setPropertyMessage('Only Client role can change manager assignments.', true);
    return;
  }

  const managers = (currentManagerAssignments.managers || []);
  const propertyAssignments = (currentManagerAssignments.propertyAssignments || []);
  const listingAssignments = (currentManagerAssignments.listingAssignments || []);

  const savePromises = managers.map(async (manager) => {
    const membershipId = Number(manager.membership_id);
    const checkbox = document.querySelector(
      '.property-manager-checkbox[value="' + membershipId + '"]'
    );
    const isChecked = checkbox && checkbox.checked;

    const currentListingIds = new Set(
      listingAssignments
        .filter((row) => Number(row.manager_membership_id) === membershipId)
        .map((row) => Number(row.listing_id))
    );

    const shouldHavePropertyAssignment = isChecked;
    const currentHasPropertyAssignment = propertyAssignments.some(
      (row) => Number(row.manager_membership_id) === membershipId && Number(row.property_id) === propertyId
    );

    if (shouldHavePropertyAssignment !== currentHasPropertyAssignment) {
      const listingIds = Array.from(currentListingIds).filter((id) => Number.isInteger(id) && id > 0);

      const res = await fetch('/api/access/manager-assignments/' + encodeURIComponent(membershipId), {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyIds: isChecked ? [propertyId] : [], listingIds })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save assignments for a manager.');
      }
    }
  });

  try {
    await Promise.all(savePromises);
    setPropertyMessage('Manager assignments saved.', false);
    await fetchPropertyManagers();
  } catch (err) {
    setPropertyMessage(err.message || 'Failed to save manager assignments.', true);
    throw err;
  }
}

(async () => {
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

    if (isCreateMode) {
      document.getElementById('propertyTitle').textContent = 'Create Property';
      document.getElementById('propertyPublicId').value = 'New';
      document.getElementById('deletePropertyBtn').classList.add('hidden');
      setPropertyScopeHint('');
      initialPropertyFormState = getPropertyFormState();
    } else {
      await loadProperty();
      initialPropertyFormState = getPropertyFormState();
    }

    await fetchPropertyManagers();
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

  const button = document.getElementById('savePropertyBtn');
  const name = document.getElementById('propertyName').value.trim();
  const postalAddress = document.getElementById('postalAddress').value.trim();

  if (!name) {
    setPropertyMessage('Property name is required.', true);
    return;
  }

  button.disabled = true;
  try {
    const res = await fetch(isCreateMode ? '/api/properties' : ('/api/properties/' + propertyId), {
      method: isCreateMode ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, postalAddress })
    });
    const data = await res.json();

    if (!res.ok) {
      setPropertyMessage(data.error || 'Failed to save property.', true);
      return;
    }

    if (isCreateMode) {
      const nextId = Number(data && data.property && data.property.id);
      if (Number.isInteger(nextId) && nextId > 0) {
        propertyId = nextId;
        await savePropertyManagerAssignments();
        suppressBeforeunload = true;
        goBackToConfig();
        return;
      }
    }

    await savePropertyManagerAssignments();

    document.getElementById('propertyTitle').textContent = 'Property: ' + data.property.name;
    initialPropertyFormState = getPropertyFormState();
    setPropertyMessage('Property saved.', false);
    suppressBeforeunload = true;
    goBackToConfig();
  } catch (err) {
    const message = err && err.message ? err.message : 'Network error saving property.';
    setPropertyMessage(message, true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('deletePropertyBtn').addEventListener('click', async () => {
  if (isCreateMode || !propertyId) {
    return;
  }

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

    suppressBeforeunload = true;
    goBackToConfig();
  } catch {
    setPropertyMessage('Network error deleting property.', true);
  } finally {
    if (!window.location.href.includes('/dashboard.html')) {
      button.disabled = false;
    }
  }
});

document.getElementById('cancelPropertyBtn').addEventListener('click', () => {
  if (!confirmDiscardPropertyChanges()) {
    return;
  }
  goBackToConfig();
});

document.getElementById('backBtn').addEventListener('click', () => {
  if (!confirmDiscardPropertyChanges()) {
    return;
  }
  goBackToConfig();
});

window.addEventListener('beforeunload', (event) => {
  if (suppressBeforeunload) {
    return;
  }
  if (!hasUnsavedPropertyChanges()) {
    return;
  }
  event.preventDefault();
  event.returnValue = '';
});

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/';
  });
}

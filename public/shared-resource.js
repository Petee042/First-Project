'use strict';

const params = new URLSearchParams(window.location.search);
const resourceId = Number(params.get('id'));

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

    await loadSharedResource();
  } catch (err) {
    setSharedResourceMessage(err.message || 'Failed to load shared resource page.', true);
  }
})();

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
      body: JSON.stringify({ shortDescription, fullDescriptionHtml, maxUnits })
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

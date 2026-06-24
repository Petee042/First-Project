'use strict';

const params = new URLSearchParams(window.location.search);
const teamUserIdParam = Number(params.get('id'));
const isCreateMode = String(params.get('new') || '').trim() === '1' || !(Number.isInteger(teamUserIdParam) && teamUserIdParam > 0);
let teamUserId = Number.isInteger(teamUserIdParam) && teamUserIdParam > 0 ? teamUserIdParam : null;
let canManageTeam = false;
let initialFormState = '';
let suppressBeforeunload = false;

function setMessage(text, isError) {
  const el = document.getElementById('teamMemberMessage');
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function isStrongPassword(password) {
  const value = String(password || '');
  return value.length >= 8
    && /[A-Z]/.test(value)
    && /[0-9]/.test(value)
    && /[^A-Za-z0-9]/.test(value);
}

function getFormState() {
  return JSON.stringify({
    firstName: String(document.getElementById('teamMemberFirstName').value || ''),
    familyName: String(document.getElementById('teamMemberFamilyName').value || ''),
    country: String(document.getElementById('teamMemberCountry').value || ''),
    email: String(document.getElementById('teamMemberEmail').value || ''),
    roleManager: document.getElementById('teamRoleManager').checked,
    roleStaff: document.getElementById('teamRoleStaff').checked
  });
}

function hasUnsavedChanges() {
  return getFormState() !== initialFormState;
}

function goBackToConfig() {
  suppressBeforeunload = true;
  window.location.href = '/dashboard.html?tab=panel-config';
}

function confirmDiscardChanges() {
  if (!hasUnsavedChanges()) {
    return true;
  }
  return window.confirm('You have unsaved changes. Cancel changes and continue?');
}

function setManageModeEnabled(enabled) {
  document.getElementById('saveTeamMemberBtn').disabled = !enabled;
  document.getElementById('deleteTeamMemberBtn').disabled = !enabled;

  if (!isCreateMode) {
    document.getElementById('teamMemberFirstName').disabled = true;
    document.getElementById('teamMemberFamilyName').disabled = true;
    document.getElementById('teamMemberCountry').disabled = true;
    document.getElementById('teamMemberEmail').disabled = true;
    document.getElementById('teamMemberPassword').disabled = true;
  }
}

function getSelectedRoles() {
  const roles = [];
  if (document.getElementById('teamRoleManager').checked) roles.push('Manager');
  if (document.getElementById('teamRoleStaff').checked) roles.push('Staff');
  return roles;
}

function normaliseTeamMembers(rawRows) {
  const grouped = new Map();
  (Array.isArray(rawRows) ? rawRows : [])
    .filter((member) => member && (member.status === 'active' || member.status === 'invited'))
    .forEach((member) => {
      const userId = Number(member.user_id);
      if (!Number.isInteger(userId) || userId <= 0) {
        return;
      }
      if (!grouped.has(userId)) {
        grouped.set(userId, {
          user_id: userId,
          first_name: member.first_name || '',
          family_name: member.family_name || '',
          email: member.email || '',
          country_of_residence: member.country_of_residence || '',
          roles: new Set()
        });
      }
      const current = grouped.get(userId);
      if (member.role === 'Manager' || member.role === 'Staff') {
        current.roles.add(member.role);
      }
    });

  return Array.from(grouped.values());
}

async function loadTeamMember() {
  const response = await fetch('/api/access/team');
  if (response.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to load team members.');
  }

  const member = normaliseTeamMembers(data.team || []).find((row) => Number(row.user_id) === Number(teamUserId));
  if (!member) {
    throw new Error('Team member not found.');
  }

  document.getElementById('teamMemberTitle').textContent = 'Team Member: ' + ([member.first_name, member.family_name].filter(Boolean).join(' ') || member.email);
  document.getElementById('teamMemberFirstName').value = member.first_name || '';
  document.getElementById('teamMemberFamilyName').value = member.family_name || '';
  const countrySelect = document.getElementById('teamMemberCountry');
  const memberCountry = String(member.country_of_residence || '').trim();
  if (memberCountry && !Array.from(countrySelect.options).some((opt) => opt.value === memberCountry)) {
    const customOption = document.createElement('option');
    customOption.value = memberCountry;
    customOption.textContent = memberCountry;
    countrySelect.appendChild(customOption);
  }
  countrySelect.value = memberCountry;
  document.getElementById('teamMemberEmail').value = member.email || '';
  document.getElementById('teamRoleManager').checked = member.roles.has('Manager');
  document.getElementById('teamRoleStaff').checked = member.roles.has('Staff');
}

async function createTeamMember(payload) {
  const response = await fetch('/api/access/team', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (response.status === 401) {
    window.location.href = '/';
    return null;
  }

  const data = await response.json();
  if (!response.ok) {
    if (response.status === 409 && data.code === 'EXISTING_USER_CONFIRMATION_REQUIRED') {
      const accepted = window.confirm('Site user already exists, send invitation?');
      if (!accepted) {
        return { cancelled: true };
      }

      const retry = await fetch('/api/access/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, confirmExisting: true })
      });
      const retryData = await retry.json();
      if (!retry.ok) {
        throw new Error(retryData.error || 'Failed to add team member.');
      }
      return retryData;
    }

    throw new Error(data.error || 'Failed to add team member.');
  }

  return data;
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
    canManageTeam = activeRole === 'Client';

    if (isCreateMode) {
      document.getElementById('teamMemberTitle').textContent = 'Create Team Member';
      document.getElementById('deleteTeamMemberBtn').classList.add('hidden');
      document.getElementById('teamMemberPassword').required = true;
      setManageModeEnabled(canManageTeam);
      initialFormState = getFormState();
      return;
    }

    await loadTeamMember();
    document.getElementById('teamMemberPassword').placeholder = 'Password changes are not available on this page';
    setManageModeEnabled(canManageTeam);
    initialFormState = getFormState();
  } catch (err) {
    setMessage(err.message || 'Failed to load team member.', true);
  }
})();

document.getElementById('teamMemberForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!canManageTeam) {
    setMessage('Only Client role can save team configuration.', true);
    return;
  }

  const button = document.getElementById('saveTeamMemberBtn');
  const firstName = document.getElementById('teamMemberFirstName').value.trim();
  const familyName = document.getElementById('teamMemberFamilyName').value.trim();
  const country = document.getElementById('teamMemberCountry').value.trim();
  const email = document.getElementById('teamMemberEmail').value.trim().toLowerCase();
  const password = document.getElementById('teamMemberPassword').value;
  const roles = getSelectedRoles();

  if (!roles.length) {
    setMessage('Select at least one role.', true);
    return;
  }

  button.disabled = true;
  try {
    if (isCreateMode) {
      if (!firstName || !familyName || !country || !email || !password) {
        setMessage('First name, family name, country, email and password are required.', true);
        return;
      }
      if (!isStrongPassword(password)) {
        setMessage('Password must be at least 8 characters and include one uppercase, one number, and one special character.', true);
        return;
      }

      const result = await createTeamMember({ firstName, familyName, country, email, password, roles });
      if (result && result.cancelled) {
        setMessage('Invitation cancelled.', false);
        return;
      }
      goBackToConfig();
      return;
    }

    const response = await fetch('/api/access/team/' + encodeURIComponent(teamUserId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roles })
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error || 'Failed to save team member.', true);
      return;
    }

    goBackToConfig();
  } catch (err) {
    setMessage(err.message || 'Failed to save team member.', true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('deleteTeamMemberBtn').addEventListener('click', async () => {
  if (isCreateMode) {
    return;
  }
  if (!canManageTeam) {
    setMessage('Only Client role can delete team members.', true);
    return;
  }

  const memberName = [
    document.getElementById('teamMemberFirstName').value,
    document.getElementById('teamMemberFamilyName').value
  ].filter(Boolean).join(' ').trim() || 'this team member';

  if (!window.confirm('Delete ' + memberName + '?')) {
    return;
  }

  const button = document.getElementById('deleteTeamMemberBtn');
  button.disabled = true;
  try {
    const response = await fetch('/api/access/team/' + encodeURIComponent(teamUserId), { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error || 'Failed to delete team member.', true);
      return;
    }
    goBackToConfig();
  } catch {
    setMessage('Network error deleting team member.', true);
  } finally {
    if (!window.location.href.includes('/dashboard.html')) {
      button.disabled = false;
    }
  }
});

document.getElementById('backBtn').addEventListener('click', () => {
  if (!confirmDiscardChanges()) {
    return;
  }
  goBackToConfig();
});

document.getElementById('cancelTeamMemberBtn').addEventListener('click', () => {
  if (!confirmDiscardChanges()) {
    return;
  }
  goBackToConfig();
});

window.addEventListener('beforeunload', (event) => {
  if (suppressBeforeunload) {
    return;
  }
  if (!hasUnsavedChanges()) {
    return;
  }
  event.preventDefault();
  event.returnValue = '';
});

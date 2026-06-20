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
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_SHORT_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let currentListings = [];
let currentProperties = [];
let currentCleaners = [];
let currentSharedResources = [];
let schedulePreviewRequestId = 0;
let currentScheduleRows = [];
let currentScheduleErrors = [];
let currentNotificationRows = [];
let currentAccessContext = null;
let currentTeamMembers = [];
let currentUserEmail = '';
let currentManagerAssignments = {
  managers: [],
  propertyAssignments: [],
  listingAssignments: []
};
let currentGuests = [];
let currentEditingTeamUserId = null;
let currentTeamMemberDeleteImpact = null;

let opsCalCurrentMonth = new Date();
let opsCalCurrentEvents = [];
let opsCalCurrentCleaningChanges = [];
let opsCalCurrentFetchedAt = null;
let opsCalSelectedListingIds = new Set();
let opsCalRequestId = 0;
let savedDashboardState = null;

const opsCalSourceColorMap = {};
const opsCalSourcePalette = ['#ff5a5f', '#003580', '#2a9d8f', '#e76f51', '#264653', '#f4a261', '#8a5cf6'];
const opsCalListingColorMap = {};
const opsCalListingColorPalette = ['#1d4ed8', '#0f766e', '#b45309', '#be123c', '#4338ca', '#166534', '#0369a1', '#7c3aed'];
const opsCalCleanerBadgeColorMap = {};
const opsCalCleanerBadgePalette = ['#0f766e', '#1d4ed8', '#b45309', '#be123c', '#4338ca', '#166534', '#92400e', '#0369a1'];

function getDashboardStateStorageKey() {
  const identity = currentUserEmail || 'anonymous';
  return 'dashboard-state:v1:' + identity;
}

function loadDashboardState() {
  try {
    const raw = window.localStorage.getItem(getDashboardStateStorageKey());
    savedDashboardState = raw ? JSON.parse(raw) : null;
  } catch {
    savedDashboardState = null;
  }
}

function saveDashboardState(patch) {
  const nextState = Object.assign({}, savedDashboardState || {}, patch || {});
  savedDashboardState = nextState;
  try {
    window.localStorage.setItem(getDashboardStateStorageKey(), JSON.stringify(nextState));
  } catch {
    // Ignore storage failures.
  }
}

function getSavedListingIdSet(stateKey) {
  if (!savedDashboardState || !Array.isArray(savedDashboardState[stateKey])) {
    return null;
  }
  return new Set(savedDashboardState[stateKey].map((id) => String(id)));
}

function getListingDisplayNameFromEvent(event) {
  const listingName = String(event && (event.listingName || event.listing_name || event.listing || '')).trim();
  return listingName || 'Unknown listing';
}

function getListingKeyFromEvent(event) {
  const listingId = Number(event && event.listingId ? event.listingId : event && event.listing_id ? event.listing_id : 0);
  if (Number.isInteger(listingId) && listingId > 0) {
    return 'id:' + String(listingId);
  }
  return 'name:' + getListingDisplayNameFromEvent(event).toLowerCase();
}

function getListingColor(listingKey) {
  if (!opsCalListingColorMap[listingKey]) {
    const idx = Object.keys(opsCalListingColorMap).length % opsCalListingColorPalette.length;
    opsCalListingColorMap[listingKey] = opsCalListingColorPalette[idx];
  }
  return opsCalListingColorMap[listingKey];
}

function getOpsCalendarListings(events) {
  const listings = [];
  const seen = new Set();
  (events || []).forEach((event) => {
    const key = getListingKeyFromEvent(event);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    listings.push({
      key,
      name: getListingDisplayNameFromEvent(event),
      color: getListingColor(key)
    });
  });
  listings.sort((a, b) => a.name.localeCompare(b.name));
  return listings;
}

function getDefaultCleanerForListing(usualCleanerValue) {
  const value = Number(usualCleanerValue || 0);
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }

  const cleaner = (currentCleaners || []).find((item) => {
    const cleanerId = Number(item && item.id ? item.id : 0);
    const cleanerUserId = Number(item && item.cleaner_user_id ? item.cleaner_user_id : 0);
    return cleanerId === value || cleanerUserId === value;
  });

  if (!cleaner) {
    return null;
  }

  return {
    id: Number(cleaner.id || value),
    userId: Number(cleaner.cleaner_user_id || 0) || null,
    name: getCleanerDisplayName(cleaner)
  };
}

function getDefaultCleanerNameForListing(usualCleanerValue) {
  const cleaner = getDefaultCleanerForListing(usualCleanerValue);
  return cleaner ? cleaner.name : '';
}

function getListingMetaById(listingId) {
  const id = Number(listingId || 0);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return (currentListings || []).find((listing) => Number(listing.id) === id) || null;
}

function reservationChangeKey(listingId, checkinDate, checkoutDate) {
  return String(listingId || '') + '|' + String(checkinDate || '') + '|' + String(checkoutDate || '');
}

function buildOpsDefaultCleaningChanges(events, changes) {
  const existingKeys = new Set(
    (changes || []).map((change) => reservationChangeKey(
      Number(change.listingId || change.listing_id || 0),
      toDateKey(change.reservation_checkin_date),
      toDateKey(change.reservation_checkout_date)
    ))
  );

  const synthetic = [];

  (events || []).forEach((event) => {
    if (event && event.isReservation === false) {
      return;
    }

    const listingId = Number(event && (event.listingId || event.listing_id) ? (event.listingId || event.listing_id) : 0);
    const checkinKey = toDateKey(event && event.start);
    const checkoutKey = toDateKey(event && event.end);
    if (!Number.isInteger(listingId) || listingId <= 0 || !checkinKey || !checkoutKey) {
      return;
    }

    const listingMeta = getListingMetaById(listingId);
    if (!listingMeta) {
      return;
    }

    const defaultCleaner = getDefaultCleanerForListing(listingMeta.usual_cleaner_id);
    const defaultCleanerId = defaultCleaner ? defaultCleaner.id : Number(listingMeta.usual_cleaner_id || 0);
    const defaultCleanerName = defaultCleaner ? defaultCleaner.name : '';
    if (!defaultCleanerName) {
      return;
    }

    const key = reservationChangeKey(listingId, checkinKey, checkoutKey);
    if (existingKeys.has(key)) {
      return;
    }
    existingKeys.add(key);

    const basis = listingMeta.date_basis === 'checkin' ? 'checkin' : 'checkout';
    synthetic.push({
      listingId,
      listing_id: listingId,
      listingName: listingMeta.name || ('Listing #' + listingId),
      reservation_checkin_date: checkinKey,
      reservation_checkout_date: checkoutKey,
      changeover_date: basis === 'checkin' ? checkinKey : checkoutKey,
      cleaner_id: null,
      cleaner_name: '',
      default_cleaner_id: defaultCleanerId,
      default_cleaner_name: defaultCleanerName
    });
  });

  return synthetic;
}

function setScheduleEmailMessage(text, isError) {
  const el = document.getElementById('scheduleEmailMessage');
  if (!el) return;
  el.textContent = text || '';
  el.className = text ? ('schedule-email-message ' + (isError ? 'error' : 'success')) : 'schedule-email-message';
}

function setConsolidatedIcsUrl(token) {
  const input = document.getElementById('consolidatedIcsExportUrl');
  if (!input) {
    return;
  }

  const baseUrl = window.location.origin + '/api/calendar.ics';
  input.value = token ? (baseUrl + '?token=' + encodeURIComponent(token)) : baseUrl;
}

function setMessage(text, isError) {
  const el = document.getElementById('dashboardMessage');
  el.textContent = text;
  el.className = text ? 'message ' + (isError ? 'error' : 'success') : 'message';
}

function setStripeConnectStatus(text, isError) {
  const el = document.getElementById('stripeConnectStatus');
  if (!el) {
    return;
  }
  el.textContent = text || '';
  el.className = isError ? 'hint error' : 'hint';
}

function isStrongPassword(password) {
  const value = String(password || '');
  return value.length >= 8
    && /[A-Z]/.test(value)
    && /[0-9]/.test(value)
    && /[^A-Za-z0-9]/.test(value);
}

function canManageTeam() {
  return Boolean(currentAccessContext && currentAccessContext.activeRole === 'Client');
}

function canViewTeam() {
  if (!currentAccessContext) return false;
  return currentAccessContext.activeRole === 'Client' || currentAccessContext.activeRole === 'Manager';
}

function canManageAssignments() {
  return Boolean(currentAccessContext && currentAccessContext.activeRole === 'Client');
}

function canViewAssignments() {
  if (!currentAccessContext) return false;
  return currentAccessContext.activeRole === 'Client' || currentAccessContext.activeRole === 'Manager';
}

function canViewGuests() {
  if (!currentAccessContext) return false;
  return currentAccessContext.activeRole === 'Client' || currentAccessContext.activeRole === 'Manager';
}

function getCleanerDisplayName(cleaner) {
  if (!cleaner) {
    return 'Unallocated';
  }
  const fullName = [cleaner.first_name || '', cleaner.last_name || ''].join(' ').trim();
  if (fullName) {
    return fullName;
  }
  return String(cleaner.email || '').trim() || 'Unallocated';
}

function getCleanerUserId(cleaner) {
  const cleanerUserId = Number(cleaner && cleaner.cleaner_user_id ? cleaner.cleaner_user_id : 0);
  return Number.isInteger(cleanerUserId) && cleanerUserId > 0 ? cleanerUserId : null;
}

function getCleanerByUserIdMap(cleaners) {
  return new Map(
    (cleaners || currentCleaners || [])
      .filter((cleaner) => getCleanerUserId(cleaner))
      .map((cleaner) => [getCleanerUserId(cleaner), cleaner])
  );
}

function resolveCleanerNameFromChange(change, cleaners) {
  if (!change) {
    return 'Unallocated';
  }

  const explicitName = String(change.cleaner_name || '').trim();
  if (explicitName) {
    return explicitName;
  }

  const cleanerList = cleaners || currentCleaners || [];
  const byUserId = getCleanerByUserIdMap(cleanerList);
  const cleanerUserId = Number(change.cleaner_user_id || 0);
  if (Number.isInteger(cleanerUserId) && cleanerUserId > 0 && byUserId.has(cleanerUserId)) {
    return getCleanerDisplayName(byUserId.get(cleanerUserId));
  }

  const cleanerId = Number(change.cleaner_id || 0);
  if (Number.isInteger(cleanerId) && cleanerId > 0) {
    const fallbackCleaner = cleanerList.find((cleaner) => Number(cleaner.id) === cleanerId);
    if (fallbackCleaner) {
      return getCleanerDisplayName(fallbackCleaner);
    }
  }

  return 'Unallocated';
}

function getCurrentManagerScopeState() {
  const empty = {
    managerMembershipId: null,
    hasAssignments: false,
    propertyIdSet: new Set(),
    listingIdSet: new Set()
  };

  if (!currentAccessContext || currentAccessContext.activeRole !== 'Manager') {
    return empty;
  }

  const managers = Array.isArray(currentManagerAssignments.managers) ? currentManagerAssignments.managers : [];
  const membership = managers.find((row) => String(row.email || '').toLowerCase() === String(currentUserEmail || '').toLowerCase()) || null;
  if (!membership) {
    return empty;
  }

  const managerMembershipId = Number(membership.membership_id);
  const propertyIdSet = new Set(
    (currentManagerAssignments.propertyAssignments || [])
      .filter((row) => Number(row.manager_membership_id) === managerMembershipId)
      .map((row) => Number(row.property_id))
      .filter((value) => Number.isInteger(value) && value > 0)
  );
  const listingIdSet = new Set(
    (currentManagerAssignments.listingAssignments || [])
      .filter((row) => Number(row.manager_membership_id) === managerMembershipId)
      .map((row) => Number(row.listing_id))
      .filter((value) => Number.isInteger(value) && value > 0)
  );

  return {
    managerMembershipId,
    hasAssignments: propertyIdSet.size > 0 || listingIdSet.size > 0,
    propertyIdSet,
    listingIdSet
  };
}

function createScopeBadge(text) {
  const badge = document.createElement('span');
  badge.className = 'scope-badge';
  badge.textContent = text;
  return badge;
}

function renderConfigRows(containerId, items, emptyText) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  container.innerHTML = '';
  if (!Array.isArray(items) || !items.length) {
    const empty = document.createElement('div');
    empty.className = 'config-item-empty';
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'config-item-row';

    const name = document.createElement('span');
    name.className = 'config-item-name';
    name.textContent = item.name || 'Untitled';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn secondary config-edit-btn';
    editBtn.textContent = '✎';
    editBtn.title = 'Edit';
    editBtn.setAttribute('aria-label', 'Edit ' + (item.name || 'item'));
    editBtn.addEventListener('click', () => {
      if (item.href) {
        window.location.href = item.href;
      }
    });

    row.appendChild(name);
    row.appendChild(editBtn);
    container.appendChild(row);
  });
}

function applyAccessRoleVisibility() {
  const addTeamForm = document.getElementById('addTeamMemberForm');
  const saveAssignmentsBtn = document.getElementById('saveManagerAssignmentsBtn');

  if (addTeamForm) {
    addTeamForm.classList.toggle('hidden', !canManageTeam());
  }
  if (saveAssignmentsBtn) {
    saveAssignmentsBtn.classList.toggle('hidden', !canManageAssignments());
  }
}

function renderAccessContext(context) {
  currentAccessContext = context || null;

  const summary = document.getElementById('accessContextSummary');
  const memberships = (context && Array.isArray(context.memberships)) ? context.memberships : [];
  const activeClientAccountId = context ? Number(context.activeClientAccountId) : null;
  const activeRole = context ? String(context.activeRole || '') : '';

  if (summary) {
    const activeMembership = memberships.find((membership) => Number(membership.client_account_id) === activeClientAccountId) || null;
    if (!activeMembership) {
      summary.textContent = 'No active client access context.';
    } else {
      let nextText = 'Active: ' + (activeMembership.account_name || ('Client #' + activeClientAccountId)) + ' as ' + (activeRole || activeMembership.role);
      const scopeState = getCurrentManagerScopeState();
      if (activeRole === 'Manager' && scopeState.hasAssignments) {
        nextText += ' | Assignment scope active (' + scopeState.propertyIdSet.size + ' properties, ' + scopeState.listingIdSet.size + ' listings).';
      }
      summary.textContent = nextText;
    }
  }

  applyAccessRoleVisibility();
}

function renderTeamMembers(team) {
  currentTeamMembers = Array.isArray(team) ? team : [];

  const tbody = document.getElementById('teamTableBody');

  if (!currentTeamMembers.length) {
    if (tbody) {
      tbody.innerHTML = '';
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.textContent = 'No team members found.';
      row.appendChild(cell);
      tbody.appendChild(row);
      closeTeamMemberEditor();
    }
    renderConfigRows('configTeamList', [], 'No team members yet.');
    return;
  }

  const groupedByUser = new Map();
  currentTeamMembers
    .filter((member) => member && (member.status === 'active' || member.status === 'invited'))
    .forEach((member) => {
      const userId = Number(member.user_id);
      if (!Number.isInteger(userId) || userId <= 0) {
        return;
      }
      if (!groupedByUser.has(userId)) {
        groupedByUser.set(userId, {
          user_id: userId,
          first_name: member.first_name || '',
          family_name: member.family_name || '',
          email: member.email || '',
          country_of_residence: member.country_of_residence || '',
          is_validated: member.is_validated !== false,
          statuses: new Set(),
          roles: new Set()
        });
      }
      const grouped = groupedByUser.get(userId);
      grouped.statuses.add(String(member.status || ''));
      if (member.role === 'Manager' || member.role === 'Staff') {
        grouped.roles.add(member.role);
      }
    });

  if (!groupedByUser.size) {
    if (tbody) {
      tbody.innerHTML = '';
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.textContent = 'No team members found.';
      row.appendChild(cell);
      tbody.appendChild(row);
      closeTeamMemberEditor();
    }
    renderConfigRows('configTeamList', [], 'No team members yet.');
    return;
  }

  const groupedMembers = Array.from(groupedByUser.values());

  renderConfigRows(
    'configTeamList',
    groupedMembers.map((member) => {
      const fullName = [member.first_name, member.family_name].filter(Boolean).join(' ').trim();
      const emailFallback = String(member.email || '').trim();
      return {
        name: fullName || emailFallback || ('Team Member #' + member.user_id),
        href: '/team-member.html?id=' + encodeURIComponent(member.user_id)
      };
    }),
    'No team members yet.'
  );

  if (!tbody) {
    return;
  }

  tbody.innerHTML = '';

  groupedMembers.forEach((member) => {
    const row = document.createElement('tr');

    const nameCell = document.createElement('td');
    const fullName = [member.first_name, member.family_name].filter(Boolean).join(' ').trim();
    const emailFallback = String(member.email || '').trim();
    nameCell.textContent = fullName || (emailFallback || 'Name not set');

    const emailCell = document.createElement('td');
    emailCell.textContent = member.email || '';

    const roleCell = document.createElement('td');
    const roleLabels = [];
    if (member.roles.has('Manager')) roleLabels.push('Manager');
    if (member.roles.has('Staff')) roleLabels.push('Staff');
    roleCell.textContent = roleLabels.length ? roleLabels.join(' / ') : 'None';

    const statusCell = document.createElement('td');
    if (member.is_validated === false) {
      statusCell.textContent = 'unvalidated';
    } else if (member.statuses.has('invited') && !member.statuses.has('active')) {
      statusCell.textContent = 'invited';
    } else {
      statusCell.textContent = 'active';
    }

    const actionCell = document.createElement('td');
    if (canManageTeam() || canViewTeam()) {
      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.className = 'btn secondary config-edit-btn';
      actionBtn.textContent = '✎';
      actionBtn.title = 'View/Update/Delete';
      actionBtn.setAttribute('aria-label', 'View/Update/Delete');
      actionBtn.addEventListener('click', () => {
        openTeamMemberEditor(member);
      });
      actionCell.appendChild(actionBtn);
    } else {
      actionCell.textContent = '-';
    }

    row.appendChild(nameCell);
    row.appendChild(emailCell);
    row.appendChild(roleCell);
    row.appendChild(statusCell);
    row.appendChild(actionCell);
    tbody.appendChild(row);
  });

  if (currentEditingTeamUserId) {
    const selected = groupedMembers.find((member) => Number(member.user_id) === Number(currentEditingTeamUserId)) || null;
    if (selected) {
      openTeamMemberEditor(selected);
    } else {
      closeTeamMemberEditor();
    }
  }
}

function openTeamMemberEditor(member) {
  const panel = document.getElementById('teamMemberEditor');
  if (!panel || !member) {
    return;
  }

  const fullName = [member.first_name, member.family_name].filter(Boolean).join(' ').trim();
  const emailFallback = String(member.email || '').trim();

  document.getElementById('editTeamMemberUserId').value = String(member.user_id || '');
  document.getElementById('editTeamMemberName').value = fullName || (emailFallback || 'Name not set');
  document.getElementById('editTeamMemberEmail').value = member.email || '';
  document.getElementById('editTeamMemberCountry').value = member.country_of_residence || '';

  const managerBox = document.getElementById('editTeamMemberRoleManager');
  const staffBox = document.getElementById('editTeamMemberRoleStaff');
  managerBox.checked = member.roles.has('Manager');
  staffBox.checked = member.roles.has('Staff');
  managerBox.disabled = !canManageTeam();
  staffBox.disabled = !canManageTeam();

  const saveBtn = document.getElementById('saveTeamMemberEditorBtn');
  const deleteBtn = document.getElementById('deleteTeamMemberBtn');
  if (saveBtn) saveBtn.classList.toggle('hidden', !canManageTeam());
  if (deleteBtn) deleteBtn.classList.toggle('hidden', !canManageTeam());

  const impactEl = document.getElementById('teamMemberDeleteImpact');
  currentTeamMemberDeleteImpact = null;
  if (impactEl) {
    if (!canManageTeam()) {
      impactEl.textContent = 'Delete impact is available to Client role only.';
    } else {
      impactEl.textContent = 'Delete impact: loading...';
    }
  }

  panel.classList.remove('hidden');
  currentEditingTeamUserId = Number(member.user_id) || null;

  if (canManageTeam()) {
    fetchTeamMemberDeleteImpact(member.user_id)
      .then((impact) => {
        if (Number(currentEditingTeamUserId) !== Number(member.user_id)) {
          return;
        }
        currentTeamMemberDeleteImpact = impact;
        if (!impactEl) {
          return;
        }
        if (impact.deletedFromSite) {
          impactEl.textContent = 'Delete impact: this will remove the user from this client and delete the site user account (no other client associations found).';
        } else {
          impactEl.textContent = 'Delete impact: this will remove the user from this client scope only (other client associations exist).';
        }
      })
      .catch((err) => {
        if (Number(currentEditingTeamUserId) !== Number(member.user_id)) {
          return;
        }
        currentTeamMemberDeleteImpact = null;
        if (impactEl) {
          impactEl.textContent = 'Delete impact unavailable: ' + (err.message || 'Failed to load delete impact.');
        }
      });
  }
}

function closeTeamMemberEditor() {
  const panel = document.getElementById('teamMemberEditor');
  if (!panel) {
    return;
  }
  panel.classList.add('hidden');
  currentEditingTeamUserId = null;
  currentTeamMemberDeleteImpact = null;
}

function renderGuests(guests) {
  currentGuests = Array.isArray(guests) ? guests : [];
  const tbody = document.getElementById('guestsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!currentGuests.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.textContent = 'No guest contacts found.';
    row.appendChild(cell);
    tbody.appendChild(row);
    renderConfigRows('configGuestsList', [], 'No guests yet.');
    return;
  }

  renderConfigRows(
    'configGuestsList',
    currentGuests.map((guest) => {
      const guestName = [guest.guest_first_name, guest.guest_family_name].filter(Boolean).join(' ').trim();
      return {
        name: guestName || guest.guest_email || guest.guest_phone || ('Guest #' + guest.id),
        href: '/guest.html?id=' + encodeURIComponent(guest.id)
      };
    }),
    'No guests yet.'
  );

  currentGuests.forEach((guest) => {
    const row = document.createElement('tr');

    const nameCell = document.createElement('td');
    const guestName = [guest.guest_first_name, guest.guest_family_name].filter(Boolean).join(' ').trim();
    nameCell.textContent = guestName || 'Guest';

    const emailCell = document.createElement('td');
    emailCell.textContent = guest.guest_email || '';

    const phoneCell = document.createElement('td');
    phoneCell.textContent = guest.guest_phone || '';

    const sourceCell = document.createElement('td');
    sourceCell.textContent = guest.source_type || '';

    row.appendChild(nameCell);
    row.appendChild(emailCell);
    row.appendChild(phoneCell);
    row.appendChild(sourceCell);
    tbody.appendChild(row);
  });
}

function renderManagerAssignmentSelectors(snapshot) {
  currentManagerAssignments = snapshot || { managers: [], propertyAssignments: [], listingAssignments: [] };

  const managerSelect = document.getElementById('managerAssignmentMembership');
  if (!managerSelect) {
    return;
  }

  const managers = Array.isArray(currentManagerAssignments.managers) ? currentManagerAssignments.managers : [];
  managerSelect.innerHTML = '';

  if (!managers.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No active managers';
    managerSelect.appendChild(option);
    renderManagerScopeOptions(null);
    return;
  }

  managers.forEach((manager) => {
    const option = document.createElement('option');
    option.value = String(manager.membership_id);
    option.textContent = (manager.email || ('Manager #' + manager.membership_id));
    managerSelect.appendChild(option);
  });

  renderManagerScopeOptions(Number(managerSelect.value));
}

function renderManagerScopeOptions(membershipId) {
  const propertyContainer = document.getElementById('managerPropertyScope');
  const listingContainer = document.getElementById('managerListingScope');
  if (!propertyContainer || !listingContainer) {
    return;
  }

  const managerMembershipId = Number(membershipId);
  const propertyAssignments = new Set(
    (currentManagerAssignments.propertyAssignments || [])
      .filter((row) => Number(row.manager_membership_id) === managerMembershipId)
      .map((row) => Number(row.property_id))
  );
  const listingAssignments = new Set(
    (currentManagerAssignments.listingAssignments || [])
      .filter((row) => Number(row.manager_membership_id) === managerMembershipId)
      .map((row) => Number(row.listing_id))
  );

  propertyContainer.innerHTML = '';
  if (!(currentProperties || []).length) {
    propertyContainer.innerHTML = '<p class="cleaning-empty">No properties available.</p>';
  } else {
    currentProperties.forEach((property) => {
      const row = document.createElement('label');
      row.className = 'cleaning-listing-row';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'manager-property-checkbox';
      checkbox.value = String(property.id);
      checkbox.checked = propertyAssignments.has(Number(property.id));

      const text = document.createElement('span');
      text.className = 'cleaning-listing-name';
      text.textContent = property.name;

      row.appendChild(checkbox);
      row.appendChild(text);
      propertyContainer.appendChild(row);
    });
  }

  listingContainer.innerHTML = '';
  if (!(currentListings || []).length) {
    listingContainer.innerHTML = '<p class="cleaning-empty">No listings available.</p>';
  } else {
    currentListings.forEach((listing) => {
      const row = document.createElement('label');
      row.className = 'cleaning-listing-row';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'manager-listing-checkbox';
      checkbox.value = String(listing.id);
      checkbox.checked = listingAssignments.has(Number(listing.id));

      const text = document.createElement('span');
      text.className = 'cleaning-listing-name';
      text.textContent = listing.name;

      row.appendChild(checkbox);
      row.appendChild(text);
      listingContainer.appendChild(row);
    });
  }

  const disabled = !canManageAssignments();
  Array.from(document.querySelectorAll('.manager-property-checkbox, .manager-listing-checkbox')).forEach((checkbox) => {
    checkbox.disabled = disabled;
  });
}

function renderStripeConnectStatus(status) {
  const button = document.getElementById('startStripeConnectBtn');
  const connected = Boolean(status && status.onboardingComplete && status.chargesEnabled && status.payoutsEnabled);
  const accountId = status && status.stripeAccountId ? String(status.stripeAccountId) : '';

  if (connected) {
    setStripeConnectStatus('Stripe account connected and ready to receive payments.' + (accountId ? (' (' + accountId + ')') : ''), false);
    if (button) {
      button.textContent = 'Manage Stripe Account';
    }
    return;
  }

  if (accountId) {
    setStripeConnectStatus('Stripe account linked but onboarding is incomplete. Complete setup to enable online payments.', false);
    if (button) {
      button.textContent = 'Complete Stripe Setup';
    }
    return;
  }

  setStripeConnectStatus('No Stripe account connected yet. Connect one to accept online payments.', false);
  if (button) {
    button.textContent = 'Connect Stripe Account';
  }
}

async function fetchStripeConnectStatus() {
  const response = await fetch('/api/stripe/connect/status');

  if (response.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to load Stripe Connect status.');
  }

  renderStripeConnectStatus(data.stripeConnect || null);
}

async function fetchAccessContext() {
  const response = await fetch('/api/access/context');
  if (response.status === 401) {
    window.location.href = '/';
    return;
  }
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to load access context.');
  }
  renderAccessContext(data);
}

async function fetchTeamMembers() {
  if (!canViewTeam()) {
    renderTeamMembers([]);
    return;
  }

  const response = await fetch('/api/access/team');
  if (response.status === 401) {
    window.location.href = '/';
    return;
  }
  if (response.status === 403) {
    renderTeamMembers([]);
    return;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to load team memberships.');
  }

  renderTeamMembers(data.team || []);
}

async function inviteTeamMember(payload) {
  const response = await fetch('/api/access/team', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (response.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await response.json();
  if (!response.ok) {
    if (response.status === 409 && data.code === 'EXISTING_USER_CONFIRMATION_REQUIRED') {
      const accepted = window.confirm('Site user already exists, send invitation?');
      if (!accepted) {
        return { cancelled: true };
      }

      const retryResponse = await fetch('/api/access/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          confirmExisting: true
        })
      });

      if (retryResponse.status === 401) {
        window.location.href = '/';
        return;
      }

      const retryData = await retryResponse.json();
      if (!retryResponse.ok) {
        throw new Error(retryData.error || 'Failed to add existing site user to client.');
      }
      return retryData;
    }
    throw new Error(data.error || 'Failed to add team member.');
  }

  return data;
}

async function updateTeamMemberRoles(userId, roles) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Invalid user id.');
  }

  const response = await fetch('/api/access/team/' + encodeURIComponent(id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roles })
  });

  if (response.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to update team member roles.');
  }

  return data;
}

async function deleteTeamMember(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Invalid user id.');
  }

  const response = await fetch('/api/access/team/' + encodeURIComponent(id), {
    method: 'DELETE'
  });

  if (response.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to delete team member.');
  }

  return data;
}

async function fetchTeamMemberDeleteImpact(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Invalid user id.');
  }

  const response = await fetch('/api/access/team/' + encodeURIComponent(id) + '/delete-impact');
  if (response.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to load delete impact.');
  }

  return data;
}

async function fetchManagerAssignments() {
  if (!canViewAssignments()) {
    renderManagerAssignmentSelectors({ managers: [], propertyAssignments: [], listingAssignments: [] });
    return;
  }

  const response = await fetch('/api/access/manager-assignments');
  if (response.status === 401) {
    window.location.href = '/';
    return;
  }
  if (response.status === 403) {
    renderManagerAssignmentSelectors({ managers: [], propertyAssignments: [], listingAssignments: [] });
    return;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to load manager assignments.');
  }

  renderManagerAssignmentSelectors(data);
  renderAccessContext(currentAccessContext);
  renderProperties(currentProperties || []);
  renderListings(currentListings || []);
  renderSharedResources(currentSharedResources || []);
}

async function saveManagerAssignments() {
  if (!canManageAssignments()) {
    setMessage('Only Client role can change manager assignments.', true);
    return;
  }

  const managerMembershipId = Number(document.getElementById('managerAssignmentMembership').value);
  if (!Number.isInteger(managerMembershipId) || managerMembershipId <= 0) {
    setMessage('Please select a manager.', true);
    return;
  }

  const propertyIds = Array.from(document.querySelectorAll('.manager-property-checkbox:checked')).map((checkbox) => Number(checkbox.value));
  const listingIds = Array.from(document.querySelectorAll('.manager-listing-checkbox:checked')).map((checkbox) => Number(checkbox.value));

  const response = await fetch('/api/access/manager-assignments/' + encodeURIComponent(managerMembershipId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ propertyIds, listingIds })
  });

  if (response.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to save manager assignments.');
  }

  setMessage('Manager assignments saved.', false);
  await fetchManagerAssignments();
}

async function fetchGuests() {
  if (!canViewGuests()) {
    renderGuests([]);
    return;
  }

  const response = await fetch('/api/access/guests');
  if (response.status === 401) {
    window.location.href = '/';
    return;
  }
  if (response.status === 403) {
    renderGuests([]);
    return;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to load guests.');
  }
  renderGuests(data.guests || []);
}

function sortListingsByProperty(listings) {
  return (listings || []).slice().sort((a, b) => {
    const pa = (a.property_name || '').toLowerCase();
    const pb = (b.property_name || '').toLowerCase();
    if (pa !== pb) return pa < pb ? -1 : 1;
    const na = (a.name || '').toLowerCase();
    const nb = (b.name || '').toLowerCase();
    return na < nb ? -1 : na > nb ? 1 : 0;
  });
}

function renderListings(listings) {
  const sorted = sortListingsByProperty(listings);
  const tbody = document.getElementById('listingsTableBody');
  if (tbody) {
    tbody.innerHTML = '';
  }

  renderConfigRows(
    'configListingsList',
    (sorted || []).map((listing) => ({
      name: listing.name || ('Listing #' + listing.id),
      href: '/listing.html?id=' + encodeURIComponent(listing.id)
    })),
    'No listings yet.'
  );

  if (!tbody) {
    return;
  }

  if (!sorted.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.textContent = 'No listings yet.';
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  sorted.forEach((listing) => {
    const row = document.createElement('tr');

    const scopeState = getCurrentManagerScopeState();
    let scopeLabel = '';
    if (scopeState.hasAssignments) {
      if (scopeState.listingIdSet.has(Number(listing.id))) {
        scopeLabel = 'Direct listing assignment';
      } else if (scopeState.propertyIdSet.has(Number(listing.property_id))) {
        scopeLabel = 'Property-based assignment';
      }
    }

    const nameCell = document.createElement('td');
    nameCell.textContent = listing.name;
    if (scopeLabel) {
      nameCell.appendChild(document.createTextNode(' '));
      nameCell.appendChild(createScopeBadge(scopeLabel));
    }

    const propertyCell = document.createElement('td');
    propertyCell.textContent = listing.property_name || 'default';

    const actionCell = document.createElement('td');
    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'btn secondary config-edit-btn';
    openBtn.textContent = '✎';
    openBtn.title = 'View/Edit';
    openBtn.setAttribute('aria-label', 'View/Edit');
    openBtn.addEventListener('click', () => {
      window.location.href = '/listing.html?id=' + encodeURIComponent(listing.id);
    });

    actionCell.appendChild(openBtn);
    row.appendChild(nameCell);
    row.appendChild(propertyCell);
    row.appendChild(actionCell);
    tbody.appendChild(row);
  });
}

function renderProperties(properties) {
  currentProperties = properties || [];

  const tbody = document.getElementById('propertiesTableBody');
  if (tbody) {
    tbody.innerHTML = '';
  }

  renderConfigRows(
    'configPropertiesList',
    currentProperties.map((property) => ({
      name: property.name || ('Property #' + property.id),
      href: '/property.html?id=' + encodeURIComponent(property.id)
    })),
    'No properties yet.'
  );

  if (tbody && !currentProperties.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.textContent = 'No properties yet.';
    row.appendChild(cell);
    tbody.appendChild(row);
  } else if (tbody) {
    currentProperties.forEach((property) => {
      const row = document.createElement('tr');

      const scopeState = getCurrentManagerScopeState();
      const scopeLabel = scopeState.hasAssignments && scopeState.propertyIdSet.has(Number(property.id))
        ? 'Direct property assignment'
        : '';

      const nameCell = document.createElement('td');
      nameCell.textContent = property.name;
      if (scopeLabel) {
        nameCell.appendChild(document.createTextNode(' '));
        nameCell.appendChild(createScopeBadge(scopeLabel));
      }

      const managerCell = document.createElement('td');
      managerCell.textContent = property.manager_name || property.manager_email || 'Not set';

      const actionCell = document.createElement('td');
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'btn secondary config-edit-btn';
      openBtn.textContent = '✎';
      openBtn.title = 'View/Edit';
      openBtn.setAttribute('aria-label', 'View/Edit');
      openBtn.addEventListener('click', () => {
        window.location.href = '/property.html?id=' + encodeURIComponent(property.id);
      });

      actionCell.appendChild(openBtn);
      row.appendChild(nameCell);
      row.appendChild(managerCell);
      row.appendChild(actionCell);
      tbody.appendChild(row);
    });
  }

  const select = document.getElementById('listingPropertyId');
  if (select) {
    select.innerHTML = '';
    currentProperties.forEach((property) => {
      const option = document.createElement('option');
      option.value = String(property.id);
      option.textContent = property.name;
      select.appendChild(option);
    });
  }
}

function resetCleanerForm() {
  if (!document.getElementById('cleanerId')) {
    return;
  }
  document.getElementById('cleanerId').value = '';
  document.getElementById('cleanerFirstName').value = '';
  document.getElementById('cleanerLastName').value = '';
  document.getElementById('cleanerEmail').value = '';
  document.getElementById('cleanerTelephone').value = '';
  document.getElementById('cleanerPassword').value = '';
  document.getElementById('cleanerPassword').required = true;
  document.getElementById('cleanerPassword').placeholder = '';
  document.getElementById('cleanerFormTitle').textContent = 'Add Changeover Staff';
  document.getElementById('saveCleanerBtn').textContent = 'Add Changeover Staff';
  document.getElementById('cancelCleanerEditBtn').classList.add('hidden');
}

function startCleanerEdit(cleanerId) {
  if (!document.getElementById('cleanerId')) {
    return;
  }
  const cleaner = currentCleaners.find((item) => Number(item.id) === Number(cleanerId));
  if (!cleaner) {
    setMessage('Changeover staff entry not found.', true);
    return;
  }

  document.getElementById('cleanerId').value = String(cleaner.id);
  document.getElementById('cleanerFirstName').value = cleaner.first_name || '';
  document.getElementById('cleanerLastName').value = cleaner.last_name || '';
  document.getElementById('cleanerEmail').value = cleaner.email || '';
  document.getElementById('cleanerTelephone').value = cleaner.telephone || '';
  document.getElementById('cleanerPassword').value = '';
  document.getElementById('cleanerPassword').required = false;
  document.getElementById('cleanerPassword').placeholder = 'Leave blank to keep current password';
  document.getElementById('cleanerFormTitle').textContent = 'Edit Changeover Staff';
  document.getElementById('saveCleanerBtn').textContent = 'Save Changeover Staff';
  document.getElementById('cancelCleanerEditBtn').classList.remove('hidden');
}

function renderCleaners(cleaners) {
  currentCleaners = cleaners || [];

  const tbody = document.getElementById('cleanersTableBody');
  if (!tbody) {
    return;
  }
  tbody.innerHTML = '';

  if (!currentCleaners.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.textContent = 'No changeover staff configured yet.';
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  currentCleaners.forEach((cleaner) => {
    const row = document.createElement('tr');

    const firstNameCell = document.createElement('td');
    firstNameCell.textContent = cleaner.first_name || '';

    const lastNameCell = document.createElement('td');
    lastNameCell.textContent = cleaner.last_name || '';

    const actionCell = document.createElement('td');
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn secondary config-edit-btn';
    editBtn.textContent = '✎';
    editBtn.title = 'View Details/Edit';
    editBtn.setAttribute('aria-label', 'View Details/Edit');
    editBtn.addEventListener('click', () => {
      startCleanerEdit(cleaner.id);
    });

    actionCell.appendChild(editBtn);

    row.appendChild(firstNameCell);
    row.appendChild(lastNameCell);
    row.appendChild(actionCell);

    tbody.appendChild(row);
  });
}

function renderSharedResources(resources) {
  currentSharedResources = resources || [];
  const propertyNameById = new Map((currentProperties || []).map((property) => [Number(property.id), property.name || '']));
  const listingNameById = new Map((currentListings || []).map((listing) => [Number(listing.id), listing.name || '']));

  const tbody = document.getElementById('sharedResourcesTableBody');
  if (!tbody) {
    renderConfigRows(
      'configFacilitiesList',
      currentSharedResources.map((resource) => ({
        name: resource.short_description || ('Facility #' + resource.id),
        href: '/shared-resource.html?id=' + encodeURIComponent(resource.id)
      })),
      'No facilities yet.'
    );
    return;
  }
  tbody.innerHTML = '';

  renderConfigRows(
    'configFacilitiesList',
    currentSharedResources.map((resource) => ({
      name: resource.short_description || ('Facility #' + resource.id),
      href: '/shared-resource.html?id=' + encodeURIComponent(resource.id)
    })),
    'No facilities yet.'
  );

  if (!currentSharedResources.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.textContent = 'No shared resources yet.';
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  currentSharedResources.forEach((resource) => {
    const row = document.createElement('tr');

    const scopeState = getCurrentManagerScopeState();
    let scopeLabel = '';
    if (scopeState.hasAssignments) {
      if (scopeState.listingIdSet.has(Number(resource.listing_id))) {
        scopeLabel = 'Listing-assigned scope';
      } else if (scopeState.propertyIdSet.has(Number(resource.property_id))) {
        scopeLabel = 'Property-assigned scope';
      }
    }

    const shortCell = document.createElement('td');
    shortCell.textContent = resource.short_description || '';
    if (scopeLabel) {
      shortCell.appendChild(document.createTextNode(' '));
      shortCell.appendChild(createScopeBadge(scopeLabel));
    }

    const propertyCell = document.createElement('td');
    const propertyId = Number(resource.property_id || 0);
    propertyCell.textContent = propertyId > 0 ? (propertyNameById.get(propertyId) || 'Unknown property') : 'All Properties';

    const listingCell = document.createElement('td');
    const listingId = Number(resource.listing_id || 0);
    listingCell.textContent = listingId > 0 ? (listingNameById.get(listingId) || 'Unknown listing') : 'All Listings';

    const actionCell = document.createElement('td');
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn secondary config-edit-btn';
    editBtn.textContent = '✎';
    editBtn.title = 'View/Edit';
    editBtn.setAttribute('aria-label', 'View/Edit');
    editBtn.addEventListener('click', () => {
      window.location.href = '/shared-resource.html?id=' + encodeURIComponent(resource.id);
    });
    actionCell.appendChild(editBtn);

    row.appendChild(shortCell);
    row.appendChild(propertyCell);
    row.appendChild(listingCell);
    row.appendChild(actionCell);
    tbody.appendChild(row);
  });
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function keyFromUtcDate(date) {
  return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate());
}

function utcDateFromKey(key) {
  const parts = key.split('-').map((v) => Number(v));
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

function addUtcDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function toDateKey(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return keyFromUtcDate(d);
}

function formatMonthLabel(date) {
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return monthNames[date.getUTCMonth()] + ' ' + date.getUTCFullYear();
}

function renderCleaningListings(listings) {
  const sorted = sortListingsByProperty(listings);
  const container = document.getElementById('cleaningListings');
  container.innerHTML = '';
  const savedListingIds = getSavedListingIdSet('scheduleListingIds');

  if (!sorted.length) {
    const text = document.createElement('p');
    text.className = 'cleaning-empty';
    text.textContent = 'No listings available.';
    container.appendChild(text);
    return;
  }

  sorted.forEach((listing) => {
    const row = document.createElement('label');
    row.className = 'cleaning-listing-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'cleaning-listing-checkbox';
    checkbox.value = String(listing.id);
    checkbox.setAttribute('data-listing-name', listing.name);
    checkbox.setAttribute('data-property-name', listing.property_name || '');
    checkbox.setAttribute('data-date-basis', listing.date_basis === 'checkin' ? 'checkin' : 'checkout');
    checkbox.setAttribute('data-usual-cleaner-id', listing.usual_cleaner_id ? String(listing.usual_cleaner_id) : '');
    if (savedListingIds) {
      checkbox.checked = savedListingIds.has(String(listing.id));
    }

    const name = document.createElement('span');
    name.className = 'cleaning-listing-name';
    name.textContent = listing.name;

    row.appendChild(checkbox);
    row.appendChild(name);
    container.appendChild(row);
  });

  Array.from(container.querySelectorAll('.cleaning-listing-checkbox')).forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      saveDashboardState({
        scheduleListingIds: Array.from(container.querySelectorAll('.cleaning-listing-checkbox:checked')).map((box) => String(box.value))
      });
    });
  });
}

function getSelectedCleaningListings() {
  const checked = Array.from(document.querySelectorAll('.cleaning-listing-checkbox:checked'));
  return checked.map((box) => ({
    id: Number(box.value),
    name: box.getAttribute('data-listing-name') || 'Listing',
    propertyName: box.getAttribute('data-property-name') || '',
    dateBasis: box.getAttribute('data-date-basis') === 'checkin' ? 'checkin' : 'checkout',
    usualCleanerId: box.getAttribute('data-usual-cleaner-id') ? Number(box.getAttribute('data-usual-cleaner-id')) : null
  }));
}

function formatCleaningScheduleLine(dayKey, listingNames) {
  const date = utcDateFromKey(dayKey);
  const weekday = WEEKDAY_NAMES[date.getUTCDay()];
  const day = date.getUTCDate();
  const month = MONTH_SHORT_NAMES[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const text = listingNames.length ? listingNames.join(', ') : 'No checkouts';
  return weekday + ' ' + day + ' ' + month + ' ' + year + ': ' + text;
}

function formatPreparationScheduleLine(dayKey, listingNames) {
  const date = utcDateFromKey(dayKey);
  const weekday = WEEKDAY_NAMES[date.getUTCDay()];
  const day = date.getUTCDate();
  const month = MONTH_SHORT_NAMES[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const text = listingNames.length ? listingNames.join(', ') : 'No checkins';
  return weekday + ' ' + day + ' ' + month + ' ' + year + ': ' + text;
}

function csvEscape(value) {
  const text = String(value || '');
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

function rowsToCsv(rows) {
  const header = 'Checkin Date,Checkout Date,Change Date,Property,Listing,Cleaner';
  const body = rows.map((row) => {
    return [
      csvEscape(row.checkinDate || ''),
      csvEscape(row.checkoutDate || ''),
      csvEscape(row.changeDate || row.date || ''),
      csvEscape(row.property),
      csvEscape(row.listing),
      csvEscape(row.cleanerName || 'Unallocated')
    ].join(',');
  });
  return [header].concat(body).join('\n');
}

function preparationRowsToCsv(rows) {
  const header = 'Date,Checkout Date,Property,Listing';
  const body = rows.map((row) => {
    return [
      csvEscape(row.date),
      csvEscape(row.checkoutDate || ''),
      csvEscape(row.property),
      csvEscape(row.listing)
    ].join(',');
  });
  return [header].concat(body).join('\n');
}

function rowsToText(rows, lineFormatter) {
  const headers = [];

  const properties = Array.from(new Set(rows.map((row) => String(row.property || '').trim()).filter(Boolean)));
  const singleProperty = properties.length === 1;
  if (singleProperty) {
    headers.push(properties[0]);
  }

  const cleaners = Array.from(new Set(rows.map((row) => String(row.cleanerName || 'Unallocated').trim()).filter(Boolean)));
  const singleCleaner = cleaners.length === 1;
  if (singleCleaner) {
    headers.push(cleaners[0]);
  }

  const grouped = {};
  rows.forEach((row) => {
    const changeDateKey = row.changeDate || row.date;
    if (!grouped[changeDateKey]) {
      grouped[changeDateKey] = [];
    }
    const propertyPrefix = singleProperty ? '' : (row.property ? row.property + ' - ' : '');
    const cleanerSuffix = singleCleaner ? '' : ' [' + (row.cleanerName || 'Unallocated') + ']';
    grouped[changeDateKey].push(propertyPrefix + row.listing + cleanerSuffix);
  });

  const body = Object.keys(grouped)
    .sort()
    .map((dateKey) => lineFormatter(dateKey, grouped[dateKey].sort((a, b) => a.localeCompare(b))))
    .join('\n');

  return headers.length ? headers.join('\n') + '\n' + body : body;
}

function downloadTextFile(fileName, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function toDateInputValue(date) {
  return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate());
}

function getSelectedStartDateUtc() {
  const raw = document.getElementById('cleaningStartDate').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return utcDateFromKey(raw);
}

function reservationKey(listingId, checkinDate, checkoutDate) {
  return String(listingId) + '|' + String(checkinDate || '') + '|' + String(checkoutDate || '');
}

function renderNotificationLog(lines) {
  const container = document.getElementById('notificationLog');
  if (!container) return;

  container.innerHTML = '';

  if (!lines.length) {
    const empty = document.createElement('p');
    empty.className = 'cleaning-empty';
    empty.textContent = 'No notifications.';
    container.appendChild(empty);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'notification-list';
  lines.forEach((line) => {
    const item = document.createElement('li');
    item.textContent = line;
    list.appendChild(item);
  });
  container.appendChild(list);
}

async function deleteBookedInChanges(changes) {
  const rows = Array.isArray(changes) ? changes : [];
  if (!rows.length) {
    return { deleted: 0 };
  }

  const res = await fetch('/api/booked-in-changes/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changes: rows })
  });

  if (res.status === 401) {
    window.location.href = '/';
    return { deleted: 0 };
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to delete stale booked-in changes.');
  }

  return { deleted: Number(data.deleted || 0) };
}

async function buildSchedule(selectedListings, days, startDateUtc) {
  const rangeKeySet = new Set();
  for (let i = 0; i < days; i += 1) {
    rangeKeySet.add(keyFromUtcDate(addUtcDays(startDateUtc, i)));
  }

  const rows = [];
  const errors = [];

  await Promise.all(selectedListings.map(async (listing) => {
    try {
      const res = await fetch('/api/listings/' + encodeURIComponent(listing.id) + '/events');
      if (res.status === 401) {
        window.location.href = '/';
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        errors.push(listing.name + ': ' + (data.error || 'Failed to load events.'));
        return;
      }

      (data.events || []).forEach((event) => {
        if (event && event.isReservation === false) {
          return;
        }

        const checkinKey = toDateKey(event.start);
        const checkoutKey = toDateKey(event.end);
        if (!checkinKey || !checkoutKey) {
          return;
        }

        const basis = listing.dateBasis === 'checkin' ? 'checkin' : 'checkout';
        const basisDate = basis === 'checkin' ? checkinKey : checkoutKey;
        if (!rangeKeySet.has(basisDate)) {
          return;
        }

        const cleanerByUserId = getCleanerByUserIdMap(currentCleaners);
        const usualCleanerId = listing.usualCleanerId || null;
        let defaultCleanerId = null;
        let defaultCleanerName = 'Unallocated';
        const listingCleaner = (currentCleaners || []).find((c) => Number(c.id) === Number(usualCleanerId));
        const defaultCleanerUserId = listingCleaner && listingCleaner.cleaner_user_id
          ? Number(listingCleaner.cleaner_user_id)
          : null;
        if (defaultCleanerUserId && cleanerByUserId.has(defaultCleanerUserId)) {
          const uc = cleanerByUserId.get(defaultCleanerUserId);
          defaultCleanerId = defaultCleanerUserId;
          defaultCleanerName = getCleanerDisplayName(uc);
        }

        rows.push({
          listingId: Number(listing.id),
          property: listing.propertyName || '',
          listing: listing.name || '',
          listingDateBasis: basis,
          checkinDate: checkinKey,
          checkoutDate: checkoutKey,
          date: basisDate,
          reservationKey: reservationKey(listing.id, checkinKey, checkoutKey),
          changeDate: basisDate,
          cleanerId: defaultCleanerId,
          cleanerName: defaultCleanerName
        });
      });
    } catch {
      errors.push(listing.name + ': Network error while loading events.');
    }
  }));

  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.property !== b.property) return a.property.localeCompare(b.property);
    return a.listing.localeCompare(b.listing);
  });

  let bookedChanges = [];
  try {
    const lookupRes = await fetch('/api/booked-in-changes/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingIds: selectedListings.map((listing) => Number(listing.id)) })
    });

    if (lookupRes.status === 401) {
      window.location.href = '/';
      return { rows: [], errors: [], text: '', csv: '', rowCount: 0, notifications: [] };
    }

    const lookupData = await lookupRes.json();
    if (lookupRes.ok) {
      bookedChanges = lookupData.changes || [];
    }
  } catch {
    errors.push('Could not load booked-in changes.');
  }

  const bookedMap = new Map();
  bookedChanges.forEach((row) => {
    const key = reservationKey(row.listing_id, row.reservation_checkin_date, row.reservation_checkout_date);
    bookedMap.set(key, row);
  });
  rows.forEach((row) => {
    const existing = bookedMap.get(row.reservationKey);
    if (!existing) {
      return;
    }
    row.changeDate = existing.changeover_date || row.changeDate;
    row.cleanerName = resolveCleanerNameFromChange(existing, currentCleaners);
    row.cleanerId = existing.cleaner_user_id ? Number(existing.cleaner_user_id) : null;
    if (!row.cleanerId && existing.cleaner_id) {
      const fallbackCleaner = (currentCleaners || []).find((cleaner) => Number(cleaner.id) === Number(existing.cleaner_id));
      row.cleanerId = fallbackCleaner && fallbackCleaner.cleaner_user_id ? Number(fallbackCleaner.cleaner_user_id) : null;
    }
  });

  const reservationKeySet = new Set(rows.map((row) => row.reservationKey));
  const notifications = bookedChanges
    .filter((row) => !reservationKeySet.has(reservationKey(row.listing_id, row.reservation_checkin_date, row.reservation_checkout_date)))
    .map((row) => {
      const listing = selectedListings.find((item) => Number(item.id) === Number(row.listing_id));
      const listingName = listing ? listing.name : ('Listing #' + row.listing_id);
      return listingName + ': booked-in change ' + row.reservation_checkin_date + ' to ' + row.reservation_checkout_date + ' no longer matches a reservation.';
    });

  const staleChanges = bookedChanges
    .filter((row) => !reservationKeySet.has(reservationKey(row.listing_id, row.reservation_checkin_date, row.reservation_checkout_date)))
    .map((row) => ({
      listingId: Number(row.listing_id),
      reservationCheckinDate: row.reservation_checkin_date,
      reservationCheckoutDate: row.reservation_checkout_date
    }));

  return {
    text: rowsToText(rows, formatCleaningScheduleLine),
    csv: rowsToCsv(rows),
    rows,
    rowCount: rows.length,
    errors,
    notifications,
    staleChanges
  };
}

function buildScheduleEditSnapshot(rows) {
  const snapshot = new Map();
  (rows || []).forEach((row) => {
    if (!row || !row.reservationKey) {
      return;
    }
    snapshot.set(row.reservationKey, {
      changeDate: row.changeDate || row.date || '',
      cleanerId: Number.isInteger(Number(row.cleanerId)) && Number(row.cleanerId) > 0
        ? Number(row.cleanerId)
        : null,
      cleanerName: row.cleanerName || ''
    });
  });
  return snapshot;
}

function mergeScheduleRowsWithSnapshot(rows, snapshot) {
  if (!snapshot || !snapshot.size) {
    return rows || [];
  }

  (rows || []).forEach((row) => {
    if (!row || !row.reservationKey) {
      return;
    }

    const saved = snapshot.get(row.reservationKey);
    if (!saved) {
      return;
    }

    row.changeDate = saved.changeDate || row.changeDate || row.date;
    row.cleanerId = Number.isInteger(saved.cleanerId) && saved.cleanerId > 0
      ? saved.cleanerId
      : null;

    if (!row.cleanerId) {
      row.cleanerName = 'Unallocated';
      return;
    }

    if (saved.cleanerName) {
      row.cleanerName = saved.cleanerName;
      return;
    }

    const cleaner = (currentCleaners || []).find((item) => Number(item && item.cleaner_user_id ? item.cleaner_user_id : 0) === row.cleanerId);
    row.cleanerName = cleaner ? getCleanerDisplayName(cleaner) : row.cleanerName;
  });

  return rows;
}

function formatDisplayDate(dateKey) {
  if (!dateKey) return '';
  const utcDate = utcDateFromKey(dateKey);
  const dayName = WEEKDAY_NAMES[utcDate.getUTCDay()].substring(0, 3);
  const day = utcDate.getUTCDate();
  const monthName = MONTH_SHORT_NAMES[utcDate.getUTCMonth()];
  const year = String(utcDate.getUTCFullYear()).slice(-2);
  return dayName + ' ' + day + ' ' + monthName + ' ' + year;
}

function renderSchedulePreviewTable(rows, errors, notifications) {
  const container = document.getElementById('schedulePreviewContent') || document.getElementById('schedulePreview');
  container.innerHTML = '';
  renderNotificationLog(notifications || []);

  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'cleaning-empty';
    empty.textContent = 'No schedule entries for the selected listings and date range.';
    container.appendChild(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'calendar-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const headers = ['Checkin Date', 'Checkout Date', 'Property', 'Listing'];
  headers.forEach((label) => {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.forEach((row, idx) => {
    const dividerRow = document.createElement('tr');
    dividerRow.className = 'schedule-entry-divider';
    const dividerCell = document.createElement('td');
    dividerCell.colSpan = headers.length;
    dividerRow.appendChild(dividerCell);
    tbody.appendChild(dividerRow);

    // Main data row
    const altClass = '';
    const mainRow = document.createElement('tr');
    mainRow.className = 'schedule-main-row' + altClass;

    const dateCell = document.createElement('td');
    dateCell.textContent = formatDisplayDate(row.checkinDate || row.date);
    mainRow.appendChild(dateCell);

    const checkoutCell = document.createElement('td');
    checkoutCell.textContent = formatDisplayDate(row.checkoutDate || row.date);
    mainRow.appendChild(checkoutCell);

    const propertyCell = document.createElement('td');
    propertyCell.textContent = row.property || '';
    mainRow.appendChild(propertyCell);

    const listingCell = document.createElement('td');
    listingCell.textContent = row.listing || '';
    mainRow.appendChild(listingCell);

    tbody.appendChild(mainRow);

    // Sub-row with Change Date and Cleaner
    const subRow = document.createElement('tr');
    subRow.className = 'schedule-sub-row' + altClass;

    const controlsCell = document.createElement('td');
    controlsCell.colSpan = headers.length;
    controlsCell.className = 'schedule-controls-cell';

    const controlsContainer = document.createElement('div');
    controlsContainer.className = 'schedule-controls';

    // Change Date input
    const dateInputDiv = document.createElement('div');
    dateInputDiv.className = 'schedule-control-group';
    const dateLabel = document.createElement('label');
    dateLabel.textContent = 'Change Date:';
    dateLabel.className = 'schedule-control-label';
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.value = row.changeDate || row.date;
    dateInput.className = 'schedule-change-date';
    dateInput.dataset.rowIndex = idx;
    dateInput.addEventListener('change', (event) => {
      const rowIndex = Number(event.target.dataset.rowIndex);
      if (!Number.isInteger(rowIndex) || !currentScheduleRows[rowIndex]) return;
      currentScheduleRows[rowIndex].changeDate = event.target.value || currentScheduleRows[rowIndex].changeDate;
    });
    dateInputDiv.appendChild(dateLabel);
    dateInputDiv.appendChild(dateInput);
    controlsContainer.appendChild(dateInputDiv);

    // Cleaner select
    const cleanerDiv = document.createElement('div');
    cleanerDiv.className = 'schedule-control-group';
    const cleanerLabel = document.createElement('label');
    cleanerLabel.textContent = 'Cleaner:';
    cleanerLabel.className = 'schedule-control-label';
    const cleanerSelect = document.createElement('select');
    cleanerSelect.className = 'schedule-cleaner';
    cleanerSelect.dataset.rowIndex = idx;

    const unallocatedOption = document.createElement('option');
    unallocatedOption.value = '';
    unallocatedOption.textContent = 'Unallocated';
    cleanerSelect.appendChild(unallocatedOption);

    currentCleaners.forEach((cleaner) => {
      const cleanerUserId = Number(cleaner.cleaner_user_id || 0);
      if (!Number.isInteger(cleanerUserId) || cleanerUserId <= 0) {
        return;
      }
      const option = document.createElement('option');
      option.value = String(cleanerUserId);
      option.textContent = getCleanerDisplayName(cleaner);
      cleanerSelect.appendChild(option);
    });
    cleanerSelect.value = row.cleanerId ? String(row.cleanerId) : '';
    cleanerSelect.addEventListener('change', (event) => {
      const rowIndex = Number(event.target.dataset.rowIndex);
      if (!Number.isInteger(rowIndex) || !currentScheduleRows[rowIndex]) return;
      const cleanerId = event.target.value ? Number(event.target.value) : null;
      currentScheduleRows[rowIndex].cleanerId = cleanerId;
      currentScheduleRows[rowIndex].cleanerName = cleanerId
        ? event.target.options[event.target.selectedIndex].textContent
        : 'Unallocated';
    });

    cleanerDiv.appendChild(cleanerLabel);
    cleanerDiv.appendChild(cleanerSelect);
    controlsContainer.appendChild(cleanerDiv);

    controlsCell.appendChild(controlsContainer);
    subRow.appendChild(controlsCell);

    tbody.appendChild(subRow);
  });
  table.appendChild(tbody);
  container.appendChild(table);

  if (errors && errors.length) {
    const warning = document.createElement('p');
    warning.className = 'hint';
    warning.textContent = 'Some listings could not be loaded: ' + errors.join(' | ');
    container.appendChild(warning);
  }
}

function opsCalendarSetMessage(text, isError) {
  const el = document.getElementById('opsCalendarMessage');
  if (!el) {
    return;
  }
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function opsCalendarSetDebugMessage(text, isError) {
  const el = document.getElementById('opsCalendarDebugMessage');
  if (!el) {
    return;
  }
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function opsCalendarCanRunDebugActions() {
  return Boolean(currentAccessContext && currentAccessContext.activeRole === 'Manager');
}

function applyOpsCalendarDebugAccess() {
  const canDebug = opsCalendarCanRunDebugActions();
  ['opsDebugCreateBtn', 'opsDebugDeleteByDateBtn', 'opsDebugDeleteAllBtn', 'opsDebugCreateStartDate', 'opsDebugCreateEndDate', 'opsDebugDeleteDate']
    .forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.disabled = !canDebug;
      }
    });

  if (!canDebug) {
    opsCalendarSetDebugMessage('Debug controls are available to Managers only.', true);
  } else {
    opsCalendarSetDebugMessage('', false);
  }
}

function getSingleOpsSelectedListingOrThrow() {
  const selectedListings = getOpsSelectedListings();
  if (!selectedListings.length) {
    throw new Error('Select one listing to use debug tools.');
  }
  if (selectedListings.length > 1) {
    throw new Error('Select only one listing to use debug tools.');
  }
  return selectedListings[0];
}

async function opsCalendarCreateDebugReservation() {
  if (!opsCalendarCanRunDebugActions()) {
    opsCalendarSetDebugMessage('Manager access is required for debug actions.', true);
    return;
  }

  try {
    const listing = getSingleOpsSelectedListingOrThrow();
    const startDate = String(document.getElementById('opsDebugCreateStartDate')?.value || '').trim();
    const endDate = String(document.getElementById('opsDebugCreateEndDate')?.value || '').trim();
    if (!startDate || !endDate || endDate <= startDate) {
      throw new Error('Enter a valid start and end date (end must be after start).');
    }

    const res = await fetch('/api/listings/' + encodeURIComponent(listing.id) + '/debug-reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate, endDate })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to create debug reservation.');
    }

    opsCalendarSetDebugMessage('Debug reservation created for ' + (listing.name || ('Listing #' + listing.id)) + '.', false);
    await refreshOpsCalendar(true);
  } catch (err) {
    opsCalendarSetDebugMessage(err.message || 'Failed to create debug reservation.', true);
  }
}

async function opsCalendarDeleteAllDebugReservations() {
  if (!opsCalendarCanRunDebugActions()) {
    opsCalendarSetDebugMessage('Manager access is required for debug actions.', true);
    return;
  }

  try {
    const listing = getSingleOpsSelectedListingOrThrow();
    const res = await fetch('/api/listings/' + encodeURIComponent(listing.id) + '/debug-reservations', {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to delete reservations.');
    }

    const deletedCount = Number(data.deletedCount || 0);
    opsCalendarSetDebugMessage('Deleted ' + deletedCount + ' reservation(s) for ' + (listing.name || ('Listing #' + listing.id)) + '.', false);
    await refreshOpsCalendar(true);
  } catch (err) {
    opsCalendarSetDebugMessage(err.message || 'Failed to delete reservations.', true);
  }
}

async function opsCalendarDeleteDebugReservationsByDate() {
  if (!opsCalendarCanRunDebugActions()) {
    opsCalendarSetDebugMessage('Manager access is required for debug actions.', true);
    return;
  }

  try {
    const listing = getSingleOpsSelectedListingOrThrow();
    const date = String(document.getElementById('opsDebugDeleteDate')?.value || '').trim();
    if (!date) {
      throw new Error('Enter a date to delete matching reservations.');
    }

    const res = await fetch('/api/listings/' + encodeURIComponent(listing.id) + '/debug-reservations/delete-by-date', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to delete reservations by date.');
    }

    const deletedCount = Number(data.deletedCount || 0);
    opsCalendarSetDebugMessage('Deleted ' + deletedCount + ' reservation(s) including ' + date + '.', false);
    await refreshOpsCalendar(true);
  } catch (err) {
    opsCalendarSetDebugMessage(err.message || 'Failed to delete reservations by date.', true);
  }
}

function opsCalendarSetFetchedAt(isoString) {
  const el = document.getElementById('opsCalendarFetchedAt');
  if (!el) {
    return;
  }
  if (!isoString) {
    el.textContent = '';
    return;
  }
  const date = new Date(isoString);
  el.textContent = 'Last updated: ' + date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  applyOpsCalendarDebugAccess();
}

function renderOpsCalendarListingSelector(listings) {
  const sorted = sortListingsByProperty(listings);
  const container = document.getElementById('opsCalendarListings');
  if (!container) {
    return;
  }

  container.innerHTML = '';
  const savedListingIds = getSavedListingIdSet('opsCalendarListingIds');
  if (!Array.isArray(sorted) || !sorted.length) {
    const empty = document.createElement('p');
    empty.className = 'cleaning-empty';
    empty.textContent = 'No listings available.';
    container.appendChild(empty);
    opsCalSelectedListingIds = new Set();
    return;
  }

  const validIds = new Set(sorted.map((listing) => String(listing.id)));
  const hasSavedSelection = !!savedListingIds;
  const nextSelectedIds = hasSavedSelection
    ? new Set(Array.from(savedListingIds).filter((id) => validIds.has(String(id))))
    : new Set(Array.from(opsCalSelectedListingIds || []).filter((id) => validIds.has(String(id))));
  if (!hasSavedSelection && !nextSelectedIds.size) {
    sorted.forEach((listing) => nextSelectedIds.add(String(listing.id)));
  }
  opsCalSelectedListingIds = nextSelectedIds;

  sorted.forEach((listing) => {
    const row = document.createElement('label');
    row.className = 'cleaning-listing-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'ops-calendar-listing-checkbox';
    checkbox.value = String(listing.id);
    checkbox.checked = opsCalSelectedListingIds.has(String(listing.id));

    const textWrap = document.createElement('span');
    textWrap.className = 'cleaning-listing-name';
    textWrap.textContent = listing.name || ('Listing #' + listing.id);

    const detail = document.createElement('span');
    detail.className = 'hint';
    const propertyName = listing.property_name || 'Unknown property';
    const dateBasis = listing.date_basis === 'checkin' ? 'Check-in basis' : 'Check-out basis';
    detail.textContent = propertyName + ' - ' + dateBasis;

    row.appendChild(checkbox);
    row.appendChild(textWrap);
    row.appendChild(detail);
    container.appendChild(row);
  });

  Array.from(container.querySelectorAll('.ops-calendar-listing-checkbox')).forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const checkedBoxes = Array.from(container.querySelectorAll('.ops-calendar-listing-checkbox:checked'));
      opsCalSelectedListingIds = new Set(checkedBoxes.map((box) => String(box.value)));
      saveDashboardState({ opsCalendarListingIds: Array.from(opsCalSelectedListingIds) });
      refreshOpsCalendar(false);
    });
  });
}

function getOpsSelectedListings() {
  return Array.from(document.querySelectorAll('.ops-calendar-listing-checkbox:checked')).map((box) => ({
    id: Number(box.value),
    name: box.closest('label') ? String(box.closest('label').querySelector('.cleaning-listing-name')?.textContent || '') : ''
  })).filter((listing) => Number.isInteger(listing.id) && listing.id > 0);
}

function opsCalendarSourceKey(source) {
  return String(source || 'Unknown').trim().toLowerCase();
}

function opsCalendarSourceColor(source) {
  const key = opsCalendarSourceKey(source);
  if (!opsCalSourceColorMap[key]) {
    const idx = Object.keys(opsCalSourceColorMap).length % opsCalSourcePalette.length;
    opsCalSourceColorMap[key] = opsCalSourcePalette[idx];
  }
  return opsCalSourceColorMap[key];
}

function opsCalendarGetCleanerKey(change) {
  if (change && change.cleaner_id) {
    return 'id:' + String(change.cleaner_id);
  }
  if (change && change.default_cleaner_id) {
    return 'default:' + String(change.default_cleaner_id);
  }
  const name = opsCalendarGetCleanerDisplayName(change).trim().toLowerCase();
  return name ? ('name:' + name) : '';
}

function opsCalendarGetCleanerInitials(change) {
  const key = opsCalendarGetCleanerKey(change);
  if (!key) {
    return '';
  }
  const name = opsCalendarGetCleanerDisplayName(change);
  if (!name) {
    return '';
  }
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function opsCalendarGetCleanerColor(change) {
  const key = opsCalendarGetCleanerKey(change);
  if (!key) {
    return '#2d3d66';
  }
  if (!opsCalCleanerBadgeColorMap[key]) {
    const idx = Object.keys(opsCalCleanerBadgeColorMap).length % opsCalCleanerBadgePalette.length;
    opsCalCleanerBadgeColorMap[key] = opsCalCleanerBadgePalette[idx];
  }
  return opsCalCleanerBadgeColorMap[key];
}

function opsCalendarGetCleanerDisplayName(change) {
  if (!change) {
    return '';
  }
  const explicitName = String(change.cleaner_name || '').trim();
  if (explicitName && explicitName.toLowerCase() !== 'unallocated') {
    return explicitName;
  }
  const defaultName = String(change.default_cleaner_name || '').trim();
  return !defaultName || defaultName.toLowerCase() === 'unallocated' ? '' : defaultName;
}

function opsCalendarGetSources(events) {
  const sources = [];
  const seen = new Set();

  function addSource(source) {
    const label = String(source || 'Unknown').trim() || 'Unknown';
    const key = opsCalendarSourceKey(label);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    sources.push(label);
  }

  (events || []).forEach((event) => addSource(event.source || 'Unknown'));
  return sources;
}

function eachDateKeyInclusive(startKey, endKey, callback) {
  if (!startKey || !endKey) {
    return;
  }
  const startDate = utcDateFromKey(startKey);
  const endDate = utcDateFromKey(endKey);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return;
  }
  const step = startDate <= endDate ? 1 : -1;
  for (let cursor = new Date(startDate.getTime()); ; cursor = addUtcDays(cursor, step)) {
    callback(keyFromUtcDate(cursor));
    if (cursor.getTime() === endDate.getTime()) {
      break;
    }
  }
}

function buildDayTooltip(dayEntry) {
  if (!dayEntry || !dayEntry.events.length) {
    return '';
  }

  return dayEntry.events.map((event) => {
    const rawLines = Object.entries(event.raw || {}).map(([key, value]) => key + ': ' + value).join(' | ');
    const title = event.title ? event.title : '(untitled)';
    return (event.source || 'Unknown') + ' - ' + title + (rawLines ? ' - ' + rawLines : '');
  }).join('\n');
}

function buildBarTooltip(events) {
  if (!events || !events.length) {
    return '';
  }

  return events.map((event) => {
    const checkin = formatDateKeyForTooltip(toDateKey(event.start));
    const checkout = formatDateKeyForTooltip(toDateKey(event.end));
    return 'Summary: ' + (event.title || (event.raw && event.raw.SUMMARY) || '(untitled)')
      + '\nCheck-in: ' + checkin
      + '\nCheck-out: ' + checkout;
  }).join('\n\n');
}

function formatDateKeyForTooltip(key) {
  if (!key) {
    return 'Unknown';
  }
  const date = utcDateFromKey(key);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return date.getUTCDate() + ' ' + monthNames[date.getUTCMonth()] + ' ' + date.getUTCFullYear();
}

function getOpsEventSummary(event) {
  return event.title || (event.raw && event.raw.SUMMARY) || '(untitled)';
}

function isOpsAirbnbNotAvailableEvent(event, sourceLabel) {
  const sourceKey = opsCalendarSourceKey(sourceLabel || (event && event.source));
  if (!sourceKey.includes('airbnb')) {
    return false;
  }
  return String(getOpsEventSummary(event) || '').toLowerCase().includes('not available');
}

function shouldDimBar(events) {
  return (events || []).some((event) => isOpsAirbnbNotAvailableEvent(event));
}

function hasDisplayUnavailable(events) {
  return (events || []).some((event) => event && event.isUnavailableBlock);
}

function hasReservationEligible(events) {
  return (events || []).some((event) => event && event.isReservation !== false);
}

function applyUnavailableHatch(bar) {
  bar.classList.add('day-bar-unavailable');
  const hatch = document.createElement('span');
  hatch.className = 'day-bar-hatch';
  bar.appendChild(hatch);
}

function opsCalendarMonthStart(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function opsCalendarBuildDayIndex(events) {
  const index = {};

  function ensureDay(key) {
    if (!index[key]) {
      index[key] = {
        listings: new Map(),
        events: [],
        conflict: false
      };
    }
    return index[key];
  }

  function ensureListing(day, listingKey, listingName, color) {
    if (!day.listings.has(listingKey)) {
      day.listings.set(listingKey, {
        name: listingName,
        color,
        stays: new Set(),
        checkins: new Set(),
        checkouts: new Set(),
        stayEvents: [],
        checkinEvents: [],
        checkoutEvents: [],
        events: []
      });
    }
    return day.listings.get(listingKey);
  }

  (events || []).forEach((event) => {
    const listingKey = getListingKeyFromEvent(event);
    const listingName = getListingDisplayNameFromEvent(event);
    const listingColor = getListingColor(listingKey);
    const startKey = toDateKey(event.start);
    const rawEndKey = toDateKey(event.end);
    if (!startKey) {
      return;
    }

    const startDate = utcDateFromKey(startKey);
    let endDate = rawEndKey ? utcDateFromKey(rawEndKey) : addUtcDays(startDate, 1);
    if (endDate <= startDate) {
      endDate = addUtcDays(startDate, 1);
    }

    const checkinDay = ensureDay(startKey);
    checkinDay.events.push(event);
    const checkinListing = ensureListing(checkinDay, listingKey, listingName, listingColor);
    checkinListing.checkins.add(listingKey);
    checkinListing.checkinEvents.push(event);
    checkinListing.events.push(event);

    const checkoutKey = keyFromUtcDate(endDate);
    const checkoutDay = ensureDay(checkoutKey);
    checkoutDay.events.push(event);
    const checkoutListing = ensureListing(checkoutDay, listingKey, listingName, listingColor);
    checkoutListing.checkouts.add(listingKey);
    checkoutListing.checkoutEvents.push(event);
    checkoutListing.events.push(event);

    for (let cursor = new Date(startDate.getTime()); cursor < endDate; cursor = addUtcDays(cursor, 1)) {
      const day = ensureDay(keyFromUtcDate(cursor));
      day.events.push(event);
      const listingEntry = ensureListing(day, listingKey, listingName, listingColor);
      listingEntry.stays.add(listingKey);
      listingEntry.stayEvents.push(event);
      listingEntry.events.push(event);
    }
  });

  return index;
}

function opsCalendarBuildCleaningBadgesByDate(changes) {
  const byDate = {};
  (changes || []).forEach((change) => {
    const cleanKey = toDateKey(change.changeover_date);
    if (!cleanKey) {
      return;
    }

    const initials = opsCalendarGetCleanerInitials(change);
    if (!initials) {
      return;
    }
    const cleanerKey = opsCalendarGetCleanerKey(change);
    const badgeColor = opsCalendarGetCleanerColor(change);

    if (!byDate[cleanKey]) {
      byDate[cleanKey] = new Map();
    }
    const key = cleanerKey || ('initials:' + initials);
    if (!byDate[cleanKey].has(key)) {
      byDate[cleanKey].set(key, {
        initials,
        color: badgeColor
      });
    }
  });

  return byDate;
}

function opsCalendarRenderCleanerLegend(changes) {
  const legend = document.getElementById('opsCalendarCleanerLegend');
  if (!legend) {
    return;
  }
  legend.innerHTML = '';

  const byKey = new Map();
  (changes || []).forEach((change) => {
    const initials = opsCalendarGetCleanerInitials(change);
    const name = opsCalendarGetCleanerDisplayName(change);
    if (!initials || !name) {
      return;
    }
    const key = opsCalendarGetCleanerKey(change) || ('name:' + name.toLowerCase());
    if (!byKey.has(key)) {
      byKey.set(key, {
        initials,
        name,
        color: opsCalendarGetCleanerColor(change)
      });
    }
  });

  Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name)).forEach((itemData) => {
    const item = document.createElement('div');
    item.className = 'cleaner-legend-item';

    const badge = document.createElement('span');
    badge.className = 'calendar-day-cleaner-badge';
    badge.textContent = itemData.initials;
    badge.style.backgroundColor = itemData.color;

    const name = document.createElement('span');
    name.className = 'cleaner-legend-name';
    name.textContent = itemData.name;

    item.appendChild(badge);
    item.appendChild(name);
    legend.appendChild(item);
  });
}

function opsCalendarRenderReservationCalendar(events, changes) {
  const calendar = document.getElementById('opsReservationCalendar');
  const monthLabel = document.getElementById('opsCalendarMonthLabel');
  if (!calendar || !monthLabel) {
    return;
  }

  const monthStart = opsCalendarMonthStart(opsCalCurrentMonth);
  const dayIndex = opsCalendarBuildDayIndex(events);
  const cleanerBadgesByDate = opsCalendarBuildCleaningBadgesByDate(changes);
  const listings = getOpsCalendarListings(events);

  monthLabel.textContent = formatMonthLabel(monthStart);
  calendar.innerHTML = '';

  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const corner = document.createElement('div');
  corner.className = 'calendar-weekday calendar-weekday-corner';
  calendar.appendChild(corner);

  weekdayNames.forEach((name) => {
    const header = document.createElement('div');
    header.className = 'calendar-weekday';
    header.textContent = name;
    calendar.appendChild(header);
  });

  const firstDayOfWeek = monthStart.getUTCDay();
  const nextMonthStart = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
  const daysInMonth = Math.round((nextMonthStart - monthStart) / 86400000);

  const dayNumbers = [];
  for (let i = 0; i < firstDayOfWeek; i += 1) {
    dayNumbers.push(null);
  }
  for (let dayNum = 1; dayNum <= daysInMonth; dayNum += 1) {
    dayNumbers.push(dayNum);
  }
  while (dayNumbers.length % 7 !== 0) {
    dayNumbers.push(null);
  }

  const dayListings = listings.length ? listings : [{ key: 'unknown', name: 'Unknown listing', color: '#667085' }];

  for (let weekStart = 0; weekStart < dayNumbers.length; weekStart += 7) {
    if (weekStart === 0) {
      const labelsCell = document.createElement('div');
      labelsCell.className = 'calendar-channel-labels';

      dayListings.forEach((listing) => {
        const row = document.createElement('div');
        row.className = 'calendar-channel-label-row';

        const swatch = document.createElement('span');
        swatch.className = 'calendar-channel-label-swatch';
        swatch.style.backgroundColor = listing.color;

        const text = document.createElement('span');
        text.className = 'calendar-channel-label-text';
        text.textContent = listing.name;
        text.title = listing.name;

        row.appendChild(swatch);
        row.appendChild(text);
        labelsCell.appendChild(row);
      });

      calendar.appendChild(labelsCell);
    } else {
      const spacer = document.createElement('div');
      spacer.className = 'calendar-channel-labels-spacer';
      calendar.appendChild(spacer);
    }

    for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
      const dayNum = dayNumbers[weekStart + dayOffset];
      if (dayNum === null) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'calendar-day calendar-day-empty';
        calendar.appendChild(emptyCell);
        continue;
      }

      const date = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), dayNum));
      const key = keyFromUtcDate(date);
      const dayEntry = dayIndex[key];

      const cell = document.createElement('div');
      cell.className = 'calendar-day';
      if (dayEntry && dayEntry.conflict) {
        cell.classList.add('calendar-day-conflict');
      }
      cell.title = buildDayTooltip(dayEntry);

      const num = document.createElement('div');
      num.className = 'calendar-day-number';
      num.textContent = String(dayNum);
      cell.appendChild(num);

      const dayCleanerBadgeMap = cleanerBadgesByDate[key] ? new Map(cleanerBadgesByDate[key]) : new Map();

      const dayCleanerBadges = Array.from(dayCleanerBadgeMap.values());
      if (dayCleanerBadges.length) {
        const cleanersEl = document.createElement('div');
        cleanersEl.className = 'calendar-day-cleaners';
        dayCleanerBadges.forEach((badgeInfo) => {
          const badge = document.createElement('span');
          badge.className = 'calendar-day-cleaner-badge';
          badge.textContent = badgeInfo.initials;
          badge.style.backgroundColor = badgeInfo.color;
          cleanersEl.appendChild(badge);
        });
        cell.appendChild(cleanersEl);
      }

      const bars = document.createElement('div');
      bars.className = 'calendar-day-bars';

      dayListings.forEach((listing) => {
        const slot = document.createElement('div');
        slot.className = 'day-bar-slot';

        const bar = document.createElement('div');
        bar.className = 'day-bar';

        if (!dayEntry) {
          bar.classList.add('day-bar-empty');
          slot.appendChild(bar);
          bars.appendChild(slot);
          return;
        }

        const listingEntry = dayEntry.listings.get(listing.key);
        const hasCheckout = !!(listingEntry && listingEntry.checkouts.size);
        const hasCheckin = !!(listingEntry && listingEntry.checkins.size);
        const hasStay = !!(listingEntry && listingEntry.stays.size);
        const color = listing.color;
        const transparentStop = color.length === 7 ? (color + '00') : 'rgba(0,0,0,0)';

        if (hasCheckout && hasCheckin) {
          const transitionEvents = (listingEntry.checkoutEvents || []).concat(listingEntry.checkinEvents || []);
          bar.classList.add('day-transition-bar');
          bar.style.background = 'linear-gradient(90deg, ' + color + ' 0 47%, ' + transparentStop + ' 47% 53%, ' + color + ' 53% 100%)';
          if (shouldDimBar(transitionEvents, listing.name)) {
            bar.style.opacity = '0.5';
          }
          bar.title = buildBarTooltip(transitionEvents);
          if (hasDisplayUnavailable(transitionEvents) && !hasReservationEligible(transitionEvents)) {
            applyUnavailableHatch(bar);
          }
        } else if (hasCheckout) {
          const checkoutEvents = listingEntry.checkoutEvents || [];
          bar.classList.add('day-transition-bar');
          bar.style.background = 'linear-gradient(90deg, ' + color + ' 0 68%, ' + transparentStop + ' 68% 100%)';
          if (shouldDimBar(checkoutEvents, listing.name)) {
            bar.style.opacity = '0.5';
          }
          bar.title = buildBarTooltip(checkoutEvents);
          if (hasDisplayUnavailable(checkoutEvents) && !hasReservationEligible(checkoutEvents)) {
            applyUnavailableHatch(bar);
          }
        } else if (hasCheckin) {
          const checkinEvents = listingEntry.checkinEvents || [];
          bar.classList.add('day-transition-bar');
          bar.style.background = 'linear-gradient(90deg, ' + transparentStop + ' 0 32%, ' + color + ' 32% 100%)';
          if (shouldDimBar(checkinEvents, listing.name)) {
            bar.style.opacity = '0.5';
          }
          bar.title = buildBarTooltip(checkinEvents);
          if (hasDisplayUnavailable(checkinEvents) && !hasReservationEligible(checkinEvents)) {
            applyUnavailableHatch(bar);
          }
        } else if (hasStay) {
          const stayEvents = listingEntry.stayEvents || [];
          bar.style.backgroundColor = color;
          if (shouldDimBar(stayEvents, listing.name)) {
            bar.style.opacity = '0.5';
          }
          bar.title = buildBarTooltip(stayEvents);
          if (hasDisplayUnavailable(stayEvents) && !hasReservationEligible(stayEvents)) {
            applyUnavailableHatch(bar);
          }
        } else {
          bar.classList.add('day-bar-empty');
        }

        slot.appendChild(bar);
        bars.appendChild(slot);
      });

      cell.appendChild(bars);
      calendar.appendChild(cell);
    }
  }
}

async function fetchOpsCalendarListingData(listing, refresh) {
  const listingId = Number(listing.id);
  const endpoint = '/api/listings/' + encodeURIComponent(listingId) + '/events' + (refresh ? '/refresh' : '');
  const res = await fetch(endpoint, refresh ? { method: 'POST' } : undefined);

  if (res.status === 401) {
    window.location.href = '/';
    return null;
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || ('Failed to load calendar data for ' + (listing.name || ('Listing #' + listingId)) + '.'));
  }

  return data;
}

function syncOpsCalendarSelection() {
  const checkedBoxes = Array.from(document.querySelectorAll('.ops-calendar-listing-checkbox:checked'));
  opsCalSelectedListingIds = new Set(checkedBoxes.map((box) => String(box.value)));
}

async function refreshOpsCalendar(refresh) {
  const selectedListings = getOpsSelectedListings();
  const container = document.getElementById('opsReservationCalendar');
  if (!container) {
    return;
  }

  if (!selectedListings.length) {
    opsCalCurrentEvents = [];
    opsCalCurrentCleaningChanges = [];
    opsCalCurrentFetchedAt = null;
    container.innerHTML = '<p class="cleaning-empty">Select at least one listing to display the calendar.</p>';
    opsCalendarSetMessage('Select at least one listing to display the calendar.', true);
    opsCalendarSetFetchedAt(null);
    return;
  }

  const requestId = ++opsCalRequestId;
  opsCalendarSetMessage(refresh ? 'Refreshing calendar...' : 'Loading calendar...', false);

  const results = await Promise.all(selectedListings.map(async (listing) => {
    try {
      const data = await fetchOpsCalendarListingData(listing, refresh);
      return { listing, data };
    } catch (err) {
      return { listing, error: err };
    }
  }));

  if (requestId !== opsCalRequestId) {
    return;
  }

  const events = [];
  const cleaningChanges = [];
  const fetchedAts = [];
  const issues = [];

  results.forEach((result) => {
    if (result.error) {
      issues.push((result.listing.name || ('Listing #' + result.listing.id)) + ': ' + (result.error.message || 'Failed to load.'));
      return;
    }

    const data = result.data || {};
    const listingMeta = getListingMetaById(result.listing.id) || {};
    const listingName = result.listing.name || listingMeta.name || ('Listing #' + result.listing.id);
    const listingColorName = listingMeta.property_name || '';
    const defaultCleaner = getDefaultCleanerForListing(listingMeta.usual_cleaner_id);
    const defaultCleanerId = defaultCleaner ? defaultCleaner.id : (listingMeta.usual_cleaner_id || null);
    const listingDateBasis = listingMeta.date_basis === 'checkin' ? 'checkin' : 'checkout';
    events.push(...(data.events || []).map((event) => Object.assign({}, event, {
      listingId: result.listing.id,
      listingName,
      listingPropertyName: listingColorName
    })));
    cleaningChanges.push(...(data.cleaningChanges || []).map((change) => {
      const checkinKey = toDateKey(change.reservation_checkin_date);
      const checkoutKey = toDateKey(change.reservation_checkout_date);
      const fallbackChangeDate = listingDateBasis === 'checkin' ? checkinKey : checkoutKey;
      return Object.assign({}, change, {
        listingId: result.listing.id,
        listingName,
        changeover_date: toDateKey(change.changeover_date) || fallbackChangeDate,
        default_cleaner_id: defaultCleanerId,
        default_cleaner_name: defaultCleaner ? defaultCleaner.name : ''
      });
    }));
    if (data.fetchedAt) {
      fetchedAts.push(data.fetchedAt);
    }
    if (Array.isArray(data.feedErrors)) {
      data.feedErrors.forEach((feedError) => {
        issues.push((result.listing.name || ('Listing #' + result.listing.id)) + ': ' + (feedError.error || 'Feed issue'));
      });
    }
  });

  opsCalCurrentEvents = events;
  opsCalCurrentCleaningChanges = cleaningChanges.concat(buildOpsDefaultCleaningChanges(events, cleaningChanges));
  opsCalCurrentFetchedAt = fetchedAts.length ? fetchedAts.sort().slice(-1)[0] : null;

  opsCalendarRenderCleanerLegend(opsCalCurrentCleaningChanges);
  opsCalendarRenderReservationCalendar(events, opsCalCurrentCleaningChanges);
  opsCalendarSetFetchedAt(opsCalCurrentFetchedAt);

  if (issues.length) {
    opsCalendarSetMessage('Loaded with feed issues: ' + issues.join(' | '), true);
  } else {
    opsCalendarSetMessage('Loaded ' + selectedListings.length + ' listing' + (selectedListings.length === 1 ? '' : 's') + '.', false);
  }
}

function renderOpsCalendarForCurrentMonth() {
  opsCalendarRenderCleanerLegend(opsCalCurrentCleaningChanges);
  opsCalendarRenderReservationCalendar(opsCalCurrentEvents, opsCalCurrentCleaningChanges);
}

async function updateSchedulePreview() {
  const container = document.getElementById('schedulePreviewContent') || document.getElementById('schedulePreview');
  const daysValue = Number(document.getElementById('cleaningDays').value);
  const startDateUtc = getSelectedStartDateUtc();
  const selectedListings = getSelectedCleaningListings();
  const pendingScheduleEdits = buildScheduleEditSnapshot(currentScheduleRows);
  const requestId = ++schedulePreviewRequestId;

  if (!selectedListings.length) {
    container.innerHTML = '<p class="cleaning-empty">Select listings to preview the schedule.</p>';
    return;
  }
  if (!Number.isInteger(daysValue) || daysValue < 1 || daysValue > 365 || !startDateUtc) {
    container.innerHTML = '<p class="cleaning-empty">Choose a valid start date and day range to preview the schedule.</p>';
    return;
  }

  container.innerHTML = '<p class="cleaning-empty">Loading schedule preview...</p>';

  try {
    const result = await buildSchedule(selectedListings, daysValue, startDateUtc);

    if (requestId !== schedulePreviewRequestId) {
      return;
    }

    let notifications = result.notifications || [];
    currentNotificationRows = result.staleChanges || [];

    if (currentNotificationRows.length) {
      try {
        const deletionResult = await deleteBookedInChanges(currentNotificationRows);
        if (deletionResult.deleted > 0) {
          notifications = notifications.concat('Removed ' + deletionResult.deleted + ' stale booked-in change(s) from the system.');
        }
        currentNotificationRows = [];
      } catch (err) {
        notifications = notifications.concat(err.message || 'Failed to remove stale booked-in changes from the system.');
      }
    }

    currentScheduleRows = mergeScheduleRowsWithSnapshot(result.rows || [], pendingScheduleEdits);
    currentScheduleErrors = result.errors || [];
    renderSchedulePreviewTable(currentScheduleRows, currentScheduleErrors, notifications);
  } catch {
    if (requestId !== schedulePreviewRequestId) {
      return;
    }
    container.innerHTML = '<p class="cleaning-empty">Failed to build schedule preview.</p>';
    renderNotificationLog([]);
  }
}

function renderFeedSources(sources) {
  const tbody = document.getElementById('feedSourcesTableBody');
  if (!tbody) {
    return;
  }
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

  currentListings = data.listings || [];
  renderListings(currentListings);
  renderCleaningListings(currentListings);
  renderOpsCalendarListingSelector(currentListings);
  await refreshOpsCalendar(false);
}

async function fetchProperties() {
  const res = await fetch('/api/properties');
  if (res.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load properties.');
  }

  renderProperties(data.properties || []);
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

async function fetchCleaners() {
  const res = await fetch('/api/cleaners');
  if (res.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load changeover staff.');
  }

  renderCleaners(data.cleaners || []);
}

async function fetchSharedResources() {
  const res = await fetch('/api/shared-resources');
  if (res.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load shared resources.');
  }

  renderSharedResources(data.resources || []);
}

async function persistCurrentScheduleChanges() {
  if (!currentScheduleRows.length) {
    return { ok: false, error: 'Generate a schedule preview before saving changes.' };
  }

  const saveRes = await fetch('/api/booked-in-changes/upsert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      changes: currentScheduleRows.map((row) => ({
        listingId: row.listingId,
        reservationCheckinDate: row.checkinDate,
        reservationCheckoutDate: row.checkoutDate,
        changeoverDate: row.changeDate || row.date,
        cleanerUserId: row.cleanerId
      }))
    })
  });

  if (saveRes.status === 401) {
    window.location.href = '/';
    return { ok: false, error: 'Session expired.' };
  }

  const saveData = await saveRes.json();
  if (!saveRes.ok) {
    return { ok: false, error: saveData.error || 'Failed to save schedule changes.' };
  }

  return { ok: true, saved: Number(saveData.saved || 0) };
}

async function loadDashboardData() {
  await fetchProperties();
  await fetchFeedSources();
  await fetchCleaners();
  await fetchListings();
  await fetchSharedResources();
  await fetchTeamMembers();
  await fetchManagerAssignments();
  await fetchGuests();
  await fetchStripeConnectStatus();
  await fetchBankDetails();

  const managerSelect = document.getElementById('managerAssignmentMembership');
  if (managerSelect) {
    renderManagerScopeOptions(Number(managerSelect.value));
  }
}

function restorePersistedScheduleControls() {
  const startDateInput = document.getElementById('cleaningStartDate');
  const daysInput = document.getElementById('cleaningDays');
  const formatInput = document.getElementById('cleaningFormat');

  // Always default start date to today (local date) on page load
  if (startDateInput) {
    const today = new Date();
    startDateInput.value = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  }
  if (daysInput && savedDashboardState && savedDashboardState.cleaningDays) {
    daysInput.value = String(savedDashboardState.cleaningDays);
  }
  if (formatInput && savedDashboardState && savedDashboardState.cleaningFormat) {
    formatInput.value = savedDashboardState.cleaningFormat;
  }
}

function persistScheduleControls() {
  const startDateInput = document.getElementById('cleaningStartDate');
  const daysInput = document.getElementById('cleaningDays');
  const formatInput = document.getElementById('cleaningFormat');
  saveDashboardState({
    cleaningStartDate: startDateInput ? startDateInput.value : '',
    cleaningDays: daysInput ? daysInput.value : '',
    cleaningFormat: formatInput ? formatInput.value : 'csv'
  });
}

function openScheduleEmailDialog() {
  const dialog = document.getElementById('scheduleEmailDialog');
  const input = document.getElementById('scheduleEmailDialogTo');
  if (!dialog || typeof dialog.showModal !== 'function') {
    return;
  }
  if (input) {
    input.value = currentUserEmail || input.value || '';
  }
  dialog.showModal();
  if (input) {
    input.focus();
    input.select();
  }
}

function closeScheduleEmailDialog() {
  const dialog = document.getElementById('scheduleEmailDialog');
  if (dialog && typeof dialog.close === 'function' && dialog.open) {
    dialog.close();
  }
}

async function sendScheduleEmailToRecipient(toEmail) {
  const format = String((document.getElementById('cleaningFormat') && document.getElementById('cleaningFormat').value) || 'csv').toLowerCase() === 'txt' ? 'txt' : 'csv';
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(toEmail)) {
    setMessage('Enter a valid email address.', true);
    setScheduleEmailMessage('Enter a valid email address.', true);
    return;
  }

  const daysValue = Number(document.getElementById('cleaningDays').value);
  const startDateUtc = getSelectedStartDateUtc();
  const selectedListings = getSelectedCleaningListings();

  if (!selectedListings.length) {
    setMessage('Select at least one listing for the schedule.', true);
    setScheduleEmailMessage('Select at least one listing for the schedule.', true);
    return;
  }
  if (!Number.isInteger(daysValue) || daysValue < 1 || daysValue > 365) {
    setMessage('Number of days must be between 1 and 365.', true);
    setScheduleEmailMessage('Number of days must be between 1 and 365.', true);
    return;
  }
  if (!startDateUtc) {
    setMessage('Please select a valid start date.', true);
    setScheduleEmailMessage('Please select a valid start date.', true);
    return;
  }

  setMessage('Preparing schedule email...', false);
  setScheduleEmailMessage('Preparing schedule email...', false);

  try {
    let rows = currentScheduleRows || [];
    let errors = currentScheduleErrors || [];

    if (!rows.length) {
      const result = await buildSchedule(selectedListings, daysValue, startDateUtc);
      rows = result.rows || [];
      errors = result.errors || [];
      currentScheduleRows = rows;
      currentScheduleErrors = errors;
      renderSchedulePreviewTable(rows, errors, result.notifications || []);
    }

    if (!rows.length) {
      setMessage('No reservations found in the selected range.', true);
      setScheduleEmailMessage('No reservations found in the selected range.', true);
      return;
    }

    const startKey = keyFromUtcDate(startDateUtc);
    const listingNames = Array.from(new Set(rows.map((row) => String(row.listing || '').trim()).filter(Boolean)));
    const subjectPrefix = listingNames.length ? listingNames.join(', ') : 'Listings';
    const subject = subjectPrefix + ' Schedule';
    const textContent = rowsToText(rows, formatCleaningScheduleLine) + '\n';
    const csvContent = rowsToCsv(rows) + '\n';
    const fileName = 'schedule-' + startKey + (format === 'csv' ? '.csv' : '.txt');
    const bodyText = format === 'txt'
      ? textContent
      : ('Please find the schedule attached as CSV.\n\nListings: ' + (listingNames.join(', ') || 'N/A') + '\nDate range start: ' + startKey + '\n');

    const button = document.getElementById('sendScheduleEmailBtn');
    if (button) {
      button.disabled = true;
    }

    const sendRes = await fetch('/api/schedules/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: toEmail,
        subject,
        format,
        fileName,
        textContent: bodyText,
        csvContent
      })
    });

    if (sendRes.status === 401) {
      window.location.href = '/';
      return;
    }

    const sendData = await sendRes.json();
    if (!sendRes.ok) {
      setMessage(sendData.error || 'Failed to send schedule email.', true);
      setScheduleEmailMessage(sendData.error || 'Failed to send schedule email.', true);
      return;
    }

    if (errors.length) {
      setMessage('Email sent with some feed issues: ' + errors.join(' | '), true);
      setScheduleEmailMessage('Email sent with some feed issues.', false);
    } else {
      setMessage('Schedule email sent to ' + toEmail + '.', false);
      setScheduleEmailMessage('Schedule email sent to ' + toEmail + '.', false);
    }
    closeScheduleEmailDialog();
  } catch {
    setMessage('Failed to send schedule email.', true);
    setScheduleEmailMessage('Failed to send schedule email.', true);
  } finally {
    const button = document.getElementById('sendScheduleEmailBtn');
    if (button) {
      button.disabled = false;
    }
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
    setConsolidatedIcsUrl(meData.consolidated_ics_token || '');
    currentUserEmail = String(meData.email || '').toLowerCase();
    loadDashboardState();
    renderStripeConnectStatus(meData.stripeConnect || null);

    await fetchAccessContext();
    await loadPrivateReservations();
    await loadDashboardData();

    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const cleaningStartDate = document.getElementById('cleaningStartDate');
    if (cleaningStartDate && !cleaningStartDate.value) {
      cleaningStartDate.value = toDateInputValue(todayUtc);
    }
    restorePersistedScheduleControls();
    persistScheduleControls();
    resetCleanerForm();

    const savedSelection = savedDashboardState && Array.isArray(savedDashboardState.scheduleListingIds)
      ? savedDashboardState.scheduleListingIds.length
      : 0;
    if (savedSelection) {
      await updateSchedulePreview();
    }
  } catch (err) {
    setMessage(err.message || 'Failed to load page.', true);
  }
})();

const addListingForm = document.getElementById('addListingForm');
if (addListingForm) addListingForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = e.target.querySelector('button[type="submit"]');
  const name = document.getElementById('listingName').value.trim();
  const propertyId = Number(document.getElementById('listingPropertyId').value);

  if (!name) {
    setMessage('Listing name is required.', true);
    return;
  }

  if (!Number.isInteger(propertyId) || propertyId <= 0) {
    setMessage('Property selection is required.', true);
    return;
  }

  button.disabled = true;
  try {
    const res = await fetch('/api/listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, propertyId, dateBasis: 'checkout' })
    });

    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || 'Failed to create listing.', true);
      return;
    }

    document.getElementById('listingName').value = '';
    setMessage('Listing added.', false);
    await fetchProperties();
    await fetchListings();
    await fetchFeedSources();
  } catch {
    setMessage('Network error creating listing.', true);
  } finally {
    button.disabled = false;
  }
});

const addPropertyForm = document.getElementById('addPropertyForm');
if (addPropertyForm) addPropertyForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const button = e.target.querySelector('button[type="submit"]');
  const name = document.getElementById('propertyName').value.trim();

  if (!name) {
    setMessage('Property name is required.', true);
    return;
  }

  button.disabled = true;
  try {
    const res = await fetch('/api/properties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();

    if (!res.ok) {
      setMessage(data.error || 'Failed to create property.', true);
      return;
    }

    document.getElementById('propertyName').value = '';
    setMessage('Property added.', false);
    await fetchProperties();
    await fetchListings();
  } catch {
    setMessage('Network error creating property.', true);
  } finally {
    button.disabled = false;
  }
});

const addSharedResourceForm = document.getElementById('addSharedResourceForm');
if (addSharedResourceForm) addSharedResourceForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const button = e.target.querySelector('button[type="submit"]');
  const shortDescription = document.getElementById('sharedResourceShortDescription').value.trim();

  if (!shortDescription) {
    setMessage('Shared resource short description is required.', true);
    return;
  }

  button.disabled = true;
  try {
    const res = await fetch('/api/shared-resources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shortDescription })
    });
    const data = await res.json();

    if (!res.ok) {
      setMessage(data.error || 'Failed to create shared resource.', true);
      return;
    }

    window.location.href = '/shared-resource.html?id=' + encodeURIComponent(data.resource.id);
  } catch {
    setMessage('Network error creating shared resource.', true);
  } finally {
    button.disabled = false;
  }
});

const createPropertyConfigBtn = document.getElementById('createPropertyConfigBtn');
if (createPropertyConfigBtn) {
  createPropertyConfigBtn.addEventListener('click', () => {
    window.location.href = '/property.html?new=1';
  });
}

const createListingConfigBtn = document.getElementById('createListingConfigBtn');
if (createListingConfigBtn) {
  createListingConfigBtn.addEventListener('click', () => {
    window.location.href = '/listing.html?new=1';
  });
}

const createTeamConfigBtn = document.getElementById('createTeamConfigBtn');
if (createTeamConfigBtn) {
  createTeamConfigBtn.addEventListener('click', () => {
    window.location.href = '/team-member.html?new=1';
  });
}

const createFacilityConfigBtn = document.getElementById('createFacilityConfigBtn');
if (createFacilityConfigBtn) {
  createFacilityConfigBtn.addEventListener('click', () => {
    window.location.href = '/shared-resource.html?new=1';
  });
}

const createGuestConfigBtn = document.getElementById('createGuestConfigBtn');
if (createGuestConfigBtn) {
  createGuestConfigBtn.addEventListener('click', () => {
    window.location.href = '/guest.html?new=1';
  });
}

const _addTeamMemberForm = document.getElementById('addTeamMemberForm');
if (_addTeamMemberForm) _addTeamMemberForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const button = form.querySelector('button[type="submit"]');
  const firstName = document.getElementById('teamMemberFirstName').value.trim();
  const familyName = document.getElementById('teamMemberFamilyName').value.trim();
  const country = document.getElementById('teamMemberCountry').value.trim();
  const email = document.getElementById('teamMemberEmail').value.trim();
  const password = document.getElementById('teamMemberPassword').value;
  const roles = [];
  if (document.getElementById('teamInviteRoleManager').checked) roles.push('Manager');
  if (document.getElementById('teamInviteRoleStaff').checked) roles.push('Staff');

  if (!firstName || !familyName || !country || !email || !password) {
    setMessage('First name, family name, country, email, and password are required.', true);
    return;
  }

  if (!roles.length) {
    setMessage('Select at least one role (Manager and/or Staff).', true);
    return;
  }

  if (!isStrongPassword(password)) {
    setMessage('Password must be at least 8 characters and include one uppercase, one number, and one special character.', true);
    return;
  }

  button.disabled = true;
  try {
    const result = await inviteTeamMember({
      firstName,
      familyName,
      country,
      email,
      password,
      roles
    });

    if (result && result.cancelled) {
      setMessage('Invitation cancelled.', false);
      return;
    }

    setMessage('Team member invitation saved.', false);
    document.getElementById('teamMemberFirstName').value = '';
    document.getElementById('teamMemberFamilyName').value = '';
    document.getElementById('teamMemberCountry').value = '';
    document.getElementById('teamMemberEmail').value = '';
    document.getElementById('teamMemberPassword').value = '';
    document.getElementById('teamInviteRoleManager').checked = false;
    document.getElementById('teamInviteRoleStaff').checked = false;
    await fetchTeamMembers();
    await fetchManagerAssignments();
  } catch (err) {
    setMessage(err.message || 'Failed to add team member.', true);
  } finally {
    button.disabled = false;
  }
});

const _saveTeamMemberEditorBtn = document.getElementById('saveTeamMemberEditorBtn');
if (_saveTeamMemberEditorBtn) _saveTeamMemberEditorBtn.addEventListener('click', async () => {
  const button = document.getElementById('saveTeamMemberEditorBtn');
  const userId = Number(document.getElementById('editTeamMemberUserId').value);
  const roles = [];
  if (document.getElementById('editTeamMemberRoleManager').checked) roles.push('Manager');
  if (document.getElementById('editTeamMemberRoleStaff').checked) roles.push('Staff');

  if (!Number.isInteger(userId) || userId <= 0) {
    setMessage('Select a valid team member first.', true);
    return;
  }

  button.disabled = true;
  try {
    await updateTeamMemberRoles(userId, roles);
    setMessage('Team member updated.', false);
    await fetchTeamMembers();
    await fetchManagerAssignments();
  } catch (err) {
    setMessage(err.message || 'Failed to update team member.', true);
  } finally {
    button.disabled = false;
  }
});

const _deleteTeamMemberBtn = document.getElementById('deleteTeamMemberBtn');
if (_deleteTeamMemberBtn) _deleteTeamMemberBtn.addEventListener('click', async () => {
  const button = document.getElementById('deleteTeamMemberBtn');
  const userId = Number(document.getElementById('editTeamMemberUserId').value);

  if (!Number.isInteger(userId) || userId <= 0) {
    setMessage('Select a valid team member first.', true);
    return;
  }

  let impact = currentTeamMemberDeleteImpact;
  if (!impact) {
    try {
      impact = await fetchTeamMemberDeleteImpact(userId);
      currentTeamMemberDeleteImpact = impact;
    } catch (err) {
      setMessage(err.message || 'Failed to load delete impact.', true);
      return;
    }
  }

  const impactMessage = impact.deletedFromSite
    ? 'This action will remove the user from this client and delete the site user account.'
    : 'This action will remove the user from this client scope only.';
  const confirmed = window.confirm(impactMessage + ' Continue?');
  if (!confirmed) {
    return;
  }

  button.disabled = true;
  try {
    const result = await deleteTeamMember(userId);
    closeTeamMemberEditor();
    if (result && result.deletedFromSite) {
      setMessage('Team member deleted from this client and removed from the site.', false);
    } else {
      setMessage('Team member removed from this client scope.', false);
    }
    await fetchTeamMembers();
    await fetchManagerAssignments();
  } catch (err) {
    setMessage(err.message || 'Failed to delete team member.', true);
  } finally {
    button.disabled = false;
  }
});

const _closeTeamMemberEditorBtn = document.getElementById('closeTeamMemberEditorBtn');
if (_closeTeamMemberEditorBtn) _closeTeamMemberEditorBtn.addEventListener('click', () => {
  closeTeamMemberEditor();
});

const _logoutBtn = document.getElementById('logoutBtn');
if (_logoutBtn) _logoutBtn.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
});

// ── Bank Details ──────────────────────────────────────────────

function setBankDetailsMessage(text, isError) {
  const el = document.getElementById('bankDetailsMessage');
  if (!el) return;
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function setPrivateReservationsMessage(text, isError) {
  const el = document.getElementById('privateReservationsMessage');
  if (!el) return;
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function formatPrivateReservationArrival(dateValue) {
  const value = String(dateValue || '').trim();
  if (!value) {
    return '—';
  }
  const parsed = new Date(value + 'T00:00:00');
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString([], { dateStyle: 'medium' });
}

function formatPrivateReservationAmount(amount) {
  const numeric = Number(amount);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : '—';
}

function createPrivateReservationActionButton(symbol, title, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn secondary config-icon-btn private-res-action-btn ' + className;
  button.textContent = symbol;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.addEventListener('click', onClick);
  return button;
}

function createSharedReservationActionButton(symbol, title, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn secondary config-icon-btn resource-res-action-btn ' + className;
  button.textContent = symbol;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.addEventListener('click', onClick);
  return button;
}

async function deleteSharedReservation(resourceId, reservationId, button) {
  const parsedResourceId = Number(resourceId || 0);
  const parsedReservationId = Number(reservationId || 0);
  if (!Number.isInteger(parsedResourceId) || parsedResourceId <= 0 || !Number.isInteger(parsedReservationId) || parsedReservationId <= 0) {
    setMessage('Select a valid shared resource reservation first.', true);
    return;
  }

  const confirmed = window.confirm('Delete this shared resource reservation? This cannot be undone.');
  if (!confirmed) {
    return;
  }

  if (button) {
    button.disabled = true;
  }
  setMessage('Deleting reservation...', false);

  try {
    const res = await fetch(
      '/api/shared-resources/' + encodeURIComponent(String(parsedResourceId))
      + '/reservations/' + encodeURIComponent(String(parsedReservationId)),
      { method: 'DELETE' }
    );
    if (res.status === 401) {
      window.location.href = '/';
      return;
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to delete reservation.');
    }

    await loadAllReservations();
    setMessage('Reservation deleted.', false);
  } catch (err) {
    setMessage(err.message || 'Failed to delete reservation.', true);
    if (button) {
      button.disabled = false;
    }
  }
}

async function confirmSharedReservationPayment(resourceId, reservationId, status, button) {
  const parsedResourceId = Number(resourceId || 0);
  const parsedReservationId = Number(reservationId || 0);
  const nextStatus = String(status || '').trim();

  if (!Number.isInteger(parsedResourceId) || parsedResourceId <= 0 || !Number.isInteger(parsedReservationId) || parsedReservationId <= 0 || !nextStatus) {
    setMessage('Select a valid shared resource reservation first.', true);
    return;
  }

  const confirmed = window.confirm('Confirm payment received for this reservation?');
  if (!confirmed) {
    return;
  }

  if (button) {
    button.disabled = true;
  }
  setMessage('Registering payment receipt...', false);

  try {
    const res = await fetch(
      '/api/shared-resources/' + encodeURIComponent(String(parsedResourceId))
      + '/reservations/' + encodeURIComponent(String(parsedReservationId))
      + '/status',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus })
      }
    );
    if (res.status === 401) {
      window.location.href = '/';
      return;
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to register payment receipt.');
    }

    await loadAllReservations();
    setMessage('Payment receipt registered.', false);
  } catch (err) {
    setMessage(err.message || 'Failed to register payment receipt.', true);
    if (button) {
      button.disabled = false;
    }
  }
}

async function cancelPrivateReservation(reservationId, button) {
  const id = Number(reservationId || 0);
  if (!Number.isInteger(id) || id <= 0) {
    setPrivateReservationsMessage('Select a valid reservation first.', true);
    return;
  }

  const confirmed = window.confirm('Cancel this reservation? No automatic refund will be issued if the reservation is cancelled.');
  if (!confirmed) {
    return;
  }

  if (button) {
    button.disabled = true;
  }
  setPrivateReservationsMessage('Cancelling reservation...', false);

  try {
    const res = await fetch('/api/private-reservations/' + encodeURIComponent(String(id)), {
      method: 'DELETE'
    });
    if (res.status === 401) {
      window.location.href = '/';
      return;
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to cancel reservation.');
    }

    await loadPrivateReservations();
    setPrivateReservationsMessage('Reservation cancelled.', false);
  } catch (err) {
    setPrivateReservationsMessage(err.message || 'Failed to cancel reservation.', true);
    if (button) {
      button.disabled = false;
    }
  }
}

async function confirmPrivateReservationPayment(reservationId, button) {
  const id = Number(reservationId || 0);
  if (!Number.isInteger(id) || id <= 0) {
    setPrivateReservationsMessage('Select a valid reservation first.', true);
    return;
  }

  const confirmed = window.confirm('Confirm payment receipt');
  if (!confirmed) {
    return;
  }

  if (button) {
    button.disabled = true;
  }
  setPrivateReservationsMessage('Confirming payment...', false);

  try {
    const res = await fetch('/api/private-reservations/' + encodeURIComponent(String(id)) + '/confirm-payment', {
      method: 'POST'
    });
    if (res.status === 401) {
      window.location.href = '/';
      return;
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to confirm payment.');
    }

    await loadPrivateReservations();
    setPrivateReservationsMessage('Payment confirmed.', false);
  } catch (err) {
    setPrivateReservationsMessage(err.message || 'Failed to confirm payment.', true);
    if (button) {
      button.disabled = false;
    }
  }
}

async function loadPrivateReservations() {
  const tbody = document.getElementById('privateReservationsTableBody');
  if (!tbody) {
    return;
  }

  tbody.innerHTML = '<tr><td colspan="7">Loading private reservations...</td></tr>';
  setPrivateReservationsMessage('', false);

  try {
    const res = await fetch('/api/private-reservations');
    if (res.status === 401) {
      window.location.href = '/';
      return;
    }
    if (res.status === 403) {
      tbody.innerHTML = '<tr><td colspan="7">Access restricted.</td></tr>';
      return;
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to load private reservations.');
    }

    const reservations = Array.isArray(data.reservations) ? data.reservations : [];
    if (!reservations.length) {
      tbody.innerHTML = '<tr><td colspan="7">No private reservations found.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    reservations.forEach((reservation) => {
      const tr = document.createElement('tr');
      if (reservation && reservation.isOverduePayment === true) {
        tr.classList.add('conflict-row');
      }

      const reservationIdCell = document.createElement('td');
      reservationIdCell.textContent = reservation.reservationIdentifier || '—';

      const guestCell = document.createElement('td');
      guestCell.textContent = reservation.guestName || '—';

      const listingCell = document.createElement('td');
      listingCell.textContent = reservation.listingName || '—';

      const arrivalCell = document.createElement('td');
      arrivalCell.textContent = formatPrivateReservationArrival(reservation.arrivalDate);

      const nightsCell = document.createElement('td');
      nightsCell.textContent = String(Number(reservation.stayNights || 0) || 0);

      const amountCell = document.createElement('td');
      amountCell.textContent = formatPrivateReservationAmount(reservation.amount);

      const actionCell = document.createElement('td');
      const actionsWrap = document.createElement('div');
      actionsWrap.className = 'feed-actions';

      const cancelBtn = createPrivateReservationActionButton('✖', 'Cancel Reservation', 'private-res-cancel-btn', () => {
        cancelPrivateReservation(reservation.id, cancelBtn);
      });
      actionsWrap.appendChild(cancelBtn);

      if (reservation.canConfirmPayment) {
        const confirmBtn = createPrivateReservationActionButton('✔', 'Confirm Payment Receipt', 'private-res-confirm-btn', () => {
          confirmPrivateReservationPayment(reservation.id, confirmBtn);
        });
        actionsWrap.appendChild(confirmBtn);
      }
      actionCell.appendChild(actionsWrap);

      tr.appendChild(reservationIdCell);
      tr.appendChild(guestCell);
      tr.appendChild(listingCell);
      tr.appendChild(arrivalCell);
      tr.appendChild(nightsCell);
      tr.appendChild(amountCell);
      tr.appendChild(actionCell);
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7">Failed to load private reservations.</td></tr>';
    setPrivateReservationsMessage(err.message || 'Failed to load private reservations.', true);
  }
}

async function fetchBankDetails() {
  try {
    const res = await fetch('/api/account/bank-details');
    if (!res.ok) return;
    const data = await res.json();
    document.getElementById('bankAccountName').value = data.accountName || '';
    document.getElementById('bankSortCode').value = data.sortCode || '';
    document.getElementById('bankAccountNumber').value = data.accountNumber || '';
    document.getElementById('bankIsBusiness').checked = data.isBusiness === true;
  } catch {
    // non-fatal
  }
}

const _bankDetailsForm = document.getElementById('bankDetailsForm');
if (_bankDetailsForm) _bankDetailsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setBankDetailsMessage('', false);
  const btn = document.getElementById('saveBankDetailsBtn');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/account/bank-details', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountName: (document.getElementById('bankAccountName') || {}).value || '',
        sortCode: (document.getElementById('bankSortCode') || {}).value || '',
        accountNumber: (document.getElementById('bankAccountNumber') || {}).value || '',
        isBusiness: !!(document.getElementById('bankIsBusiness') || {}).checked
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save bank details.');
    setBankDetailsMessage('Bank details saved.', false);
  } catch (err) {
    setBankDetailsMessage(err.message || 'Failed to save bank details.', true);
  } finally {
    if (btn) btn.disabled = false;
  }
});


const _startStripeConnectBtn = document.getElementById('startStripeConnectBtn');
if (_startStripeConnectBtn) _startStripeConnectBtn.addEventListener('click', async () => {
  const button = document.getElementById('startStripeConnectBtn');
  button.disabled = true;
  setStripeConnectStatus('Opening Stripe onboarding...', false);

  try {
    const response = await fetch('/api/stripe/connect/start', { method: 'POST' });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to start Stripe onboarding.');
    }

    if (!data.onboardingUrl) {
      throw new Error('Stripe onboarding URL is missing.');
    }

    window.location.href = data.onboardingUrl;
  } catch (err) {
    setStripeConnectStatus(err.message || 'Failed to start Stripe onboarding.', true);
    button.disabled = false;
  }
});

const _clearNotificationLogBtn = document.getElementById('clearNotificationLogBtn');
if (_clearNotificationLogBtn) _clearNotificationLogBtn.addEventListener('click', () => {
  currentNotificationRows = [];
  renderNotificationLog([]);
});

const _opsCalendarRefreshBtn = document.getElementById('opsCalendarRefreshBtn');
if (_opsCalendarRefreshBtn) _opsCalendarRefreshBtn.addEventListener('click', async () => {
  const button = document.getElementById('opsCalendarRefreshBtn');
  button.disabled = true;
  try {
    await refreshOpsCalendar(true);
  } finally {
    button.disabled = false;
  }
});

const _opsCalendarPrevBtn = document.getElementById('opsCalendarPrevBtn');
if (_opsCalendarPrevBtn) _opsCalendarPrevBtn.addEventListener('click', () => {
  opsCalCurrentMonth = new Date(Date.UTC(opsCalCurrentMonth.getUTCFullYear(), opsCalCurrentMonth.getUTCMonth() - 1, 1));
  renderOpsCalendarForCurrentMonth();
});

const _opsCalendarNextBtn = document.getElementById('opsCalendarNextBtn');
if (_opsCalendarNextBtn) _opsCalendarNextBtn.addEventListener('click', () => {
  opsCalCurrentMonth = new Date(Date.UTC(opsCalCurrentMonth.getUTCFullYear(), opsCalCurrentMonth.getUTCMonth() + 1, 1));
  renderOpsCalendarForCurrentMonth();
});

const _opsDebugCreateBtn = document.getElementById('opsDebugCreateBtn');
if (_opsDebugCreateBtn) _opsDebugCreateBtn.addEventListener('click', async () => {
  _opsDebugCreateBtn.disabled = true;
  try {
    await opsCalendarCreateDebugReservation();
  } finally {
    applyOpsCalendarDebugAccess();
  }
});

const _opsDebugDeleteByDateBtn = document.getElementById('opsDebugDeleteByDateBtn');
if (_opsDebugDeleteByDateBtn) _opsDebugDeleteByDateBtn.addEventListener('click', async () => {
  _opsDebugDeleteByDateBtn.disabled = true;
  try {
    await opsCalendarDeleteDebugReservationsByDate();
  } finally {
    applyOpsCalendarDebugAccess();
  }
});

const _opsDebugDeleteAllBtn = document.getElementById('opsDebugDeleteAllBtn');
if (_opsDebugDeleteAllBtn) _opsDebugDeleteAllBtn.addEventListener('click', async () => {
  const confirmed = window.confirm('Delete all active reservations for the selected listing?');
  if (!confirmed) {
    return;
  }
  _opsDebugDeleteAllBtn.disabled = true;
  try {
    await opsCalendarDeleteAllDebugReservations();
  } finally {
    applyOpsCalendarDebugAccess();
  }
});

const _refreshScheduleBtn = document.getElementById('refreshScheduleBtn');
if (_refreshScheduleBtn) _refreshScheduleBtn.addEventListener('click', async () => {
  _refreshScheduleBtn.disabled = true;
  try {
    await updateSchedulePreview();
  } finally {
    _refreshScheduleBtn.disabled = false;
  }
});

const _sendScheduleEmailBtn = document.getElementById('sendScheduleEmailBtn');
if (_sendScheduleEmailBtn) _sendScheduleEmailBtn.addEventListener('click', () => {
  openScheduleEmailDialog();
});

const _scheduleEmailDialogForm = document.getElementById('scheduleEmailDialogForm');
if (_scheduleEmailDialogForm) _scheduleEmailDialogForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('scheduleEmailDialogTo');
  await sendScheduleEmailToRecipient(String(input ? input.value : '').trim().toLowerCase());
});

const _cancelScheduleEmailDialogBtn = document.getElementById('cancelScheduleEmailDialogBtn');
if (_cancelScheduleEmailDialogBtn) _cancelScheduleEmailDialogBtn.addEventListener('click', () => {
  closeScheduleEmailDialog();
});

['cleaningStartDate', 'cleaningDays', 'cleaningFormat'].forEach((id) => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('change', () => {
      persistScheduleControls();
    });
  }
});

document.querySelectorAll('.cleaning-listing-checkbox, .ops-calendar-listing-checkbox').forEach((checkbox) => {
  checkbox.addEventListener('change', () => {
    persistScheduleControls();
  });
});

const _cleaningScheduleForm = document.getElementById('cleaningScheduleForm');
if (_cleaningScheduleForm) _cleaningScheduleForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const button = document.getElementById('downloadCleaningScheduleBtn');
  const daysValue = Number(document.getElementById('cleaningDays').value);
  const format = document.getElementById('cleaningFormat').value;
  const startDateUtc = getSelectedStartDateUtc();
  const selectedListings = getSelectedCleaningListings();

  if (!selectedListings.length) {
    setMessage('Select at least one listing for the schedule.', true);
    return;
  }

  if (!Number.isInteger(daysValue) || daysValue < 1 || daysValue > 365) {
    setMessage('Number of days must be between 1 and 365.', true);
    return;
  }

  if (!startDateUtc) {
    setMessage('Please select a valid start date.', true);
    return;
  }

  const pendingScheduleEdits = buildScheduleEditSnapshot(currentScheduleRows);

  button.disabled = true;
  setMessage('Building schedule from latest feeds...', false);

  try {
    const result = await buildSchedule(selectedListings, daysValue, startDateUtc);
    currentScheduleRows = mergeScheduleRowsWithSnapshot(result.rows || [], pendingScheduleEdits);
    currentScheduleErrors = result.errors || [];
    renderSchedulePreviewTable(currentScheduleRows, currentScheduleErrors, result.notifications || []);

    const startKey = keyFromUtcDate(startDateUtc);
    if (result.rowCount < 1) {
      setMessage('No reservations found in the selected range.', true);
      return;
    }

    const saveResult = await persistCurrentScheduleChanges();
    if (!saveResult.ok) {
      setMessage(saveResult.error || 'Failed to save schedule changes.', true);
      return;
    }

    if (format === 'csv') {
      const fileName = 'schedule-' + startKey + '.csv';
      downloadTextFile(fileName, rowsToCsv(currentScheduleRows) + '\n');
    } else {
      const fileName = 'schedule-' + startKey + '.txt';
      downloadTextFile(fileName, rowsToText(currentScheduleRows, formatCleaningScheduleLine) + '\n');
    }

    if (currentScheduleErrors.length) {
      setMessage('Downloaded with some issues: ' + currentScheduleErrors.join(' | '), true);
    } else {
      setMessage('Schedule downloaded.', false);
    }
  } catch {
    setMessage('Failed to build schedule.', true);
  } finally {
    button.disabled = false;
  }
});

const _saveScheduleChangesBtn = document.getElementById('saveScheduleChangesBtn');
if (_saveScheduleChangesBtn) _saveScheduleChangesBtn.addEventListener('click', async () => {
  const button = document.getElementById('saveScheduleChangesBtn');
  button.disabled = true;
  try {
    const saveResult = await persistCurrentScheduleChanges();
    if (!saveResult.ok) {
      setMessage(saveResult.error || 'Failed to save schedule changes.', true);
      return;
    }
    setMessage('Saved ' + saveResult.saved + ' schedule change(s).', false);
  } catch {
    setMessage('Failed to save schedule changes.', true);
  } finally {
    button.disabled = false;
  }
});

const cleanerForm = document.getElementById('cleanerForm');
if (cleanerForm) cleanerForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const cleanerId = Number(document.getElementById('cleanerId').value);
  const isEdit = Number.isInteger(cleanerId) && cleanerId > 0;

  const button = document.getElementById('saveCleanerBtn');
  const firstName = document.getElementById('cleanerFirstName').value.trim();
  const lastName = document.getElementById('cleanerLastName').value.trim();
  const email = document.getElementById('cleanerEmail').value.trim();
  const telephone = document.getElementById('cleanerTelephone').value.trim();
  const password = document.getElementById('cleanerPassword').value;

  if (!firstName || !lastName || !email || !telephone) {
    setMessage('First name, last name, email, and telephone are required.', true);
    return;
  }

  if (!isEdit && !password) {
    setMessage('Password is required when adding changeover staff.', true);
    return;
  }

  button.disabled = true;
  try {
    const res = await fetch(
      isEdit ? '/api/cleaners/' + encodeURIComponent(cleanerId) : '/api/cleaners',
      {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, email, telephone, password })
      }
    );

    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || 'Failed to save changeover staff.', true);
      return;
    }

    setMessage(isEdit ? 'Changeover staff updated.' : 'Changeover staff added.', false);
    resetCleanerForm();
    await fetchCleaners();
  } catch {
    setMessage('Network error saving changeover staff.', true);
  } finally {
    button.disabled = false;
  }
});

const cancelCleanerEditBtn = document.getElementById('cancelCleanerEditBtn');
if (cancelCleanerEditBtn) {
  cancelCleanerEditBtn.addEventListener('click', () => {
    resetCleanerForm();
  });
}

const _copyConsolidatedIcsUrlBtn = document.getElementById('copyConsolidatedIcsUrlBtn');
if (_copyConsolidatedIcsUrlBtn) _copyConsolidatedIcsUrlBtn.addEventListener('click', async () => {
  const url = document.getElementById('consolidatedIcsExportUrl').value;
  if (!url) return;

  try {
    await navigator.clipboard.writeText(url);
    const btn = document.getElementById('copyConsolidatedIcsUrlBtn');
    const originalText = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => {
      btn.textContent = originalText;
    }, 1800);
  } catch {
    setMessage('Could not copy consolidated calendar URL.', true);
  }
});

// ── Dashboard tab switching ───────────────────────────────────

(function initDashboardTabs() {
  const STORAGE_KEY = 'dashboardActiveTab';
  const tabBtns = Array.from(document.querySelectorAll('.dashboard-tab-btn'));
  const panels = Array.from(document.querySelectorAll('.dashboard-tab-panel'));

  function activateTab(panelId) {
    tabBtns.forEach((btn) => {
      const isTarget = btn.dataset.panel === panelId;
      btn.classList.toggle('active', isTarget);
      btn.setAttribute('aria-selected', String(isTarget));
    });
    panels.forEach((panel) => {
      panel.classList.toggle('hidden', panel.id !== panelId);
    });
    try {
      sessionStorage.setItem(STORAGE_KEY, panelId);
    } catch {
      // ignore
    }
    if (panelId === 'panel-dashboard') {
      loadAllReservations();
    }
  }

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => activateTab(btn.dataset.panel));
  });

  // restore last tab or default to panel-dashboard
  let initial = 'panel-dashboard';
  let hasExplicitTab = false;
  try {
    const requested = String(new URLSearchParams(window.location.search).get('tab') || '').trim();
    if (requested && document.getElementById(requested)) {
      initial = requested;
      hasExplicitTab = true;
    }
  } catch {
    // ignore
  }
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (!hasExplicitTab && initial === 'panel-dashboard' && saved && document.getElementById(saved)) {
      initial = saved;
    }
  } catch {
    // ignore
  }
  activateTab(initial);
})();

// ── Consolidated reservations (Ops tab) ──────────────────────

async function loadAllReservations() {
  const tbody = document.getElementById('allReservationsTableBody');
  const msgEl = document.getElementById('allReservationsMessage');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="6">Loading...</td></tr>';
  if (msgEl) {
    msgEl.textContent = '';
    msgEl.className = 'message';
  }

  try {
    const res = await fetch('/api/shared-resources/all-reservations');
    if (res.status === 401) {
      window.location.href = '/';
      return;
    }
    if (res.status === 403) {
      tbody.innerHTML = '<tr><td colspan="6">Access restricted.</td></tr>';
      return;
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to load reservations.');
    }

    const reservations = Array.isArray(data.reservations) ? data.reservations : [];
    if (!reservations.length) {
      tbody.innerHTML = '<tr><td colspan="6">No reservations found.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    reservations.forEach((row) => {
      const tr = document.createElement('tr');

      const resourceCell = document.createElement('td');
      resourceCell.textContent = row.resource_short_description || ('Resource #' + row.shared_resource_id);

      const guestCell = document.createElement('td');
      guestCell.textContent = ((row.first_name || '') + ' ' + (row.family_name || '')).trim() || row.email_address || '—';

      const startCell = document.createElement('td');
      startCell.textContent = row.requested_start_at ? new Date(row.requested_start_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—';

      const endCell = document.createElement('td');
      endCell.textContent = row.requested_end_at ? new Date(row.requested_end_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—';

      const statusCell = document.createElement('td');
      statusCell.textContent = row.status || '—';

      const actionCell = document.createElement('td');
      const actionsWrap = document.createElement('div');
      actionsWrap.className = 'feed-actions';

      const deleteBtn = createSharedReservationActionButton('✖', 'Delete Reservation', 'resource-delete-btn', () => {
        deleteSharedReservation(row.shared_resource_id, row.id, deleteBtn);
      });

      const statusText = String(row.status || '').trim();
      if (statusText === 'cash') {
        const confirmCashBtn = createSharedReservationActionButton('◍◍$', 'Register Cash Payment Received', 'resource-pay-cash-btn', () => {
          confirmSharedReservationPayment(row.shared_resource_id, row.id, 'Cash Received', confirmCashBtn);
        });
        actionsWrap.appendChild(confirmCashBtn);
      } else if (statusText === 'Awaiting Bank Transfer') {
        const confirmBankBtn = createSharedReservationActionButton('⌂⇄', 'Register Bank Transfer Received', 'resource-pay-bank-btn', () => {
          confirmSharedReservationPayment(row.shared_resource_id, row.id, 'Bank Transfer Confirmed', confirmBankBtn);
        });
        actionsWrap.appendChild(confirmBankBtn);
      }

      actionsWrap.appendChild(deleteBtn);

      actionCell.appendChild(actionsWrap);

      tr.appendChild(resourceCell);
      tr.appendChild(guestCell);
      tr.appendChild(startCell);
      tr.appendChild(endCell);
      tr.appendChild(statusCell);
      tr.appendChild(actionCell);
      tbody.appendChild(tr);
    });
  } catch (err) {
    if (msgEl) {
      msgEl.textContent = err.message || 'Failed to load reservations.';
      msgEl.className = 'message error';
    }
    tbody.innerHTML = '<tr><td colspan="6">—</td></tr>';
  }
}


// -- Tab context menu ------------------------------------------

(function initTabContextMenu() {
  const TAB_SUBMENUS = {
    'panel-dashboard': [
      { label: 'New Private Reservation', href: '/private-reservation.html' },
      { label: 'New Facility Booking', href: '/resource-booking.html' }
    ],
    'panel-config': [],
    'panel-ops': [],
    'panel-account': []
  };

  const menuBtn = document.getElementById('tabMenuBtn');
  const menuEl = document.getElementById('tabContextMenu');
  if (!menuBtn || !menuEl) return;

  function getActivePanel() {
    const active = document.querySelector('.dashboard-tab-btn.active');
    return active ? active.dataset.panel : 'panel-dashboard';
  }

  function buildMenu(panelId) {
    const items = TAB_SUBMENUS[panelId] || [];
    if (!items.length) {
      menuEl.innerHTML = '<span class="tab-context-menu-empty">No actions for this section.</span>';
    } else {
      menuEl.innerHTML = items.map(function(item) {
        return '<a class="tab-context-menu-item" href="' + item.href + '">' + item.label + '</a>';
      }).join('');
    }
  }

  function openMenu() {
    buildMenu(getActivePanel());
    menuEl.classList.remove('hidden');
    menuBtn.setAttribute('aria-expanded', 'true');
    menuBtn.classList.add('open');
  }

  function closeMenu() {
    menuEl.classList.add('hidden');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.classList.remove('open');
  }

  menuBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    if (menuEl.classList.contains('hidden')) {
      openMenu();
    } else {
      closeMenu();
    }
  });

  document.addEventListener('click', function() { closeMenu(); });

  menuEl.addEventListener('click', function(e) {
    const item = e.target.closest('.tab-context-menu-item');
    if (item) { closeMenu(); }
  });

  // Rebuild submenu if user changes tab while menu is open
  document.querySelectorAll('.dashboard-tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      if (!menuEl.classList.contains('hidden')) {
        buildMenu(btn.dataset.panel);
      }
    });
  });
})();

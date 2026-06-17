'use strict';

const params = new URLSearchParams(window.location.search);
const resourceIdParam = Number(params.get('id'));
const isCreateMode = String(params.get('new') || '').trim() === '1' || !(Number.isInteger(resourceIdParam) && resourceIdParam > 0);
let resourceId = Number.isInteger(resourceIdParam) && resourceIdParam > 0 ? resourceIdParam : null;
let canEditSharedResource = false;
let currentProperties = [];
let currentListings = [];
let initialSharedResourceFormState = '';
let suppressBeforeunload = false;
const SHARED_RESOURCE_DRAFT_KEY = 'sharedResourceDraftState';
let activePaymentMessageKey = 'free_of_charge';
let currentPaymentMessages = {
  free_of_charge: '',
  cash_on_site: '',
  bank_transfer: '',
  online_payment: ''
};
let currentChargeConfig = {
  chargeBasis: null,
  dailyChargeMode: null,
  dailyRate: '',
  hourlyChargeMode: null,
  hourlyRate: '',
  hourlyRates: Array.from({ length: 24 }, () => '')
};

function getSharedResourceFormState() {
  persistActivePaymentMessage();
  return JSON.stringify({
    shortDescription: String(document.getElementById('shortDescription').value || ''),
    resourceType: String(document.getElementById('resourceType').value || ''),
    fullDescriptionHtml: String(getEditorHtml() || ''),
    maxUnits: String(document.getElementById('maxUnits').value || ''),
    maxDaysAdvanceBooking: String(document.getElementById('maxDaysAdvanceBooking').value || ''),
    propertyId: String(document.getElementById('sharedResourcePropertyId').value || ''),
    listingId: String(document.getElementById('sharedResourceListingId').value || ''),
    freeOfCharge: document.getElementById('paymentFreeOfCharge').checked,
    cashOnSite: document.getElementById('paymentCashOnSite').checked,
    bankTransfer: document.getElementById('paymentBankTransfer').checked,
    onlinePayment: document.getElementById('paymentOnlinePayment').checked,
    paymentMessages: {
      free_of_charge: currentPaymentMessages.free_of_charge || '',
      cash_on_site: currentPaymentMessages.cash_on_site || '',
      bank_transfer: currentPaymentMessages.bank_transfer || '',
      online_payment: currentPaymentMessages.online_payment || ''
    },
    chargeConfig: currentChargeConfig
  });
}

function hasUnsavedSharedResourceChanges() {
  return getSharedResourceFormState() !== initialSharedResourceFormState;
}

function confirmDiscardSharedResourceChanges() {
  if (!hasUnsavedSharedResourceChanges()) {
    return true;
  }
  return window.confirm('You have unsaved changes. Cancel changes and continue?');
}

function goBackToConfig() {
  suppressBeforeunload = true;
  window.location.href = '/dashboard.html?tab=panel-config';
}

function buildSharedResourceDraft() {
  persistActivePaymentMessage();
  return {
    resourceId,
    isCreateMode,
    shortDescription: String(document.getElementById('shortDescription').value || ''),
    resourceType: String(document.getElementById('resourceType').value || ''),
    fullDescriptionHtml: String(getEditorHtml() || ''),
    maxUnits: String(document.getElementById('maxUnits').value || ''),
    maxDaysAdvanceBooking: String(document.getElementById('maxDaysAdvanceBooking').value || ''),
    propertyId: String(document.getElementById('sharedResourcePropertyId').value || ''),
    listingId: String(document.getElementById('sharedResourceListingId').value || ''),
    freeOfCharge: document.getElementById('paymentFreeOfCharge').checked,
    cashOnSite: document.getElementById('paymentCashOnSite').checked,
    bankTransfer: document.getElementById('paymentBankTransfer').checked,
    onlinePayment: document.getElementById('paymentOnlinePayment').checked,
    activePaymentMessageKey,
    paymentMessages: {
      free_of_charge: currentPaymentMessages.free_of_charge || '',
      cash_on_site: currentPaymentMessages.cash_on_site || '',
      bank_transfer: currentPaymentMessages.bank_transfer || '',
      online_payment: currentPaymentMessages.online_payment || ''
    },
    chargeConfig: {
      chargeBasis: currentChargeConfig.chargeBasis,
      dailyChargeMode: currentChargeConfig.dailyChargeMode,
      dailyRate: currentChargeConfig.dailyRate,
      hourlyChargeMode: currentChargeConfig.hourlyChargeMode,
      hourlyRate: currentChargeConfig.hourlyRate,
      hourlyRates: ensureHourlyRatesLength(currentChargeConfig.hourlyRates)
    }
  };
}

function saveSharedResourceDraft() {
  try {
    sessionStorage.setItem(SHARED_RESOURCE_DRAFT_KEY, JSON.stringify(buildSharedResourceDraft()));
  } catch {
    // ignore storage failures
  }
}

function readSharedResourceDraft() {
  try {
    const raw = sessionStorage.getItem(SHARED_RESOURCE_DRAFT_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    if (Boolean(parsed.isCreateMode) !== Boolean(isCreateMode)) {
      return null;
    }
    if (!isCreateMode && Number(parsed.resourceId) !== Number(resourceId)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearSharedResourceDraft() {
  try {
    sessionStorage.removeItem(SHARED_RESOURCE_DRAFT_KEY);
  } catch {
    // ignore storage failures
  }
}

function applySharedResourceDraft(draft) {
  if (!draft) {
    return false;
  }

  if (Object.prototype.hasOwnProperty.call(draft, 'shortDescription')) {
    document.getElementById('shortDescription').value = String(draft.shortDescription || '');
  }
  if (Object.prototype.hasOwnProperty.call(draft, 'resourceType')) {
    document.getElementById('resourceType').value = draft.resourceType === 'parking' ? 'parking' : 'undefined';
  }
  if (Object.prototype.hasOwnProperty.call(draft, 'fullDescriptionHtml')) {
    document.getElementById('fullDescriptionEditor').innerHTML = String(draft.fullDescriptionHtml || '');
  }
  if (Object.prototype.hasOwnProperty.call(draft, 'maxUnits')) {
    document.getElementById('maxUnits').value = String(draft.maxUnits || '1');
  }
  if (Object.prototype.hasOwnProperty.call(draft, 'maxDaysAdvanceBooking')) {
    document.getElementById('maxDaysAdvanceBooking').value = String(draft.maxDaysAdvanceBooking || '365');
  }
  if (Object.prototype.hasOwnProperty.call(draft, 'propertyId')) {
    document.getElementById('sharedResourcePropertyId').value = String(draft.propertyId || '');
  }
  if (Object.prototype.hasOwnProperty.call(draft, 'listingId')) {
    renderListingOptions(draft.listingId ? Number(draft.listingId) : null);
    document.getElementById('sharedResourceListingId').value = String(draft.listingId || '');
  }
  if (Object.prototype.hasOwnProperty.call(draft, 'freeOfCharge')) {
    document.getElementById('paymentFreeOfCharge').checked = draft.freeOfCharge === true;
  }
  if (Object.prototype.hasOwnProperty.call(draft, 'cashOnSite')) {
    document.getElementById('paymentCashOnSite').checked = draft.cashOnSite === true;
  }
  if (Object.prototype.hasOwnProperty.call(draft, 'bankTransfer')) {
    document.getElementById('paymentBankTransfer').checked = draft.bankTransfer === true;
  }
  if (Object.prototype.hasOwnProperty.call(draft, 'onlinePayment')) {
    document.getElementById('paymentOnlinePayment').checked = draft.onlinePayment === true;
  }

  if (Object.prototype.hasOwnProperty.call(draft, 'paymentMessages')) {
    currentPaymentMessages = {
      free_of_charge: (draft.paymentMessages && draft.paymentMessages.free_of_charge) || '',
      cash_on_site: (draft.paymentMessages && draft.paymentMessages.cash_on_site) || '',
      bank_transfer: (draft.paymentMessages && draft.paymentMessages.bank_transfer) || '',
      online_payment: (draft.paymentMessages && draft.paymentMessages.online_payment) || ''
    };
  }
  if (Object.prototype.hasOwnProperty.call(draft, 'activePaymentMessageKey')) {
    activePaymentMessageKey = draft.activePaymentMessageKey || 'free_of_charge';
  }
  if (Object.prototype.hasOwnProperty.call(draft, 'chargeConfig')) {
    currentChargeConfig = {
      chargeBasis: (draft.chargeConfig && draft.chargeConfig.chargeBasis) || null,
      dailyChargeMode: (draft.chargeConfig && draft.chargeConfig.dailyChargeMode) || null,
      dailyRate: (draft.chargeConfig && draft.chargeConfig.dailyRate) || '',
      hourlyChargeMode: (draft.chargeConfig && draft.chargeConfig.hourlyChargeMode) || null,
      hourlyRate: (draft.chargeConfig && draft.chargeConfig.hourlyRate) || '',
      hourlyRates: ensureHourlyRatesLength((draft.chargeConfig && draft.chargeConfig.hourlyRates) || [])
    };
  }

  syncPaymentOptionState();
  setPaymentMessageEditorHtml(currentPaymentMessages[activePaymentMessageKey] || '');
  renderChargeConfigSummary();
  return true;
}

function setSharedResourceMessage(text, isError) {
  const el = document.getElementById('sharedResourceMessage');
  el.textContent = text;
  el.className = text ? 'message ' + (isError ? 'error' : 'success') : 'message';
}

function applySharedResourceAccess(role) {
  canEditSharedResource = role === 'Manager' || role === 'Client';

  const form = document.getElementById('sharedResourceForm');
  if (form) {
    Array.from(form.querySelectorAll('input, select, textarea, button, [contenteditable="true"]')).forEach((el) => {
      if (el.id === 'bookingPageUrl' || el.id === 'copyBookingPageUrlBtn') {
        return;
      }

      if (el.id === 'fullDescriptionEditor' || el.id === 'paymentMessageEditor') {
        el.contentEditable = canEditSharedResource ? 'true' : 'false';
        return;
      }

      el.disabled = !canEditSharedResource;
    });
  }

  const saveBtn = document.getElementById('saveSharedResourceBtn');
  const deleteBtn = document.getElementById('deleteSharedResourceBtn');
  const cancelBtn = document.getElementById('cancelSharedResourceBtn');
  if (saveBtn) saveBtn.disabled = !canEditSharedResource;
  if (deleteBtn) deleteBtn.disabled = !canEditSharedResource;
  if (cancelBtn) cancelBtn.disabled = !canEditSharedResource;

  if (!canEditSharedResource) {
    setSharedResourceMessage('Read-only access: your current role can view this resource but cannot edit it.', false);
  }
}

function getEditorHtml() {
  return document.getElementById('fullDescriptionEditor').innerHTML.trim();
}

function buildBookingPageUrl() {
  if (!Number.isInteger(resourceId) || resourceId <= 0) {
    return '';
  }
  return window.location.origin + '/public-pages/booking.html?resourceId=' + encodeURIComponent(resourceId);
}

function setBookingPageUrl() {
  const input = document.getElementById('bookingPageUrl');
  const copyBtn = document.getElementById('copyBookingPageUrlBtn');
  const url = buildBookingPageUrl();
  input.value = url;
  copyBtn.disabled = !url;
}

function applyEditorCommand(command, editorId) {
  const targetEditorId = editorId || 'fullDescriptionEditor';
  const editor = document.getElementById(targetEditorId);
  if (!editor) {
    return;
  }
  editor.focus();
  document.execCommand(command, false, null);
  editor.focus();
}

function getPaymentMessageEditorHtml() {
  const editor = document.getElementById('paymentMessageEditor');
  if (!editor) {
    return '';
  }
  return editor.innerHTML.trim();
}

function setPaymentMessageEditorHtml(value) {
  const editor = document.getElementById('paymentMessageEditor');
  if (!editor) {
    return;
  }
  editor.innerHTML = value || '';
}

function persistActivePaymentMessage() {
  currentPaymentMessages[activePaymentMessageKey] = getPaymentMessageEditorHtml();
}

function getPaymentOptionEnabledMap() {
  return {
    free_of_charge: document.getElementById('paymentFreeOfCharge').checked,
    cash_on_site: document.getElementById('paymentCashOnSite').checked,
    bank_transfer: document.getElementById('paymentBankTransfer').checked,
    online_payment: document.getElementById('paymentOnlinePayment').checked
  };
}

function activatePaymentMessageTab(nextKey) {
  if (!nextKey) {
    return;
  }
  persistActivePaymentMessage();
  activePaymentMessageKey = nextKey;
  setPaymentMessageEditorHtml(currentPaymentMessages[activePaymentMessageKey] || '');

  const tabs = Array.from(document.querySelectorAll('.resource-payment-tab'));
  tabs.forEach((tab) => {
    const isActive = tab.getAttribute('data-payment-tab') === activePaymentMessageKey;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}

function syncPaymentMessageTabs() {
  const enabled = getPaymentOptionEnabledMap();
  const tabs = Array.from(document.querySelectorAll('.resource-payment-tab'));
  const editor = document.getElementById('paymentMessageEditor');

  tabs.forEach((tab) => {
    const key = tab.getAttribute('data-payment-tab');
    const isEnabled = enabled[key] === true;
    tab.disabled = !isEnabled;
    tab.classList.toggle('disabled', !isEnabled);
  });

  if (!enabled[activePaymentMessageKey]) {
    const fallbackKey = ['free_of_charge', 'cash_on_site', 'bank_transfer', 'online_payment'].find((key) => enabled[key]);
    activePaymentMessageKey = fallbackKey || 'free_of_charge';
  }

  if (editor) {
    editor.setAttribute('aria-disabled', enabled[activePaymentMessageKey] ? 'false' : 'true');
  }

  activatePaymentMessageTab(activePaymentMessageKey);
}

function getChargeDialog() {
  return document.getElementById('chargeConfigDialog');
}

function createDefaultHourlyRates() {
  return Array.from({ length: 24 }, () => '');
}

function ensureHourlyRatesLength(values) {
  const next = Array.isArray(values) ? values.slice(0, 24) : [];
  while (next.length < 24) {
    next.push('');
  }
  return next.map((value) => (value === null || value === undefined ? '' : String(value)));
}

function renderChargeConfigSummary() {
  const summary = document.getElementById('chargeConfigSummary');
  if (document.getElementById('paymentFreeOfCharge').checked) {
    summary.textContent = 'No charge configuration needed while Free Of Charge is selected.';
    return;
  }

  if (currentChargeConfig.chargeBasis === 'daily') {
    const rateSuffix = currentChargeConfig.dailyRate ? (' at ' + currentChargeConfig.dailyRate + ' per day') : '';
    if (currentChargeConfig.dailyChargeMode === 'per_24_hours') {
      summary.textContent = 'Daily charge basis: Per 24 hours' + rateSuffix + '.';
      return;
    }
    if (currentChargeConfig.dailyChargeMode === 'per_calendar_day') {
      summary.textContent = 'Daily charge basis: Per Calendar Day' + rateSuffix + '.';
      return;
    }
  }

  if (currentChargeConfig.chargeBasis === 'hourly') {
    if (currentChargeConfig.hourlyChargeMode === 'single_rate' && currentChargeConfig.hourlyRate !== '') {
      summary.textContent = 'Hourly charge basis: simple rate of ' + currentChargeConfig.hourlyRate + ' per hour.';
      return;
    }
    if (currentChargeConfig.hourlyChargeMode === 'per_hour_of_day') {
      summary.textContent = 'Hourly charge basis: separate rate configured for each hour of the day.';
      return;
    }
  }

  summary.textContent = 'Charge configuration not set.';
}

function syncChargeDialogVisibility() {
  const chargeBasis = document.querySelector('input[name="chargeBasis"]:checked');
  const basisValue = chargeBasis ? chargeBasis.value : null;
  const dailyWrap = document.getElementById('dailyChargeOptions');
  const hourlyWrap = document.getElementById('hourlyChargeOptions');
  const singleWrap = document.getElementById('singleHourlyRateWrap');
  const hourlyGrid = document.getElementById('hourlyRateGrid');
  const dailyModeInputs = Array.from(document.querySelectorAll('input[name="dailyChargeMode"]'));
  const hourlyModeInputs = Array.from(document.querySelectorAll('input[name="hourlyChargeMode"]'));
  const dailyRateInput = document.getElementById('dailyRate');
  const singleHourlyRate = document.getElementById('singleHourlyRate');
  const hourlyGridInputs = Array.from(document.querySelectorAll('#hourlyRateGrid input'));
  const hourlyChargeMode = document.querySelector('input[name="hourlyChargeMode"]:checked');

  const dailyDisabled = basisValue === 'hourly';
  const hourlyDisabled = basisValue === 'daily';

  dailyWrap.classList.remove('hidden');
  hourlyWrap.classList.remove('hidden');
  dailyWrap.classList.toggle('resource-dialog-fieldset-disabled', dailyDisabled);
  hourlyWrap.classList.toggle('resource-dialog-fieldset-disabled', hourlyDisabled);

  dailyModeInputs.forEach((input) => {
    input.disabled = dailyDisabled;
  });
  dailyRateInput.disabled = dailyDisabled;

  hourlyModeInputs.forEach((input) => {
    input.disabled = hourlyDisabled;
  });
  singleHourlyRate.disabled = hourlyDisabled || !hourlyChargeMode || hourlyChargeMode.value !== 'single_rate';
  hourlyGridInputs.forEach((input) => {
    input.disabled = hourlyDisabled || !hourlyChargeMode || hourlyChargeMode.value !== 'per_hour_of_day';
  });

  singleWrap.classList.toggle('hidden', !hourlyChargeMode || hourlyChargeMode.value !== 'single_rate');
  hourlyGrid.classList.toggle('hidden', !hourlyChargeMode || hourlyChargeMode.value !== 'per_hour_of_day');
}

function renderHourlyRateGrid() {
  const container = document.getElementById('hourlyRateGrid');
  container.innerHTML = '';

  ensureHourlyRatesLength(currentChargeConfig.hourlyRates).forEach((value, index) => {
    const row = document.createElement('div');
    row.className = 'resource-hourly-row';

    const label = document.createElement('label');
    label.setAttribute('for', 'hourlyRate_' + index);
    label.textContent = String(index).padStart(2, '0') + ':00';

    const input = document.createElement('input');
    input.id = 'hourlyRate_' + index;
    input.type = 'number';
    input.min = '0';
    input.step = '0.01';
    input.inputMode = 'decimal';
    input.value = value;
    input.addEventListener('input', () => {
      currentChargeConfig.hourlyRates[index] = input.value;
    });

    row.appendChild(label);
    row.appendChild(input);
    container.appendChild(row);
  });
}

function populateChargeDialogFromState() {
  const dailyRadio = document.getElementById('chargeBasisDaily');
  const hourlyRadio = document.getElementById('chargeBasisHourly');
  dailyRadio.checked = currentChargeConfig.chargeBasis === 'daily';
  hourlyRadio.checked = currentChargeConfig.chargeBasis === 'hourly';

  document.getElementById('dailyChargePer24Hours').checked = currentChargeConfig.dailyChargeMode === 'per_24_hours';
  document.getElementById('dailyChargePerCalendarDay').checked = currentChargeConfig.dailyChargeMode === 'per_calendar_day';
  document.getElementById('dailyRate').value = currentChargeConfig.dailyRate;
  document.getElementById('hourlyChargeSingleRate').checked = currentChargeConfig.hourlyChargeMode === 'single_rate';
  document.getElementById('hourlyChargePerHourOfDay').checked = currentChargeConfig.hourlyChargeMode === 'per_hour_of_day';
  document.getElementById('singleHourlyRate').value = currentChargeConfig.hourlyRate;
  currentChargeConfig.hourlyRates = ensureHourlyRatesLength(currentChargeConfig.hourlyRates);
  renderHourlyRateGrid();
  syncChargeDialogVisibility();
}

function readChargeDialogState() {
  const chargeBasis = document.querySelector('input[name="chargeBasis"]:checked');
  const dailyChargeMode = document.querySelector('input[name="dailyChargeMode"]:checked');
  const hourlyChargeMode = document.querySelector('input[name="hourlyChargeMode"]:checked');

  return {
    chargeBasis: chargeBasis ? chargeBasis.value : null,
    dailyChargeMode: dailyChargeMode ? dailyChargeMode.value : null,
    dailyRate: document.getElementById('dailyRate').value.trim(),
    hourlyChargeMode: hourlyChargeMode ? hourlyChargeMode.value : null,
    hourlyRate: document.getElementById('singleHourlyRate').value.trim(),
    hourlyRates: Array.from(document.querySelectorAll('#hourlyRateGrid input')).map((input) => input.value.trim())
  };
}

function validateChargeConfigDraft(draft) {
  if (document.getElementById('paymentFreeOfCharge').checked) {
    return {
      chargeBasis: null,
      dailyChargeMode: null,
      dailyRate: '',
      hourlyChargeMode: null,
      hourlyRate: '',
      hourlyRates: createDefaultHourlyRates()
    };
  }

  if (!draft.chargeBasis) {
    return { error: 'Select a charge basis.' };
  }

  if (draft.chargeBasis === 'daily') {
    if (!draft.dailyChargeMode) {
      return { error: 'Select either Per 24 hours or Per Calendar Day.' };
    }
    const dailyRateValue = draft.dailyRate === '' ? null : Number(draft.dailyRate);
    if (dailyRateValue === null || !Number.isFinite(dailyRateValue) || dailyRateValue < 0) {
      return { error: 'Enter a valid daily rate.' };
    }
    return {
      chargeBasis: 'daily',
      dailyChargeMode: draft.dailyChargeMode,
      dailyRate: dailyRateValue.toFixed(2),
      hourlyChargeMode: null,
      hourlyRate: '',
      hourlyRates: createDefaultHourlyRates()
    };
  }

  if (!draft.hourlyChargeMode) {
    return { error: 'Select how hourly charging should work.' };
  }

  if (draft.hourlyChargeMode === 'single_rate') {
    const value = draft.hourlyRate === '' ? null : Number(draft.hourlyRate);
    if (value === null || !Number.isFinite(value) || value < 0) {
      return { error: 'Enter a valid hourly rate.' };
    }
    return {
      chargeBasis: 'hourly',
      dailyChargeMode: null,
      dailyRate: '',
      hourlyChargeMode: 'single_rate',
      hourlyRate: value.toFixed(2),
      hourlyRates: createDefaultHourlyRates()
    };
  }

  const hourlyRates = ensureHourlyRatesLength(draft.hourlyRates);
  const invalid = hourlyRates.some((value) => {
    if (value === '') {
      return true;
    }
    const numeric = Number(value);
    return !Number.isFinite(numeric) || numeric < 0;
  });
  if (invalid) {
    return { error: 'Enter a valid hourly rate for each of the 24 hours.' };
  }

  return {
    chargeBasis: 'hourly',
    dailyChargeMode: null,
    dailyRate: '',
    hourlyChargeMode: 'per_hour_of_day',
    hourlyRate: '',
    hourlyRates: hourlyRates.map((value) => Number(value).toFixed(2))
  };
}

function syncCurrentChargeConfigFromDialog() {
  const draft = readChargeDialogState();
  currentChargeConfig = {
    chargeBasis: draft.chargeBasis,
    dailyChargeMode: draft.dailyChargeMode,
    dailyRate: draft.dailyRate,
    hourlyChargeMode: draft.hourlyChargeMode,
    hourlyRate: draft.hourlyRate,
    hourlyRates: ensureHourlyRatesLength(draft.hourlyRates)
  };
  renderChargeConfigSummary();
}

function requestSharedResourceSave() {
  const form = document.getElementById('sharedResourceForm');
  if (!form) {
    return;
  }
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function syncChargeConfigAvailability() {
  const disabled = document.getElementById('paymentFreeOfCharge').checked;
  const button = document.getElementById('openChargeConfigBtn');
  button.disabled = disabled;
  if (disabled) {
    currentChargeConfig = {
      chargeBasis: null,
      dailyChargeMode: null,
      dailyRate: '',
      hourlyChargeMode: null,
      hourlyRate: '',
      hourlyRates: createDefaultHourlyRates()
    };
    const dialog = getChargeDialog();
    if (dialog.open) {
      dialog.close();
    }
  }
  renderChargeConfigSummary();
}

function syncPaymentOptionState() {
  const freeCheckbox = document.getElementById('paymentFreeOfCharge');
  const otherIds = ['paymentCashOnSite', 'paymentBankTransfer', 'paymentOnlinePayment'];
  const freeSelected = freeCheckbox.checked;

  otherIds.forEach((id) => {
    const checkbox = document.getElementById(id);
    const row = checkbox.closest('.resource-payment-option');
    checkbox.disabled = freeSelected;
    if (freeSelected) {
      checkbox.checked = false;
    }
    if (row) {
      row.classList.toggle('disabled', freeSelected);
    }
  });

  syncPaymentMessageTabs();
  syncChargeConfigAvailability();
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

function renderListingOptions(selectedListingId) {
  const propertyId = Number(document.getElementById('sharedResourcePropertyId').value || 0);
  const select = document.getElementById('sharedResourceListingId');
  select.innerHTML = '';

  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = 'All Listings';
  select.appendChild(allOption);

  const filteredListings = sortListingsByProperty((currentListings || []).filter((listing) => {
    if (!propertyId) {
      return true;
    }
    return Number(listing.property_id) === propertyId;
  }));

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
    setSharedResourceMessage('Facility not found.', true);
    return;
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load facility.');
  }

  const resource = data.resource;
  document.getElementById('sharedResourceTitle').textContent = 'Facility: ' + (resource.short_description || '');
  document.getElementById('shortDescription').value = resource.short_description || '';
  document.getElementById('resourceType').value = resource.resource_type === 'parking' ? 'parking' : 'undefined';
  document.getElementById('fullDescriptionEditor').innerHTML = resource.full_description_html || '';
  document.getElementById('maxUnits').value = Number(resource.max_units) > 0 ? Number(resource.max_units) : 1;
  const maxDaysAdvanceBooking = Number(resource.max_days_advance_booking);
  document.getElementById('maxDaysAdvanceBooking').value = Number.isInteger(maxDaysAdvanceBooking) && maxDaysAdvanceBooking >= 1 && maxDaysAdvanceBooking <= 365
    ? maxDaysAdvanceBooking
    : 365;
  renderPropertyOptions(Number(resource.property_id) || null);
  renderListingOptions(Number(resource.listing_id) || null);
  document.getElementById('paymentFreeOfCharge').checked = resource.free_of_charge === true;
  document.getElementById('paymentCashOnSite').checked = resource.cash_on_site === true;
  document.getElementById('paymentBankTransfer').checked = resource.bank_transfer === true;
  document.getElementById('paymentOnlinePayment').checked = resource.online_payment === true;
  currentPaymentMessages = {
    free_of_charge: resource.free_of_charge_message_html || '',
    cash_on_site: resource.cash_on_site_message_html || '',
    bank_transfer: resource.bank_transfer_message_html || '',
    online_payment: resource.online_payment_message_html || ''
  };
  activePaymentMessageKey = 'free_of_charge';
  currentChargeConfig = {
    chargeBasis: resource.charge_basis || null,
    dailyChargeMode: resource.daily_charge_mode || null,
    dailyRate: resource.daily_rate === null || resource.daily_rate === undefined ? '' : String(resource.daily_rate),
    hourlyChargeMode: resource.hourly_charge_mode || null,
    hourlyRate: resource.hourly_rate === null || resource.hourly_rate === undefined ? '' : String(resource.hourly_rate),
    hourlyRates: ensureHourlyRatesLength(resource.hourly_rates || [])
  };
  syncPaymentOptionState();
  setPaymentMessageEditorHtml(currentPaymentMessages[activePaymentMessageKey] || '');
  renderChargeConfigSummary();
}

function formatAdminDateTime(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value || '');
  }
  return parsed.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderAdminReservationsTable(reservations) {
  const body = document.getElementById('adminSharedReservationsBody');
  if (!body) {
    return;
  }

  const rows = Array.isArray(reservations) ? reservations : [];
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="6" class="public-resource-reservations-empty">No reservations yet.</td></tr>';
    return;
  }

  body.innerHTML = rows.map((row) => {
    const reservationId = row.reservation_identifier || String(row.id || '');
    const familyName = String(row.family_name || '');
    return '<tr>'
      + '<td>' + escapeHtml(reservationId) + '</td>'
      + '<td>' + formatAdminDateTime(row.requested_start_at) + '</td>'
      + '<td>' + formatAdminDateTime(row.requested_end_at) + '</td>'
      + '<td>' + escapeHtml(familyName) + '</td>'
      + '<td>' + escapeHtml(String(row.status || '')) + '</td>'
      + '<td><button type="button" class="btn secondary" data-edit-reservation-id="' + String(row.id || '') + '"' + (canEditSharedResource ? '' : ' disabled') + '>Edit Reservation</button></td>'
      + '</tr>';
  }).join('');
}

async function loadAdminReservations() {
  if (!resourceId) {
    return;
  }

  const msgEl = document.getElementById('adminReservationsMessage');
  try {
    const res = await fetch('/api/shared-resources/' + resourceId + '/reservations');
    const data = await res.json();
    if (!res.ok) {
      if (msgEl) {
        msgEl.textContent = data.error || 'Failed to load reservations.';
        msgEl.className = 'message error';
      }
      return;
    }
    renderAdminReservationsTable(data.reservations || []);
  } catch {
    if (msgEl) {
      msgEl.textContent = 'Network error loading reservations.';
      msgEl.className = 'message error';
    }
  }
}

(async () => {
  setBookingPageUrl();

  try {
    const meRes = await fetch('/api/me');
    if (!meRes.ok) {
      window.location.href = '/';
      return;
    }

    const meData = await meRes.json();
    const activeRole = String((meData && meData.accessContext && meData.accessContext.activeRole) || '');
    applySharedResourceAccess(activeRole);

    const loaded = await loadPropertiesAndListings();
    if (!loaded) {
      return;
    }

    const draft = readSharedResourceDraft();

    if (isCreateMode) {
      document.getElementById('sharedResourceTitle').textContent = 'Create Facility';
      document.getElementById('deleteSharedResourceBtn').classList.add('hidden');
      document.getElementById('maxUnits').value = '1';
      document.getElementById('maxDaysAdvanceBooking').value = '365';
      if (draft) {
        applySharedResourceDraft(draft);
      }
      initialSharedResourceFormState = getSharedResourceFormState();
    } else {
      await loadSharedResource();
      if (draft) {
        applySharedResourceDraft(draft);
      }
      initialSharedResourceFormState = getSharedResourceFormState();
    }
  } catch (err) {
    setSharedResourceMessage(err.message || 'Failed to load facility page.', true);
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

const adminSharedReservationsBody = document.getElementById('adminSharedReservationsBody');
if (adminSharedReservationsBody) {
  adminSharedReservationsBody.addEventListener('click', (event) => {
    const button = event.target && event.target.closest ? event.target.closest('button[data-edit-reservation-id]') : null;
    if (!button) {
      return;
    }
    const reservationId = Number(button.getAttribute('data-edit-reservation-id'));
    if (!Number.isInteger(reservationId) || reservationId <= 0) {
      return;
    }
    window.location.href = 'shared-resource-reservation-edit.html?resourceId=' + encodeURIComponent(resourceId) + '&reservationId=' + encodeURIComponent(reservationId);
  });
}

document.getElementById('paymentFreeOfCharge').addEventListener('change', () => {
  syncPaymentOptionState();
});

document.getElementById('openChargeConfigBtn').addEventListener('click', () => {
  saveSharedResourceDraft();
  suppressBeforeunload = true;
  const target = '/shared-resource-charge-config.html' + (isCreateMode
    ? '?new=1'
    : ('?id=' + encodeURIComponent(resourceId)));
  window.location.href = target;
});

document.getElementById('closeChargeConfigBtn').addEventListener('click', () => {
  getChargeDialog().close();
});

document.getElementById('copyBookingPageUrlBtn').addEventListener('click', async () => {
  const input = document.getElementById('bookingPageUrl');
  const value = input.value.trim();
  if (!value) {
    return;
  }

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      input.focus();
      input.select();
      document.execCommand('copy');
    }
    setSharedResourceMessage('Booking page URL copied.', false);
  } catch {
    setSharedResourceMessage('Could not copy booking page URL.', true);
  }
});

document.querySelectorAll('input[name="chargeBasis"]').forEach((input) => {
  input.addEventListener('change', () => {
    syncChargeDialogVisibility();
    syncCurrentChargeConfigFromDialog();
  });
});

document.querySelectorAll('input[name="dailyChargeMode"]').forEach((input) => {
  input.addEventListener('change', () => {
    syncCurrentChargeConfigFromDialog();
  });
});

document.querySelectorAll('input[name="hourlyChargeMode"]').forEach((input) => {
  input.addEventListener('change', () => {
    syncChargeDialogVisibility();
    syncCurrentChargeConfigFromDialog();
  });
});

document.getElementById('dailyRate').addEventListener('input', () => {
  syncCurrentChargeConfigFromDialog();
});

document.getElementById('singleHourlyRate').addEventListener('input', () => {
  syncCurrentChargeConfigFromDialog();
});

document.getElementById('saveChargeConfigBtn').addEventListener('click', () => {
  const validated = validateChargeConfigDraft(readChargeDialogState());
  if (validated.error) {
    setSharedResourceMessage(validated.error, true);
    return;
  }
  currentChargeConfig = validated;
  renderChargeConfigSummary();
  getChargeDialog().close();
  setSharedResourceMessage('Saving updated charge logic...', false);
  requestSharedResourceSave();
});

document.querySelectorAll('.editor-btn').forEach((button) => {
  button.addEventListener('click', () => {
    const command = button.getAttribute('data-command');
    if (command) {
      applyEditorCommand(command);
    }
  });
});

document.querySelectorAll('.payment-editor-btn').forEach((button) => {
  button.addEventListener('click', () => {
    const command = button.getAttribute('data-command');
    if (command) {
      applyEditorCommand(command, 'paymentMessageEditor');
    }
  });
});

document.querySelectorAll('.resource-payment-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    if (tab.disabled) {
      return;
    }
    activatePaymentMessageTab(tab.getAttribute('data-payment-tab'));
  });
});

['paymentCashOnSite', 'paymentBankTransfer', 'paymentOnlinePayment'].forEach((id) => {
  document.getElementById(id).addEventListener('change', () => {
    syncPaymentOptionState();
  });
});

document.getElementById('sharedResourceForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!canEditSharedResource) {
    setSharedResourceMessage('Read-only access: editing is not allowed for your role.', true);
    return;
  }

  const button = document.getElementById('saveSharedResourceBtn');
  const shortDescription = document.getElementById('shortDescription').value.trim();
  const resourceType = document.getElementById('resourceType').value === 'parking' ? 'parking' : 'undefined';
  const maxUnits = Number(document.getElementById('maxUnits').value);
  const maxDaysAdvanceBooking = Number(document.getElementById('maxDaysAdvanceBooking').value);
  const fullDescriptionHtml = getEditorHtml();
  const propertyId = document.getElementById('sharedResourcePropertyId').value || null;
  const listingId = document.getElementById('sharedResourceListingId').value || null;
  const freeOfCharge = document.getElementById('paymentFreeOfCharge').checked;
  const cashOnSite = document.getElementById('paymentCashOnSite').checked;
  const bankTransfer = document.getElementById('paymentBankTransfer').checked;
  const onlinePayment = document.getElementById('paymentOnlinePayment').checked;
  persistActivePaymentMessage();
  const validatedChargeConfig = validateChargeConfigDraft(currentChargeConfig);

  if (!shortDescription) {
    setSharedResourceMessage('Short description is required.', true);
    return;
  }

  if (!Number.isInteger(maxUnits) || maxUnits <= 0) {
    setSharedResourceMessage('Maximum units must be a whole number greater than zero.', true);
    return;
  }
  if (!Number.isInteger(maxDaysAdvanceBooking) || maxDaysAdvanceBooking < 1 || maxDaysAdvanceBooking > 365) {
    setSharedResourceMessage('Max days advance booking must be a whole number from 1 to 365.', true);
    return;
  }
  if (validatedChargeConfig.error) {
    setSharedResourceMessage(validatedChargeConfig.error, true);
    return;
  }

  currentChargeConfig = validatedChargeConfig;
  renderChargeConfigSummary();

  button.disabled = true;
  try {
    const endpoint = isCreateMode ? '/api/shared-resources' : ('/api/shared-resources/' + resourceId);
    const method = isCreateMode ? 'POST' : 'PUT';
    const res = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shortDescription,
        resourceType,
        fullDescriptionHtml,
        maxUnits,
        maxDaysAdvanceBooking,
        propertyId,
        listingId,
        freeOfCharge,
        cashOnSite,
        bankTransfer,
        onlinePayment,
        freeOfChargeMessageHtml: currentPaymentMessages.free_of_charge || '',
        cashOnSiteMessageHtml: currentPaymentMessages.cash_on_site || '',
        bankTransferMessageHtml: currentPaymentMessages.bank_transfer || '',
        onlinePaymentMessageHtml: currentPaymentMessages.online_payment || '',
        chargeBasis: validatedChargeConfig.chargeBasis,
        dailyChargeMode: validatedChargeConfig.dailyChargeMode,
        dailyRate: validatedChargeConfig.dailyRate,
        hourlyChargeMode: validatedChargeConfig.hourlyChargeMode,
        hourlyRate: validatedChargeConfig.hourlyRate,
        hourlyRates: validatedChargeConfig.hourlyRates
      })
    });
    const data = await res.json();

    if (!res.ok) {
      setSharedResourceMessage(data.error || 'Failed to save facility.', true);
      return;
    }

    const savedHourlyRates = (() => {
      if (Array.isArray(data.resource.hourly_rates_json)) {
        return data.resource.hourly_rates_json;
      }
      if (typeof data.resource.hourly_rates_json === 'string' && data.resource.hourly_rates_json.trim()) {
        try {
          const parsed = JSON.parse(data.resource.hourly_rates_json);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
      return [];
    })();

    currentChargeConfig = {
      chargeBasis: data.resource.charge_basis || null,
      dailyChargeMode: data.resource.daily_charge_mode || null,
      dailyRate: data.resource.daily_rate === null || data.resource.daily_rate === undefined ? '' : String(data.resource.daily_rate),
      hourlyChargeMode: data.resource.hourly_charge_mode || null,
      hourlyRate: data.resource.hourly_rate === null || data.resource.hourly_rate === undefined ? '' : String(data.resource.hourly_rate),
      hourlyRates: ensureHourlyRatesLength(savedHourlyRates)
    };
    renderChargeConfigSummary();

    if (isCreateMode) {
      const nextResourceId = Number(data && data.resource && data.resource.id);
      if (Number.isInteger(nextResourceId) && nextResourceId > 0) {
        clearSharedResourceDraft();
        suppressBeforeunload = true;
        goBackToConfig();
        return;
      }
    }

    document.getElementById('sharedResourceTitle').textContent = 'Facility: ' + (data.resource.short_description || '');
    initialSharedResourceFormState = getSharedResourceFormState();
    setSharedResourceMessage('Facility saved.', false);
    clearSharedResourceDraft();
  } catch {
    setSharedResourceMessage('Network error saving facility.', true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('deleteSharedResourceBtn').addEventListener('click', async () => {
  if (isCreateMode || !resourceId) {
    return;
  }

  if (!canEditSharedResource) {
    setSharedResourceMessage('Read-only access: deleting is not allowed for your role.', true);
    return;
  }

  const shortDescription = document.getElementById('shortDescription').value.trim() || 'this facility';
  const confirmed = window.confirm(
    'Are you sure you want to delete facility: ' + shortDescription + '?\n\nAll reservation data for this facility will be irrevocably lost.'
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
      setSharedResourceMessage(data.error || 'Failed to delete facility.', true);
      return;
    }

    goBackToConfig();
  } catch {
    setSharedResourceMessage('Network error deleting facility.', true);
  } finally {
    if (!window.location.href.includes('/dashboard.html')) {
      button.disabled = false;
    }
  }
});

document.getElementById('backBtn').addEventListener('click', () => {
  if (!confirmDiscardSharedResourceChanges()) {
    return;
  }
  goBackToConfig();
});

document.getElementById('cancelSharedResourceBtn').addEventListener('click', () => {
  if (!confirmDiscardSharedResourceChanges()) {
    return;
  }
  goBackToConfig();
});

window.addEventListener('beforeunload', (event) => {
  if (suppressBeforeunload) {
    return;
  }
  if (!hasUnsavedSharedResourceChanges()) {
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

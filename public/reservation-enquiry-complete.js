'use strict';

const RESERVATION_ENQUIRY_COMPLETION_KEY = 'reservationEnquiryCompletionContext';

function formatCompletionMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return '-';
  }
  return 'GBP ' + amount.toFixed(2);
}

function formatCompletionDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text || '-';
  }
  const dt = new Date(text + 'T00:00:00Z');
  if (!Number.isFinite(dt.getTime())) {
    return text;
  }
  return dt.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

function loadCompletionData() {
  const raw = window.sessionStorage.getItem(RESERVATION_ENQUIRY_COMPLETION_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

(function initCompletionPage() {
  const data = loadCompletionData();
  
  if (!data) {
    document.body.innerHTML = '<main class="dashboard"><div class="card-container wide"><h2>Error</h2><p>Completion data is missing. Please contact support.</p></div></main>';
    return;
  }

  document.getElementById('completionStay').textContent = formatCompletionDate(data.arrivalDate) + ' to ' + formatCompletionDate(data.departureDate);
  document.getElementById('completionGuests').textContent = String(data.guestCount || '');
  document.getElementById('completionOption').textContent = String(data.option && data.option.label || '');
  document.getElementById('completionAmount').textContent = formatCompletionMoney(data.totalAmount);

  if (data.bankAccount) {
    document.getElementById('completionAccountName').textContent = String(data.bankAccount.accountName || '');
    document.getElementById('completionAccountType').textContent = String(data.bankAccount.accountType || '');
    document.getElementById('completionSortCode').textContent = String(data.bankAccount.sortCode || '');
    document.getElementById('completionAccountNumber').textContent = String(data.bankAccount.accountNumber || '');
    document.getElementById('completionIban').textContent = String(data.bankAccount.iban || '');
    document.getElementById('completionBic').textContent = String(data.bankAccount.bic || '');
  }

  window.sessionStorage.removeItem(RESERVATION_ENQUIRY_COMPLETION_KEY);
})();

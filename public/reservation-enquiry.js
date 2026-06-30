'use strict';

const reservationEnquiryParams = new URLSearchParams(window.location.search);
const reservationEnquirySlug = String(reservationEnquiryParams.get('landingPage') || '').trim();
const RESERVATION_ENQUIRY_SELECTION_KEY = 'reservationEnquirySelectionContext';
let reservationEnquiryPage = null;
let reservationEnquiryCurrentMonth = (() => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
})();
let reservationEnquiryOptions = [];
let reservationEnquirySelectedOptionKey = '';
let reservationEnquiryLastSearch = null;

function setReservationEnquiryMessage(text, isError) {
  const el = document.getElementById('reservationEnquiryMessage');
  if (!el) {
    return;
  }
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function formatReservationEnquiryMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return '-';
  }
  return 'GBP ' + amount.toFixed(2);
}

function toDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + Number(days || 0));
  return next;
}

function eventOverlapsDay(event, dayKey) {
  const nextDay = addUtcDays(new Date(dayKey + 'T00:00:00Z'), 1).toISOString().slice(0, 10);
  const startKey = String(event && event.start || '').slice(0, 10);
  const endKey = String(event && event.end || '').slice(0, 10);
  if (!startKey || !endKey) {
    return false;
  }
  return startKey < nextDay && endKey > dayKey;
}

function renderReservationEnquiryCalendars() {
  const label = document.getElementById('reservationEnquiryMonthLabel');
  const grid = document.getElementById('reservationEnquiryCalendarGrid');
  if (!label || !grid || !reservationEnquiryPage) {
    return;
  }

  label.textContent = reservationEnquiryCurrentMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const monthStart = new Date(reservationEnquiryCurrentMonth.getTime());
  const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0));
  const weekdayOffset = (monthStart.getUTCDay() + 6) % 7;
  const daysInMonth = monthEnd.getUTCDate();
  const todayKey = new Date().toISOString().slice(0, 10);

  const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  grid.innerHTML = (reservationEnquiryPage.listing_calendars || []).map((calendar) => {
    const dayCells = [];
    for (let i = 0; i < weekdayOffset; i += 1) {
      dayCells.push('<div class="reservation-enquiry-day is-blank"></div>');
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dayDate = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), day));
      const dayKey = toDateKey(dayDate);
      const isPast = dayKey < todayKey;
      const blocked = (calendar.events || []).some((event) => eventOverlapsDay(event, dayKey));
      dayCells.push(
        '<div class="reservation-enquiry-day ' + (blocked ? 'is-unavailable' : 'is-available') + (isPast ? ' is-past' : '') + '">' + String(day) + '</div>'
      );
    }

    return ''
      + '<article class="reservation-enquiry-calendar-card">'
      +   '<div class="reservation-enquiry-calendar-title">' + String(calendar.listingName || '') + '</div>'
      +   '<p class="reservation-enquiry-calendar-subtitle">' + String(calendar.propertyName || '') + '</p>'
      +   '<div class="reservation-enquiry-weekdays">' + weekdayLabels.map((item) => '<span>' + item + '</span>').join('') + '</div>'
      +   '<div class="reservation-enquiry-days">' + dayCells.join('') + '</div>'
      + '</article>';
  }).join('');
}

function renderReservationEnquiryResults() {
  const section = document.getElementById('reservationEnquiryResultsSection');
  const body = document.getElementById('reservationEnquiryResultsBody');
  const discountHeader = document.getElementById('reservationEnquiryDiscountHeader');
  const summary = document.getElementById('reservationEnquirySelectionSummary');
  if (!section || !body || !discountHeader) {
    return;
  }

  const showDiscountColumn = Boolean(reservationEnquiryPage && reservationEnquiryPage.show_discount_column);
  section.classList.toggle('hidden', reservationEnquiryOptions.length === 0);
  discountHeader.classList.toggle('hidden', !showDiscountColumn);

  if (!reservationEnquiryOptions.length) {
    body.innerHTML = '';
    if (summary) {
      summary.textContent = 'No reservation option selected.';
    }
    return;
  }

  body.innerHTML = reservationEnquiryOptions.map((option, index) => {
    const optionLines = (option.segments || []).map((segment) => {
      const text = String(segment.propertyName || '') + ' / ' + String(segment.listingName || '') + ' (' + String(segment.arrivalDate || '') + ' to ' + String(segment.departureDate || '') + ')';
      return '<span class="reservation-enquiry-option-line">' + text + '</span>';
    }).join('');
    const viewButton = option.listingUrl
      ? '<button type="button" class="btn secondary reservation-enquiry-view-btn" data-view-url="' + String(option.listingUrl).replace(/"/g, '&quot;') + '" aria-label="Open listing details"></button>'
      : '';
    const discountCell = showDiscountColumn
      ? ('<td>' + formatReservationEnquiryMoney(option.discountedTotalPrice) + '</td>')
      : '';
    const checked = reservationEnquirySelectedOptionKey === option.key ? ' checked' : '';
    return ''
      + '<tr>'
      +   '<td>' + String(option.propertyName || '') + '</td>'
      +   '<td><div class="reservation-enquiry-option-lines">' + optionLines + '</div></td>'
      +   '<td>' + viewButton + '</td>'
      +   '<td>' + formatReservationEnquiryMoney(option.totalPrice) + '</td>'
      +   discountCell
      +   '<td><input class="reservation-enquiry-option-select" type="checkbox" data-option-index="' + String(index) + '"' + checked + ' /></td>'
      + '</tr>';
  }).join('');

  if (summary) {
    const selected = reservationEnquiryOptions.find((option) => option.key === reservationEnquirySelectedOptionKey);
    summary.textContent = selected ? ('Selected: ' + String(selected.label || 'Reservation option')) : 'No reservation option selected.';
  }
}

function getReservationEnquirySearchPayload() {
  const arrivalDate = String(document.getElementById('reservationEnquiryArrivalDate').value || '').trim();
  const departureDate = String(document.getElementById('reservationEnquiryDepartureDate').value || '').trim();
  const guestCount = Number(document.getElementById('reservationEnquiryGuestCount').value || 0);
  if (!arrivalDate) {
    return { error: 'Requested Arrival Date is required.' };
  }
  if (!departureDate) {
    return { error: 'Requested Departure Date is required.' };
  }
  if (departureDate <= arrivalDate) {
    return { error: 'Requested Departure Date must be after Requested Arrival Date.' };
  }
  if (!Number.isInteger(guestCount) || guestCount <= 0 || guestCount > 50) {
    return { error: 'Number of Guests is required.' };
  }
  return {
    payload: {
      arrivalDate,
      departureDate,
      guestCount
    }
  };
}

function persistReservationEnquirySelection(option) {
  if (!reservationEnquiryPage || !reservationEnquiryLastSearch || !option) {
    return;
  }
  const paymentPageUrl = '/reservation-enquiry-payment.html?landingPage=' + encodeURIComponent(String(reservationEnquiryPage.public_slug || ''));
  const payload = {
    slug: String(reservationEnquiryPage.public_slug || ''),
    paymentMethod: String(reservationEnquiryPage.payment_method || ''),
    optionKey: String(option.key || ''),
    option,
    arrivalDate: reservationEnquiryLastSearch.arrivalDate,
    departureDate: reservationEnquiryLastSearch.departureDate,
    guestCount: reservationEnquiryLastSearch.guestCount,
    title: String(reservationEnquiryPage.title || ''),
    descriptionHtml: String(reservationEnquiryPage.description_html || ''),
    notesHtml: String(reservationEnquiryPage.notes_html || ''),
    termsUrl: String(reservationEnquiryPage.terms_url || ''),
    paymentPageUrl
  };
  window.sessionStorage.setItem(RESERVATION_ENQUIRY_SELECTION_KEY, JSON.stringify(payload));
}

async function loadReservationEnquiryPage() {
  if (!reservationEnquirySlug) {
    setReservationEnquiryMessage('Reservation enquiry landing page is missing.', true);
    return;
  }

  const response = await fetch('/api/public/reservation-enquiry-landing-pages/' + encodeURIComponent(reservationEnquirySlug));
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to load reservation enquiry landing page.');
  }

  reservationEnquiryPage = data.landingPage || null;
  if (!reservationEnquiryPage) {
    throw new Error('Reservation enquiry landing page was not found.');
  }

  document.getElementById('reservationEnquiryTitle').textContent = String(reservationEnquiryPage.title || 'Reservation Enquiry');
  document.getElementById('reservationEnquiryDescription').innerHTML = String(reservationEnquiryPage.description_html || '');
  const notesSection = document.getElementById('reservationEnquiryNotesSection');
  const notesEl = document.getElementById('reservationEnquiryNotes');
  if (notesSection && notesEl) {
    const notesHtml = String(reservationEnquiryPage.notes_html || '').trim();
    notesSection.classList.toggle('hidden', !notesHtml);
    notesEl.innerHTML = notesHtml;
  }
  renderReservationEnquiryCalendars();
}

document.getElementById('reservationEnquiryPrevMonthBtn').addEventListener('click', () => {
  reservationEnquiryCurrentMonth = new Date(Date.UTC(reservationEnquiryCurrentMonth.getUTCFullYear(), reservationEnquiryCurrentMonth.getUTCMonth() - 1, 1));
  renderReservationEnquiryCalendars();
});

document.getElementById('reservationEnquiryNextMonthBtn').addEventListener('click', () => {
  reservationEnquiryCurrentMonth = new Date(Date.UTC(reservationEnquiryCurrentMonth.getUTCFullYear(), reservationEnquiryCurrentMonth.getUTCMonth() + 1, 1));
  renderReservationEnquiryCalendars();
});

document.getElementById('reservationEnquiryTermsBtn').addEventListener('click', () => {
  const url = reservationEnquiryPage && reservationEnquiryPage.terms_url ? String(reservationEnquiryPage.terms_url) : '/guest-terms-and-conditions.html';
  window.open(url, '_blank', 'noopener');
});

document.getElementById('reservationEnquirySearchForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = getReservationEnquirySearchPayload();
  if (result.error) {
    setReservationEnquiryMessage(result.error, true);
    return;
  }

  setReservationEnquiryMessage('Checking availability...', false);
  reservationEnquirySelectedOptionKey = '';

  try {
    const response = await fetch('/api/public/reservation-enquiry-landing-pages/' + encodeURIComponent(reservationEnquirySlug) + '/check-availability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result.payload)
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to check availability.');
    }

    reservationEnquiryLastSearch = result.payload;
    reservationEnquiryOptions = Array.isArray(data.options) ? data.options : [];
    renderReservationEnquiryResults();
    setReservationEnquiryMessage(
      reservationEnquiryOptions.length
        ? 'Availability loaded. Select one reservation option to continue.'
        : 'No single or split-stay option could accommodate the requested dates and guests.',
      false
    );
  } catch (err) {
    reservationEnquiryOptions = [];
    renderReservationEnquiryResults();
    setReservationEnquiryMessage(err.message || 'Failed to check availability.', true);
  }
});

document.getElementById('reservationEnquiryResultsBody').addEventListener('change', (event) => {
  const target = event.target;
  if (!target || !target.classList || !target.classList.contains('reservation-enquiry-option-select')) {
    return;
  }
  if (!target.checked) {
    reservationEnquirySelectedOptionKey = '';
    renderReservationEnquiryResults();
    return;
  }
  const index = Number(target.getAttribute('data-option-index'));
  const option = Number.isInteger(index) ? reservationEnquiryOptions[index] : null;
  reservationEnquirySelectedOptionKey = option ? String(option.key || '') : '';
  renderReservationEnquiryResults();
});

document.getElementById('reservationEnquiryResultsBody').addEventListener('click', (event) => {
  const target = event.target;
  if (!target || !target.classList || !target.classList.contains('reservation-enquiry-view-btn')) {
    return;
  }
  const url = String(target.getAttribute('data-view-url') || '').trim();
  if (url) {
    window.open(url, '_blank', 'noopener');
  }
});

document.getElementById('reservationEnquiryClearSelectionBtn').addEventListener('click', () => {
  reservationEnquirySelectedOptionKey = '';
  renderReservationEnquiryResults();
  setReservationEnquiryMessage('Reservation option selection cleared.', false);
});

document.getElementById('reservationEnquiryContinueBtn').addEventListener('click', () => {
  const selected = reservationEnquiryOptions.find((option) => option.key === reservationEnquirySelectedOptionKey) || null;
  if (!selected) {
    setReservationEnquiryMessage('Select exactly one reservation option to continue.', true);
    return;
  }
  persistReservationEnquirySelection(selected);
  window.location.href = '/reservation-enquiry-payment.html?landingPage=' + encodeURIComponent(reservationEnquirySlug);
});

(async () => {
  try {
    await loadReservationEnquiryPage();
  } catch (err) {
    setReservationEnquiryMessage(err.message || 'Failed to load reservation enquiry page.', true);
  }
})();
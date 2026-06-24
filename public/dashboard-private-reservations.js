'use strict';

function setMessage(text, isError) {
  const el = document.getElementById('dashboardPageMessage');
  if (!el) {
    return;
  }
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function setPrivateReservationsMessage(text, isError) {
  const el = document.getElementById('privateReservationsMessage');
  if (!el) {
    return;
  }
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function formatPrivateReservationArrival(dateValue) {
  const value = String(dateValue || '').trim();
  if (!value) {
    return '-';
  }
  const parsed = new Date(value + 'T00:00:00');
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString([], { dateStyle: 'medium' });
}

function formatPrivateReservationAmount(amount) {
  const numeric = Number(amount);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : '-';
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
      reservationIdCell.textContent = reservation.reservationIdentifier || '-';

      const guestCell = document.createElement('td');
      guestCell.textContent = reservation.guestName || '-';

      const listingCell = document.createElement('td');
      listingCell.textContent = reservation.listingName || '-';

      const arrivalCell = document.createElement('td');
      arrivalCell.textContent = formatPrivateReservationArrival(reservation.arrivalDate);

      const nightsCell = document.createElement('td');
      nightsCell.textContent = String(Number(reservation.stayNights || 0) || 0);

      const amountCell = document.createElement('td');
      amountCell.textContent = formatPrivateReservationAmount(reservation.amount);

      const actionCell = document.createElement('td');
      const actionsWrap = document.createElement('div');
      actionsWrap.className = 'feed-actions';

      const cancelBtn = createPrivateReservationActionButton('x', 'Cancel Reservation', 'private-res-cancel-btn', () => {
        cancelPrivateReservation(reservation.id, cancelBtn);
      });
      actionsWrap.appendChild(cancelBtn);

      if (reservation.canConfirmPayment) {
        const confirmBtn = createPrivateReservationActionButton('ok', 'Confirm Payment Receipt', 'private-res-confirm-btn', () => {
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

(function init() {
  const backBtn = document.getElementById('backBtn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.href = '/dashboard.html?tab=panel-dashboard';
    });
  }

  loadPrivateReservations().catch(() => {
    setMessage('Failed to load private reservations page.', true);
  });
})();

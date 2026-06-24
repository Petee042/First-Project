'use strict';

function setMessage(text, isError) {
  const el = document.getElementById('dashboardPageMessage');
  if (!el) {
    return;
  }
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function setAllReservationsMessage(text, isError) {
  const el = document.getElementById('allReservationsMessage');
  if (!el) {
    return;
  }
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
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

async function loadAllReservations() {
  const tbody = document.getElementById('allReservationsTableBody');
  const msgEl = document.getElementById('allReservationsMessage');
  if (!tbody) {
    return;
  }

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
      guestCell.textContent = ((row.first_name || '') + ' ' + (row.family_name || '')).trim() || row.email_address || '-';

      const startCell = document.createElement('td');
      startCell.textContent = row.requested_start_at ? new Date(row.requested_start_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '-';

      const endCell = document.createElement('td');
      endCell.textContent = row.requested_end_at ? new Date(row.requested_end_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '-';

      const statusCell = document.createElement('td');
      statusCell.textContent = row.status || '-';

      const actionCell = document.createElement('td');
      const actionsWrap = document.createElement('div');
      actionsWrap.className = 'feed-actions';

      const deleteBtn = createSharedReservationActionButton('x', 'Delete Reservation', 'resource-delete-btn', () => {
        deleteSharedReservation(row.shared_resource_id, row.id, deleteBtn);
      });

      const statusText = String(row.status || '').trim();
      if (statusText === 'cash') {
        const confirmCashBtn = createSharedReservationActionButton('cash', 'Register Cash Payment Received', 'resource-pay-cash-btn', () => {
          confirmSharedReservationPayment(row.shared_resource_id, row.id, 'Cash Received', confirmCashBtn);
        });
        actionsWrap.appendChild(confirmCashBtn);
      } else if (statusText === 'Awaiting Bank Transfer') {
        const confirmBankBtn = createSharedReservationActionButton('bank', 'Register Bank Transfer Received', 'resource-pay-bank-btn', () => {
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
    setAllReservationsMessage(err.message || 'Failed to load reservations.', true);
    tbody.innerHTML = '<tr><td colspan="6">-</td></tr>';
  }
}

(function init() {
  const backBtn = document.getElementById('backBtn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.href = '/dashboard.html?tab=panel-dashboard';
    });
  }

  loadAllReservations().catch(() => {
    setMessage('Failed to load facility reservations page.', true);
  });
})();

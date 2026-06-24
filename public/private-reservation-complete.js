'use strict';

(function initPrivateReservationComplete() {
  const msgEl = document.getElementById('completeMessage');
  if (!msgEl) {
    return;
  }

  const mode = String(new URLSearchParams(window.location.search).get('mode') || '').trim().toLowerCase();

  if (mode === 'no-charge') {
    msgEl.textContent = 'Reservation confirmed. A direct-booking calendar entry has been added for the selected listing.';
    msgEl.className = 'message success';
    return;
  }

  if (mode === 'bank-transfer') {
    const warning = String(new URLSearchParams(window.location.search).get('warning') || '').trim();
    const reason = String(new URLSearchParams(window.location.search).get('reason') || '').trim();
    msgEl.textContent = warning === 'email-unavailable'
      ? ('Reservation saved, but email delivery is not configured on this server. The reservation was still recorded.'
        + (reason ? (' ' + reason) : ''))
      : 'Reservation saved. Payment request email has been sent to the guest with your bank details.';
    msgEl.className = 'message success';
    return;
  }

  if (mode === 'online-payment') {
    msgEl.textContent = 'Reservation activity created for online payment. Continue payment collection using your configured flow.';
    msgEl.className = 'message success';
    return;
  }

  msgEl.textContent = 'Reservation processed.';
  msgEl.className = 'message success';
})();

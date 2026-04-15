'use strict';

(async () => {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) {
      // Not authenticated — redirect to login page
      window.location.href = '/';
      return;
    }

    const user = await res.json();
    document.getElementById('displayName').textContent     = user.username;
    document.getElementById('displayUsername').textContent = user.username;
    document.getElementById('displayEmail').textContent    = user.email;
  } catch {
    window.location.href = '/';
  }
})();

// ── Logout ───────────────────────────────────────────────────
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
});

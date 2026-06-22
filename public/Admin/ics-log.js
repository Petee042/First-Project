'use strict';

/* ── ICS Transaction Log – Admin Page ────────────────────────────────────── */

const PAGE_SIZE = 50;

let allEntries = [];    // raw data from the API (up to limit=1000)
let filtered   = [];    // after search + status filter
let currentPage = 1;

// ── DOM refs ──────────────────────────────────────────────────────────────
const msgEl        = document.getElementById('icsLogMessage');
const countEl      = document.getElementById('icsLogCount');
const tableBody    = document.getElementById('icsLogTableBody');
const searchInput  = document.getElementById('icsLogSearch');
const statusFilter = document.getElementById('icsLogStatusFilter');
const refreshBtn   = document.getElementById('icsLogRefreshBtn');
const prevBtn      = document.getElementById('icsLogPrevBtn');
const nextBtn      = document.getElementById('icsLogNextBtn');
const pageInfo     = document.getElementById('icsLogPageInfo');
const logoutBtn    = document.getElementById('adminLogoutBtn');

// ── Helpers ───────────────────────────────────────────────────────────────

function formatDTG(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return String(isoString);
  // Format: DDMonYYYY HH:MM:SS UTC  (military-style DTG)
  const pad = n => String(n).padStart(2, '0');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return (
    pad(d.getUTCDate()) + months[d.getUTCMonth()] + d.getUTCFullYear() +
    ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + 'Z'
  );
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(text, maxLen) {
  const s = String(text || '');
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}

function setMessage(text, isError) {
  msgEl.textContent = text || '';
  msgEl.className = 'message' + (isError ? ' error' : (text ? ' success' : ''));
}

// ── Fetch ─────────────────────────────────────────────────────────────────

async function loadLog() {
  setMessage('');
  countEl.textContent = 'Loading…';
  tableBody.innerHTML = '<tr><td colspan="8">Loading…</td></tr>';
  prevBtn.disabled = true;
  nextBtn.disabled = true;

  try {
    const resp = await fetch('/api/admin/ics-log?limit=1000&offset=0', { credentials: 'same-origin' });
    if (resp.status === 401) {
      setMessage('Admin session expired. Please log in again.', true);
      setTimeout(() => { window.location.href = '/Admin/index.html'; }, 2000);
      return;
    }
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      setMessage(data.error || 'Failed to load ICS log.', true);
      tableBody.innerHTML = '<tr><td colspan="8">Error loading data.</td></tr>';
      return;
    }
    const data = await resp.json();
    allEntries = Array.isArray(data.entries) ? data.entries : [];
    applyFilters();
  } catch (err) {
    console.error('ICS log fetch error:', err);
    setMessage('Network error loading ICS log.', true);
    tableBody.innerHTML = '<tr><td colspan="8">Network error.</td></tr>';
  }
}

// ── Filtering & Rendering ─────────────────────────────────────────────────

function applyFilters() {
  const query  = String(searchInput.value || '').trim().toLowerCase();
  const status = String(statusFilter.value || '').toLowerCase();

  filtered = allEntries.filter(entry => {
    if (status && String(entry.status || '').toLowerCase() !== status) return false;
    if (query) {
      const haystack = [
        entry.importing_channel_label,
        entry.exporting_channel_label,
        entry.import_url,
        entry.status,
        entry.error_text
      ].join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  currentPage = 1;
  renderPage();
}

function renderPage() {
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);

  countEl.textContent =
    filtered.length === allEntries.length
      ? `${allEntries.length} transactions`
      : `${filtered.length} of ${allEntries.length} transactions (filtered)`;

  pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;

  if (pageRows.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#888;">No entries found.</td></tr>';
    return;
  }

  tableBody.innerHTML = pageRows.map(entry => {
    const dtg           = escapeHtml(formatDTG(entry.logged_at));
    const importing     = escapeHtml(entry.importing_channel_label || '—');
    const exporting     = escapeHtml(entry.exporting_channel_label || '—');
    const statusLower   = String(entry.status || '').toLowerCase();
    const statusBadge   = `<span class="ics-status-badge ics-status-${statusLower === 'error' ? 'error' : 'success'}">${escapeHtml(entry.status || 'success')}</span>`;
    const eventCount    = String(entry.event_count || 0);
    const importUrl     = escapeHtml(truncate(entry.import_url, 60));
    const rawPayload    = String(entry.raw_payload || entry.error_text || '');
    const payloadPreview = escapeHtml(truncate(rawPayload, 60) || '(empty)');
    const detailTitle = [
      formatDTG(entry.logged_at),
      String(entry.importing_channel_label || '').trim(),
      String(entry.status || '').trim()
    ].filter(Boolean).join(' | ');
    const encodedTitle = encodeURIComponent(detailTitle || 'ICS Transaction Payload');
    const payloadFull   = escapeHtml(rawPayload || '(no payload)');

    return `<tr>
      <td class="ics-info-cell"><a href="#" class="ics-info-link" data-title="${encodedTitle}" data-payload="${payloadFull}" aria-label="Open full payload details in a new tab">(i)</a></td>
      <td>${dtg}</td>
      <td>${importing}</td>
      <td>${exporting}</td>
      <td>${statusBadge}</td>
      <td style="text-align:right;">${eventCount}</td>
      <td title="${escapeHtml(entry.import_url || '')}">${importUrl}</td>
      <td class="ics-payload-cell">${payloadPreview}</td>
    </tr>`;
  }).join('');

  tableBody.querySelectorAll('.ics-info-link').forEach(link => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const title = decodeURIComponent(link.getAttribute('data-title') || 'ICS Transaction Payload');
      const payload = decodeHtmlEntities(link.getAttribute('data-payload') || '(empty)');
      openPayloadTab(title, payload);
    });
  });
}

function decodeHtmlEntities(text) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(String(text || ''), 'text/html');
  return (doc.documentElement && doc.documentElement.textContent) ? doc.documentElement.textContent : String(text || '');
}

function openPayloadTab(title, payload) {
  const tab = window.open('about:blank', '_blank');
  if (!tab) {
    setMessage('Popup blocked by browser. Allow popups to view payload details in a new tab.', true);
    return;
  }

  const escapedTitle = escapeHtml(title || 'ICS Transaction Payload');
  const escapedPayload = escapeHtml(payload || '(empty)');
  tab.document.open();
  tab.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapedTitle}</title>
  <style>
    body { margin: 0; padding: 1rem; font-family: Consolas, 'Courier New', monospace; background: #0f172a; color: #e2e8f0; }
    h1 { margin: 0 0 0.8rem; font-size: 1rem; font-family: Segoe UI, Arial, sans-serif; color: #bfdbfe; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; background: #020617; border: 1px solid #334155; border-radius: 6px; padding: 1rem; max-height: calc(100vh - 4rem); overflow: auto; }
  </style>
</head>
<body>
  <h1>${escapedTitle}</h1>
  <pre>${escapedPayload}</pre>
</body>
</html>`);
  tab.document.close();
}

// ── Event Listeners ───────────────────────────────────────────────────────

searchInput.addEventListener('input', applyFilters);
statusFilter.addEventListener('change', applyFilters);
refreshBtn.addEventListener('click', loadLog);

prevBtn.addEventListener('click', () => {
  if (currentPage > 1) { currentPage--; renderPage(); }
});
nextBtn.addEventListener('click', () => {
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  if (currentPage < totalPages) { currentPage++; renderPage(); }
});

if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
    } catch (_e) { /* ignore */ }
    window.location.href = '/Admin/index.html';
  });
}

// ── Init ──────────────────────────────────────────────────────────────────
loadLog();

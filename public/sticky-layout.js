'use strict';

(function initStickyMessageBar() {
  const stickyBar = document.getElementById('stickyMessageBar');
  if (!stickyBar) {
    return;
  }

  const sources = Array.from(document.querySelectorAll('.message, .schedule-email-message'));
  if (!sources.length) {
    return;
  }

  function isVisible(el) {
    return Boolean(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }

  function classify(el) {
    const cls = String((el && el.className) || '');
    if (/\berror\b/i.test(cls)) {
      return 'error';
    }
    if (/\bsuccess\b/i.test(cls)) {
      return 'success';
    }
    return 'info';
  }

  function cleanText(el) {
    return String((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
  }

  function writeBar(text, tone) {
    const content = text || 'No current messages.';
    stickyBar.textContent = content;
    stickyBar.className = 'sticky-message-bar' + (tone ? (' ' + tone) : '');
  }

  function refreshFromVisibleMessages() {
    const visibleNonEmpty = sources.filter((el) => isVisible(el) && cleanText(el));
    if (!visibleNonEmpty.length) {
      writeBar('', 'info');
      return;
    }

    const active = visibleNonEmpty[visibleNonEmpty.length - 1];
    writeBar(cleanText(active), classify(active));
  }

  refreshFromVisibleMessages();

  const observer = new MutationObserver(() => {
    refreshFromVisibleMessages();
  });

  sources.forEach((el) => {
    observer.observe(el, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class']
    });
  });
})();

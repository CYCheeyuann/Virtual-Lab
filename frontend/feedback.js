/* ─── User feedback (thumbs up / down) ──────────────────────────────────
 * One public function: window.Feedback.attach(container, options).
 *
 * Renders a small "Was this helpful?" widget into `container` and POSTs
 * the chosen rating to the feedback_collector Lambda. Failures are
 * silent on the UI side (we still show "Thanks!") but logged to console
 * so they show up in dev tools.
 *
 * Storage of past ratings is intentionally NOT done. The same response
 * can be rated multiple times — the backend just records each event.
 * That keeps state out of localStorage and avoids a privacy footprint.
 *
 * The session_id is a per-page-load random id used so analysts can
 * group multiple ratings from the same student session without storing
 * any PII. It is NOT persisted across reloads.
 * ───────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  // Stable per-page-load session id. Used as a non-PII grouping key.
  const SESSION_ID = (() => {
    try {
      return crypto.randomUUID().slice(0, 16);
    } catch (_) {
      return Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-6);
    }
  })();

  function _esc(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function _render(container, options) {
    const widget = document.createElement('div');
    widget.className = 'fb-widget';
    widget.setAttribute('role', 'group');
    widget.setAttribute('aria-label', 'Rate this response');
    widget.innerHTML = `
      <span class="fb-label">Was this helpful?</span>
      <button type="button" class="fb-up"   aria-label="Helpful">👍</button>
      <button type="button" class="fb-down" aria-label="Not helpful">👎</button>
      <span class="fb-status" aria-live="polite"></span>
    `;
    container.appendChild(widget);

    const status = widget.querySelector('.fb-status');
    const up = widget.querySelector('.fb-up');
    const down = widget.querySelector('.fb-down');

    function send(rating, btn) {
      // Lock the buttons immediately so a double-click doesn't double-count.
      up.disabled = true;
      down.disabled = true;
      btn.classList.add('fb-selected');

      const url = window.STREAM_URLS && window.STREAM_URLS.feedback_collector;
      if (!url || url.startsWith('__URL_')) {
        status.textContent = '(feedback offline — backend not deployed)';
        return;
      }

      const headers = (typeof window.apiHeaders === 'function')
        ? window.apiHeaders()
        : { 'Content-Type': 'application/json' };

      const body = {
        feature:    options.feature,
        rating:     rating,
        subject:    options.subject || null,
        context:    options.context || null,
        session_id: SESSION_ID,
      };

      // Fire-and-forget. We don't wait for the response to update the UI —
      // the rating is already recorded as soon as the user clicks.
      status.textContent = 'Thanks!';
      fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(err => {
        // Network failure is not user-visible; just log for dev tools.
        // eslint-disable-next-line no-console
        console.warn('[feedback] post failed', err);
      });
    }

    up.addEventListener('click', () => send('up', up));
    down.addEventListener('click', () => send('down', down));
    return widget;
  }

  /**
   * Attach the widget to a container element.
   *
   * options:
   *   feature  — required, one of the values allowlisted server-side.
   *   subject  — optional, sets the subject dimension.
   *   context  — optional, free-text label (e.g. quiz topic). Capped at 200 chars server-side.
   */
  function attach(container, options) {
    if (!container || !options || !options.feature) return null;
    return _render(container, options);
  }

  window.Feedback = { attach, SESSION_ID };
})();

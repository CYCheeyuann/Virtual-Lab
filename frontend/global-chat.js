/* ─── Global persistent AI chatbot ───────────────────────────────────── */
(function () {
  const STORAGE_KEY = 'vsl.globalChat';
  const MAX_MESSAGES = 100; // cap localStorage growth

  const SOURCE_LABEL = {
    safety:     '🦺 Safety',
    image:      '🎨 Image Gen',
    whatif:     '⚡ What If',
    chapter:    '📖 Chapter',
    experiment: '🧪 Experiment',
    quiz:       '📝 Quiz',
    tutor:      '🤖 Tutor',
    'page-inject': '📋 Injected',
  };

  /* ── State ─────────────────────────────────────────────────── */
  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const obj = raw ? JSON.parse(raw) : null;
      if (obj && Array.isArray(obj.messages)) return obj;
      return { messages: [] };
    } catch (e) {
      return { messages: [] };
    }
  }
  function saveHistory(state) {
    // Drop oldest messages once we exceed MAX_MESSAGES so localStorage can't
    // balloon past the 5–10 MB browser quota.
    if (state.messages.length > MAX_MESSAGES) {
      const dropped = state.messages.length - MAX_MESSAGES;
      state.messages.splice(0, dropped);
      if (typeof window.showToast === 'function') {
        window.showToast(`Older chat messages trimmed (kept ${MAX_MESSAGES})`, 'info', 3000);
      }
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) {
      if (typeof window.showToast === 'function') {
        window.showToast('Chat history is full — clear it to keep saving.', 'warning');
      }
    }
  }
  let state = loadHistory();
  if (state.messages.length === 0) {
    state.messages.push({
      role: 'assistant',
      content: 'Hi! I\'m your Lab Assistant. Ask me anything, or use "Send to AI" buttons across the app to bring content here.',
      source: 'system',
      ts: Date.now(),
    });
    saveHistory(state);
  }

  let isOpen = false;
  let hasUnread = false;
  let gcFocusTimer = 0;   // pending auto-focus timer, cancellable on close
  let gcFocusRaf = 0;     // pending deferred FAB-focus rAF, cancellable on close

  // Phone viewport = narrow portrait OR short/landscape coarse-pointer device.
  // Matches the CSS breakpoint and toolkit.js so panel sizing and the
  // chat/toolkit mutual-exclusivity stay consistent.
  function isPhoneViewport() {
    return window.matchMedia(
      '(max-width: 600px), (max-height: 600px) and (pointer: coarse)'
    ).matches;
  }
  // Tracks the currently streaming reply so the user can abort it via the
  // 🗑️ clear button. While a reply is in flight, further sends are REFUSED
  // (not queued, not fire-a-second-request) so one awaited reply = one backend
  // call — the frontend half of avoiding duplicate (billable) generations.
  let activeAbort = null;
  let replyInFlight = false;
  // Monotonic generation token. clearHistory() bumps it so a late response
  // from a request that started before the clear can detect it is stale and
  // refuse to write to the (now reused) message list. This does NOT rely on
  // array indices, which get reused when state.messages is replaced.
  let chatGen = 0;

  /* ── DOM build ────────────────────────────────────────────── */
  // Reuse the global escapeHtml from common.js when available, else fall back
  // to a tiny local copy so this file still works in isolation.
  const esc = (typeof window.escapeHtml === 'function')
    ? window.escapeHtml
    : function (s) {
        return String(s ?? '')
          .replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      };

  function buildDom() {
    if (document.getElementById('gc-fab')) return;
    const fab = document.createElement('button');
    fab.id = 'gc-fab';
    fab.className = 'gc-fab';
    fab.title = 'Open AI Lab Assistant';
    fab.setAttribute('aria-label', 'Open AI Lab Assistant');
    fab.innerHTML = `🤖<span class="gc-dot" aria-hidden="true"></span>`;
    fab.addEventListener('click', toggle);
    document.body.appendChild(fab);

    const panel = document.createElement('aside');
    panel.id = 'gc-panel';
    panel.className = 'gc-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'AI Lab Assistant');
    // Closed by default — isolate from keyboard/pointer until opened so hidden
    // controls aren't tabbable. open() removes this.
    panel.setAttribute('inert', '');
    panel.innerHTML = `
      <div class="gc-header">
        <div class="gc-title">🤖 Lab Assistant</div>
        <div class="gc-actions">
          <button class="gc-icon-btn" id="gc-clear" title="Clear history">🗑️</button>
          <button class="gc-icon-btn" id="gc-close" title="Close">✕</button>
        </div>
      </div>
      <div class="gc-messages" id="gc-messages" aria-live="polite"></div>
      <form class="gc-input-row" id="gc-input-row" autocomplete="off">
        <input class="gc-input" id="gc-input" type="text" placeholder="Ask me anything…" />
        <button class="gc-send-btn" id="gc-send" type="submit" aria-label="Send">➤</button>
      </form>`;
    document.body.appendChild(panel);

    document.getElementById('gc-clear').addEventListener('click', clearHistory);
    document.getElementById('gc-close').addEventListener('click', () => close('user'));
    document.getElementById('gc-input-row').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('gc-input');
      const v = input.value.trim();
      if (!v) return;
      // sendUser returns false when a reply is still in flight. In that case
      // we must NOT clear the box — the user's text is preserved so a send
      // refused during the wait is never silently lost.
      if (sendUser(v) !== false) input.value = '';
    });

    render();
  }

  /* ── Rendering ────────────────────────────────────────────── */
  function render() {
    const host = document.getElementById('gc-messages');
    if (!host) return;
    if (state.messages.length === 0) {
      host.innerHTML = `<div class="gc-empty">No messages yet. Say hi 👋</div>`;
      return;
    }
    host.innerHTML = '';
    for (const m of state.messages) {
      const div = document.createElement('div');
      let cls = 'gc-msg ';
      if (m.role === 'user' && m.source === 'page-inject') cls += 'injected';
      else if (m.role === 'user') cls += 'user';
      else cls += 'assistant';
      div.className = cls;

      const tag = m.sourceLabel
        ? `<div class="gc-source-tag">${esc(m.sourceLabel)}</div>`
        : '';
      const body = esc(m.content);
      div.innerHTML = `${tag}${body}`;
      host.appendChild(div);
    }
    host.scrollTop = host.scrollHeight;
  }

  /* ── Send / inject ────────────────────────────────────────── */
  function pushMessage(msg) {
    state.messages.push({ ts: Date.now(), ...msg });
    saveHistory(state);
    render();
    if (!isOpen) {
      hasUnread = true;
      const fab = document.getElementById('gc-fab');
      if (fab) fab.classList.add('has-unread');
    }
  }

  // Build the conversation history we send to the backend. Page-injected
  // content is folded in as a labeled "context" message so the model can
  // answer follow-up questions referencing whatever the user pasted.
  function buildApiHistory() {
    const out = [];
    for (const m of state.messages) {
      if (m.source === 'streaming') continue;        // in-flight assistant placeholder
      if (m.role === 'assistant' && m.source === 'system') continue; // welcome / errors
      if (m.role === 'user' && m.source === 'page-inject') {
        out.push({
          role: 'user',
          content: `[Context from ${m.sourceLabel || 'previous page'}]\n${m.content}`,
        });
      } else if (m.role === 'user' || m.role === 'assistant') {
        out.push({ role: m.role, content: m.content });
      }
    }
    return out;
  }

  // streamReply(userText, opts):
  //   opts.popLastUserTurn — drop the trailing history turn because it is the
  //     live user text we are about to send as `message` (the sendUser path:
  //     the text is already pushed into state.messages). Defaults to true for
  //     backwards compatibility.
  //   When FALSE (the injectContent path) the trailing turn is the injected
  //     page-context body — it must STAY in history so the shared content
  //     actually reaches the model; the `message` we send is only the ack
  //     prompt, which is NOT in history.
  async function streamReply(userText, opts) {
    opts = opts || {};
    const popLastUserTurn = opts.popLastUserTurn !== false;
    const url = window.STREAM_URLS && window.STREAM_URLS.science_tutor;
    if (!url || url.startsWith('__URL_')) {
      pushMessage({
        role: 'assistant',
        content: '⚠️ Tutor URL not configured. Deploy via GitHub Actions first.',
        source: 'system',
      });
      return;
    }

    activeAbort = new AbortController();
    const localAbort = activeAbort;
    // Snapshot the generation this request belongs to. If clearHistory() bumps
    // chatGen while we're awaiting, isCurrent() turns false and we refuse to
    // touch the fresh message list (no index reuse, no stale error write-back).
    const myGen = chatGen;
    const isCurrent = () => myGen === chatGen && localAbort === activeAbort;
    replyInFlight = true;

    // History snapshot BEFORE we add the placeholder assistant bubble.
    const apiHistory = buildApiHistory();
    // On the sendUser path the just-pushed user message is already the last
    // entry of apiHistory; the backend expects `message` separately and
    // `history` to hold prior turns only, so drop it. On the injectContent
    // path we must NOT pop — the trailing turn is the shared body context.
    if (popLastUserTurn) apiHistory.pop();

    const subject = (typeof window.getSavedSubject === 'function')
      ? window.getSavedSubject()
      : 'Biology';

    // Add a streaming placeholder bubble we'll fill as chunks arrive.
    state.messages.push({
      ts: Date.now(),
      role: 'assistant',
      content: '',
      source: 'streaming',
    });
    const idx = state.messages.length - 1;
    render();

    try {
      const headers = (typeof window.apiHeaders === 'function')
        ? window.apiHeaders()
        : { 'Content-Type': 'application/json' };

      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          subject,
          message: userText,
          history: apiHistory,
        }),
        signal: localAbort.signal,
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);

      const reader  = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let full = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        // Bail quietly if the user cleared the chat (or started a newer send)
        // mid-stream — the bubble belongs to a wiped/stale list.
        if (!isCurrent() || !state.messages[idx]) return;
        state.messages[idx].content = full;
        render();
      }
      // Stale guard: a response that resolves AFTER a clear must not write to
      // the reused list. Check the generation, not just the index.
      if (!isCurrent() || !state.messages[idx]) return;
      state.messages[idx].content = full || '(no response)';
      state.messages[idx].source  = 'manual';
      saveHistory(state);
      render();
    } catch (err) {
      if (err && err.name === 'AbortError') {
        // User clicked clear; nothing to surface.
        return;
      }
      // A plain network error on an OLD request (cleared, or superseded) must
      // NOT overwrite the current message — guard the error path by generation
      // too, not only by the (reusable) array index.
      if (isCurrent() && state.messages[idx]) {
        state.messages[idx].content = '⚠️ ' + (err.message || 'request failed');
        state.messages[idx].source  = 'system';
        saveHistory(state);
        render();
      }
    } finally {
      // Only the CURRENT request releases shared state: a stale/aborted
      // request's finally must not clear the in-flight flag of a newer send.
      if (isCurrent()) {
        replyInFlight = false;
        activeAbort = null;
      }
    }
  }

  function sendUser(text) {
    // In-flight guard shared by every send entry point (form submit, Enter,
    // and any future caller): while a reply is awaited, a repeat send is
    // REFUSED — it must not fire a second (billable) request. Returning false
    // lets the caller keep the user's text in the input box.
    if (replyInFlight) {
      if (typeof window.showToast === 'function') {
        window.showToast('⏳ Wait for the current reply to finish.', 'warning');
      }
      return false;
    }
    pushMessage({ role: 'user', content: text, source: 'manual' });
    // The live user turn is now the last entry in history → pop it before
    // sending (backend wants it in `message`, not `history`).
    streamReply(text, { popLastUserTurn: true });
    return true;
  }

  function injectContent(content, sourcePage, sourceLabel) {
    if (!content) return;
    const label = sourceLabel || SOURCE_LABEL[sourcePage] || '📋 From page';
    const body = typeof content === 'string' ? content : String(content);
    // Dedupe: injecting the SAME body from the SAME page twice in a row must
    // not stack two identical context turns (e.g. a double-click on "Send to
    // AI"). Skip the push if the most recent page-inject already carries it.
    let lastInject = null;
    for (let i = state.messages.length - 1; i >= 0; i--) {
      if (state.messages[i].source === 'page-inject') { lastInject = state.messages[i]; break; }
    }
    const duplicate = lastInject &&
      lastInject.content === body && lastInject.sourcePage === sourcePage;

    // Always surface the panel so the user sees their shared content, even
    // when we end up not firing a request below.
    open();

    // A repeat share of the SAME body from the SAME page must not fire a
    // second (billable) generation — not just skip the history push. Skip the
    // whole request when the body duplicates the most recent inject.
    if (duplicate) return;

    // Likewise, if a reply is already streaming, do not stack a second
    // request. Keep the body in history (so it still reaches the model on the
    // next turn) but don't dispatch an ack request on top of the live one.
    pushMessage({
      role: 'user',
      content: body,
      source: 'page-inject',
      sourcePage,
      sourceLabel: label,
    });
    if (replyInFlight) return;

    // Ask the tutor to acknowledge + summarise so the user immediately sees
    // the assistant has the context. The ack prompt is sent as `message`; the
    // injected body stays in `history` (popLastUserTurn=false) so the model
    // actually receives the shared content on the very first share.
    streamReply(
      `I just shared content from "${label}". Briefly acknowledge what you received and offer to help.`,
      { popLastUserTurn: false }
    );
  }

  /* ── Open / close / clear ─────────────────────────────────── */
  function open() {
    // Unified lock: a host page (e.g. Quiz during answering) can set
    // document.documentElement.dataset.gcLocked = '1' to block ALL open paths,
    // including the internal toggle()→open() route that bypasses the public
    // window.GlobalChat.open wrapper.
    if (document.documentElement.dataset.gcLocked === '1') {
      if (typeof window.showToast === 'function') {
        window.showToast('🔒 Lab Assistant is locked during the quiz. Submit your quiz first.', 'warning');
      }
      return;
    }
    const panel = document.getElementById('gc-panel');
    const fab   = document.getElementById('gc-fab');
    if (!panel) return;
    // On phones (narrow OR short/landscape coarse-pointer), close the toolkit
    // bottom-sheet first so the two panels don't overlap and hide each other's
    // controls. Wider screens can show both. Must match the CSS breakpoint and
    // toolkit.js.
    if (isPhoneViewport() && window.Toolkit && window.Toolkit.isOpen) {
      try { window.Toolkit.close(); } catch (_) {}
    }
    panel.classList.add('open');
    panel.removeAttribute('inert');
    if (fab) fab.classList.add('hidden');
    isOpen = true;
    hasUnread = false;
    if (fab) fab.classList.remove('has-unread');
    // Track the delayed focus so close() can cancel it — otherwise a quick
    // open→close leaves a pending focus that drags the caret (and keyboard)
    // back into a now-hidden input.
    if (gcFocusTimer) clearTimeout(gcFocusTimer);
    gcFocusTimer = setTimeout(() => {
      gcFocusTimer = 0;
      if (!isOpen) return;                 // closed in the meantime — do nothing
      const inp = document.getElementById('gc-input');
      if (inp) inp.focus();
    }, 50);
  }
  // close(reason): the reason decides whether focus returns to the chat FAB.
  //   'user'      (default) — user dismissed it → restore focus to the FAB.
  //   'takeover'  — another overlay (toolkit) is opening; it manages focus, so
  //                 DON'T steal focus back to the chat FAB.
  //   'lock'      — Quiz locked the chat; the FAB is disabled, don't focus it.
  //   'lifecycle' — page hide / BFCache etc.; don't move focus.
  function close(reason) {
    reason = reason || 'user';
    const panel = document.getElementById('gc-panel');
    const fab   = document.getElementById('gc-fab');
    if (!panel) return;
    // Cancel any pending auto-focus / deferred focus so a hidden input or a
    // stale focus task can't run after a quick close→reopen.
    if (gcFocusTimer) { clearTimeout(gcFocusTimer); gcFocusTimer = 0; }
    if (gcFocusRaf) { cancelAnimationFrame(gcFocusRaf); gcFocusRaf = 0; }
    // Move focus out of the panel before hiding it, then isolate the hidden
    // panel from keyboard/pointer with inert so its controls aren't tabbable.
    const active = document.activeElement;
    if (active && panel.contains(active) && typeof active.blur === 'function') {
      active.blur();
    }
    panel.classList.remove('open');
    panel.setAttribute('inert', '');
    if (fab) fab.classList.remove('hidden');
    isOpen = false;
    // Only a user-initiated close returns focus to the FAB. Takeover/lock/
    // lifecycle closes must not grab focus (the taking-over overlay owns it,
    // or the FAB is disabled/irrelevant).
    if (reason === 'user' && fab &&
        !fab.classList.contains('hidden') &&
        document.documentElement.dataset.gcLocked !== '1' &&
        document.visibilityState === 'visible') {
      gcFocusRaf = requestAnimationFrame(() => {
        gcFocusRaf = 0;
        // Re-check at execution time: don't focus if we were re-opened, locked,
        // or the toolkit opened in the meantime.
        if (isOpen) return;
        if (document.documentElement.dataset.gcLocked === '1') return;
        if (window.Toolkit && window.Toolkit.isOpen) return;
        try { fab.focus({ preventScroll: true }); } catch (_) {}
      });
    }
  }
  function toggle() { isOpen ? close('user') : open(); }

  function clearHistory() {
    // Stop any in-flight streaming reply so it can't keep appending after
    // we've reset the message list. Bumping chatGen invalidates that request's
    // generation so even a NON-abort path (a plain network error resolving
    // later) sees isCurrent()===false and refuses to write to the fresh list.
    // Reset replyInFlight so the user can send immediately after clearing.
    chatGen++;
    if (activeAbort) { try { activeAbort.abort(); } catch (_) {} }
    activeAbort = null;
    replyInFlight = false;
    state = { messages: [] };
    saveHistory(state);
    state.messages.push({
      role: 'assistant',
      content: 'History cleared. Ask me anything!',
      source: 'system',
      ts: Date.now(),
    });
    saveHistory(state);
    render();
  }

  /* ── Init ─────────────────────────────────────────────────── */
  function init() {
    buildDom();

    // Context-aware greeting based on current page
    const PAGE_GREETINGS = {
      'index.html':       '👋 Welcome to the Dashboard! Pick a tool to start.',
      'welcome.html':     '🔬 Welcome! I\'m your Lab Assistant — open the Dashboard to begin.',
      'chapter.html':     '📖 Need help with chapters? Click any card or ask me anything.',
      'experiment.html':  '🧪 Setting up an experiment? I can help with safety and procedures.',
      'quiz.html':        '📝 Ready to test your knowledge? I\'m here if you need a hint.',
      'flashcards.html':  '🧠 Cramming smart? Generate a deck or study what\'s due today.',
      'lab-tools.html':   '🧰 Exploring Lab Tools? Ask me about safety, images, or what-if scenarios.',
      'tutor.html':       '🤖 Welcome to Science Tutor! Ask me anything.',
    };
    const path = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    const greeting = PAGE_GREETINGS[path] || '👋 Need help? Ask me anything!';

    setTimeout(() => {
      if (isOpen) return;
      const hint = document.createElement('div');
      hint.className = 'gc-bubble-hint';
      hint.textContent = greeting;
      hint.id = 'gc-bubble-hint';
      document.body.appendChild(hint);
      requestAnimationFrame(() => hint.classList.add('show'));
      const hide = () => { hint.classList.remove('show'); setTimeout(() => hint.remove(), 400); };
      setTimeout(hide, 6000);
      const fab = document.getElementById('gc-fab');
      if (fab) fab.addEventListener('click', hide, { once: true });
    }, 1200);

    setupKeyboardInset();
  }

  /* ── Software-keyboard handling (shared by chat + toolkit panels) ──────
   * iOS does NOT shrink the layout viewport (or 100dvh) when the on-screen
   * keyboard opens, so a bottom-anchored panel can sit behind it. We measure
   * the keyboard overlap from visualViewport and publish it as the CSS var
   * --kb-inset on <html>; bottom-anchored mobile panels add it to their
   * bottom offset. Restores to 0 when the keyboard closes. Listeners are
   * registered once and the handler is a no-op where visualViewport is
   * absent (older desktop browsers) so nothing regresses there. */
  // Tracks whether the viewport listeners are currently attached, so re-arming
  // (e.g. after a BFCache restore) never double-binds.
  let kbInsetActive = false;

  function setupKeyboardInset() {
    const vv = window.visualViewport;
    const root = document.documentElement;
    if (!vv) { root.style.setProperty('--kb-inset', '0px'); return; }

    let raf = 0;
    let focusoutTimer = 0;

    const isEditableFocused = () => {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };
    const apply = () => {
      raf = 0;
      // METHOD (heuristic — see caveats):
      //   layout viewport bottom covered = innerHeight - (vv.height + vv.offsetTop)
      // When the page is pinch-zoomed, vv.height is ALSO divided by vv.scale,
      // so that raw difference conflates zoom with the keyboard. We can only
      // approximate the keyboard portion. Approach:
      //   - Convert the visual-viewport height back to layout-CSS px by
      //     multiplying by scale, so zoom alone contributes ~0 overlap.
      //   - Treat the remainder as keyboard only when it is substantial (>80px)
      //     and a keyboard is plausible (either not zoomed, or an editable is
      //     focused — covering "zoom first, then type").
      // CAVEATS / SUPPORT: visualViewport is unavailable on very old browsers
      // (then --kb-inset stays 0 and panels fall back to dvh). The zoom/keyboard
      // split is approximate; exact behaviour on iOS Safari / Android Chrome
      // with the on-screen keyboard is NOT verified without a real device.
      const scale = vv.scale || 1;
      const layoutVisibleH = vv.height * scale;            // undo zoom shrink
      const overlap = Math.max(0, window.innerHeight - (layoutVisibleH + vv.offsetTop * scale));
      const zoomed = scale > 1.05;
      const keyboardLikely = !zoomed || isEditableFocused();
      // Clamp to <=60% of viewport so a bad reading can't shove the panel off.
      const capped = Math.min(overlap, window.innerHeight * 0.6);
      const inset = (keyboardLikely && capped > 80) ? Math.round(capped) : 0;
      root.style.setProperty('--kb-inset', inset + 'px');
    };
    const onChange = () => { if (!raf) raf = requestAnimationFrame(apply); };
    // Reset when a field blurs (keyboard dismissed) — some browsers don't fire
    // a reliable resize on close.
    const onFocusOut = () => {
      if (focusoutTimer) clearTimeout(focusoutTimer);
      focusoutTimer = setTimeout(() => { focusoutTimer = 0; apply(); }, 100);
    };

    const attach = () => {
      if (kbInsetActive) return;         // never double-bind
      kbInsetActive = true;
      vv.addEventListener('resize', onChange);
      vv.addEventListener('scroll', onChange);
      document.addEventListener('focusout', onFocusOut);
      apply();                           // recompute position immediately
    };
    const detach = () => {
      if (!kbInsetActive) return;
      kbInsetActive = false;
      vv.removeEventListener('resize', onChange);
      vv.removeEventListener('scroll', onChange);
      document.removeEventListener('focusout', onFocusOut);
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (focusoutTimer) { clearTimeout(focusoutTimer); focusoutTimer = 0; }
    };

    // Page lifecycle: tear down when the page is hidden/cached, and re-arm +
    // recompute when it is shown again (including BFCache restores where init()
    // does NOT run a second time). These two stay bound for the page's life.
    window.addEventListener('pagehide', detach);
    window.addEventListener('pageshow', () => { attach(); apply(); });

    attach();                            // initial arm
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ── Public API ───────────────────────────────────────────── */
  window.GlobalChat = {
    open, close, toggle, clearHistory, injectContent,
    get state()    { return state; },
    get isOpen()   { return isOpen; },
  };
})();

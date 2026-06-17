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
  // Tracks the currently streaming reply so the user can abort it via the
  // 🗑️ clear button (or simply by sending another message).
  let activeAbort = null;

  /* ── DOM build ────────────────────────────────────────────── */
  // Reuse the global escapeHtml from common.js when available, else fall back
  // to a tiny local copy so this file still works in isolation.
  const esc = (typeof window.escapeHtml === 'function')
    ? window.escapeHtml
    : function (s) {
        return String(s ?? '')
          .replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
    document.getElementById('gc-close').addEventListener('click', close);
    document.getElementById('gc-input-row').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('gc-input');
      const v = input.value.trim();
      if (!v) return;
      sendUser(v);
      input.value = '';
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

  async function streamReply(userText) {
    const url = window.STREAM_URLS && window.STREAM_URLS.science_tutor;
    if (!url || url.startsWith('__URL_')) {
      pushMessage({
        role: 'assistant',
        content: '⚠️ Tutor URL not configured. Deploy via GitHub Actions first.',
        source: 'system',
      });
      return;
    }

    // If a previous reply is still streaming, abort it first.
    if (activeAbort) { try { activeAbort.abort(); } catch (_) {} }
    activeAbort = new AbortController();
    const localAbort = activeAbort;

    // History snapshot BEFORE we add the placeholder assistant bubble.
    const apiHistory = buildApiHistory();
    // The just-pushed user message is already in apiHistory; the backend
    // expects `message` separately and `history` to hold prior turns only.
    apiHistory.pop();

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
        // Bail quietly if the user cleared the chat mid-stream — the bubble
        // is already gone and we don't want to revive it.
        if (localAbort.signal.aborted || !state.messages[idx]) return;
        state.messages[idx].content = full;
        render();
      }
      if (!state.messages[idx]) return;
      state.messages[idx].content = full || '(no response)';
      state.messages[idx].source  = 'manual';
      saveHistory(state);
      render();
    } catch (err) {
      if (err && err.name === 'AbortError') {
        // User clicked clear; nothing to surface.
        return;
      }
      if (state.messages[idx]) {
        state.messages[idx].content = '⚠️ ' + (err.message || 'request failed');
        state.messages[idx].source  = 'system';
        saveHistory(state);
        render();
      }
    } finally {
      if (activeAbort === localAbort) activeAbort = null;
    }
  }

  function sendUser(text) {
    pushMessage({ role: 'user', content: text, source: 'manual' });
    streamReply(text);
  }

  function injectContent(content, sourcePage, sourceLabel) {
    if (!content) return;
    const label = sourceLabel || SOURCE_LABEL[sourcePage] || '📋 From page';
    pushMessage({
      role: 'user',
      content: typeof content === 'string' ? content : String(content),
      source: 'page-inject',
      sourcePage,
      sourceLabel: label,
    });
    // Ask the tutor to acknowledge + summarise so the user immediately sees
    // the assistant has the context. We pipe a synthetic user message so the
    // backend treats prior turns + the injected blob as conversation context.
    streamReply(`I just shared content from "${label}". Briefly acknowledge what you received and offer to help.`);
    open();
  }

  /* ── Open / close / clear ─────────────────────────────────── */
  function open() {
    const panel = document.getElementById('gc-panel');
    const fab   = document.getElementById('gc-fab');
    if (!panel) return;
    panel.classList.add('open');
    if (fab) fab.classList.add('hidden');
    isOpen = true;
    hasUnread = false;
    if (fab) fab.classList.remove('has-unread');
    setTimeout(() => {
      const inp = document.getElementById('gc-input');
      if (inp) inp.focus();
    }, 50);
  }
  function close() {
    const panel = document.getElementById('gc-panel');
    const fab   = document.getElementById('gc-fab');
    if (!panel) return;
    panel.classList.remove('open');
    if (fab) fab.classList.remove('hidden');
    isOpen = false;
  }
  function toggle() { isOpen ? close() : open(); }

  function clearHistory() {
    // Stop any in-flight streaming reply so it can't keep appending after
    // we've reset the message list.
    if (activeAbort) { try { activeAbort.abort(); } catch (_) {} }
    activeAbort = null;
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
    // Show a speech-bubble hint flying out of the FAB after 3s (only
    // when the panel is closed and user hasn't interacted yet).
    setTimeout(() => {
      if (isOpen) return;
      const hint = document.createElement('div');
      hint.className = 'gc-bubble-hint';
      const PAGE_GREETINGS = {
        'chapter': '📖 Welcome to Chapter Assistant! Need help exploring a topic?',
        'experiment': '🧪 Ready to set up an experiment? I can help with safety tips!',
        'quiz': '📝 Quiz time! I\'ll be here after you finish if you need explanations.',
        'lab-tools': '🧰 Lab Tools ready! Try the image generator or safety checker.',
        'index': '👋 Welcome back! Pick a tool to get started.',
      };
      const page = location.pathname.split('/').pop().replace('.html','') || 'index';
      const greeting = PAGE_GREETINGS[page] || '👋 Need help? Ask me anything!';
      hint.textContent = greeting;
      hint.id = 'gc-bubble-hint';
      document.body.appendChild(hint);
      // Trigger show animation after DOM insertion
      requestAnimationFrame(() => hint.classList.add('show'));
      // Auto-hide after 5s or on first fab click
      const hide = () => { hint.classList.remove('show'); setTimeout(() => hint.remove(), 400); };
      setTimeout(hide, 5000);
      const fab = document.getElementById('gc-fab');
      if (fab) fab.addEventListener('click', hide, { once: true });
    }, 3000);
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

/* ─── Global persistent AI chatbot ───────────────────────────────────── */
(function () {
  const STORAGE_KEY = 'vsl.globalChat';
  const MAX_MESSAGES = 100; // cap localStorage growth
  const PLACEHOLDER_REPLY =
    '⚠️ AI not connected yet — will be enabled after backend setup.';

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

  function sendUser(text) {
    pushMessage({ role: 'user', content: text, source: 'manual' });
    // Hardcoded placeholder reply for Phase 2
    setTimeout(() => {
      pushMessage({ role: 'assistant', content: PLACEHOLDER_REPLY, source: 'system' });
    }, 400);
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
    // Acknowledgement assistant reply
    setTimeout(() => {
      pushMessage({
        role: 'assistant',
        content: `Got it — I've received the content from "${label}". ` + PLACEHOLDER_REPLY,
        source: 'system',
      });
    }, 400);
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
  function init() { buildDom(); }
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

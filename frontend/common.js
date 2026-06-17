/* ─── Shared helpers for all pages ───────────────────────────────────── */

/* ============================================================
 *  SVG ICON LIBRARY
 *  Inline SVGs returned as strings, used everywhere instead
 *  of plain emoji/text on buttons.
 * ============================================================ */
const ICONS = {
  // Lightning bolt — Generate
  bolt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 4 14 12 14 11 22 20 10 12 10 13 2" fill="currentColor" stroke="none"/></svg>`,
  // Circular arrow — Reset
  refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
  // Paper plane — Send
  plane: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2" fill="currentColor" stroke="none" opacity="0.85"/></svg>`,
  // Eye — Show
  eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  // Eye-off — Hide
  eyeOff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a19.79 19.79 0 0 1 5.06-5.94"/><path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a19.86 19.86 0 0 1-3.17 4.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
  // Download — Export PDF
  download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  // Trash can — Clear
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>`,
  // Sun / Moon for theme toggle
  sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="currentColor" opacity="0.15"/></svg>`,
};

/* Convenience helper for buttons */
function iconHtml(name, extraClass = '') {
  const cls = `btn-icon ${extraClass}`.trim();
  return `<span class="${cls}">${ICONS[name] || ''}</span>`;
}

/* ============================================================
 *  API HEADERS — shared key + content-type for every fetch.
 * ============================================================ */
function apiHeaders(extra) {
  const h = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
  // window.API_KEY is sed-injected by the deploy workflow. Leave the header
  // off when the placeholder is still there (local dev) or when the secret
  // is empty (auth disabled).
  const key = (typeof window !== 'undefined' && window.API_KEY) || '';
  if (key && !key.startsWith('__')) h['X-Api-Key'] = key;
  return h;
}

/* ============================================================
 *  ESCAPING
 * ============================================================ */
function escapeHtml(s) {
  return String(s ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
}

/* ============================================================
 *  SUBJECT THEME
 * ============================================================ */
function setSubjectTheme(subject) {
  if (!['Biology', 'Chemistry', 'Physics', 'Science'].includes(subject)) subject = 'Biology';
  document.documentElement.setAttribute('data-subject', subject);
  try { localStorage.setItem('selectedSubject', subject); } catch (e) {}
  updateFloatingIcons(subject);
}

function getSavedSubject() {
  try { return localStorage.getItem('selectedSubject') || 'Biology'; }
  catch (e) { return 'Biology'; }
}

const SUBJECT_ICONS = {
  Biology:   ['🧬', '🌿', '🍃', '🦠', '🧪', '🌱'],
  Chemistry: ['⚗️', '🧪', '🔬', '🧫', '⚛️', '💊'],
  Physics:   ['🔭', '⚛️', '🌌', '🪐', '🛰️', '⚡'],
  Science:   ['🔬', '⚗️', '🧬', '🌍', '⚛️', '🧪'],
};

function updateFloatingIcons(subject) {
  // Clear previous icons
  document.querySelectorAll('.floating-icon').forEach(el => el.remove());
  const set = SUBJECT_ICONS[subject] || SUBJECT_ICONS.Biology;
  const positions = [
    { top: '12%',  left: '6%'   },
    { top: '22%',  left: '88%'  },
    { top: '46%',  left: '4%'   },
    { top: '58%',  left: '92%'  },
    { top: '78%',  left: '10%'  },
    { top: '85%',  left: '82%'  },
  ];
  positions.forEach((pos, i) => {
    const el = document.createElement('div');
    el.className = 'floating-icon';
    el.textContent = set[i % set.length];
    el.style.top = pos.top;
    el.style.left = pos.left;
    el.style.animationDelay = `${i * 1.7}s`;
    document.body.appendChild(el);
  });
}

/* Bind a #subject <select> to the theme system */
function bindSubjectSelect() {
  const sel = document.getElementById('subject');
  if (!sel) return;
  // restore from localStorage
  const saved = getSavedSubject();
  if ([...sel.options].some(o => o.value === saved)) sel.value = saved;
  setSubjectTheme(sel.value);
  sel.addEventListener('change', () => setSubjectTheme(sel.value));
}

/* ============================================================
 *  THEME — dark mode is the only mode.
 * ============================================================ */
function initTheme() {
  // Force dark theme always; previous light-mode toggle has been removed.
  document.documentElement.setAttribute('data-theme', 'dark');
  try { localStorage.removeItem('theme'); } catch (e) {}
}

/* ============================================================
 *  TOAST NOTIFICATIONS
 * ============================================================ */
function ensureToastContainer() {
  let c = document.getElementById('toast-container');
  if (!c) {
    c = document.createElement('div');
    c.id = 'toast-container';
    c.className = 'toast-container';
    document.body.appendChild(c);
  }
  return c;
}
function showToast(message, type = 'info', duration = 4000) {
  const c = ensureToastContainer();
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const icon = type === 'success' ? '✅'
             : type === 'error'   ? '❌'
             : type === 'warning' ? '⚠️' : 'ℹ️';
  t.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <div class="toast-msg">${escapeHtml(message)}</div>
    <button class="toast-close" aria-label="Close">×</button>`;
  c.appendChild(t);
  const close = () => {
    t.classList.add('toast-out');
    setTimeout(() => t.remove(), 280);
  };
  t.querySelector('.toast-close').addEventListener('click', close);
  if (duration > 0) setTimeout(close, duration);
}

/* ============================================================
 *  STREAMING + LOADING SKELETON + BUTTON LOADING
 * ============================================================ */
function skeletonHTML() {
  return `
    <div class="skeleton">
      <div class="skeleton-line title"></div>
      <div class="skeleton-line long"></div>
      <div class="skeleton-line medium"></div>
      <div class="skeleton-line long"></div>
      <div class="skeleton-line short"></div>
      <div class="skeleton-line medium"></div>
    </div>`;
}

function setButtonLoading(btn, isLoading, loadingLabel = 'Generating…') {
  if (!btn) return;
  if (isLoading) {
    btn.dataset.origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="btn-spinner"></span><span>${escapeHtml(loadingLabel)}</span>`;
  } else {
    if (btn.dataset.origHtml) btn.innerHTML = btn.dataset.origHtml;
    delete btn.dataset.origHtml;
    btn.disabled = false;
  }
}

/* Render one streaming line as a markdown <span class="md-line"> */
function appendMarkdownLine(panel, raw, panelId) {
  const span = document.createElement('span');
  span.className = 'md-line';

  let line = raw.replace(/\r$/, '');
  let cls = '';

  if (/^---+\s*$/.test(line)) {
    span.classList.add('hr');
    panel.appendChild(span);
    return;
  }
  if      (/^###\s+/.test(line))      { cls = 'h3'; line = line.replace(/^###\s+/, ''); }
  else if (/^##\s+/.test(line))       { cls = 'h2'; line = line.replace(/^##\s+/, ''); }
  else if (/^#\s+/.test(line))        { cls = 'h1'; line = line.replace(/^#\s+/, ''); }
  else if (/^\s*[-*]\s+/.test(line))  { cls = 'bullet';   line = line.replace(/^\s*[-*]\s+/, ''); }
  else if (/^\s*\d+\.\s+/.test(line)) { cls = 'numbered'; }

  if (cls) span.classList.add(cls);

  if (panelId === 'out-quiz') {
    if (/✅|Correct Answer/i.test(line)) span.classList.add('answer-line');
    if (/💡|Explanation/i.test(line))    span.classList.add('explanation-line');
  }

  const html = escapeHtml(line)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');

  span.innerHTML = html || '&nbsp;';
  panel.appendChild(span);
}

/* Stream POST to a Lambda Function URL, render into panel, disable button while running */
async function streamToPanel(url, body, panelId, btn, options = {}) {
  const panel = document.getElementById(panelId);
  panel.innerHTML = skeletonHTML();

  setButtonLoading(btn, true, options.loadingLabel || 'Generating…');

  if (!url || url.startsWith('__URL_')) {
    panel.innerHTML =
      '<div class="error-msg">⚠️ Streaming URL not configured. Deploy via GitHub Actions first.</div>';
    setButtonLoading(btn, false);
    showToast('Streaming URL not configured', 'error');
    return;
  }

  let fullText = '';
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} — ${resp.statusText}`);

    panel.innerHTML = '';
    const cursor  = document.createElement('span');
    cursor.className = 'streaming-cursor';

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      fullText += chunk;
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) appendMarkdownLine(panel, line, panelId);

      if (cursor.parentNode) cursor.remove();
      panel.appendChild(cursor);
      panel.scrollTop = panel.scrollHeight;
    }
    if (buffer) {
      appendMarkdownLine(panel, buffer, panelId);
    }
    if (cursor.parentNode) cursor.remove();

    if (typeof options.onComplete === 'function') {
      try { options.onComplete(fullText, panel); } catch (e) { console.warn(e); }
    }
    if (options.successToast) showToast(options.successToast, 'success');
  } catch (err) {
    panel.innerHTML = `<div class="error-msg">⚠️ ${escapeHtml(err.message)}</div>`;
    showToast(`Failed: ${err.message}`, 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}

/* ============================================================
 *  DROPZONE
 * ============================================================ */
function setupDropzone(zoneId, inputId, infoId, onLoad) {
  const zone  = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  const info  = document.getElementById(infoId);
  if (!zone || !input) return;

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', e => {
    if (e.target.files.length) handleFile(e.target.files[0]);
  });

  function handleFile(file) {
    if (file.size > 10 * 1024 * 1024) {
      info.textContent = '⚠️ File too large (max 10 MB)';
      showToast('File too large (max 10 MB)', 'warning');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const comma  = result.indexOf(',');
      const base64 = result.slice(comma + 1);
      info.textContent = `📎 ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
      onLoad({ data: base64, mime: file.type, name: file.name });
    };
    reader.readAsDataURL(file);
  }
}

function clearPanel(id, msg) {
  const p = document.getElementById(id);
  if (!p) return;
  // Build the placeholder via DOM nodes so `msg` can never be interpreted
  // as HTML even if a future caller passes user-controlled text.
  const div = document.createElement('div');
  div.className = 'placeholder';
  div.textContent = msg || 'Output will appear here…';
  p.replaceChildren(div);
}

/* ============================================================
 *  PDF EXPORT (window.print + dedicated print stylesheet)
 * ============================================================ */
function exportToPDF(panelId, title) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  if (!panel.textContent.trim() || panel.querySelector('.placeholder')) {
    showToast('Nothing to export yet', 'warning');
    return;
  }
  const exportBtns = document.querySelectorAll('.btn-export');
  const origHtmls = [];
  exportBtns.forEach((b, i) => { origHtmls[i] = b.innerHTML; b.disabled = true;
    b.innerHTML = '<span class="btn-spinner"></span><span>Exporting…</span>'; });

  const oldTitle = document.title;
  if (title) document.title = title;
  setTimeout(() => {
    window.print();
    document.title = oldTitle;
    exportBtns.forEach((b, i) => { b.innerHTML = origHtmls[i]; b.disabled = false; });
  }, 120);
}

/* ============================================================
 *  KEYBOARD SHORTCUTS
 * ============================================================ */
function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + Enter — submit / generate / send
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      const target = document.querySelector('#sendBtn, #runBtn');
      if (target && !target.disabled) {
        e.preventDefault();
        target.click();
      }
      return;
    }
    // Escape — clear inputs / reset
    if (e.key === 'Escape') {
      const reset = document.getElementById('resetBtn');
      const active = document.activeElement;
      // If user focused an input, just clear it; otherwise trigger reset
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
        if (active.value) {
          active.value = '';
          e.preventDefault();
          return;
        }
      }
      if (reset && !reset.disabled) {
        e.preventDefault();
        reset.click();
      }
    }
  });
}

/* ============================================================
 *  NAVBAR THEME TOGGLE — removed (dark mode only).
 *  Keeping a stub so callers don't break if the function is referenced
 *  elsewhere; cleans up any pre-existing button from cached HTML.
 * ============================================================ */
function injectThemeToggle() {
  const btn = document.getElementById('themeToggle');
  if (btn) btn.remove();
}

/* ============================================================
 *  KEYBOARD SHORTCUT HINT
 * ============================================================ */
function injectShortcutHint() {
  if (document.querySelector('.shortcut-hint')) return;
  const main = document.querySelector('main.page');
  if (!main) return;
  const hint = document.createElement('div');
  hint.className = 'shortcut-hint';
  hint.innerHTML = `⌨️ Shortcuts:
    <kbd>Ctrl</kbd>+<kbd>Enter</kbd> generate ·
    <kbd>Esc</kbd> clear`;
  main.appendChild(hint);
}

/* ============================================================
 *  GLOBAL BOOTSTRAP
 * ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  bindSubjectSelect();             // safe no-op when there is no #subject
  // If no subject select on this page, still apply saved subject
  if (!document.getElementById('subject')) {
    setSubjectTheme(getSavedSubject());
  }
  injectThemeToggle();
  injectShortcutHint();
  initKeyboardShortcuts();
});

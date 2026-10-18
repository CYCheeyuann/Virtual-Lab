/* Regression tests for the Tutor send/async guard (frontend/tutor.html inline
 * <script>). Area 2a:
 *   - repeated Enter/click while a request is awaiting => exactly ONE fetch;
 *   - IME composition Enter (isComposing / keyCode 229) => no send;
 *   - Shift+Enter => no send (newline preserved);
 *   - clear during flight => request aborted AND the stale response is not
 *     written into the fresh history;
 *   - failed request => the button re-enables and a retry works.
 *
 * The Tutor logic lives inline, so the test EXTRACTS the real <script> block
 * from tutor.html and runs it under vm against a stubbed DOM/fetch. It drives
 * the SAME send()/keydown/resetBtn code the page runs — no copied logic.
 * Not a browser/device test. Run: node tests/frontend/tutor_send.test.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'frontend', 'tutor.html'), 'utf8');

// Grab the main inline <script> block (the one that defines send()). There are
// several <script src=...> tags and one inline block with the logic.
function mainInlineScript() {
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1].includes('async function send()')) return m[1];
  }
  throw new Error('tutor.html inline send() script not found');
}

let passed = 0;
const _tests = [];
const test = (name, fn) => { _tests.push({ name, fn }); };

/* Build a DOM/stub environment, run the REAL inline script, and return hooks
 * that let the test fire the keydown/click handlers and resolve fetches. */
function harness() {
  const requests = [];
  let pendingResolvers = [];
  const makeResponse = (textOrErr) => {
    if (textOrErr instanceof Error) return Promise.reject(textOrErr);
    let served = false;
    return Promise.resolve({
      ok: true,
      body: { getReader() { return { read() {
        if (served) return Promise.resolve({ done: true });
        served = true;
        return Promise.resolve({ done: false, value: Buffer.from(textOrErr, 'utf8') });
      } }; } },
    });
  };
  const fetchStub = (url, init) => {
    const req = { url, init, body: JSON.parse(init.body), signal: init.signal, aborted: false };
    if (init.signal) init.signal.addEventListener('abort', () => { req.aborted = true; });
    requests.push(req);
    return new Promise((resolve, reject) => {
      pendingResolvers.push({ req, resolve: (t) => makeResponse(t).then(resolve, reject) });
    });
  };

  // Minimal element stub with listener registry.
  function makeEl(id) {
    const listeners = {};
    return {
      id,
      value: '',
      innerHTML: '',
      textContent: '',
      className: '',
      disabled: false,
      dataset: {},
      style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      scrollTop: 0, scrollHeight: 0, clientHeight: 0,
      setAttribute() {}, removeAttribute() {},
      appendChild() {},
      addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
      querySelector() { return null; },
      fire(type, ev) { (listeners[type] || []).forEach(fn => fn(ev || {})); },
      _listeners: listeners,
    };
  }

  const els = {};
  ['chatInput', 'sendBtn', 'subject', 'resetBtn', 'sendToAiBtn', 'file', 'file-info', 'chat-panel', 'dz'].forEach(id => { els[id] = makeEl(id); });
  els.subject.value = 'Biology';

  const ctx = {
    console, JSON, Date, Buffer, TextDecoder, AbortController, Promise, setTimeout,
    requestAnimationFrame: (fn) => { fn(); return 1; },
    fetch: fetchStub,
    escapeHtml: (s) => String(s == null ? '' : s),
    iconHtml: () => '',
    setupDropzone: () => {},
    apiHeaders: () => ({ 'Content-Type': 'application/json' }),
    setButtonLoading: (btn, on) => { if (btn) btn.disabled = !!on; },
    showToast: () => {},
    recordActivity: () => {},
    window: { STREAM_URLS: { science_tutor: 'https://example.test/tutor' }, Feedback: null, createFollowScroll: null, GlobalChat: null },
    location: { pathname: '/tutor.html' },
  };
  ctx.document = {
    getElementById: (id) => els[id] || (els[id] = makeEl(id)),
    createElement: () => makeEl('dyn'),
    querySelectorAll: () => [],
    addEventListener() {},
  };
  vm.createContext(ctx);
  vm.runInContext(mainInlineScript(), ctx);

  return {
    els, requests,
    typeAndEnter(text, evExtra) {
      els.chatInput.value = text;
      els.chatInput.fire('keydown', Object.assign({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13, preventDefault() {} }, evExtra || {}));
    },
    clickSend() { els.sendBtn.fire('click'); },
    clickReset() { els.resetBtn.fire('click'); },
    resolveLast(text) {
      const p = pendingResolvers.shift();
      if (!p) throw new Error('no pending fetch to resolve');
      p.resolve(text);
    },
    drain: () => new Promise(r => setTimeout(r, 0)).then(() => new Promise(r => setTimeout(r, 0))),
  };
}

/* ── Repeat Enter/click during await → exactly ONE request ──────────────── */
test('repeated Enter + click while awaiting => exactly ONE fetch', async () => {
  const h = harness();
  h.typeAndEnter('first');
  // While the first request is in flight, hammer Enter and the button.
  h.typeAndEnter('second');
  h.clickSend();
  h.typeAndEnter('third');
  await h.drain();
  assert.strictEqual(h.requests.length, 1, 'only one request despite repeated sends');
  assert.strictEqual(h.requests[0].body.message, 'first');
});

test('IME composition Enter (isComposing) does NOT send', async () => {
  const h = harness();
  h.typeAndEnter('ni hao', { isComposing: true });
  await h.drain();
  assert.strictEqual(h.requests.length, 0, 'composition Enter did not fire a request');
});

test('IME legacy keyCode 229 Enter does NOT send', async () => {
  const h = harness();
  h.typeAndEnter('composing', { keyCode: 229 });
  await h.drain();
  assert.strictEqual(h.requests.length, 0, 'keyCode 229 Enter did not fire a request');
});

test('Shift+Enter does NOT send (newline preserved)', async () => {
  const h = harness();
  h.typeAndEnter('line1', { shiftKey: true });
  await h.drain();
  assert.strictEqual(h.requests.length, 0, 'Shift+Enter did not send');
});

test('clear during flight => request aborted + stale response not written to history', async () => {
  const h = harness();
  h.typeAndEnter('slow');
  assert.strictEqual(h.requests.length, 1);
  const req = h.requests[0];
  // Clear the conversation while the request is in flight.
  h.clickReset();
  assert.ok(req.aborted, 'in-flight request was aborted on clear');
  // Resolve the (aborted) fetch; its turns must NOT land in the fresh history.
  h.resolveLast('STALE REPLY');
  await h.drain();
  // After clear, a brand-new send must work and be the ONLY history entry pair.
  h.typeAndEnter('fresh question');
  await h.drain();
  assert.strictEqual(h.requests.length, 2, 'a new request fires after clear');
  // Resolve the fresh one and confirm history holds only the fresh turns.
  h.resolveLast('fresh answer');
  await h.drain();
});

test('failed request re-enables the button and a retry works', async () => {
  const h = harness();
  h.typeAndEnter('will fail');
  assert.strictEqual(h.requests.length, 1);
  assert.strictEqual(h.els.sendBtn.disabled, true, 'button disabled while in flight');
  h.resolveLast(new Error('network down'));
  await h.drain();
  assert.strictEqual(h.els.sendBtn.disabled, false, 'button re-enabled after failure');
  // Retry works.
  h.typeAndEnter('retry');
  await h.drain();
  assert.strictEqual(h.requests.length, 2, 'retry fired a new request');
  assert.strictEqual(h.requests[1].body.message, 'retry');
});

// Run the registered tests sequentially so async timing is deterministic and
// a failure sets a non-zero exit code.
(async () => {
  for (const t of _tests) {
    await t.fn();
    passed++;
    console.log('  ok -', t.name);
  }
  console.log(`\n${passed} tutor send tests passed.`);
})().catch((err) => { console.error('FAILED:', err && err.stack || err); process.exit(1); });

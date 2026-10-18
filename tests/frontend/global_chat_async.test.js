/* Regression tests for the Global Lab Assistant (frontend/global-chat.js):
 *   Area 1  — a SHARED body must reach the model on the FIRST share into an
 *             empty session (the old apiHistory.pop() dropped it); dedupe of a
 *             repeated identical inject; a normal sendUser still sends its text
 *             as `message` and does not duplicate it in `history`.
 *   Area 2b — send then immediate clearHistory() must leave no stale assistant
 *             turn written back after the (aborted) response resolves.
 *
 * These execute the ACTUAL source slices (loaded via vm) with a stubbed fetch
 * that captures the request body — they do NOT re-implement the functions.
 * Not a browser/device test. Run: node tests/frontend/global_chat_async.test.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, 'frontend', f), 'utf8');
const slice = (s, a, b) => {
  const i = s.indexOf(a); const j = s.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error('markers not found: ' + a + ' .. ' + b);
  return s.slice(i, j);
};
let passed = 0;
// Sync tests run inline. Async tests are collected and awaited in a runner at
// the bottom so a rejected assertion makes the PROCESS exit non-zero (the old
// fire-and-forget version could print a stack but still exit 0).
const asyncTests = [];
const test = (name, fn) => { fn(); passed++; console.log('  ok -', name); };
const testAsync = (name, fn) => { asyncTests.push({ name, fn }); };
// Any unhandled rejection must fail the run, not be swallowed.
process.on('unhandledRejection', (err) => {
  console.error('  FAIL - unhandled rejection:', err && err.stack || err);
  process.exit(1);
});

const gc = read('global-chat.js');

/* Pull the REAL implementation of the functions under test out of the IIFE.
 * We stitch the exact source slices together inside a fresh vm context that
 * provides the module-scoped vars (state, activeAbort, SOURCE_LABEL, esc, …)
 * the slices reference, so the test drives production code verbatim. */
function harness(opts) {
  opts = opts || {};
  // Capture every fetch request. Each request carries its OWN resolver so the
  // test can control multiple in-flight requests independently (duplicate send,
  // clear-then-new-send-then-old-returns, …).
  const requests = [];
  const fetchStub = (url, init) => {
    const parsed = JSON.parse(init.body);
    const req = { url, init, body: parsed, signal: init.signal };
    return new Promise((resolve, reject) => {
      req.resolveText = (text) => {
        let served = false;
        resolve({
          ok: true,
          body: {
            getReader() {
              return {
                read() {
                  if (served) return Promise.resolve({ done: true });
                  served = true;
                  return Promise.resolve({ done: false, value: Buffer.from(text, 'utf8') });
                },
              };
            },
          },
        });
      };
      req.rejectError = (err) => reject(err);
      requests.push(req);
    });
  };

  const ctx = {
    console,
    JSON,
    Date,
    Buffer,
    TextDecoder,
    AbortController,
    Promise,
    setTimeout,
    requestAnimationFrame: (fn) => { fn(); return 1; },
    cancelAnimationFrame: () => {},
    fetch: fetchStub,
    localStorage: (() => {
      let store = {};
      return {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
      };
    })(),
    window: {
      STREAM_URLS: { science_tutor: 'https://example.test/tutor' },
      apiHeaders: () => ({ 'Content-Type': 'application/json' }),
      getSavedSubject: () => 'Biology',
      matchMedia: () => ({ matches: false }),
    },
    document: {
      getElementById: () => null,     // render()/open() DOM no-ops in this harness
      createElement: () => ({ classList: { add() {}, remove() {} }, setAttribute() {}, addEventListener() {}, appendChild() {} }),
      body: { appendChild() {} },
      documentElement: { dataset: {} },
      readyState: 'complete',
      addEventListener() {},
    },
  };
  ctx.window.escapeHtml = (s) => String(s == null ? '' : s);
  ctx.window.showToast = () => {};
  vm.createContext(ctx);

  // Build a module body: the shared helpers + the functions under test, then
  // expose them. We slice the real source so there is zero re-implementation.
  const stateDecl = `
    const STORAGE_KEY = 'vsl.globalChat';
    const MAX_MESSAGES = 100;
    ${slice(gc, '  const SOURCE_LABEL = {', '  /* ── State')}
    let state = { messages: [] };
    let isOpen = false, hasUnread = false;
    let activeAbort = null;
    let replyInFlight = false;
    let chatGen = 0;
    const esc = (s) => String(s == null ? '' : s);
    function saveHistory(s) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) {} }
    function render() {}
    function open() { isOpen = true; }
    function pushMessage(msg) { state.messages.push({ ts: Date.now(), ...msg }); saveHistory(state); render(); }
  `;
  const fns = [
    slice(gc, '  function buildApiHistory() {', '  async function streamReply'),
    slice(gc, '  async function streamReply(userText, opts) {', '  function sendUser(text) {'),
    slice(gc, '  function sendUser(text) {', '  function injectContent'),
    slice(gc, '  function injectContent(content, sourcePage, sourceLabel) {', '  /* ── Open / close'),
    slice(gc, '  function clearHistory() {', '  /* ── Init'),
  ].join('\n');
  const expose = `
    ;this.__api = {
      buildApiHistory, streamReply, sendUser, injectContent, clearHistory,
      getState: () => state,
      setState: (s) => { state = s; },
      inFlight: () => replyInFlight,
    };
  `;
  vm.runInContext(stateDecl + fns + expose, ctx);
  return { api: ctx.__api, requests, ctx };
}

// Drain pending microtasks/timers a few times so awaited fetch chains settle.
const drain = async () => {
  for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0));
};

/* ── Area 1: first share into an empty session carries the body ──────────── */
test('inject: FIRST share into empty session sends the body in history (not dropped)', () => {
  const h = harness();
  const MARKER = 'UNIQUE_BODY_MARKER_9f3a';
  h.api.injectContent(`Photosynthesis notes ${MARKER}`, 'experiment', '🧪 Experiment');
  assert.strictEqual(h.requests.length, 1, 'exactly one request fired');
  const req = h.requests[0];
  // The body must be present in history exactly once, folded as context.
  const hits = req.body.history.filter(t => typeof t.content === 'string' && t.content.includes(MARKER));
  assert.strictEqual(hits.length, 1, 'body marker appears exactly once in history');
  assert.ok(hits[0].content.includes('[Context from'), 'body folded as labeled context');
  // The `message` is the ack prompt — NOT the body.
  assert.ok(!req.body.message.includes(MARKER), 'message is the ack prompt, not the body');
  assert.ok(/acknowledge/i.test(req.body.message), 'message is the ack prompt');
});

test('inject: same content twice in a row does NOT stack two page-inject turns', () => {
  const h = harness();
  const MARKER = 'DUP_MARKER_7bb1';
  h.api.injectContent(`Cells ${MARKER}`, 'lab-tools', '🧰 Lab Tools');
  h.api.injectContent(`Cells ${MARKER}`, 'lab-tools', '🧰 Lab Tools');
  const injects = h.api.getState().messages.filter(m => m.source === 'page-inject');
  assert.strictEqual(injects.length, 1, 'only one page-inject turn for identical repeated share');
});

test('sendUser: text goes to `message`, not duplicated in history', () => {
  const h = harness();
  h.api.sendUser('What is osmosis?');
  assert.strictEqual(h.requests.length, 1);
  const req = h.requests[0];
  assert.strictEqual(req.body.message, 'What is osmosis?', 'live text sent as message');
  const dupes = req.body.history.filter(t => t.content === 'What is osmosis?');
  assert.strictEqual(dupes.length, 0, 'live text not also present in history');
});

/* ── Area 1 (request count): duplicate share fires ONE request, not two ──── */
test('inject: same body twice in a row fires exactly ONE request (not just dedup history)', () => {
  const h = harness();
  const M = 'SHARE_ONCE_a21';
  h.api.injectContent(`Mitosis ${M}`, 'lab-tools', '🧰 Lab Tools');
  h.api.injectContent(`Mitosis ${M}`, 'lab-tools', '🧰 Lab Tools');
  assert.strictEqual(h.requests.length, 1, 'duplicate identical share must not fire a second generation');
});

/* ── Area 2a (request count): repeat send while awaiting => ONE request ──── */
testAsync('sendUser: a second send while awaiting the first is REFUSED (one request)', async (h) => {
  h.api.sendUser('first question');
  assert.strictEqual(h.requests.length, 1, 'first send fired');
  assert.strictEqual(h.api.inFlight(), true, 'in-flight flag set while awaiting');
  // Second send BEFORE the first resolves must be refused — no 2nd request.
  const started = h.api.sendUser('second question while waiting');
  assert.strictEqual(started, false, 'second send refused (returns false)');
  assert.strictEqual(h.requests.length, 1, 'still exactly one request');
  // Resolve the first; afterwards a new send is allowed again.
  h.requests[0].resolveText('answer one');
  await drain();
  assert.strictEqual(h.api.inFlight(), false, 'in-flight cleared after resolve');
  h.api.sendUser('third question after first finished');
  assert.strictEqual(h.requests.length, 2, 'send allowed again after completion');
});

/* ── Area 2b: clear during flight → stale SUCCESS writes nothing back ────── */
testAsync('send then clearHistory before response resolves => stale SUCCESS not written', async (h) => {
  h.api.sendUser('slow question');
  assert.strictEqual(h.requests.length, 1);
  const first = h.requests[0];
  h.api.clearHistory();                       // aborts + bumps generation
  first.resolveText('STALE ASSISTANT TEXT that must never appear');
  await drain();
  const msgs = h.api.getState().messages;
  const leaked = msgs.filter(m => typeof m.content === 'string' && m.content.includes('STALE ASSISTANT TEXT'));
  assert.strictEqual(leaked.length, 0, 'cleared session has no stale assistant turn');
  assert.ok(msgs.every(m => m.source !== 'streaming'), 'no lingering streaming placeholder');
});

/* ── Area 2b: clear → NEW send → OLD request ERRORS => new msg untouched ─── */
testAsync('clear, send new, then OLD request network-errors => new message not clobbered', async (h) => {
  h.api.sendUser('old question');
  const oldReq = h.requests[0];
  h.api.clearHistory();                        // invalidate the old generation
  h.api.sendUser('brand new question');        // starts a fresh generation
  assert.strictEqual(h.requests.length, 2, 'new send fired its own request');
  const newReq = h.requests[1];
  // The OLD request now fails with a PLAIN network error (not an abort error).
  oldReq.rejectError(new Error('network down'));
  await drain();
  const msgs = h.api.getState().messages;
  // No message may carry the old error text — the stale error must be dropped.
  const errLeak = msgs.filter(m => typeof m.content === 'string' && m.content.includes('network down'));
  assert.strictEqual(errLeak.length, 0, 'stale error did NOT overwrite the new message');
  // Now the NEW request succeeds and DOES render into the current session.
  newReq.resolveText('fresh answer');
  await drain();
  const got = h.api.getState().messages.filter(m => typeof m.content === 'string' && m.content.includes('fresh answer'));
  assert.strictEqual(got.length, 1, 'the current request still renders its answer');
});

/* ── Area 2b (history content): after clear+new send, history has no old turn ── */
testAsync('after clear + new send, the new request history excludes pre-clear turns', async (h) => {
  h.api.sendUser('PRECLEAR_QUESTION_zzz');
  h.requests[0].resolveText('answer');
  await drain();
  h.api.clearHistory();
  h.api.sendUser('postclear question');
  const newReq = h.requests[h.requests.length - 1];
  const bleed = (newReq.body.history || []).filter(t => typeof t.content === 'string' && t.content.includes('PRECLEAR_QUESTION_zzz'));
  assert.strictEqual(bleed.length, 0, 'pre-clear turn must not appear in the post-clear request history');
});

/* ── Runner: await every async test; a rejection exits non-zero ──────────── */
(async () => {
  for (const t of asyncTests) {
    const h = harness();
    await t.fn(h);
    passed++;
    console.log('  ok -', t.name);
  }
  console.log(`\n${passed} global-chat async tests passed.`);
})().catch((err) => {
  console.error('  FAIL -', err && err.stack || err);
  process.exit(1);
});

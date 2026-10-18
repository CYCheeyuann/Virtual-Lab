/* Regression for Chapter detail out-of-order responses (Area 5 —
 * frontend/chapter.html inline <script>).
 *
 * Bug: openDetail() fetched with no request token, so opening chapter A then B
 * let whichever response resolved LAST win — a slow A (or a failing A) could
 * overwrite the modal the user is now looking at (B). The fix adds a monotonic
 * detailReqSeq; only the latest request may write modal content/error, and
 * closeDetail() bumps the seq so a post-close response is ignored.
 *
 * This test runs the REAL inline script under vm with a controllable deferred
 * fetch and a stubbed DOM, then drives openDetail directly for the three
 * orderings. It exercises the production guard, not a copy. Run:
 *   node tests/frontend/chapter_race.test.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'frontend', 'chapter.html'), 'utf8');

function mainInlineScript() {
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1].includes('async function openDetail')) return m[1];
  }
  throw new Error('chapter.html inline openDetail script not found');
}

let passed = 0;
const _tests = [];
const test = (name, fn) => { _tests.push({ name, fn }); };

function harness() {
  // Deferred fetches: each call returns a promise the test resolves by title.
  const pending = [];
  const fetchStub = (url, init) => {
    const body = JSON.parse(init.body);
    return new Promise((resolve) => {
      pending.push({ title: body.chapter_title, action: body.action, resolve });
    });
  };
  const resolveDetail = (title, data) => {
    const i = pending.findIndex(p => p.title === title && p.action === 'detail');
    if (i < 0) throw new Error('no pending detail fetch for ' + title);
    const p = pending.splice(i, 1)[0];
    p.resolve({ ok: true, json: () => Promise.resolve({ data }) });
  };
  const rejectDetail = (title, err) => {
    const i = pending.findIndex(p => p.title === title && p.action === 'detail');
    if (i < 0) throw new Error('no pending detail fetch for ' + title);
    const p = pending.splice(i, 1)[0];
    // Simulate a network/HTTP failure surfaced in the try/catch.
    p.resolve({ ok: false, json: () => Promise.reject(err || new Error('boom')) });
  };

  // Stub modal content element; track what gets written. querySelector returns
  // null (no flash button wiring needed) and appendChild is a no-op so
  // renderDetailContent (feedback widget) runs without throwing.
  const content = { innerHTML: '', querySelector: () => null, appendChild() {} };
  const backdrop = {
    style: { display: 'none' },
    classList: { add() {}, remove() {}, contains: () => false },
    parentElement: null,
    appendChild() {}, addEventListener() {},
  };
  const els = {
    'modal-content': content,
    'modal-backdrop': backdrop,
    'chapter-modal': { },
    'modal-close': { addEventListener() {} },
    subject: { value: 'Biology' },
    level: { value: 'SPM' },
    chapterTopic: { value: '' },
    'chapter-grid': { innerHTML: '', appendChild() {} },
    'chapter-grid-section': { style: {} },
    'copilot-section': { style: {} },
    'copilot-chat': { innerHTML: '' },
    runBtn: makeBtn(), resetBtn: makeBtn(), copilotSend: makeBtn(), copilotInput: makeBtn(),
  };
  function makeBtn() { return { innerHTML: '', value: '', addEventListener() {}, style: {} }; }

  const ctx = {
    console, JSON, Date, Promise, setTimeout,
    requestAnimationFrame: (fn) => { fn(); return 1; },
    fetch: fetchStub,
    escapeHtml: (s) => String(s == null ? '' : s),
    iconHtml: () => '',
    apiHeaders: () => ({ 'Content-Type': 'application/json' }),
    setButtonLoading: () => {},
    showToast: () => {},
    recordActivity: () => {},
    setSubjectTheme: () => {},
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    // No overlay-lock / trapFocus → openDetail falls back to plain display
    // toggling, which is enough to drive the request-ordering guard.
    window: { STREAM_URLS: { chapter_assistant: 'https://example.test/chapter' } },
    location: { pathname: '/chapter.html' },
  };
  ctx.document = {
    getElementById: (id) => els[id] || (els[id] = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, contains: () => false }, addEventListener() {} }),
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { appendChild() {} },
    addEventListener() {},
  };
  ctx.window.createOverlayLock = undefined;
  ctx.window.trapFocus = undefined;
  vm.createContext(ctx);
  vm.runInContext(mainInlineScript() + '\n;this.__openDetail = openDetail; this.__closeDetail = closeDetail;', ctx);

  return {
    content, resolveDetail, rejectDetail,
    openDetail: (title) => ctx.__openDetail({ title }, null),
    closeDetail: () => ctx.__closeDetail(),
    drain: () => new Promise(r => setTimeout(r, 0)).then(() => new Promise(r => setTimeout(r, 0))),
  };
}

/* ── A slow, B fast: B is current → A must not overwrite ────────────────── */
test('A slow / B fast: late A response does NOT overwrite current B', async () => {
  const h = harness();
  h.openDetail('Chapter A');
  h.openDetail('Chapter B');
  // B resolves first and renders.
  h.resolveDetail('Chapter B', { title: 'Chapter B', subtopics: ['b-topic'] });
  await h.drain();
  assert.ok(h.content.innerHTML.includes('Chapter B'), 'B rendered');
  // A resolves late — must be ignored.
  h.resolveDetail('Chapter A', { title: 'Chapter A', subtopics: ['a-topic'] });
  await h.drain();
  assert.ok(h.content.innerHTML.includes('Chapter B'), 'still showing B after late A');
  assert.ok(!h.content.innerHTML.includes('Chapter A'), 'A did not overwrite B');
});

/* ── A fast, B slow: B is current → A (already resolved) must not win ────── */
test('A fast / B slow: A resolving before B still never shows A', async () => {
  const h = harness();
  h.openDetail('Chapter A');
  h.openDetail('Chapter B');
  // A resolves first, but B is the current open → A ignored.
  h.resolveDetail('Chapter A', { title: 'Chapter A', subtopics: ['a-topic'] });
  await h.drain();
  assert.ok(!h.content.innerHTML.includes('Chapter A'), 'A ignored (not current)');
  // B resolves and wins.
  h.resolveDetail('Chapter B', { title: 'Chapter B', subtopics: ['b-topic'] });
  await h.drain();
  assert.ok(h.content.innerHTML.includes('Chapter B'), 'B rendered as the current chapter');
});

/* ── Response after close is ignored ────────────────────────────────────── */
test('response arriving after close does NOT repaint the modal', async () => {
  const h = harness();
  h.openDetail('Chapter A');
  h.closeDetail();
  h.content.innerHTML = 'CLOSED';   // simulate hidden/cleared state
  h.resolveDetail('Chapter A', { title: 'Chapter A', subtopics: ['a-topic'] });
  await h.drain();
  assert.strictEqual(h.content.innerHTML, 'CLOSED', 'closed modal not repainted by late response');
});

/* ── Failing earlier request must not overwrite current error/content ───── */
test('failed earlier A does NOT overwrite current B with an error', async () => {
  const h = harness();
  h.openDetail('Chapter A');
  h.openDetail('Chapter B');
  h.resolveDetail('Chapter B', { title: 'Chapter B', subtopics: ['b'] });
  await h.drain();
  h.rejectDetail('Chapter A', new Error('A failed'));
  await h.drain();
  assert.ok(h.content.innerHTML.includes('Chapter B'), 'B content intact');
  assert.ok(!h.content.innerHTML.includes('A failed'), 'failed A did not write an error over B');
});

(async () => {
  for (const t of _tests) { await t.fn(); passed++; console.log('  ok -', t.name); }
  console.log(`\n${passed} chapter race tests passed.`);
})().catch((err) => { console.error('FAILED:', err && err.stack || err); process.exit(1); });

/* Regression for Flashcards round-2 grading visibility (Area 6 —
 * frontend/flashcards.js).
 *
 * Bug: the session-done branch of showCurrentCard() sets actions.hidden=true
 * (hiding Hard/Okay/Easy on the end screen). Starting a NEW round (study the
 * same deck again, or a different deck) re-enters the card branch, which reset
 * summary/stage but NEVER reset actions.hidden — so round 2 opened with the
 * grading buttons stuck hidden. Fix: the card branch now sets
 * actions.hidden=false.
 *
 * This test loads the REAL flashcards.js IIFE under vm with a stubbed DOM +
 * localStorage and drives the ACTUAL study controller (startStudy / grade /
 * exitStudy / showCurrentCard, exposed via a Node-only test seam) so it
 * exercises production state logic, not a copy. The pure gesture reducer tests
 * live in flashcards_gesture.test.js and must stay green. Run:
 *   node tests/frontend/flashcards_round.test.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const src = fs.readFileSync(path.join(ROOT, 'frontend', 'flashcards.js'), 'utf8');

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ok -', name); };

function makeEl(id) {
  return {
    id,
    innerHTML: '', textContent: '', value: '',
    hidden: false, disabled: false,
    dataset: {}, style: {}, _listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, removeAttribute() {}, focus() {},
    appendChild() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    removeEventListener() {},
    fire(type, ev) { (this._listeners[type] || []).forEach(fn => fn(ev || {})); },
  };
}

function oneCardDeck(id) {
  const now = Date.now();
  return {
    id, subject: 'Biology', bab: 'Cells', topic: 'Round test',
    createdAt: now, updatedAt: now,
    dailyNewCap: 20, lastSessionDay: '1970-01-01', newServedToday: 0,
    cards: [{
      id: id + '-c1', front: 'Q1', back: 'A1', hint: null, tags: [],
      box: 1, lastReviewedAt: null, nextReviewDate: now, history: [],
    }],
  };
}

function harness(decks) {
  const els = {};
  const ids = [
    'fcStage', 'fcSummary', 'fcActions', 'fcHintRow', 'fcProgress', 'fcOverlay',
    'fcPrompt', 'fcAnswer', 'fcHintBtn', 'fcHint', 'fcExitBtn',
    'generateDeckBtn', 'newBab', 'subject', 'deckGrid',
  ];
  ids.forEach(id => { els[id] = makeEl(id); });
  const store = { 'vsl.flashcards': JSON.stringify({ version: 1, decks }) };

  const ctx = {
    console, JSON, Date, Math, setTimeout, clearTimeout, URLSearchParams,
    module: { exports: {} },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    // NOT the flashcards page + no autostudy → init() does nothing; we drive
    // the controller directly through the exposed seam.
    location: { pathname: '/other.html', search: '' },
  };
  ctx.window = {
    escapeHtml: (s) => String(s == null ? '' : s),
    ScrollLock: { lock: () => 'tok', release() {} },
    Feedback: null, showToast: () => {}, setupDropzone: null, Flashcards: null,
  };
  ctx.document = {
    readyState: 'complete',
    getElementById: (id) => els[id] || (els[id] = makeEl(id)),
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {},
    body: { style: {} },
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const controls = ctx.module.exports.__studyControls;
  assert.ok(controls && controls.startStudy, 'study controller test seam is exposed');
  return { els, controls };
}

/* ── Same deck studied twice: round 2 grading buttons visible again ─────── */
test('same deck: round-1 end hides grading, round-2 start re-shows it', () => {
  const deck = oneCardDeck('deck-A');
  const { els, controls } = harness([deck]);

  controls.startStudy('deck-A');
  assert.strictEqual(els.fcActions.hidden, false, 'round 1 card: grading visible');

  controls.grade('okay');   // only card graded → end screen
  assert.strictEqual(els.fcSummary.hidden, false, 'end screen shown');
  assert.strictEqual(els.fcActions.hidden, true, 'end screen hides grading');

  controls.exitStudy();
  // Round 2 — study the SAME deck again.
  controls.startStudy('deck-A');
  assert.strictEqual(els.fcActions.hidden, false, 'round 2: grading buttons visible again');
  assert.strictEqual(els.fcSummary.hidden, true, 'round 2: summary hidden, card showing');
  assert.notStrictEqual(els.fcStage.style.display, 'none', 'round 2: stage visible');
});

/* ── Different deck after an end screen also shows grading ──────────────── */
test('different deck after an end screen also shows grading buttons', () => {
  const a = oneCardDeck('deck-A');
  const b = oneCardDeck('deck-B');
  const { els, controls } = harness([a, b]);

  controls.startStudy('deck-A');
  controls.grade('easy');   // end screen for A
  assert.strictEqual(els.fcActions.hidden, true, 'A end screen hides grading');

  controls.exitStudy();
  controls.startStudy('deck-B');
  assert.strictEqual(els.fcActions.hidden, false, 'deck B round shows grading buttons');
});

console.log(`\n${passed} flashcards round tests passed.`);

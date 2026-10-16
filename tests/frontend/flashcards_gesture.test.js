/* Regression tests for flashcard touch gesture handling (mobile double-flip fix).
 *
 * Run with:  node tests/frontend/flashcards_gesture.test.js
 *
 * Lives OUTSIDE frontend/ so it is never synced to S3. It imports the SAME pure
 * functions the production handlers use (classifyFlashcardGesture +
 * decideClickFlip from flashcards.js) — it does not re-implement the logic.
 *
 * Covered:
 *  - a single tap flips exactly once (the synthetic click after a touch tap is
 *    suppressed, so no flip-then-flip-back);
 *  - two consecutive taps each flip normally;
 *  - a horizontal swipe grades without flipping (and the next card isn't flipped);
 *  - a vertical scroll does nothing;
 *  - pointercancel then a normal tap works;
 *  - mouse click and keyboard still flip.
 */
'use strict';

const assert = require('assert');
const path = require('path');
const { classifyFlashcardGesture, decideClickFlip, reducePointerGesture, createGestureState } = require(
  path.join(__dirname, '..', '..', 'frontend', 'flashcards.js')
);

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

/* A faithful model of the stage wiring that drives flips/grades through the
 * REAL shared functions. One touch tap = pointerdown→pointerup (arms suppress)
 * then a synthetic click. A mouse click = click only. */
function makeStage() {
  const s = { flips: 0, grades: [], suppressNextClick: false, down: false, moved: false, x0: 0, y0: 0, t0: 0 };
  s.pointerdown = (x, y, t) => { s.down = true; s.moved = false; s.x0 = x; s.y0 = y; s.t0 = t; };
  s.pointermove = (x, y) => { if (Math.abs(x - s.x0) > 10 || Math.abs(y - s.y0) > 10) s.moved = true; };
  s.pointercancel = () => { s.down = false; s.moved = false; s.suppressNextClick = true; };
  s.pointerup = (x, y, t) => {               // touch only
    if (!s.down) return;
    s.down = false;
    s.suppressNextClick = true;              // handler always arms suppression on touch
    const outcome = classifyFlashcardGesture(x - s.x0, y - s.y0, Math.max(1, t - s.t0), s.moved);
    if (outcome === 'grade-hard') s.grades.push('hard');
    else if (outcome === 'grade-easy') s.grades.push('easy');
    else if (outcome === 'flip') s.flips++;
  };
  s.click = () => {                          // synthetic (touch) or real (mouse)
    const d = decideClickFlip(s.suppressNextClick);
    s.suppressNextClick = d.suppressNextClick;
    if (d.flip) s.flips++;
  };
  s.touchTap = (x = 2, y = 2) => { s.pointerdown(x, y, 0); s.pointerup(x, y, 90); s.click(); };
  return s;
}

// ── Pure classifier ──────────────────────────────────────────────────────────
test('classify: tiny tap => flip', () =>
  assert.strictEqual(classifyFlashcardGesture(2, -3, 120, false), 'flip'));
test('classify: fast left swipe => grade-hard', () =>
  assert.strictEqual(classifyFlashcardGesture(-120, 5, 200, true), 'grade-hard'));
test('classify: fast right swipe => grade-easy', () =>
  assert.strictEqual(classifyFlashcardGesture(130, -4, 200, true), 'grade-easy'));
test('classify: vertical drag => none', () =>
  assert.strictEqual(classifyFlashcardGesture(4, -90, 150, true), 'none'));
test('classify: slow short nudge => none', () =>
  assert.strictEqual(classifyFlashcardGesture(30, 2, 400, true), 'none'));

// ── Real wiring: taps ────────────────────────────────────────────────────────
test('one touch tap => exactly one flip', () => {
  const s = makeStage(); s.touchTap();
  assert.strictEqual(s.flips, 1);
});
test('two consecutive touch taps => two flips', () => {
  const s = makeStage(); s.touchTap(); s.touchTap();
  assert.strictEqual(s.flips, 2);
});
test('one mouse click => one flip', () => {
  const s = makeStage(); s.click();
  assert.strictEqual(s.flips, 1);
});

// ── Real wiring: swipe grades, never flips, and next card not flipped ─────────
test('left swipe => one grade, zero flips', () => {
  const s = makeStage();
  s.pointerdown(200, 100, 0); s.pointermove(80, 102); s.pointerup(80, 102, 200); s.click();
  assert.deepStrictEqual(s.grades, ['hard']);
  assert.strictEqual(s.flips, 0);
});
test('swipe then tap on next card => grade then exactly one flip', () => {
  const s = makeStage();
  s.pointerdown(60, 100, 0); s.pointermove(190, 100); s.pointerup(190, 100, 200); s.click(); // swipe easy
  s.touchTap(); // next card tap
  assert.deepStrictEqual(s.grades, ['easy']);
  assert.strictEqual(s.flips, 1);
});

// ── Real wiring: scroll + pointercancel ──────────────────────────────────────
test('vertical scroll gesture => no flip, no grade', () => {
  const s = makeStage();
  s.pointerdown(100, 300, 0); s.pointermove(102, 180); s.pointerup(102, 180, 180); s.click();
  assert.strictEqual(s.flips, 0);
  assert.strictEqual(s.grades.length, 0);
});
test('pointercancel then a normal tap => one flip', () => {
  const s = makeStage();
  s.pointerdown(100, 100, 0); s.pointercancel(); s.click(); // cancelled gesture, stray click swallowed
  assert.strictEqual(s.flips, 0);
  s.touchTap();                                             // next real tap
  assert.strictEqual(s.flips, 1);
});

// ── Multi-touch state machine (real reducePointerGesture used by runtime) ────
// Uses the SAME createGestureState()/reducePointerGesture() the production
// pointer handlers call (flashcards.js dispatchGesture), so these drive the
// real state machine, not a copy.
function run(events) {
  let st = createGestureState();
  const actions = [];
  for (const ev of events) {
    const r = reducePointerGesture(st, ev);
    st = r.state;
    if (r.action) actions.push(r.action);
  }
  return { st, actions };
}

test('multi: single-finger tap => one flip', () => {
  const { actions } = run([
    { type: 'down', pointerId: 1, x: 100, y: 100, t: 0 },
    { type: 'up',   pointerId: 1, x: 102, y: 101, t: 90 },
  ]);
  assert.deepStrictEqual(actions, ['flip']);
});

test('multi: second finger covers start, first lifts => NO grade (cancelled)', () => {
  // finger1 down at x=100; finger2 down at x=200 (covers start); finger1 up at
  // x=100 → naive dx would be -100 (grade-hard), but multi-touch cancels it.
  const { actions } = run([
    { type: 'down', pointerId: 1, x: 100, y: 100, t: 0 },
    { type: 'down', pointerId: 2, x: 200, y: 100, t: 20 },
    { type: 'up',   pointerId: 1, x: 100, y: 100, t: 220 },
  ]);
  assert.deepStrictEqual(actions, []);
});

test('multi: second finger lifts first (different order) => NO action', () => {
  const { actions } = run([
    { type: 'down', pointerId: 1, x: 100, y: 100, t: 0 },
    { type: 'down', pointerId: 2, x: 200, y: 100, t: 20 },
    { type: 'up',   pointerId: 2, x: 240, y: 100, t: 120 },  // 2nd finger up first — ignored
    { type: 'up',   pointerId: 1, x: 100, y: 100, t: 200 },  // tracked finger up — cancelled
  ]);
  assert.deepStrictEqual(actions, []);
});

test('multi: tracked-finger pointercancel then fresh tap => one flip', () => {
  const { actions } = run([
    { type: 'down',   pointerId: 1, x: 100, y: 100, t: 0 },
    { type: 'cancel', pointerId: 1, x: 100, y: 100, t: 50 },
    { type: 'down',   pointerId: 2, x: 50,  y: 50,  t: 300 },
    { type: 'up',     pointerId: 2, x: 52,  y: 51,  t: 380 },
  ]);
  assert.deepStrictEqual(actions, ['flip']);
});

test('multi: clean left swipe (single finger) => grade-hard', () => {
  const { actions } = run([
    { type: 'down', pointerId: 1, x: 200, y: 100, t: 0 },
    { type: 'move', pointerId: 1, x: 90,  y: 102, t: 100 },
    { type: 'up',   pointerId: 1, x: 80,  y: 102, t: 200 },
  ]);
  assert.deepStrictEqual(actions, ['grade-hard']);
});

test('multi: secondary pointer up during single gesture is ignored, then tracked tap flips', () => {
  const { actions } = run([
    { type: 'down', pointerId: 1, x: 100, y: 100, t: 0 },
    { type: 'up',   pointerId: 9, x: 300, y: 300, t: 40 },   // stray/unknown pointer up — ignored
    { type: 'up',   pointerId: 1, x: 101, y: 101, t: 90 },   // tracked finger tap
  ]);
  assert.deepStrictEqual(actions, ['flip']);
});

// ── The review's exact "poison must persist until ALL fingers lift" sequence ──
test('multi: f1 down, f2 down, f1 up, f2 STILL held, f3 down+swipe => NO grade', () => {
  // Previously the single-id tracker cleared on f1 up and let f3 start a fresh
  // single-finger gesture (false grade) while f2 was still down. The active-set
  // + poison flag must suppress all custom gestures until every finger lifts.
  const r = run([
    { type: 'down', pointerId: 1, x: 100, y: 100, t: 0 },
    { type: 'down', pointerId: 2, x: 200, y: 100, t: 10 },   // poison
    { type: 'up',   pointerId: 1, x: 100, y: 100, t: 20 },   // f1 up, f2 still held
    { type: 'down', pointerId: 3, x: 300, y: 100, t: 30 },   // f3 lands (f2 held)
    { type: 'move', pointerId: 3, x: 180, y: 100, t: 110 },
    { type: 'up',   pointerId: 3, x: 170, y: 100, t: 120 },  // would be grade-hard if not poisoned
  ]);
  assert.deepStrictEqual(r.actions, []);
  assert.strictEqual(r.st.poisoned, true, 'still poisoned while finger 2 held');
  assert.deepStrictEqual(r.st.active, [2], 'finger 2 still tracked as active');
});

test('multi: after the poisoned sequence, lifting the last finger then a clean tap flips', () => {
  const r = run([
    { type: 'down', pointerId: 1, x: 100, y: 100, t: 0 },
    { type: 'down', pointerId: 2, x: 200, y: 100, t: 10 },
    { type: 'up',   pointerId: 1, x: 100, y: 100, t: 20 },
    { type: 'up',   pointerId: 2, x: 200, y: 100, t: 30 },   // ALL fingers up → poison clears
    { type: 'down', pointerId: 5, x: 50,  y: 50,  t: 400 },  // fresh single-finger tap
    { type: 'up',   pointerId: 5, x: 51,  y: 51,  t: 470 },
  ]);
  assert.deepStrictEqual(r.actions, ['flip']);
  assert.strictEqual(r.st.poisoned, false);
  assert.deepStrictEqual(r.st.active, []);
});

test('multi: pointercancel on one of two fingers, other still held => no action, stays poisoned', () => {
  const r = run([
    { type: 'down',   pointerId: 1, x: 100, y: 100, t: 0 },
    { type: 'down',   pointerId: 2, x: 200, y: 100, t: 10 },
    { type: 'cancel', pointerId: 1, x: 100, y: 100, t: 20 },
    { type: 'up',     pointerId: 2, x: 60,  y: 100, t: 120 },  // tracked? no — poisoned
  ]);
  assert.deepStrictEqual(r.actions, []);
  assert.deepStrictEqual(r.st.active, []);
  assert.strictEqual(r.st.poisoned, false);  // all up now
});

console.log(`\n${passed} flashcard gesture tests passed.`);

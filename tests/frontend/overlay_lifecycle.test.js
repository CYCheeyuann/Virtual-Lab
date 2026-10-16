/* Regression tests for overlay lifecycle: ScrollLock ref-counting/token
 * ownership, Chapter modal double-close/reopen, and the Tutor follow-scroll
 * state machine. These execute the ACTUAL source slices (loaded via vm) with a
 * mocked DOM, mirroring the review's probe but committed as a project test.
 * Not a browser/device test — layout and real touch/keyboard still need a
 * device. Run: node tests/frontend/overlay_lifecycle.test.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const vmMod = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, 'frontend', f), 'utf8');
const slice = (s, a, b) => {
  const i = s.indexOf(a); const j = s.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error('markers not found: ' + a + ' .. ' + b);
  return s.slice(i, j);
};
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ok -', name); };

/* ── ScrollLock: token ownership + ref counting + restore ─────────────────── */
(function scrollLockTests() {
  const common = read('common.js');
  const src = slice(common, 'window.ScrollLock = (function', '/* ============================================================\n *  SVG ICON LIBRARY');
  const body = { style: { overflow: 'scroll-prev' } };   // pre-existing inline overflow
  let scrolledTo = null;
  const ctx = {
    window: { scrollY: 250, scrollTo: (x, y) => { scrolledTo = y; } },
    document: { body, documentElement: { scrollTop: 250 } },
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const SL = ctx.window.ScrollLock;

  test('ScrollLock: two holders, inner double-release keeps lock until outer releases', () => {
    const a = SL.lock();          // holder A (e.g. flashcards)
    const b = SL.lock();          // holder B (e.g. chapter modal)
    assert.strictEqual(SL.count, 2);
    SL.release(b);                // B closes
    SL.release(b);                // B's animation calls release again — idempotent
    assert.strictEqual(SL.count, 1, 'A still holds the lock after B double-releases');
    assert.strictEqual(body.style.overflow, 'hidden', 'still locked');
    SL.release(a);                // A closes
    assert.strictEqual(SL.count, 0);
    assert.strictEqual(body.style.overflow, 'scroll-prev', 'restores PRIOR inline overflow, not blank');
    assert.strictEqual(scrolledTo, 250, 'restores saved scroll position');
  });

  test('ScrollLock: idempotent lock with same token counts once', () => {
    const t = SL.lock();
    SL.lock(t); SL.lock(t);
    assert.strictEqual(SL.count, 1);
    SL.release(t);
    assert.strictEqual(SL.count, 0);
  });
})();

/* ── Modal lifecycle: REAL createOverlayLock + REAL ScrollLock from common.js ── */
(function overlayLockTests() {
  const common = read('common.js');
  const slSrc = slice(common, 'window.ScrollLock = (function', '/* ============================================================\n *  FOLLOW-SCROLL');
  const olSrc = slice(common, 'function createOverlayLock(opts)', 'if (typeof window !== \'undefined\') window.createOverlayLock');
  const body = { style: { overflow: '' } };
  const ctx = { window: { scrollY: 0, scrollTo() {} }, document: { body, documentElement: { scrollTop: 0 } } };
  vm.createContext(ctx); vm.runInContext(slSrc, ctx);
  // Deterministic timers for the test.
  const timers = new Map(); let tid = 0;
  ctx.setTimeout = (fn) => { const id = ++tid; timers.set(id, fn); return id; };
  ctx.clearTimeout = (id) => { timers.delete(id); };
  const flush = () => { for (const [, fn] of timers) fn(); timers.clear(); };
  vm.runInContext(olSrc + '\n;this.__make = createOverlayLock;', ctx);
  const SL = ctx.window.ScrollLock;
  const makeCtl = (onHide) => ctx.__make({ hideMs: 300, onHide, setTimeout: ctx.setTimeout, clearTimeout: ctx.clearTimeout, scrollLock: SL });

  test('overlayLock: double-close does NOT over-release another holder', () => {
    const other = SL.lock();                 // another overlay holds a lock
    const ctl = makeCtl(() => {});
    ctl.open();
    assert.strictEqual(SL.count, 2);
    ctl.close(); ctl.close();                // stray second close during animation
    assert.strictEqual(SL.count, 1, 'other overlay keeps its lock');
    SL.release(other);
    assert.strictEqual(SL.count, 0);
    flush();
  });

  test('overlayLock: reopen during close animation cancels the stale hide', () => {
    let hideCalls = 0;
    const ctl = makeCtl(() => { hideCalls++; });
    ctl.open();
    ctl.close();                             // schedules onHide
    ctl.open();                              // reopen before it fires — cancels it
    flush();
    assert.strictEqual(hideCalls, 0, 'stale hide did not fire for the reopened modal');
    assert.strictEqual(ctl.isOpen(), true);
    ctl.close(); flush();
    assert.strictEqual(hideCalls, 1, 'hide fires once after the real close');
    assert.strictEqual(SL.count, 0);
  });

  test('overlayLock: open is idempotent (locks once)', () => {
    const ctl = makeCtl(() => {});
    ctl.open(); ctl.open(); ctl.open();
    assert.strictEqual(SL.count, 1);
    ctl.close(); flush();
    assert.strictEqual(SL.count, 0);
  });
})();

/* ── Tutor follow-scroll: drives the REAL createFollowScroll from common.js ── */
(function tutorFollowTests() {
  // Load the actual helper tutor.html uses (sliced from common.js) so these
  // tests exercise production code, not a copy.
  const common = read('common.js');
  const src = slice(common, 'function createFollowScroll(panel, opts)', 'if (typeof window !==');
  const ctx = { requestAnimationFrame: (fn) => { fn(); return 1; }, setTimeout: (fn) => { fn(); return 1; } };
  vm.createContext(ctx);
  vm.runInContext(src + '\n;this.__make = createFollowScroll;', ctx);
  const createFollowScroll = ctx.__make;

  // Minimal panel stub with a real listener list.
  function makePanel(scrollTop) {
    const listeners = [];
    return {
      scrollHeight: 1000, clientHeight: 400, scrollTop,
      addEventListener(_t, fn) { listeners.push(fn); },
      removeEventListener(_t, fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
      fireScroll() { listeners.forEach(fn => fn()); },
      listenerCount() { return listeners.length; },
    };
  }

  test('tutor: user scrolls UP before first chunk => not yanked to bottom', () => {
    // Controller is created while the user is already scrolled up (pre-fetch).
    const panel = makePanel(100);              // 100 == scrolled up (not near bottom)
    const fs = createFollowScroll(panel);
    assert.strictEqual(fs.isFollowing(), false, 'init from real position: not following');
    const before = panel.scrollTop;
    panel.scrollHeight += 20; fs.onContentGrow();   // first chunk arrives
    assert.strictEqual(panel.scrollTop, before, 'stayed where the user was reading');
    fs.destroy();
  });

  test('tutor: at bottom => follows new chunks', () => {
    const panel = makePanel(600);              // 1000-400 = 600 == at bottom
    const fs = createFollowScroll(panel);
    assert.strictEqual(fs.isFollowing(), true);
    panel.scrollHeight += 20; fs.onContentGrow();
    assert.strictEqual(panel.scrollTop, panel.scrollHeight, 'followed to bottom');
    fs.destroy();
  });

  test('tutor: scroll up mid-stream then back to bottom => follow resumes', () => {
    const panel = makePanel(600);
    const fs = createFollowScroll(panel);
    // user scrolls up
    panel.scrollTop = 100; panel.fireScroll();
    assert.strictEqual(fs.isFollowing(), false);
    let before = panel.scrollTop;
    panel.scrollHeight += 20; fs.onContentGrow();
    assert.strictEqual(panel.scrollTop, before, 'not yanked while reading');
    // user scrolls back to bottom
    panel.scrollTop = panel.scrollHeight - panel.clientHeight; panel.fireScroll();
    assert.strictEqual(fs.isFollowing(), true, 'follow resumed at bottom');
    panel.scrollHeight += 20; fs.onContentGrow();
    assert.strictEqual(panel.scrollTop, panel.scrollHeight, 'resumed following');
    fs.destroy();
    assert.strictEqual(panel.listenerCount(), 0, 'destroy removes the listener');
  });
})();

/* ── Chat close(reason): focus handoff ────────────────────────────────────── */
(function closeFocusTests() {
  const gc = read('global-chat.js');
  const closeSrc = slice(gc, '  function close(reason) {', '  function toggle()');

  function makeCtx(reason, opts) {
    opts = opts || {};
    const fabFocus = { n: 0 };
    const fab = {
      _hidden: false,
      classList: { remove() { fab._hidden = false; }, add() { fab._hidden = true; }, contains: () => fab._hidden },
      focus() { fabFocus.n++; },
    };
    const panel = { contains: () => false, classList: { remove() {}, add() {} }, setAttribute() {}, removeAttribute() {} };
    const rafQueue = [];
    const ctx = {
      gcFocusTimer: 0, gcFocusRaf: 0, isOpen: true,
      clearTimeout() {}, cancelAnimationFrame() {},
      requestAnimationFrame: (fn) => { rafQueue.push(fn); return 1; },
      window: { Toolkit: opts.toolkitOpen ? { isOpen: true } : null },
      document: {
        activeElement: null,
        visibilityState: 'visible',
        documentElement: { dataset: { gcLocked: opts.locked ? '1' : undefined } },
        getElementById: (id) => (id === 'gc-fab' ? fab : panel),
      },
      __fabFocus: fabFocus, __raf: rafQueue,
    };
    vm.createContext(ctx);
    vm.runInContext(closeSrc + '\n;this.__close = close;', ctx);
    return { ctx, run: (r) => { ctx.__close(r); ctx.__raf.forEach((fn) => fn()); return fabFocus.n; } };
  }

  test('chat close("user") => restores focus to FAB', () => {
    const h = makeCtx('user');
    assert.strictEqual(h.run('user'), 1);
  });
  test('chat × wiring: the gc-close click handler calls close("user") (not close(event))', () => {
    // Verify the ACTUAL binding form from global-chat.js: the close button must
    // be wired as `() => close('user')`, otherwise the MouseEvent is passed as
    // `reason` and focus restore (reason === 'user') silently breaks.
    const srcLine = read('global-chat.js');
    assert.ok(
      srcLine.includes("getElementById('gc-close').addEventListener('click', () => close('user'))"),
      'gc-close must be wired via an arrow calling close("user")'
    );
    // And prove the real close() restores focus when invoked exactly as that
    // wrapper does (reason string, not an event object).
    const h = makeCtx('user');
    const wrapper = () => h.ctx.__close('user');   // mirrors the production arrow
    wrapper(); h.ctx.__raf.forEach((fn) => fn());
    assert.strictEqual(h.ctx.__fabFocus.n, 1);
  });
  test('chat close("takeover") (toolkit opening) => does NOT focus FAB', () => {
    const h = makeCtx('takeover', { toolkitOpen: true });
    assert.strictEqual(h.run('takeover'), 0);
  });
  test('chat close("lock") (quiz lock) => does NOT focus FAB', () => {
    const h = makeCtx('lock', { locked: true });
    assert.strictEqual(h.run('lock'), 0);
  });
  test('chat close("lifecycle") => does NOT focus FAB', () => {
    const h = makeCtx('lifecycle');
    assert.strictEqual(h.run('lifecycle'), 0);
  });
})();

/* ── Modal focus trap + restore (real trapFocus from common.js) ───────────── */
(function trapFocusTests() {
  const common = read('common.js');
  const src = slice(common, 'function trapFocus(panel, trigger', 'if (typeof window !== \'undefined\') window.trapFocus');

  // Build a tiny DOM model: a modal with 2 focusable buttons + a background
  // button + a trigger. document.activeElement tracks focus() calls.
  function makeEl(name) {
    return {
      name, _tabindex: null, offsetParent: {}, // visible by default
      focus() { env.active = this; }, setAttribute(k, v) { if (k === 'tabindex') this._tabindex = v; },
      querySelectorAll() { return []; },
    };
  }
  let env;
  function setup(triggerAlive) {
    const closeBtn = makeEl('close'), linkBtn = makeEl('link'), bgBtn = makeEl('bg');
    const trigger = makeEl('trigger');
    const panel = {
      _items: [closeBtn, linkBtn],
      querySelectorAll() { return this._items; },
      contains(el) { return this._items.includes(el); },
      focus() { env.active = this; }, setAttribute() {},
    };
    const keydownHandlers = [];
    const focusinHandlers = [];
    env = {
      active: bgBtn,                    // focus starts in the background
      keydownHandlers, focusinHandlers,
      document: {
        get activeElement() { return env.active; },
        contains: (el) => triggerAlive ? [closeBtn, linkBtn, bgBtn, trigger].includes(el)
                                       : [closeBtn, linkBtn, bgBtn].includes(el),
        addEventListener: (t, fn) => {
          if (t === 'keydown') keydownHandlers.push(fn);
          else if (t === 'focusin') focusinHandlers.push(fn);
        },
        removeEventListener: (t, fn) => {
          const arr = t === 'keydown' ? keydownHandlers : t === 'focusin' ? focusinHandlers : null;
          if (arr) { const i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1); }
        },
        querySelector: () => bgBtn,     // fallback target
      },
      panel, trigger, closeBtn, linkBtn, bgBtn,
    };
    const ctx = { document: env.document };
    vm.createContext(ctx);
    vm.runInContext(src + '\n;this.__trap = trapFocus;', ctx);
    return ctx.__trap;
  }

  test('trapFocus: moves focus into the modal on open', () => {
    const trap = setup(true);
    const release = trap(env.panel, env.trigger);
    assert.strictEqual(env.active, env.closeBtn, 'focus moved to first focusable');
    release();
  });

  test('trapFocus: Tab from last cycles to first (focus stays inside)', () => {
    const trap = setup(true);
    const release = trap(env.panel, env.trigger);
    env.active = env.linkBtn;           // last focusable
    let prevented = false;
    env.keydownHandlers[0]({ key: 'Tab', shiftKey: false, preventDefault() { prevented = true; } });
    assert.ok(prevented, 'Tab at last item is intercepted');
    assert.strictEqual(env.active, env.closeBtn, 'cycled back to first (not background)');
    release();
  });

  test('trapFocus: focus escaped to background is pulled back in', () => {
    const trap = setup(true);
    const release = trap(env.panel, env.trigger);
    env.active = env.bgBtn;             // somehow in the background
    env.keydownHandlers[0]({ key: 'Tab', shiftKey: false, preventDefault() {} });
    assert.strictEqual(env.active, env.closeBtn, 'focus pulled back into modal');
    release();
  });

  test('trapFocus: release restores focus to the trigger', () => {
    const trap = setup(true);
    const release = trap(env.panel, env.trigger);
    release();
    assert.strictEqual(env.active, env.trigger, 'focus returned to trigger element');
  });

  test('trapFocus: release falls back when trigger is gone', () => {
    const trap = setup(false);          // trigger not in document anymore
    const release = trap(env.panel, env.trigger);
    release();
    assert.strictEqual(env.active, env.bgBtn, 'fell back to a sane target, not the detached trigger');
  });

  test('trapFocus: release is idempotent (second call does not re-restore)', () => {
    const trap = setup(true);
    const release = trap(env.panel, env.trigger);
    release();
    env.active = env.closeBtn;          // simulate focus moving elsewhere after
    release();                          // second call must do nothing
    assert.strictEqual(env.active, env.closeBtn, 'second release did not steal focus back');
  });

  test('trapFocus: fallbackResolver used when trigger detached (re-rendered card)', () => {
    const trap = setup(false);          // original trigger detached
    const replacement = env.linkBtn;    // stand-in for the re-rendered card
    const release = trap(env.panel, env.trigger, () => replacement);
    release();
    assert.strictEqual(env.active, replacement, 'restored to the resolver target (re-rendered card)');
  });

  test('trapFocus: programmatic focus steal to background is pulled back (focusin guard)', () => {
    const trap = setup(true);
    const release = trap(env.panel, env.trigger);
    // Simulate a stale deferred focus() landing on a background element, which
    // dispatches a focusin the trap must catch.
    env.active = env.bgBtn;
    const focusinHandlers = env.focusinHandlers || [];
    focusinHandlers.forEach((fn) => fn({ target: env.bgBtn }));
    assert.strictEqual(env.active, env.closeBtn, 'focusin guard pulled focus back into the modal');
    release();
  });
})();

/* ── Chapter card keyboard wiring (source assertion) ──────────────────────── */
(function chapterCardWiring() {
  const html = read('chapter.html');
  test('chapter card: focusable + role=button + Enter/Space opens detail', () => {
    assert.ok(html.includes('card.tabIndex = 0'), 'card is focusable (tabIndex 0)');
    assert.ok(html.includes("card.setAttribute('role', 'button')"), 'card has button role');
    assert.ok(/key === 'Enter' \|\| e\.key === ' '/.test(html), 'Enter/Space handled');
    assert.ok(html.includes('e.preventDefault()'), 'prevents Space-scroll / double fire');
  });
  test('chapter close: restores focus with a same-index fallback resolver', () => {
    assert.ok(html.includes('.chapter-card[data-index="${idx}"]'), 'fallback resolves re-rendered card by index');
    assert.ok(html.includes('modalFocusRelease = window.trapFocus('), 'trap wired with trigger + fallback');
  });
})();

console.log(`\n${passed} overlay/lifecycle tests passed.`);

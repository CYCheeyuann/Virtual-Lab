/* Regression for the Quiz History mobile layout fix (frontend/styles.css +
 * frontend/quiz.html renderHistory()).
 *
 * The bug: .quiz-history-item was a single flex row (flex-wrap) with four
 * children, so on narrow screens the title block collapsed to a sliver and
 * ordinary words wrapped character-by-character, ballooning card height.
 *
 * These are STRUCTURAL assertions against the REAL source (sliced, not copied)
 * that lock in the properties that prevent the bug. The authoritative visual
 * check is the puppeteer measurement harness (_quiz_history_measure.js), which
 * needs a real browser; this file is the browser-free CI guard.
 *   node tests/frontend/quiz_history_layout.test.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const css = fs.readFileSync(path.join(ROOT, 'frontend', 'styles.css'), 'utf8');
const quiz = fs.readFileSync(path.join(ROOT, 'frontend', 'quiz.html'), 'utf8');
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ok -', name); };

// Grab every rule whose selector mentions a history class, with its block.
function rulesMatching(re) {
  const out = [];
  const rx = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = rx.exec(css))) {
    const sel = m[1].trim();
    if (re.test(sel)) out.push({ sel, body: m[2].trim() });
  }
  return out;
}

/* ── Scoping: every history rule is under #phase-history ─────────────────── */
test('all quiz-history CSS rules are scoped under #phase-history (no global leak)', () => {
  const historyRules = rulesMatching(/quiz-history-item|history-meta|history-score|history-actions|history-status|history-delete/);
  assert.ok(historyRules.length >= 6, 'expected several history rules, got ' + historyRules.length);
  const leaked = historyRules.filter(r => !r.sel.includes('#phase-history'));
  assert.deepStrictEqual(leaked.map(r => r.sel), [],
    'these history rules are NOT scoped under #phase-history: ' + leaked.map(r => r.sel).join(' | '));
});

test('the fix did not turn generic .btn / .btn-sm / .card into history-specific rules', () => {
  // .btn-sm stays a shared global rule (pre-existing) but must NOT carry
  // history-only layout like grid-area/flex:1 that would affect other pages.
  const btnSm = rulesMatching(/^\.btn-sm$/);
  btnSm.forEach(r => {
    assert.ok(!/grid-area|flex:\s*1|min-height:\s*44/.test(r.body),
      '.btn-sm global rule must not carry history-only layout: ' + r.body);
  });
});

/* ── Desktop base: a grid, not a single wrapping flex row ────────────────── */
test('base .quiz-history-item is a GRID (not the old flex-wrap single row)', () => {
  const base = rulesMatching(/#phase-history \.quiz-history-item$/)[0];
  assert.ok(base, 'base rule present');
  assert.ok(/display:\s*grid/.test(base.body), 'uses grid layout');
  assert.ok(/grid-template-areas/.test(base.body), 'declares named areas');
  assert.ok(!/flex-wrap/.test(base.body), 'no flex-wrap single-row layout');
});

/* ── Mobile: stacks to one column so the title gets full width ───────────── */
test('mobile media query stacks the grid to a single column', () => {
  // Find the <=600px media block that actually contains the history rules
  // (styles.css has several max-width:600px blocks for different features).
  const extractBlock = (startIdx) => {
    let depth = 0, j = css.indexOf('{', startIdx), end = j;
    for (let k = j; k < css.length; k++) {
      if (css[k] === '{') depth++;
      else if (css[k] === '}') { depth--; if (depth === 0) { end = k; break; } }
    }
    return { block: css.slice(startIdx, end + 1), end };
  };
  let searchFrom = 0, block = null;
  while (true) {
    const i = css.indexOf('@media (max-width: 600px)', searchFrom);
    if (i < 0) break;
    const r = extractBlock(i);
    if (r.block.includes('#phase-history .quiz-history-item')) { block = r.block; break; }
    searchFrom = r.end + 1;
  }
  assert.ok(block, 'found a <=600px media block containing the history rules');
  assert.ok(/#phase-history \.quiz-history-item\s*\{[^}]*grid-template-columns:\s*1fr/.test(block),
    'mobile collapses the card to a single 1fr column');
  assert.ok(/history-actions[^}]*min-height:\s*44px/.test(block) ||
            /\.btn-sm\s*\{[^}]*min-height:\s*44px/.test(block),
    'mobile action buttons get a >=44px touch height');
  assert.ok(/history-delete-label\s*\{\s*display:\s*inline/.test(block),
    'mobile shows the Delete text label');
});

/* ── Markup: actions wrapped + delete keeps icon + accessible name ───────── */
test('renderHistory markup wraps the buttons and keeps delete a11y', () => {
  const i = quiz.indexOf('host.innerHTML = hist.map');
  const seg = quiz.slice(i, i + 1200);
  assert.ok(/class="history-actions"/.test(seg), 'actions container present');
  assert.ok(/data-act="retake"/.test(seg) && /data-act="delete"/.test(seg), 'data-* bindings kept');
  assert.ok(/aria-label="Delete this quiz"/.test(seg), 'delete has an explicit aria-label');
  assert.ok(/history-delete-label">Delete</.test(seg), 'delete has a text label element for mobile');
  assert.ok(/iconHtml\('trash'/.test(seg), 'delete keeps its trash icon');
  // Title block is first so it can take the full first row on mobile.
  assert.ok(seg.indexOf('history-meta') < seg.indexOf('history-score'), 'title/meta rendered before score');
  assert.ok(seg.indexOf('history-score') < seg.indexOf('history-actions'), 'score rendered before actions');
});

console.log(`\n${passed} quiz-history layout tests passed.`);

/* Regression for Quiz safe rendering (Area 4a — frontend/quiz.html).
 *
 * The results explanation line used to interpolate q.correct_answer RAW into
 * innerHTML (`❌ Correct: ${q.correct_answer}` and the "Not answered" branch),
 * the one unescaped sink. The fix routes it through quizHtml().
 *
 * IMPORTANT: this test drives the REAL finishQuiz() production function (sliced
 * verbatim from quiz.html and run under vm against a fake DOM that records
 * innerHTML). It does NOT reconstruct the template — so if finishQuiz ever
 * regresses to raw interpolation, this test FAILS. It feeds a correct_answer /
 * option / explanation carrying an XSS payload and asserts every rendered
 * innerHTML string is inert (escaped), never a live tag. It also asserts the
 * pre-submit renderQuiz() template never emits the correct answer.
 *   node tests/frontend/quiz_render.test.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'frontend', 'quiz.html'), 'utf8');
const common = fs.readFileSync(path.join(ROOT, 'frontend', 'common.js'), 'utf8');
const slice = (s, a, b) => {
  const i = s.indexOf(a); const j = s.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error('markers not found: ' + a + ' .. ' + b);
  return s.slice(i, j);
};
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ok -', name); };

const escSrc = slice(common, 'function escapeHtml(s) {', '/* ============================================================\n *  SUBJECT THEME');
const quizHtmlSrc = slice(html, '    function quizHtml(s) {', '    // ── Button icons');
const finishQuizSrc = slice(html, '    function finishQuiz(isComplete) {', '    /* ─── Quiz History');

/* A fake DOM element that RECORDS every innerHTML assignment so the test can
 * inspect exactly what finishQuiz wrote. appendChild keeps children so we can
 * walk the rendered result cards. */
function makeEl() {
  const el = {
    _html: '', className: '', title: '', disabled: false,
    style: {}, dataset: {}, children: [],
    setAttribute() {}, removeAttribute() {}, addEventListener() {},
    appendChild(c) { el.children.push(c); return c; },
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    set(v) { el._html = String(v); allHtml.push(String(v)); },
  });
  return el;
}
let allHtml = [];

function runFinishQuiz(quizData, userAnswers) {
  allHtml = [];
  const byId = {};
  const getEl = (id) => (byId[id] || (byId[id] = makeEl()));
  const ctx = {
    console, JSON, Math, Date, Object,
    document: { getElementById: getEl, createElement: () => makeEl() },
    window: {},
    // dependency stubs — finishQuiz calls these but they are irrelevant to the
    // escaping behaviour under test.
    unlockChatbox() {}, showPhase() {}, showToast() {},
    recordQuizResult() {}, saveToHistory() {}, updateProgress() {},
    quizData, userAnswers,
    quizMeta: { subject: 'Biology', topic: 'x' },
  };
  vm.createContext(ctx);
  // escapeHtml + quizHtml (real) then the real finishQuiz, then invoke it.
  const code =
    escSrc + '\n' + quizHtmlSrc + '\n' + finishQuizSrc + '\n' +
    ';finishQuiz(true);';
  vm.runInContext(code, ctx);
  return allHtml.join('\n');
}

/* ── Real finishQuiz escapes a malicious correct_answer (wrong-answer branch) ── */
test('finishQuiz: malicious correct_answer is inert when the user picked wrong', () => {
  const quizData = [{
    question_stem: 'Q1', options: { A: 'a', B: 'b', C: 'c', D: 'd' },
    correct_answer: '<img src=x onerror=alert(1)>', detailed_explanation: 'ok',
  }];
  const out = runFinishQuiz(quizData, { 0: 'A' });   // picked A, wrong → shows answer
  assert.ok(out.includes('&lt;img'), 'payload rendered as escaped text');
  assert.ok(!out.includes('<img src=x onerror'), 'no live <img> tag in rendered HTML');
});

test('finishQuiz: malicious correct_answer is inert in the not-answered branch', () => {
  const quizData = [{
    question_stem: 'Q1', options: { A: 'a', B: 'b', C: 'c', D: 'd' },
    correct_answer: '<script>steal()</script>', detailed_explanation: 'ok',
  }];
  const out = runFinishQuiz(quizData, {});           // not answered → shows answer
  assert.ok(out.includes('&lt;script&gt;'), 'payload escaped');
  assert.ok(!out.includes('<script>steal'), 'no live <script> tag in rendered HTML');
});

test('finishQuiz: malicious option text and explanation are inert', () => {
  const quizData = [{
    question_stem: '<b>stem</b>',
    options: { A: '<img src=x onerror=alert(2)>', B: 'b', C: 'c', D: 'd' },
    correct_answer: 'B',
    detailed_explanation: '<script>bad()</script>',
  }];
  const out = runFinishQuiz(quizData, { 0: 'B' });   // correct → explanation shown
  assert.ok(!out.includes('<img src=x onerror'), 'option payload not a live tag');
  assert.ok(!out.includes('<script>bad'), 'explanation payload not a live tag');
  assert.ok(out.includes('&lt;img') && out.includes('&lt;script&gt;'), 'both escaped');
});

test('finishQuiz: normal content and bold emphasis still render as plain text', () => {
  const quizData = [{
    question_stem: 'What is **H2O**?', options: { A: 'Water', B: 'Air', C: 'Fire', D: 'Earth' },
    correct_answer: 'A', detailed_explanation: 'H2O is **water**.',
  }];
  const out = runFinishQuiz(quizData, { 0: 'A' });
  assert.ok(out.includes('Water'), 'option text renders');
  assert.ok(!out.includes('**water**'), '** emphasis markers stripped');
  assert.ok(out.includes('✅ Correct'), 'correct marker shown post-submit');
});

/* ── Pre-submit render never leaks the correct answer ───────────────────── */
test('pre-submit renderQuiz template does not reference correct_answer', () => {
  const renderQuizSrc = slice(html, '    function renderQuiz() {', '    function selectOption');
  assert.ok(!renderQuizSrc.includes('correct_answer'),
    'the answer is not rendered before submit (only finishQuiz shows it)');
});

console.log(`\n${passed} quiz render tests passed.`);

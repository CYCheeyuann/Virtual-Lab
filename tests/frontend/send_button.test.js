/* Static regression for the Lab Assistant send-button icon legibility (Area 3).
 *
 * Root cause fixed: ui-icons.js swaps the ➤ glyph for a stroke-only SVG that
 * inherits the mint --c-accent color and sits on the mint→primary gradient
 * button, making it near-invisible. The fix adds a `.gc-send-btn .vsl-icon`
 * color override in global-chat.css.
 *
 * A pure Node test cannot measure rendered contrast, so this asserts the
 * contributing facts: the color override rule exists, the disabled state is
 * expressed via opacity (not a removed button), the button never shrinks
 * (flex:0 0 auto / white-space:nowrap guard against mobile squeeze), the
 * accessible name survives the icon swap, and the ➤ token the swapper targets
 * is still present. Exact pixel contrast / iOS Safari / on-screen-keyboard
 * squeeze remain 待真机验证. Run: node tests/frontend/send_button.test.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, 'frontend', f), 'utf8');
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ok -', name); };

const css = read('global-chat.css');
const js = read('global-chat.js');

test('global-chat.css: .gc-send-btn .vsl-icon has an explicit color override', () => {
  const re = /\.gc-send-btn\s+\.vsl-icon\s*\{[^}]*color\s*:/;
  assert.ok(re.test(css), 'send-button icon color override rule present');
});

test('global-chat.css: disabled state uses opacity (state cue), not display:none', () => {
  assert.ok(/\.gc-send-btn:disabled\s*\{[^}]*opacity/.test(css), 'disabled uses opacity');
  assert.ok(!/\.gc-send-btn:disabled\s*\{[^}]*display\s*:\s*none/.test(css), 'disabled is not hidden');
});

test('global-chat.css: send button never shrinks (mobile squeeze guard)', () => {
  const block = css.slice(css.indexOf('.gc-send-btn {'));
  assert.ok(/flex:\s*0\s+0\s+auto/.test(block), 'flex:0 0 auto keeps the button sized');
  assert.ok(/white-space:\s*nowrap/.test(block), 'white-space:nowrap guards against squeeze');
});

test('global-chat.js: send button keeps aria-label="Send" and the ➤ icon token', () => {
  assert.ok(js.includes('aria-label="Send"'), 'accessible name preserved for the swapped icon');
  assert.ok(js.includes('➤'), 'the ➤ token ui-icons.js swaps to the send SVG is present');
});

console.log(`\n${passed} send-button tests passed.`);

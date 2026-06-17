# Design: Experiment Guide Node-Map

## Overview

This feature replaces the streaming-markdown experiment view with a structured, navigable node map. The user goes through three phases instead of one:

1. **Setup** (existing form, unchanged surface)
2. **Confirmation** (new — AI validates inputs and document, shows what it will produce, user confirms)
3. **Node Map** (new — main topic node + 8 categorized sub-section boxes; click any box to read its details)

The eight sections (Objective, Materials, Safety, Procedure, Expected Results, Scientific Explanation, Real-Life Applications, Summary) are generated in one Lambda call as a strict JSON object, not as streaming markdown. The frontend caches that JSON for the session, so clicking between section detail panels is instantaneous and offline-tolerant.

The design intentionally piggybacks on existing infrastructure:
- Same `ExperimentGuideFunction` Lambda — only its prompt and response shape change.
- Same `AppBedrockRole` IAM — no new permissions.
- Same `experiment.html` page — DOM is restructured but the file isn't replaced.
- Same `experimentGuide` Lambda Function URL in `frontend/config.js` — no deploy-pipeline changes.

### Goals
- Replace one big scroll with a glance-able diagram.
- Let users sample sections in any order without losing context.
- Make every "click into a section" action feel local (cached) — no spinners between sections.
- Add an explicit consent point (confirmation step) before the heavy generation, mirroring Quiz Generator and Smart Flashcards patterns.

### Non-goals
- No drag-to-rearrange node map. The 8 boxes are fixed in their canonical order.
- No "edit a section" workflow. The output is read-only; users regenerate to change content.
- No persistence beyond `sessionStorage`. Refreshing or closing the tab clears the cache.
- No new Lambda. This reshapes the existing one.

### Affected files (canonical list)
```
MOD  frontend/experiment.html               (Setup → Confirmation → Node-Map view machine)
MOD  frontend/styles.css                    (node-map layout, connection lines, detail panel)
MOD  lambdas/experiment_guide/app.py        (mode: validate / node_map / [legacy markdown])
```

## Architecture

### View state machine (frontend)
```
[Setup form]
     │
     │  Click "Generate Experiment"  →  POST {mode: "validate", ...}
     ▼
[Confirmation screen]
     │
     │  Click "Continue & Generate Guide"  →  POST {mode: "node_map", ...}
     ▼
[Node-Map view]
     │  Click any sub-section box → open Detail Panel
     │  Press Esc / click backdrop → close Detail Panel
     │  Click "Reset" or "New Experiment" → return to Setup, clear cache
     ▼
(Loop)
```

Each state owns one DOM section (`#phase-setup`, `#phase-confirm`, `#phase-nodemap`) with all three pre-rendered and toggled via `display: none` — the same pattern Quiz Generator uses for its 4-phase workflow. No router, no SPA framework.

### Node-map layout (visual)
```
                ┌──────────────────────────────────────────┐
                │   🧪  Circular Motion Experiment          │  ← main-topic-node
                │       Subject: Physics · Standard         │
                └──────────────────┬───────────────────────┘
                                   │
                ┌─────────┬────────┼────────┬─────────────┐
                │         │        │        │             │
              SVG path  SVG path  SVG  ...                ...
                │         │        │
                ▼         ▼        ▼
            ┌────┐    ┌────┐    ┌────┐    ┌────┐
            │ 🎯 │    │ 🧰 │    │ ⚠️  │    │ 🔬 │      ← row 1: Obj / Mat / Safe / Proc
            └────┘    └────┘    └────┘    └────┘
            ┌────┐    ┌────┐    ┌────┐    ┌────┐
            │ 📊 │    │ 🧠 │    │ 🌍 │    │ 📝 │      ← row 2: Results / Exp / Apps / Summary
            └────┘    └────┘    └────┘    └────┘
```

Two responsive layout modes:
- **Wide (≥ 900 px):** 4-column × 2-row grid for the eight boxes; SVG connector lines fan out from the bottom-center of the main-topic node to each box's top edge.
- **Narrow (< 900 px):** 2-column × 4-row grid; connector lines simplified or omitted.
- **Mobile (< 600 px):** Single column stack, no connectors, main-topic node spans full width.

## Components and Interfaces

### Part 1 — Setup Phase (mostly unchanged)

The existing setup card stays. Only differences:
- The "Generate Experiment" button now triggers the validation request rather than the full streaming generation.
- A small note under the button explains the two-step flow: "We'll preview what the AI plans to generate before producing the full guide."

### Part 2 — Confirmation Phase

**Markup:**
```html
<section class="card" id="phase-confirm" style="display:none">
  <h2>2 · Confirm Generation</h2>

  <div class="confirm-summary" id="confirmSummary">
    <!-- Filled by Lambda response -->
  </div>

  <div class="confirm-error" id="confirmError" hidden>
    <!-- Shown only on file-relevance rejection -->
  </div>

  <div class="btn-row" style="margin-top:18px">
    <button id="continueBtn" class="btn btn-primary">
      <span>🚀</span><span>Continue &amp; Generate Guide</span>
    </button>
    <button id="confirmBackBtn" class="btn btn-ghost">
      <span>←</span><span>Back to Setup</span>
    </button>
  </div>
</section>
```

**Validation request:**
```js
async function runValidation() {
  const subject = document.getElementById('subject').value;
  const topic = document.getElementById('topic').value.trim();
  const difficulty = document.getElementById('difficulty').value;
  const body = { mode: 'validate', subject, topic, difficulty };
  if (uploadedFile.data) {
    body.file_data = uploadedFile.data;
    body.file_mime = uploadedFile.mime;
    body.file_name = uploadedFile.name;
  }
  const resp = await fetch(window.STREAM_URLS.experiment_guide, {
    method: 'POST', headers: apiHeaders(), body: JSON.stringify(body),
  });
  const json = await resp.json();
  return json;   // { valid: true, summary: "..." } | { valid: false, error: "..." }
}
```

**Render handler:**
```js
function renderConfirm({ valid, summary, error }) {
  const summaryEl = document.getElementById('confirmSummary');
  const errorEl = document.getElementById('confirmError');
  const continueBtn = document.getElementById('continueBtn');
  if (valid) {
    summaryEl.innerHTML = `
      <div class="confirm-line">${escapeHtml(summary)}</div>
      <div class="confirm-meta">Subject: <strong>${subject}</strong> · Difficulty: <strong>${difficulty}</strong> · Topic: <strong>${topic}</strong></div>
    `;
    errorEl.hidden = true;
    continueBtn.disabled = false;
  } else {
    summaryEl.innerHTML = '';
    errorEl.innerHTML = `❌ ${escapeHtml(error)}`;
    errorEl.hidden = false;
    continueBtn.disabled = true;     // can't continue if validation fails
  }
  showPhase('phase-confirm');
}
```

**Why a separate validate call?** Two reasons:
1. **Cost.** A "validate" request is a tiny prompt that returns ~50 tokens. The full eight-section generation is several thousand tokens. Letting the user abort before the expensive call saves money in the typo-driven case.
2. **UX honesty.** Users who upload an unrelated PDF should learn about the rejection in 1-2 seconds, not wait 20+ seconds for the full generation to "fail" with the same error.

### Part 3 — Node-Map View

**Markup:**
```html
<section class="card" id="phase-nodemap" style="display:none">
  <div class="node-map">
    <div class="main-topic-node" data-subject="">
      <span class="topic-icon">🧪</span>
      <h2 class="topic-title" id="mainTopicTitle">Circular Motion Experiment</h2>
      <div class="topic-meta" id="mainTopicMeta">Physics · Standard</div>
    </div>

    <svg class="node-connectors" id="nodeConnectors" aria-hidden="true">
      <!-- 8 paths drawn imperatively after layout to connect main → each box -->
    </svg>

    <div class="node-grid">
      <button class="node-box" data-section="objective">
        <span class="node-icon">🎯</span>
        <span class="node-title">Objective</span>
      </button>
      <button class="node-box" data-section="materials">
        <span class="node-icon">🧰</span>
        <span class="node-title">Materials</span>
      </button>
      <button class="node-box" data-section="safety">
        <span class="node-icon">⚠️</span>
        <span class="node-title">Safety Briefing</span>
      </button>
      <button class="node-box" data-section="procedure">
        <span class="node-icon">🔬</span>
        <span class="node-title">Procedure</span>
      </button>
      <button class="node-box" data-section="expected_results">
        <span class="node-icon">📊</span>
        <span class="node-title">Expected Results</span>
      </button>
      <button class="node-box" data-section="scientific_explanation">
        <span class="node-icon">🧠</span>
        <span class="node-title">Scientific Explanation</span>
      </button>
      <button class="node-box" data-section="real_life_applications">
        <span class="node-icon">🌍</span>
        <span class="node-title">Real-Life Applications</span>
      </button>
      <button class="node-box" data-section="summary">
        <span class="node-icon">📝</span>
        <span class="node-title">Summary</span>
      </button>
    </div>
  </div>

  <div class="btn-row" style="margin-top:18px">
    <button id="newExperimentBtn" class="btn btn-ghost">New Experiment</button>
    <button id="exportBtn" class="btn btn-ghost btn-export">Export PDF</button>
    <button id="sendToAiBtn" class="btn btn-ghost">Send to AI Lab Assistant</button>
  </div>
</section>

<!-- Detail panel — overlays the page when a node is clicked -->
<div class="node-detail-backdrop" id="nodeDetailBackdrop" hidden>
  <div class="node-detail-panel" role="dialog" aria-labelledby="nodeDetailTitle">
    <button class="node-detail-close" id="nodeDetailClose" aria-label="Close">✕</button>
    <h2 id="nodeDetailTitle"><span id="nodeDetailIcon"></span> <span id="nodeDetailTitleText"></span></h2>
    <div class="node-detail-body" id="nodeDetailBody"></div>
  </div>
</div>
```

**CSS layout (key rules):**
```css
.node-map {
  position: relative;
  padding: 24px 12px;
}
.main-topic-node {
  background: linear-gradient(135deg, var(--c-accent), var(--c-accent-2));
  color: #14101e;
  border-radius: 18px;
  padding: 22px 28px;
  text-align: center;
  margin: 0 auto 60px;
  max-width: 560px;
  box-shadow: 0 14px 40px var(--c-accent-glow);
  position: relative;
  z-index: 2;
}
.main-topic-node .topic-icon { font-size: 1.8rem; }
.main-topic-node .topic-title {
  font-size: 1.5rem;
  font-weight: 800;
  color: #14101e;
  margin: 6px 0 4px;
}
.main-topic-node .topic-meta { font-size: 0.82rem; opacity: 0.8; }

.node-connectors {
  position: absolute;
  top: 0; left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1;
}
.node-connectors path {
  stroke: var(--c-accent);
  stroke-width: 2;
  fill: none;
  opacity: 0.5;
  stroke-linecap: round;
}

.node-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 18px;
  position: relative;
  z-index: 2;
}
.node-box {
  background: var(--c-bg-glass);
  border: 1px solid var(--c-border);
  border-radius: 16px;
  padding: 22px 18px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
  font-family: inherit;
  color: var(--c-text);
  transition: transform 0.2s, border-color 0.2s, background 0.2s, box-shadow 0.2s;
}
.node-box:hover {
  transform: translateY(-3px);
  border-color: rgba(var(--c-accent-rgb), 0.45);
  background: var(--c-bg-glass-2);
  box-shadow: 0 10px 28px var(--c-shadow-strong);
}
.node-box .node-icon { font-size: 2rem; }
.node-box .node-title {
  font-weight: 700;
  font-size: 0.95rem;
  color: var(--c-text-strong);
}
.node-box.viewed::after {
  content: '✓';
  position: absolute;
  top: 10px;
  right: 12px;
  color: var(--c-accent);
  font-weight: 700;
  font-size: 0.95rem;
}

@media (max-width: 900px) {
  .node-grid { grid-template-columns: repeat(2, 1fr); }
  .node-connectors { display: none; }
  .main-topic-node { margin-bottom: 24px; }
}
@media (max-width: 600px) {
  .node-grid { grid-template-columns: 1fr; }
}
```

**SVG connector drawing.** After layout, JS walks each `.node-box`, computes the midpoint of its top edge relative to the SVG container, and writes a cubic-bezier path from the bottom-center of `.main-topic-node` to that midpoint:

```js
function drawConnectors() {
  const svg = document.getElementById('nodeConnectors');
  const main = document.querySelector('.main-topic-node');
  const map = document.querySelector('.node-map');
  const boxes = document.querySelectorAll('.node-box');
  if (!main || !map || window.innerWidth < 900) {
    svg.innerHTML = '';
    return;
  }
  const mapRect = map.getBoundingClientRect();
  const mainRect = main.getBoundingClientRect();
  const sx = mainRect.left + mainRect.width / 2 - mapRect.left;
  const sy = mainRect.bottom - mapRect.top;
  let paths = '';
  boxes.forEach(box => {
    const r = box.getBoundingClientRect();
    const tx = r.left + r.width / 2 - mapRect.left;
    const ty = r.top - mapRect.top;
    const cy = (sy + ty) / 2;
    paths += `<path d="M ${sx} ${sy} C ${sx} ${cy}, ${tx} ${cy}, ${tx} ${ty}" />`;
  });
  svg.innerHTML = paths;
  svg.setAttribute('viewBox', `0 0 ${mapRect.width} ${mapRect.height}`);
}
window.addEventListener('resize', debounce(drawConnectors, 120));
```
Drawn after `phase-nodemap` becomes visible (so `getBoundingClientRect` is meaningful) and re-drawn on resize.

### Part 4 — Detail Panel

**Behaviour:**
- Click any `.node-box` → populate `#nodeDetailTitleText`, `#nodeDetailIcon`, and `#nodeDetailBody` with the matching cached section, then unhide the backdrop.
- Click backdrop, click close button, or press Escape → hide the backdrop. Mark the just-viewed box with `.viewed` class so users see at a glance which sections they've explored.
- Switch sections without closing → if the panel is already open, swap content in place rather than fade out / fade in. Implementation:

```js
const ICONS = { objective: '🎯', materials: '🧰', safety: '⚠️',
  procedure: '🔬', expected_results: '📊', scientific_explanation: '🧠',
  real_life_applications: '🌍', summary: '📝' };
const TITLES = { objective: 'Objective', materials: 'Materials',
  safety: 'Safety Briefing', procedure: 'Procedure',
  expected_results: 'Expected Results',
  scientific_explanation: 'Scientific Explanation',
  real_life_applications: 'Real-Life Applications',
  summary: 'Summary' };

function openDetail(sectionKey) {
  const cached = sessionCache.sections[sectionKey];
  if (!cached) return;
  document.getElementById('nodeDetailIcon').textContent = ICONS[sectionKey] || '';
  document.getElementById('nodeDetailTitleText').textContent = TITLES[sectionKey] || sectionKey;
  document.getElementById('nodeDetailBody').innerHTML = renderMarkdown(cached);
  document.getElementById('nodeDetailBackdrop').hidden = false;
  document.querySelector(`.node-box[data-section="${sectionKey}"]`)?.classList.add('viewed');
}
function closeDetail() {
  document.getElementById('nodeDetailBackdrop').hidden = true;
}
```

`renderMarkdown` is a tiny inline renderer that handles `**bold**`, `\n`-separated lines, and `1. ` / `- ` list lines — matches the lightweight markdown rendering already used by `quizHtml` in `quiz.html`. We deliberately don't pull in a markdown-rendering library; the section content is simple enough that ~30 lines of regex covers it.

### Part 5 — Section Cache

**In-memory shape:**
```js
const sessionCache = {
  topicTitle: 'Circular Motion Experiment',
  subject: 'Physics',
  topic: 'Circular Motion',
  difficulty: 'Standard',
  sections: {
    objective: '...',
    materials: '...',
    safety: '...',
    procedure: '...',
    expected_results: '...',
    scientific_explanation: '...',
    real_life_applications: '...',
    summary: '...',
  },
};
```

**Persistence layer.** Mirrored to `sessionStorage.setItem('vsl.experimentGuide', JSON.stringify(sessionCache))` whenever it changes, and restored on `DOMContentLoaded`:

```js
function saveCache() {
  try { sessionStorage.setItem('vsl.experimentGuide', JSON.stringify(sessionCache)); } catch {}
}
function loadCache() {
  try {
    const raw = sessionStorage.getItem('vsl.experimentGuide');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}
```

On page load: if a cached experiment exists AND has all 8 sections, jump straight to phase-nodemap and rehydrate. Otherwise show phase-setup.

`sessionStorage` (not `localStorage`) was chosen so:
- Tab close clears it (prevents accumulation).
- Multiple browser tabs each get their own experiment cache (no cross-tab clobbering).
- Aligns with Chapter Assistant's existing cross-page state pattern.

### Part 6 — Backend Lambda Changes

`lambdas/experiment_guide/app.py` gains mode dispatch:

```python
def handler(path):
    # ... existing CORS / API key / body parsing ...
    mode = body.get("mode", "stream")  # default = legacy streaming markdown

    if mode == "validate":
        return _handle_validate(body)
    elif mode == "node_map":
        return _handle_node_map(body)
    else:
        return _handle_legacy_stream(body)   # the current streaming response
```

**`_handle_validate` prompt (sketch):**
```
You are a science lab instructor. The user wants to generate an experiment
guide with these inputs:

Subject: {subject}
Topic: {topic}
Difficulty: {difficulty}
{#if file} Document: a {file_mime} file titled "{file_name}". {/if}

Respond ONLY in JSON:
{
  "valid": true|false,
  "summary": "A single sentence telling the user what you will produce.",
  "error": "Only present when valid=false. Why was the request rejected?"
}

Reject (valid=false) if a document was uploaded and is clearly not science-
related. Otherwise return valid=true with a summary like "Proceeding to
generate a complete interactive {Subject} experiment guide on {Topic}…"
```

This call uses `max_tokens: 200` and is non-streaming — fast and cheap.

**`_handle_node_map` prompt (sketch):**
```
You are an expert science educator. Generate a complete experiment guide as
a strict JSON object with EXACTLY these keys:

{
  "topic_title": "<Topic> Experiment",
  "sections": {
    "objective": "...",
    "materials": "... (markdown bullet list, one per material with quantity)",
    "safety": "... (markdown bullet list of hazards + precautions)",
    "procedure": "... (numbered markdown list)",
    "expected_results": "...",
    "scientific_explanation": "...",
    "real_life_applications": "... (3-4 examples as a bullet list)",
    "summary": "... (2-3 sentences)"
  }
}

Use **bold** to emphasize key terms within section bodies. Each section
should be 100-400 words. Output ONLY this JSON — no markdown fences, no
preamble, no commentary.

Subject: {subject}
Topic: {topic}
Difficulty: {difficulty}
```

Same JSON-fence cleanup logic that `science_quiz/app.py` and `flashcard_generator/app.py` already use:
```python
cleaned = text
if cleaned.startswith("```"):
    cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3].rstrip()
```

Soft validation post-parse: ensure all 8 keys are present in `sections`. Truncate any section > 4000 chars. Return HTTP 200 + `{ error, raw }` on parse failure for retry-friendliness.

The legacy `_handle_legacy_stream` keeps the existing prompt and streaming response intact for any consumer that doesn't pass `mode`. Removing it later is a separate cleanup once we're sure nothing depends on the old shape.

## Data Models

| Storage location          | Key / Output            | Owner               | Purpose                                        |
|---------------------------|-------------------------|---------------------|------------------------------------------------|
| `sessionStorage`          | `vsl.experimentGuide`   | `experiment.html`   | Cached node-map sections for the current tab.  |
| In-memory                 | `sessionCache` (JS var) | `experiment.html`   | Hot copy of the cache, source of truth at render time. |
| `localStorage` (existing) | `selectedSubject`       | `common.js`         | Pre-fills the Subject select on the setup form.|
| Lambda env                | `MODEL_ID` (existing)   | `bedrock_stream.py` | Same Claude Haiku 4.5 model.                   |
| CloudFormation Output     | `ExperimentGuideUrl`    | `infra/template.yaml`| Already wired — no changes.                   |

## Error Handling

- **Validation rejects file** → Confirmation screen shows the error block, "Continue" button is disabled. User must click "Back to Setup" or upload a different file.
- **Network failure on validate** → Toast "Couldn't reach the AI — please retry", button re-enabled, no view change.
- **Network failure on node-map generation** → Toast + return to Confirmation screen so user can retry without re-typing.
- **Malformed JSON from Lambda** → Lambda returns `{ error, raw }` with HTTP 200; frontend toasts the error and stays on Confirmation screen. The `raw` field is logged to console for debugging but not shown to the user.
- **Missing section keys** → Frontend shows whichever sections did arrive; missing sections render as a placeholder "(content unavailable — try regenerating)" so the rest of the map remains usable.
- **`sessionStorage` quota** → Already capped per-section at 4000 chars; full payload is well under the typical 5 MB session quota. If write fails (e.g., private mode quirks), node-map continues to work with in-memory cache only.
- **Concurrent generations** — Each in-flight generation is tracked by an AbortController. Clicking "Continue" while a previous request is still pending aborts the previous one.

## Correctness Properties

### Property 1: Three-phase view exclusivity
**Validates: Requirements 1.1, 1.5**

At any moment, exactly one of `#phase-setup`, `#phase-confirm`, `#phase-nodemap` is visible. The phase switcher always sets the chosen phase to `display: ''` and the other two to `display: none`. There is no state where two phases overlap.

### Property 2: No commit before confirmation
**Validates: Requirements 1.5, 1.6, 1.7**

The expensive `mode: "node_map"` Lambda call is invoked if and only if the user has clicked "Continue & Generate Guide" on the Confirmation screen with `valid === true`. Clicking "Back to Setup" or arriving at the Confirmation screen with `valid === false` SHALL NOT trigger the heavy generation.

### Property 3: Eight-section completeness
**Validates: Requirements 3.1, 3.2, 6.2**

The DOM always contains exactly 8 `.node-box` elements with `data-section` values matching the canonical set `{objective, materials, safety, procedure, expected_results, scientific_explanation, real_life_applications, summary}`. Their order in the DOM matches the order specified in Requirement 3.2.

### Property 4: Cache-first detail rendering
**Validates: Requirements 4.1, 5.3**

When the user clicks any `.node-box`, the Detail Panel renders from `sessionCache.sections[key]` directly — there is no `fetch()` call, no spinner, no asynchronous gap between click and render. If the cached section is empty, the panel shows a placeholder, not a loading state.

### Property 5: Single in-flight generation
**Validates: Requirements 1.7, 6.7**

At most one `mode: "node_map"` Lambda call is in flight at a time. Triggering a second generation while the first is pending aborts the first via `AbortController.abort()` so the response we ultimately commit to cache always corresponds to the most recent user intent.

### Property 6: Subject theme propagates to main-topic node
**Validates: Requirements 2.3**

`.main-topic-node` reads its accent color from `var(--c-accent)` / `var(--c-accent-2)`, which are scoped by `[data-subject]` on `<html>`. Changing the Subject select on the setup form before regenerating produces a node with the new accent on next render.

### Property 7: Detail panel modality
**Validates: Requirements 4.3, 4.4**

When the Detail Panel is open, focus is trapped inside it (Tab/Shift-Tab cycle within the panel) and pressing Escape closes it. Clicking the backdrop region outside the panel also closes it. Closing returns focus to the `.node-box` that was clicked.

### Property 8: Viewed marker accumulation
**Validates: Requirements 4.6**

Once a user opens the Detail Panel for a sub-section, that sub-section's `.node-box` retains the `.viewed` class until either the page is refreshed or the user clicks "New Experiment" / "Reset". The marker is purely visual — it does not gate any behaviour.

### Property 9: Backward compatibility
**Validates: Requirements 6.3, 7.1, 7.2, 7.3**

Requests that omit the `mode` field (or pass any value other than `validate` / `node_map`) hit the existing streaming-markdown handler. The existing Function URL, IAM role, and CloudFormation resource are unchanged — adding the new modes is purely a code-side branch inside the existing handler.

### Property 10: Cache reset on new experiment
**Validates: Requirements 5.5**

Clicking "Reset" or "New Experiment" clears both `sessionCache` (in-memory) and `sessionStorage.vsl.experimentGuide` (persisted). The next generation starts from a known-empty cache state.

## Testing Strategy

Manual smoke-tests:

1. **Setup → Confirmation flow** — fill setup, click Generate → Confirmation screen appears within ~2s with the AI's summary line. Click Back → Setup form re-shown with all values intact.
2. **File rejection** — upload a non-science PDF (e.g., a recipe), click Generate → Confirmation screen shows the error block, Continue button is disabled.
3. **Confirmation → Node-map** — accept a valid validation, click Continue → spinner ~5-10s → node-map appears with main-topic node and 8 boxes.
4. **All eight boxes render** — count: exactly 8 boxes, ordered Objective / Materials / Safety / Procedure / Expected Results / Scientific Explanation / Real-Life Applications / Summary.
5. **Detail panel — click box** — click 🔬 Procedure → modal opens with procedure body. Click ⚠️ Safety from inside the open modal → content swaps in place (no fade out / fade in of the modal chrome). Click ✕ → modal closes.
6. **Detail panel — Escape** — open any panel → press Escape → closes. Press Escape again → no-op (already closed).
7. **Viewed marker** — click 🎯 Objective → close. The Objective box now has a ✓ corner indicator. Click 📊 Expected Results → close. Both boxes have markers; non-clicked boxes do not.
8. **Caching across clicks** — click each box once, observing zero spinners. Network tab in DevTools confirms only one `node_map` Lambda call total.
9. **Session restore** — generate an experiment, navigate to Dashboard, navigate back → node-map view is restored without a fresh AI call (no Network activity for `experiment_guide`).
10. **Reset clears cache** — click "New Experiment" → returns to Setup, `sessionStorage.vsl.experimentGuide` is gone.
11. **Subject theming** — generate an experiment in Physics → main-topic node uses blue. Reset, switch to Science, generate → main-topic node uses amber.
12. **SVG connectors on resize** — at 1440 px width, eight curves visible from main node to each box. Resize down to 850 px → connectors disappear, layout switches to 2×4 grid.
13. **Mobile** — Chrome devtools touch mode at 360 px → single column stack, no connectors, all 8 boxes still tappable.
14. **Backward compatibility** — directly POST to the existing Function URL without a `mode` field → still streams markdown response (legacy behaviour preserved).

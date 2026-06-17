# Design: 7-Part UI/UX Enhancement

## Overview

This design covers seven coordinated UI/UX upgrades to the Virtual Science Lab frontend. Together they tighten the dashboard's visual hierarchy, modernize the navigation chrome, broaden subject coverage to general Science, and make the floating Lab Assistant feel proactively aware of the user's location in the app.

The work is intentionally **frontend-heavy and backend-light**. Six of the seven parts are pure HTML/CSS/JS changes. Only Part 5 (Global Subject Expansion) crosses into the Python Lambda layer, and only as a permissive validator change plus prompt awareness — no schema or contract changes.

### Goals
- Cleaner default dashboard (icon + title only, no clutter).
- Strong, scannable headings inside the AI-generated Quiz outline.
- Header that follows mainstream web-app conventions (logo flush left, nav flush right, clickable brand).
- Single, predictable horizontal row of feature cards with a placeholder for future tools.
- "Science" treated as a first-class subject everywhere a subject is selected or themed.
- All floating utilities (Toolkit, Lab Assistant) consolidated into one bottom-right action stack.
- Lab Assistant gives a context-aware nudge on every page load that auto-dismisses.

### Non-goals
- No change to AI prompt engineering beyond accepting "Science" as a valid subject.
- No new Lambda functions, new APIs, or new IAM permissions.
- No mobile-specific redesign beyond preserving existing responsive breakpoints.
- No accessibility regressions; existing focus, ARIA, and keyboard behaviors stay intact.

### Affected files (canonical list)
```
frontend/index.html         (Parts 1, 3, 4)
frontend/welcome.html       (Part 3 — new landing page)
frontend/chapter.html       (Parts 3, 5, 7)
frontend/experiment.html    (Parts 3, 5, 7)
frontend/quiz.html          (Parts 2, 3, 5, 7)
frontend/tutor.html         (Parts 3, 5, 7)
frontend/lab-tools.html     (Parts 3, 7)
frontend/styles.css         (Parts 1, 2, 3, 4, 5)
frontend/global-chat.js     (Part 7)
frontend/global-chat.css    (Part 6 — stack alignment)
frontend/toolkit.css        (Part 6 — FAB position)
frontend/common.js          (Part 5 — Science in subject theme map)
lambdas/shared/validators.py (Part 5 — accept "Science")
```

## Architecture

The frontend is a static multi-page site (no SPA framework). Each HTML file shares a common chrome via `common.js`, `styles.css`, `global-chat.js`, and `toolkit.js`. Cross-page state is held in `localStorage` (selected subject, quiz history, chat history). All AI calls hit Function-URL Lambdas via `fetch` streaming.

```
┌──────────────────────── Top of every page ────────────────────────┐
│  <nav class="navbar">                                              │
│    .nav-inner                                                      │
│      .brand (logo, flush left, → welcome.html)                     │
│      .nav-links (flush right, ml: auto)                            │
└────────────────────────────────────────────────────────────────────┘

┌──────────────────────── Dashboard (index.html) ───────────────────┐
│  .progress-dashboard                                               │
│  .tile-grid.tile-grid-row  ← single horizontal row, 5 cells        │
│    .tile × 4 (active modules, hover-to-reveal typewriter)          │
│    .tile.tile-locked × 1 ("Coming Soon")                           │
└────────────────────────────────────────────────────────────────────┘

┌──────────────────────── Bottom-right action stack ─────────────────┐
│   ┌─────────┐                                                      │
│   │  🧮 FAB │  toolkit (was bottom-left, now stacked above chat)  │
│   └─────────┘                                                      │
│   ┌─────────┐                                                      │
│   │  🤖 FAB │  lab assistant (unchanged anchor)                    │
│   └─────────┘                                                      │
│   ↑ both fixed, right-aligned, vertically stacked                  │
└────────────────────────────────────────────────────────────────────┘
```

Page load sequence (for context-aware behavior):
```
DOMContentLoaded
  → common.js: initTheme, bindSubjectSelect, injectShortcutHint
  → global-chat.js: buildDom (FAB + panel)
  → global-chat.js: schedule contextual hint (1.2s after load)
  → toolkit.js: build (FAB + panel)
  → page-specific script: e.g., index.html wires tile typewriter
```

## Components and Interfaces

### Part 1 — Dynamic Dashboard Cards (Hover-to-Reveal Typewriter)

**Markup contract.** Each tile carries its description in `data-desc` rather than rendered text:
```html
<a class="tile" href="chapter.html"
   data-desc="Generate a structured overview …">
  <div class="tile-icon">…svg…</div>
  <h3>Chapter Assistant</h3>
  <p></p>            <!-- empty paragraph as the typewriter target -->
</a>
```

**CSS contract (`styles.css`).**
- `.tile` is a flex column, vertically centered, min-height ≥ 220 px, padding 36 × 28 px (larger click target).
- `.tile-icon` and `.tile h3` transition `transform` and `margin-bottom` on a 0.4 s ease curve.
- `.tile p` defaults to `max-height: 0; opacity: 0; overflow: hidden`. On `:hover` it expands to `max-height: 80px; opacity: 1`.
- Icon and title `translateY(-6px)` on hover so the description has room without overlap.

**JS contract (`index.html` inline script).**
- One `mouseenter` listener per tile starts a `setInterval` typing characters of `data-desc` into the `<p>` at ~18 ms per char.
- On `mouseleave` the interval is cleared and `p.textContent = ''` so re-entry restarts cleanly.
- A `.typing` class is added during typing to permit a future blinking caret (CSS `::after`) without changing JS again.

**Why this shape.** Holding the source text in `data-desc` means screen readers don't see flickering content during typing; the visible `<p>` can be re-cleared without losing the canonical string. Keeping the timer per-tile (rather than one global) avoids cross-tile race conditions when the user mouses quickly across the row.

### Part 2 — Quiz Outline Header Styling (Rich Text Highlighting)

**Where it lives.** `quiz.html` renders the AI-streamed outline into a `contenteditable` block (`#outlineEditor` or equivalent). After streaming finishes, the first non-empty line is treated as the title.

**Approach.** Apply styling via a CSS class on the outline container plus a `::before` pseudo-element on the first child element, rather than mutating the DOM. This keeps the editable text intact and round-trippable:
```css
.outline-rich h1:first-child,
.outline-rich .outline-title {
  font-size: 1.5rem;
  font-weight: 800;
  color: var(--c-accent);
  background: var(--c-accent-soft);
  border-radius: 10px;
  padding: 10px 14px;
  border-bottom: 3px solid var(--c-accent);
  margin-bottom: 14px;
  letter-spacing: 0.01em;
}
.outline-rich h1:first-child::before,
.outline-rich .outline-title::before {
  content: "🎯 ";
}
```

**Editable preservation.**
- The container keeps `contenteditable="true"`.
- We do not wrap inserted text in extra elements during streaming. After the first newline is detected post-stream, the streaming logic optionally promotes the leading line to `<h1 class="outline-title">` once, then style takes over from there. Subsequent edits do not re-trigger promotion (idempotent).
- Plain-text serialization (used when sending the outline to the quiz-generator Lambda) reads `innerText` so the icon glyph and styling are stripped naturally.

**Why a pseudo-element for the icon.** Embedding `🎯` as `::before` content keeps it out of the editable text flow — the user can't accidentally delete or duplicate it while editing the heading.

### Part 3 — Header & Navigation Redesign

**Markup (already in place across pages).**
```html
<nav class="navbar">
  <div class="nav-inner">
    <a class="brand" href="welcome.html">🔬 Virtual Science Lab</a>
    <div class="nav-links">
      <a class="nav-link" href="index.html">Dashboard</a>
      <a class="nav-link" href="chapter.html">Chapter Assistant</a>
      <a class="nav-link" href="experiment.html">Experiment Guide</a>
      <a class="nav-link" href="quiz.html">Quiz Generator</a>
      <a class="nav-link" href="lab-tools.html">Lab Tools</a>
    </div>
  </div>
</nav>
```

**CSS (`styles.css`).**
- `.nav-inner` uses `display: flex; justify-content: space-between` with `padding: 20px 28px` (taller bar).
- `.brand` is `flex-shrink: 0` and remains the first flex child → flush left.
- `.nav-links` gets `margin-left: auto` so it pushes to the right edge regardless of brand width.
- `.brand` is an `<a>` linking to `welcome.html` so hover/focus behaves like any other link and middle-click opens in a new tab (a `<button>` would lose that).

**Welcome page (`welcome.html`).** New file that uses the same `<nav>` and the same shared CSS but adds a `.welcome-hero` block with logo, tagline, four feature bullets, and a CTA → `index.html`. Active link state on `<a class="nav-link" href="index.html">` is omitted on this page (no `.active` class), so the welcome page is "outside" the dashboard nav highlight.

**Routing.** Static-site, no router. The brand `<a href="welcome.html">` is the only thing required for the routing requirement.

### Part 4 — Dashboard Card Reorganization

**CSS modifier.** A second class `tile-grid-row` overrides the auto-fit grid:
```css
.tile-grid.tile-grid-row {
  grid-template-columns: repeat(5, 1fr);
  gap: 18px;
}
@media (max-width: 1100px) {
  .tile-grid.tile-grid-row { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 600px) {
  .tile-grid.tile-grid-row { grid-template-columns: 1fr; }
}
```
Mobile collapses to two then one column instead of horizontal scroll, which keeps the dashboard usable without introducing a new carousel widget.

**5th card — "Coming Soon".**
```html
<a class="tile tile-locked" href="#"
   onclick="event.preventDefault(); showToast('Coming soon!','info')"
   data-desc="More AI-powered learning tools are on the way…">
  <div class="tile-icon"><!-- padlock svg --></div>
  <h3>Coming Soon</h3>
  <p></p>
</a>
```
```css
.tile.tile-locked {
  opacity: 0.55;
  filter: saturate(0.6);
  cursor: not-allowed;
}
.tile.tile-locked:hover { transform: none; }   /* don't lift on hover */
```
The locked card still participates in the typewriter handler (it has `data-desc`), so its description still reveals on hover for transparency, but its hover transform is suppressed so it visually reads as inactive.

### Part 5 — Global Subject Expansion ("Science")

**Frontend touchpoints.**
1. Every `<select id="subject">` across `chapter.html`, `experiment.html`, `quiz.html`, `tutor.html`, `lab-tools.html` adds `<option value="Science">🔬 Science</option>` after Physics.
2. `common.js` already gates the subject value in `setSubjectTheme`:
   ```js
   if (!['Biology','Chemistry','Physics','Science'].includes(subject)) subject = 'Biology';
   ```
3. `SUBJECT_ICONS.Science` provides floating-icon glyphs (🔬 ⚗️ 🧬 🌍 ⚛️ 🧪).
4. `styles.css` adds an accent palette under `[data-subject="Science"]` (warm amber: `--c-accent: #fbbf24`) so theming doesn't fall through to the Biology default.

**Backend touchpoint.**
- `lambdas/shared/validators.py` `validate_subject` (or equivalent allowed-list) gains `"Science"`.
- Each Lambda's system prompt builder treats `"Science"` as integrated general-science context: cross-disciplinary, syllabus-style language, topics drawn from biology + chemistry + physics with simpler depth than the standalone subjects.
- No new model, no new IAM, no new request fields.

**Why a new accent color.** Reusing one of the existing three subject colors would conflate Science with whichever pure subject borrowed it; an unused-elsewhere amber makes Science visually distinct on first glance.

### Part 6 — Floating Tools Consolidation (Calculator Relocation)

**Current state.** Toolkit FAB lives bottom-left at `left: 20px; bottom: 20px`. Lab Assistant FAB lives bottom-right at `right: 20px; bottom: 20px`.

**Target state.**
```css
/* toolkit.css */
.tk-fab {
  position: fixed;
  right: 20px;
  bottom: 110px;          /* sits 90 px above the chat FAB */
  left: auto;
}

/* global-chat.css — unchanged */
.gc-fab { position: fixed; right: 20px; bottom: 20px; }
```

**Stacking and z-index.** Both FABs share `z-index: 9999`. The chat panel uses `z-index: 10000` so it overlays the toolkit FAB when open. The toolkit panel similarly uses a higher z-index than the chat FAB so panels never visually overlap each other.

**Drag persistence.** Toolkit FAB previously remembered a custom drag position via `localStorage`. We invalidate that key on first load post-deploy:
```js
try { localStorage.removeItem('tk.fabPos'); } catch {}
```
so existing users don't see the toolkit stuck in its old left-side position.

**Why bottom-110px specifically.** Chat FAB is 72 × 72 px sitting at `bottom: 20px`. Adding a 16 px gap and a 72 px toolkit FAB lands the toolkit's bottom at 108–112 px. Rounding to 110 keeps the math tidy and gives a one-line CSS rule.

### Part 7 — Proactive Lab Assistant (Page-Transition Greeting)

**Trigger.** `global-chat.js` runs `init()` on every `DOMContentLoaded`. Because each navigation is a full page reload (static site), every page load is a "page change" — no SPA route listener needed.

**Greeting source.** A page-keyed lookup keyed off `location.pathname`:
```js
const PAGE_GREETINGS = {
  'index.html':      '👋 Welcome to the Dashboard! Pick a tool to start.',
  'welcome.html':    '🔬 Welcome! I\'m your Lab Assistant — open the Dashboard to begin.',
  'chapter.html':    '📖 Need help with chapters? Click any card or ask me anything.',
  'experiment.html': '🧪 Setting up an experiment? I can help with safety and procedures.',
  'quiz.html':       '📝 Ready to test your knowledge? I\'m here if you need a hint.',
  'lab-tools.html':  '🧰 Exploring Lab Tools? Ask me about safety, images, or what-if scenarios.',
  'tutor.html':      '🤖 Welcome to Science Tutor! Ask me anything.',
};
const path = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
const greeting = PAGE_GREETINGS[path] || '👋 Need help? Ask me anything!';
```

**UX shape.**
- A small `<div class="gc-bubble-hint">` is appended next to the FAB ~1.2 s after load, with a CSS slide-in transition.
- It auto-dismisses after 6 s (`setTimeout(hide, 6000)`).
- It also dismisses immediately if the user opens the chat panel (the FAB click handler attaches a one-shot `hide` listener).
- It does **not** appear if the chat panel is already open.
- It does **not** spam: only one greeting element is allowed at a time (`getElementById('gc-bubble-hint')` guard).

**Why a separate DOM node and not the existing FAB tooltip.** The FAB's title-attr tooltip is OS-rendered and not theme-able; a dedicated styled bubble matches the rest of the glass UI and animates in cleanly without touching the FAB's own state.

## Data Models

The only persisted state added by these features:

| Key                | Owner             | Purpose                              |
|--------------------|-------------------|--------------------------------------|
| `selectedSubject`  | `common.js`       | Adds `"Science"` as a valid value.   |
| `tk.lastTab`       | `toolkit.js`      | Unchanged.                           |
| `tk.lastConvCat`   | `toolkit.js`      | Unchanged.                           |
| `tk.fabPos`        | `toolkit.js`      | Removed-on-load to reset FAB.        |
| `vsl.globalChat`   | `global-chat.js`  | Unchanged.                           |

No new keys.

## Error Handling

- **Tile typewriter.** If `data-desc` is missing/empty, the listener writes nothing — no error, no console noise.
- **Brand link.** If `welcome.html` is missing on the server, the browser shows a 404; deploy workflow already includes all `frontend/*.html` in the S3 sync, so this is detection-only via a smoke test (manually visiting `/welcome.html` after deploy).
- **Greeting bubble.** Wrapped in `try/catch`-style guards (`if (isOpen) return`, `if (document.getElementById('gc-bubble-hint')) return`) so a re-fired init can't double-render. The element is also self-removed on transition end.
- **Subject validator.** `validators.py` returns a 400 with an explicit "subject must be one of …" message when an unknown subject is sent. Adding "Science" is purely additive; it cannot break existing requests.

## Correctness Properties

Invariants the implementation must hold across all seven parts.

### Property 1: Tile data integrity
**Validates: Requirements 1.1, 1.3**

For every `.tile` element, `data-desc` is the single source of truth. The visible `<p>` is always either empty (resting state) or a strict left-to-right prefix of `data-desc` (during typing). It is never a different string, never out of order, and is reset to empty before any new typing run.

### Property 2: Typewriter timer hygiene
**Validates: Requirements 1.3, 1.4**

At most one active `setInterval` per tile at any moment. `mouseenter` always clears the previous timer before starting a new one; `mouseleave` always clears the timer and zeroes the visible text.

### Property 3: Outline editability
**Validates: Requirements 2.5**

The Quiz outline container retains `contenteditable="true"` after styling is applied. Programmatic styling never wraps user-entered text in nodes that block editing or insert non-deletable content into the editable flow (the icon is a CSS pseudo-element, not a text node).

### Property 4: Outline serialization
**Validates: Requirements 2.6**

When the outline is sent to the backend, the serialized payload is `innerText`-derived and contains no decorative glyphs or style markup — only the user-visible text in document order.

### Property 5: Brand routing
**Validates: Requirements 3.3, 3.6**

Every page's `.brand` element is an anchor whose `href` resolves to `welcome.html`. Middle-click and Cmd/Ctrl-click open it in a new tab; keyboard `Enter` activates it like any link.

### Property 6: Active link uniqueness
**Validates: Requirements 3.4**

On any given page, at most one `.nav-link` carries the `.active` class, and it is the link whose `href` matches the current document.

### Property 7: Five-card layout
**Validates: Requirements 4.1, 4.3, 4.4**

`index.html` renders exactly five `.tile` elements inside `.tile-grid.tile-grid-row`, the last of which carries `.tile-locked`. The locked card never navigates; its click handler always calls `event.preventDefault()`.

### Property 8: Subject value space
**Validates: Requirements 5.1, 5.4**

The set of valid subject values is exactly `{"Biology", "Chemistry", "Physics", "Science"}` on both client (`setSubjectTheme`, every `<select id="subject">`) and server (`validators.py`). The two sets stay equal — adding or removing a subject must update both.

### Property 9: Subject persistence
**Validates: Requirements 5.6**

`localStorage.selectedSubject` is read and written only through `getSavedSubject()` / `setSubjectTheme()` and is always one of the four valid values; a corrupt or missing value falls back to `"Biology"` without throwing.

### Property 10: FAB placement
**Validates: Requirements 6.1, 6.2, 6.3**

No floating UI element is anchored to the left edge of the viewport. Both `tk-fab` and `gc-fab` are positioned with `right: 20px`, and `tk-fab.bottom > gc-fab.bottom` so the toolkit always sits above the chat.

### Property 11: Greeting bubble singularity
**Validates: Requirements 7.6**

At most one `#gc-bubble-hint` element exists in the DOM at any time. It self-removes after its hide transition completes; it never accumulates across page interactions on a single page load.

### Property 12: Greeting non-intrusion
**Validates: Requirements 7.4, 7.5**

The greeting bubble is never shown when `isOpen === true` for the chat panel, and it dismisses immediately the first time the FAB is clicked after appearing.

### Property 13: No backend contract drift
**Validates: Requirements 5.4**

None of the seven parts adds, removes, or renames a request/response field on any Lambda. Part 5's only backend change is widening an allowed-list and prompt context for `"Science"`.

### Property 14: Idempotent init
**Validates: Requirements 7.1, 7.6**

Every initializer (`global-chat.js init`, `toolkit.js build`, `index.html` tile wiring) is safe to call once per page load and guards against double-mount via DOM-id checks.

## Testing Strategy

Smoke-level manual verification per part, since the project has no automated frontend tests today:

1. **Tiles.** Hover each card → icon glides up, description types in. Mouse out → text disappears immediately, icon recenters. Locked card still types its description but does not lift.
2. **Quiz outline.** Generate a quiz outline → first line renders as a bold accent-colored heading with 🎯 prefix and underline. Click into the heading → cursor lands inside, characters can be edited and saved without losing styling.
3. **Header.** Resize window to 1440 / 1024 / 768. Brand stays flush left; nav stays flush right; both never overlap. Click brand on every page → lands on `welcome.html`.
4. **Dashboard.** On a wide screen, exactly five cards in one row, last card visibly dimmed and labeled "Coming Soon". Click locked card → toast appears, no navigation.
5. **Science subject.** Open each tool's subject `<select>`, confirm the new "Science" option is selectable. Pick it → page accent shifts to amber and floating icons swap. Hit Generate → backend accepts and returns a generation tailored to general science.
6. **FAB stack.** Verify the calculator FAB sits directly above the chat FAB on the right, both at 20 px from the right edge, with a small visible gap. Left edge of every page has zero floating elements.
7. **Greeting bubble.** Navigate Dashboard → Chapter → Experiment → Quiz → Lab Tools → Welcome. On each landing, a context-specific bubble pops in within ~1.2 s and disappears after ~6 s. Opening the chat dismisses it instantly. Reloading the same page re-fires the bubble (intended).

If a regression is found, the affected file in the canonical list above is the single point of investigation.

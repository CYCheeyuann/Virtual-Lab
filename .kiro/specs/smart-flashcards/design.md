# Design: Smart Flashcards

## Overview

Smart Flashcards adds a fully integrated spaced-repetition study system to the Virtual Science Lab. Users can generate AI flashcard decks from scratch, from a Chapter Assistant overview, or from their incorrectly-answered quiz questions. Decks are organized by Subject + Bab (chapter), reviewed in a distraction-free 3D-flip study UI, and scheduled by a Leitner-box algorithm running entirely client-side in `localStorage`.

The feature is intentionally a **first-class peer** to existing tools (Chapter Assistant, Experiment Guide, Quiz Generator, Lab Tools), not a tab inside one of them. It gets:

- A header nav link (between "Quiz Generator" and "Lab Tools")
- A dashboard tile (replaces the "Coming Soon" 5th card)
- A standalone page (`flashcards.html`) hosting both deck library and study mode
- A new Lambda (`flashcard_generator`) deployed via the existing SAM template
- Cross-page entry hooks in `chapter.html` and `quiz.html`

### Goals
- One coherent loop: generate → organize → study → grade → reschedule.
- Zero server-side persistence: all decks, cards, box positions, review timestamps live in the user's `localStorage`.
- Backend is stateless and only does AI generation (concept → JSON cards). It does not know which user a deck belongs to.
- Cross-module hooks reuse existing data (chapter overview text, quiz wrong answers) so users never have to retype context.

### Non-goals
- No accounts, no sync between devices.
- No SM-2 / Anki-grade scheduling. Leitner with 5 fixed boxes only.
- No image / audio cards in v1 (text front, text back, optional hint).
- No leaderboard / social features.
- No editing of card front/back text in v1 (delete + regenerate is the workflow).

### Affected files (canonical list)
```
NEW  frontend/flashcards.html          (deck library + study mode in one SPA-ish page)
NEW  frontend/flashcards.css           (deck library + 3D flip styles)
NEW  frontend/flashcards.js            (Leitner engine, deck CRUD, study state machine)
NEW  lambdas/flashcard_generator/app.py
NEW  lambdas/flashcard_generator/requirements.txt
NEW  lambdas/flashcard_generator/run.sh

MOD  frontend/index.html               (Part 1: 5th tile → Smart Flashcards)
MOD  frontend/welcome.html             (nav link added)
MOD  frontend/chapter.html             (nav link added; "Turn into Flashcards" button)
MOD  frontend/experiment.html          (nav link added)
MOD  frontend/quiz.html                (nav link added; "Save incorrect → Flashcards" button)
MOD  frontend/tutor.html               (nav link added if still routed)
MOD  frontend/lab-tools.html           (nav link added)
MOD  frontend/config.js                (FlashcardGenerator URL placeholder)
MOD  frontend/styles.css               (Beta badge for the locked tile)
MOD  frontend/global-chat.js           (greeting entry for flashcards.html)

MOD  infra/template.yaml               (FlashcardGeneratorFunction + Output URL)
MOD  .github/workflows/deploy.yml      (sed-replace __URL_FLASHCARD_GENERATOR__)
```

## Architecture

### Component layout
```
┌─ flashcards.html ────────────────────────────────────────────────┐
│                                                                  │
│  ┌── view: library ──────────────────────────────────────────┐   │
│  │   New Deck (form: Subject, Bab, Topic, source, count)     │   │
│  │   Deck cards grid                                         │   │
│  │     [Biology · Bab 3: Keturunan ]  ▸ Due Today: 12        │   │
│  │     [Physics · Circular Motion  ]  ▸ Due Today: 0  ✓      │   │
│  │     ...                                                   │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌── view: study ───────────── (full-screen overlay) ────────┐   │
│  │   ┌─────────────── 3D card ──────────────┐   progress  …  │   │
│  │   │   FRONT   |   BACK (rotateY 180deg)   │              │   │
│  │   └────────────────────────────────────────┘              │   │
│  │   [🔴 Hard]  [🟡 Okay]  [🟢 Easy]    1/2/3 · ←/→ swipe    │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Data flow
```
generation (any source)                   study loop
─────────────────────────                 ─────────────
chapter.html / quiz.html / library form   library "Study Now"
       │                                       │
       ▼                                       ▼
  flashcard_generator Lambda               buildDueQueue(deck)
   (Bedrock → strict JSON array)               │
       │                                       ▼
       ▼                              user grades (Hard/Okay/Easy)
  client merges into deck.cards[]              │
   (Box=1, due=now)                            ▼
       │                                  applyGrade(card, grade)
       ▼                                  → updates box, nextReviewDate
  localStorage: vsl.flashcards                 │
                                               ▼
                                  saveStore(); update Due counter
```

### Module boundaries
- **`flashcards.js`** owns three concerns kept in separate IIFE-scoped sub-modules: storage (`Store`), Leitner engine (`Leitner`), and view controller (`UI`). Cross-page hooks are thin: `window.Flashcards.createDeckFromText(...)` and `window.Flashcards.saveQuizMistakes(...)`.
- **`flashcard_generator`** is pure stateless AI: receives `{subject, chapter, topic, source_text, num_cards}`, returns `{cards: [...]}` array of `{front, back, hint, tags}`.
- **`global-chat.js`** is unaffected except for one new entry in `PAGE_GREETINGS` keyed off `flashcards.html`.

## Components and Interfaces

### Part 1 — Navigation & Dashboard

**Header link** added on every page between Quiz Generator and Lab Tools:
```html
<a class="nav-link" href="flashcards.html">Flashcards</a>
```
Active state on `flashcards.html` itself.

**Dashboard 5th tile** (in `index.html`) replaces the existing locked "Coming Soon" card. The card is still rendered with `tile-locked` styling **only until the Lambda is deployed and `__URL_FLASHCARD_GENERATOR__` is replaced**. Detection is automatic:
```js
const flashcardsLive = window.STREAM_URLS &&
  window.STREAM_URLS.flashcard_generator &&
  !window.STREAM_URLS.flashcard_generator.startsWith('__URL_');
```
- If `flashcardsLive` is true → tile loses `.tile-locked`, becomes a real link to `flashcards.html`, AND the badge element is removed entirely from the DOM (v2 revision: there is no "Beta" adornment on the live tile — the tile is visually identical to its four sibling tool tiles).
- If false → tile retains `.tile-locked`, badge reads "Coming Soon", click shows toast.

**Markup:**
```html
<a class="tile" href="flashcards.html" id="flashTile" data-desc="AI-generated spaced repetition decks to lock science concepts into your long-term memory.">
  <span class="tile-badge tile-badge-coming" id="flashBadge">Coming Soon</span>
  <div class="tile-icon">
    <!-- layered cards / brain SVG -->
  </div>
  <h3>Smart Flashcards</h3>
  <p></p>
</a>
```
The `flashBadge` element is **removed** from the DOM by the dashboard's bootstrap script when `flashcardsLive === true`:
```js
if (live) {
  tile.classList.remove('tile-locked');
  badge?.remove();      // physically delete the node — not just hide
}
```

`.tile-badge` is a small absolutely-positioned pill in the top-right corner of the tile, with the same accent palette as the chosen subject theme:
```css
.tile-badge {
  position: absolute;
  top: 14px;
  right: 14px;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--c-accent-soft);
  color: var(--c-accent-2);
  box-shadow: 0 0 12px var(--c-accent-glow);
}
```

### Part 2 — Cross-Module Hooks

**Chapter Assistant.** After a successful chapter overview render, an extra button appears in the existing button row:
```html
<button id="chapterToFlashBtn" class="btn btn-ghost">
  <span>🧠</span><span>Turn this Chapter into Flashcards</span>
</button>
```
Handler reads the rendered overview text from the same panel currently used for the Lambda response, calls `generateCards()` directly (NOT `createDeckFromText`, since the v2 preview step needs to gate the persistence), then routes to `flashcards.html?previewSeed=<base36-id>` — the seed key looks up the in-memory pending preview from a small `sessionStorage` cache (`vsl.flashcardsPreviewSeed`) so the page can hydrate the preview state on landing:

```js
// chapter.html
const cards = await window.Flashcards.generateCardsFromText({...});  // returns raw card array
const seedId = uid();
sessionStorage.setItem('vsl.flashcardsPreviewSeed', JSON.stringify({
  id: seedId, subject, chapter, topic, cards, createdAt: Date.now()
}));
location.href = `flashcards.html?previewSeed=${seedId}`;

// flashcards.js init
const params = new URLSearchParams(location.search);
const seedId = params.get('previewSeed');
if (seedId) {
  const raw = sessionStorage.getItem('vsl.flashcardsPreviewSeed');
  if (raw) {
    const seed = JSON.parse(raw);
    if (seed.id === seedId && Date.now() - seed.createdAt < 5 * 60 * 1000) {
      sessionStorage.removeItem('vsl.flashcardsPreviewSeed');  // one-shot
      showPreview(seed);
    }
  }
}
```
Five-minute TTL so a stale seed in another tab can't auto-confirm a stranger deck. The seed is a one-shot — consumed on first read so a refresh doesn't re-pop the preview.

**Quiz Generator.** In Phase 4 (Results), one new button:
```html
<button id="saveWrongToFlashBtn" class="btn btn-ghost">
  <span>🧠</span><span>Save incorrect answers to Flashcards</span>
</button>
```
Disabled if there are no incorrect answers OR the backend isn't deployed. Handler runs the `from_quiz` generation, writes the seed, and routes to `flashcards.html?previewSeed=…` — identical preview flow as the chapter hook.

**Why route through the preview seed.** v1 had cross-module hooks call `createDeckFromText` / `saveQuizMistakes` which committed the deck immediately and dropped the user into study mode. v2 honours the "Confirm before commit" contract universally — no entry point to the flashcards system can persist a deck without the user passing through the Preview screen first.

### Part 3 — Deck Setup UI (Bab Input)

The library page's "Create Deck" form, modeled on the Quiz Generator setup:

```html
<section class="card" id="newDeck">
  <h2>Create a New Deck</h2>

  <label>Subject</label>
  <select id="newSubject" class="input">
    <option>Biology</option>
    <option>Chemistry</option>
    <option>Physics</option>
    <option>Science</option>
  </select>

  <label>Chapter Name / Bab <span class="required">*</span></label>
  <input id="newBab" class="input" type="text"
         placeholder="e.g. Bab 3: Keturunan, Circular Motion" required />

  <label>Topic / Focus (optional)</label>
  <input id="newTopic" class="input" type="text"
         placeholder="e.g. Centripetal acceleration formulas" />

  <label>Source Notes (optional)</label>
  <textarea id="newSource" class="input" rows="6"
            placeholder="Paste your notes, a chapter summary, or leave blank for a generic AI deck."></textarea>

  <label>How many cards?</label>
  <select id="newCount" class="input">
    <option>8</option>
    <option selected>12</option>
    <option>16</option>
    <option>20</option>
  </select>

  <div class="btn-row">
    <button id="generateDeckBtn" class="btn btn-primary">Generate Deck</button>
  </div>
</section>
```

Bab is **required**; without it the deck has no folder and shows a validation toast on submit. Bab + Subject together form the deck's display label (`"Biology · Bab 3: Keturunan"`).

### Part 4 — Deck Library

Decks render as glass-style cards in a responsive grid (`repeat(auto-fit, minmax(280px, 1fr))`):

```
┌─────────────────────────────────────┐
│  🧬  Biology · Bab 3: Keturunan      │
│  24 cards · Box avg: 2.3            │
│                                     │
│  Due today: 12   ✓ All caught up?   │
│                                     │
│  [ Study Now ]  [ Manage ]   ⋯      │
└─────────────────────────────────────┘
```

- Subject icon (🧬/⚛️/🧪/🔬) drawn from `SUBJECT_ICONS` already defined in `common.js`.
- Border accent uses `[data-subject]` palette by adding `data-subject` to each deck card so it picks up the same accent CSS variables already used elsewhere.
- "Due today" counter computed at render time from `Leitner.dueCount(deck)` (no precomputation stored).
- "All caught up" check appears only when `dueCount === 0`.
- "Manage" opens an inline detail strip with: Rename Bab, Delete deck (double-confirm), Reset progress (move all cards back to Box 1), Export JSON.

### Part 5 — Distraction-Free Study UI

A full-viewport overlay with `position: fixed; inset: 0; backdrop-filter: blur(20px); background: rgba(20,13,38,0.85)` covers the dashboard, dimming the background. **Inside the overlay, all session-level controls are anchored to the central card container, not to the viewport corners** — so the user's eye doesn't have to travel to the screen edges to read the progress or hit Exit.

**Card markup (v2 — controls live INSIDE `.fc-stage`'s wrapper, not at overlay top):**
```html
<div class="fc-overlay">
  <div class="fc-session" tabindex="-1">
    <div class="fc-session-bar">
      <span class="fc-progress" id="fcProgress">1 / 12 · Box 1/5</span>
      <button class="fc-exit-btn" id="fcExitBtn" aria-label="Exit study">✕ Exit</button>
    </div>

    <div class="fc-stage" data-flipped="false" tabindex="0">
      <div class="fc-card">
        <div class="fc-face fc-front">
          <div class="fc-prompt"><!-- card.front --></div>
        </div>
        <div class="fc-face fc-back">
          <div class="fc-answer"><!-- card.back --></div>
        </div>
      </div>
    </div>

    <div class="fc-hint-row">
      <button class="fc-hint-toggle">Reveal Hint</button>
      <div class="fc-hint" hidden><!-- card.hint --></div>
    </div>

    <div class="fc-actions">
      <button class="fc-grade fc-hard" data-grade="hard">🔴 Hard</button>
      <button class="fc-grade fc-okay" data-grade="okay">🟡 Okay</button>
      <button class="fc-grade fc-easy" data-grade="easy">🟢 Easy</button>
    </div>
  </div>
</div>
```

**Key layout decision.** `.fc-session` is the central anchor — a flex column with `width: min(640px, 92vw)` matching the card's width. The session bar (progress + exit) sits as a sibling at the top, the card stage in the middle, hint and grade buttons below. Because the bar shares the session's max-width, the progress always aligns with the card's left edge and Exit always aligns with the card's right edge. Resizing the viewport moves all four anchors as one rigid block.

**Anchored controls CSS:**
```css
.fc-session {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 14px;
  width: min(640px, 92vw);
  max-width: 100%;
  outline: none;          /* tabindex=-1, focus shouldn't show ring */
}
.fc-session-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.85rem;
  color: var(--c-muted);
  padding: 0 4px;          /* tiny inset so progress doesn't crowd corner */
}
.fc-progress {
  font-weight: 600;
  color: var(--c-text-strong);
}
.fc-exit-btn {
  background: rgba(255,255,255,0.08);
  border: 1px solid var(--c-border);
  color: var(--c-text);
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 0.82rem;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}
.fc-exit-btn:hover { background: var(--c-accent-soft); color: var(--c-accent); }
```
Note the v1 spec used `position: absolute; top: 18px; left: 24px` style positioning that floated these controls to the viewport's edges. The v2 design eliminates absolute positioning entirely — flow layout inside `.fc-session` does the anchoring naturally.

**3D flip CSS** (unchanged from v1):
```css
.fc-stage { perspective: 1600px; width: 100%; height: min(420px, 60vh); }
.fc-card {
  position: relative;
  transform-style: preserve-3d;
  transition: transform 0.55s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.fc-stage[data-flipped="true"] .fc-card { transform: rotateY(180deg); }
.fc-face { position: absolute; inset: 0; backface-visibility: hidden; }
.fc-back { transform: rotateY(180deg); }
```

**Flip input rules (v2 — strictly two inputs):**

| Input                                | Triggers flip? | Notes                                                |
|--------------------------------------|----------------|------------------------------------------------------|
| Left-click on `.fc-stage`            | Yes            | `mousedown.button === 0` filter; ignore others       |
| Enter while `.fc-stage` has focus    | Yes            | Stage has `tabindex="0"` so it can hold focus        |
| Spacebar                             | NO             | Reserved (was a flip key in v1)                      |
| Tab / Shift-Tab                      | NO             | Pure focus movement                                  |
| Arrow keys                           | NO             | Reserved for future "skip" gestures                  |
| Right-click / middle-click           | NO             | Filtered by button check                             |
| Double-click                         | NO             | Browser's `dblclick` is a no-op for the stage        |
| Hover                                | NO             | No `:hover` flip — would be too sensitive            |
| Touch tap (≤ 8 px movement)          | Yes            | Treated as a left-click via pointer events           |
| Horizontal swipe ≥ 60 px             | NO (flips)     | Triggers grade only when card is currently on back   |

**Why so restrictive?** v1 testing surfaced two failure modes:
- Users trying to scroll the page tapped the card by accident and it flipped.
- Pressing Space to scroll the page (default browser behaviour) flipped the card unexpectedly because the stage held focus.

The v2 input model deliberately mirrors a desktop "open / activate" convention (click or Enter) and aligns with WCAG button-activation conventions; everything else is treated as navigation, not interaction.

**Click handler implementation:**
```js
stage.addEventListener('click', (e) => {
  if (e.button !== 0) return;          // left-click only
  if (e.detail > 1) return;            // ignore double-click second event
  flipCard();
});
stage.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    flipCard();
  }
  // No Space handler — let the browser scroll if it wants to
});
```

**flipCard() bidirectional toggle:**
```js
function flipCard() {
  if (!ui.overlayOpen) return;
  ui.flipped = !ui.flipped;
  document.getElementById('fcStage').dataset.flipped = String(ui.flipped);
  // Hint row visibility tracks the front/back state
  document.getElementById('fcHintRow').hidden = ui.flipped;
}
```
There is no one-way gate — the card can flip back to front and forward to back unlimited times during the same study card.

**State machine:**
```
queued → showing(front) ─┬─ [click / Enter] ─→ showing(back) ─┬─ [click / Enter] ─→ showing(front) → ...
                         │                                      │
                         ├──── grade button / 1/2/3 ────────────┤   (always-on, see Part 6)
                         │                                      │
                         └─→ next card                          └─→ next card
```

When the queue empties, the overlay swaps to a "Session complete" panel showing: cards reviewed, breakdown by grade, suggested next session date (= earliest `nextReviewDate` across deck). The session-bar (progress + exit) remains anchored above the summary panel.

### Part 6 — Always-On Grading & Touch Gestures

**v2 inversion.** Grading is now decoupled from flip state. The three grade buttons (and keyboard shortcuts 1/2/3) are visible AND enabled at all times during a study session, independent of whether the current card is showing front or back. Pressing any grade input applies the grade to the current card and advances — no flip required, no flip implied.

**Grade handler (v2):**
```js
function grade(g) {
  if (!ui.overlayOpen) return;
  if (!['hard','okay','easy'].includes(g)) return;
  const card = ui.queue[ui.idx];
  if (!card) return;
  const store = Store.load();
  const deck = store.decks.find(d => d.id === ui.deckId);
  if (!deck) { exitStudy(); return; }
  const liveCard = deck.cards.find(c => c.id === card.id);
  if (!liveCard) { ui.idx++; showCurrentCard(); return; }
  applyGrade(liveCard, g);            // identical Leitner semantics whether flipped or not
  if (!card.lastReviewedAt) deck.newServedToday = (deck.newServedToday || 0) + 1;
  deck.updatedAt = Date.now();
  Store.save(store);
  ui.breakdown[g]++;
  ui.idx++;
  showCurrentCard();
}
```
Note the absence of any `if (!ui.flipped) return;` guard. The v1 design's "grading gate" is gone.

**Keyboard handler (v2):**
```js
function onKey(e) {
  if (!ui.overlayOpen) return;
  if (e.key === 'Escape') { e.preventDefault(); exitStudy(); return; }
  // Note: Space is intentionally NOT handled — see flip rules table above.
  if (e.key === '1') { e.preventDefault(); grade('hard'); }
  else if (e.key === '2') { e.preventDefault(); grade('okay'); }
  else if (e.key === '3') { e.preventDefault(); grade('easy'); }
}
```

**Touch swipe (v2 — gating preserved for swipe-only).** Touch taps still flip (because tap-on-card is the natural mobile equivalent of click), so swipe-grade remains gated to "card already on back" to avoid ambiguity:
- Tap (small movement) on front → flip to back
- Tap on back → flip to front
- Swipe left ≥ 60 px while on **back** → grade Hard
- Swipe right ≥ 60 px while on **back** → grade Easy
- Swipe while on **front** → ignored (user might be trying to flip-and-grade in one gesture; we require the explicit flip first to disambiguate)

This is the only place where a flip-state check influences behaviour, and it's a touch ergonomics rule, not a Leitner rule. Button clicks and 1/2/3 keys remain unconditional.

### Part 7 — Leitner Engine

**Schedule:**
```js
const LEITNER_DAYS = { 1: 1, 2: 3, 3: 7, 4: 14, 5: 30 };
const MS_PER_DAY = 86400000;

function applyGrade(card, grade) {
  const now = Date.now();
  if (grade === 'hard') {
    card.box = 1;
  } else if (grade === 'okay') {
    // stay in current box, just push the next review forward by current interval
    card.box = card.box;
  } else if (grade === 'easy') {
    card.box = Math.min(5, card.box + 1);
  }
  card.lastReviewedAt = now;
  card.nextReviewDate = now + LEITNER_DAYS[card.box] * MS_PER_DAY;
  card.history.push({ ts: now, grade, box: card.box });
  if (card.history.length > 50) card.history.splice(0, card.history.length - 50);
}
```

**Due queue construction** at study time:
```js
function buildDueQueue(deck) {
  const now = Date.now();
  const due = deck.cards.filter(c => c.nextReviewDate <= now);
  // Limit new cards (box=1, never reviewed) to NEW_CARDS_PER_DAY
  const newCards = due.filter(c => !c.lastReviewedAt).slice(0, deck.dailyNewCap);
  const reviews = due.filter(c => c.lastReviewedAt);
  // Interleave: roughly 1 new card after every 2 reviews
  return interleave(reviews, newCards, 2);
}
```

**Daily cap.** Each deck stores `dailyNewCap` (default 20). Tracking which day "today" is uses a `lastSessionDay` field on the deck reset at midnight local time. Reviews of already-seen cards are not capped — only fresh Box-1 cards are.

### Part 8 — Storage Schema

**localStorage key:** `vsl.flashcards`. Single JSON object so loads/writes are atomic.

```ts
type Store = {
  version: 1;
  decks: Deck[];
};

type Deck = {
  id: string;                 // base36 timestamp + 4-char random
  subject: 'Biology' | 'Chemistry' | 'Physics' | 'Science';
  bab: string;                // user-typed chapter name, displayed verbatim
  topic: string;              // optional, used as deck subtitle
  createdAt: number;
  updatedAt: number;
  dailyNewCap: number;        // default 20
  lastSessionDay: string;     // 'YYYY-MM-DD' local
  cards: Card[];
};

type Card = {
  id: string;
  front: string;
  back: string;
  hint: string | null;
  tags: string[];
  box: 1 | 2 | 3 | 4 | 5;
  lastReviewedAt: number | null;
  nextReviewDate: number;     // ms epoch; new cards = createdAt
  history: Array<{ ts: number; grade: 'hard'|'okay'|'easy'; box: number }>;
};
```

**Quota guards:** total store size capped at ~3 MB. On write, if `JSON.stringify(store).length > 3_000_000`, oldest 10% of cards in the largest deck are dropped (with a toast). This matches the same pattern used by `global-chat.js` for chat history.

**Schema versioning:** `version: 1`. On load, if missing or different, the store is migrated by a switch on `version` (today: just initialize fresh).

### Part 8b — Preview State (Ephemeral, In-Memory Only)

The Preview screen does **not** persist to `localStorage`. Generated cards live only on a transient page-scoped JS variable, and are committed to the store only when the user clicks "Confirm & Start Studying":

```js
// inside flashcards.js
let pendingPreview = null;   // { subject, bab, topic, cards } or null

function showPreview({ subject, bab, topic, cards }) {
  pendingPreview = { subject, bab, topic, cards };
  // ... render the accordion list ...
}

function confirmPreview() {
  if (!pendingPreview) return;
  const { subject, bab, topic, cards } = pendingPreview;
  const deck = makeDeck({ subject, bab, topic });
  const id = persistNewDeck(deck, cards);     // single localStorage write
  pendingPreview = null;
  // ... clear form, render library, start study ...
}

function discardPreview() {
  pendingPreview = null;                       // truly nothing to clean up
  // ... show form again with original values intact ...
}
```

Discarding the preview is just a variable assignment — no storage write, no `setItem` to undo. This satisfies Requirement 9.5 (navigating away during preview = nothing committed) for free, since closing the page or browsing away naturally discards `pendingPreview`.

### Part 10 — Preview Accordion (Collapsed-by-Default Card Rows)

Each card row in the preview list is rendered as an HTML `<details>` element so the open/close behaviour is native, accessible, and animation-friendly without state-management code:

```html
<div class="preview-list">
  <div class="preview-summary-row">
    <span class="preview-count">Preview: 12 cards for "Bab 3: Keturunan"</span>
    <button class="preview-bulk-toggle" id="previewBulkToggle">Expand All</button>
  </div>

  <details class="preview-card" data-idx="0">
    <summary class="preview-card-summary">
      <span class="preview-num">1</span>
      <span class="preview-q-text">What is centripetal acceleration?</span>
      <span class="preview-chevron">▼</span>
    </summary>
    <div class="preview-card-body">
      <div class="preview-back"><strong>A:</strong> The inward acceleration of an object moving in a circular path, given by **a = v²/r**.</div>
      <div class="preview-hint">💡 Think v squared over r.</div>
    </div>
  </details>
  <!-- repeated for each card -->
</div>
```

**Default state.** The `<details>` element starts without an `open` attribute, so only the `<summary>` (number + question + chevron) is visible. The `.preview-card-body` is hidden by the browser's built-in details/summary styling.

**Click target.** The entire `<summary>` is clickable. Clicking it (or pressing Enter/Space when focused) toggles `open` natively. No JavaScript click handler is needed for the accordion mechanic itself — only for the chevron icon's rotation, which uses a `[open]` selector:

```css
.preview-chevron {
  margin-left: auto;
  transition: transform 0.2s ease;
  color: var(--c-muted);
}
details[open] > summary .preview-chevron {
  transform: rotate(180deg);
}
.preview-card-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  cursor: pointer;
  list-style: none;            /* hide default disclosure triangle */
}
.preview-card-summary::-webkit-details-marker { display: none; }
```

**Bulk Expand / Collapse All.** A single button in the preview header iterates every `<details>` and toggles `open`:

```js
function applyBulkPreviewToggle() {
  const list = document.querySelectorAll('.preview-card');
  // Are most rows currently open?
  const openCount = [...list].filter(d => d.open).length;
  const targetState = openCount < list.length / 2;     // open all if most are closed
  list.forEach(d => { d.open = targetState; });
  document.getElementById('previewBulkToggle').textContent =
    targetState ? 'Collapse All' : 'Expand All';
}
```
The button label flips based on the current dominant state of the list, so the action is always meaningful regardless of how the user has manually expanded individual rows.

**Why `<details>` over a custom div?** Three wins:
- Built-in keyboard support (Enter/Space when focused) without any JS.
- Built-in screen-reader semantics (announced as a disclosure widget).
- Independent open state per row out of the box — exactly the "all rows can be open simultaneously" model Requirement 10.5 mandates.

### Part 11 — Anchored Session Controls (Implementation)

Detailed in Part 5's "Anchored controls CSS" block. The key invariant is that the `.fc-session` element is the single layout root for every control in the active study session — progress bar, exit button, card stage, hint row, and grade buttons are all flex children of the same element. There is **no** absolute positioning relative to the viewport in the v2 design.

**Resize correctness.** Because `.fc-session` has `width: min(640px, 92vw)`, the entire control cluster scales with the viewport in lock-step. The exit button on a 1920 px monitor and on a 360 px phone both sit exactly at the right edge of the card; the progress label both sit exactly at the left.

**Session-complete swap.** When the queue empties, `.fc-stage` is hidden and `.fc-summary` is shown in its place — but `.fc-session-bar` (progress + exit) stays mounted at the top. Progress reads "12 / 12 done" and the Exit button continues to work.

### Part 9 — Backend (`flashcard_generator` Lambda)

Same scaffold as `science_quiz`: Flask app, Lambda Web Adapter, response-stream off (we want full JSON in one response). `infra/template.yaml` adds:
```yaml
FlashcardGeneratorFunction:
  Type: AWS::Serverless::Function
  Properties:
    CodeUri: ../lambdas/flashcard_generator/
    Handler: run.sh
    MemorySize: 512
    Role: !GetAtt AppBedrockRole.Arn
    Layers:
      - !Sub "arn:aws:lambda:${AWS::Region}:753240598075:layer:LambdaAdapterLayerX86:27"
    Environment:
      Variables:
        AWS_LAMBDA_EXEC_WRAPPER: /opt/bootstrap
        AWS_LWA_INVOKE_MODE: buffered
        PORT: "8080"
        ALLOWED_ORIGIN: !Ref AllowedOrigin
    FunctionUrlConfig:
      AuthType: NONE
      InvokeMode: BUFFERED

# in Outputs:
FlashcardGeneratorUrl:
  Description: Flashcard Generator Lambda Function URL
  Value: !GetAtt FlashcardGeneratorFunctionUrl.FunctionUrl
```
No new IAM is needed — the existing `AppBedrockRole` already permits `bedrock:InvokeModel` for Claude Haiku 4.5. The deploy workflow gets one new `sed` line for `__URL_FLASHCARD_GENERATOR__`.

**API contract:**
```
POST <function-url>
Headers: Content-Type: application/json, X-Api-Key (if configured)
Body:
  {
    "mode": "from_text" | "from_quiz" | "from_topic",
    "subject": "Biology" | "Chemistry" | "Physics" | "Science",
    "chapter": "Bab 3: Keturunan",          // required
    "topic": "Mendelian inheritance",        // optional
    "num_cards": 12,                         // 4..30
    "source_text": "..."                     // for from_text / from_topic
    "wrong_answers": [                       // for from_quiz
      { "question": "...", "correct": "...", "picked": "...", "explanation": "..." }
    ]
  }

200 OK:
  {
    "cards": [
      { "front": "What is centripetal acceleration?",
        "back": "a = v²/r — the inward acceleration of an object moving in a circular path.",
        "hint": "Think v squared over r.",
        "tags": ["formula", "circular-motion"] }
    ]
  }

400 / 500: { "error": "..." }
```

**System prompt (sketch):**
```
You are a strict flashcard generator. Output ONLY valid JSON: an array of
exactly N cards, no markdown fences, no preamble.

Each card:
  "front" — concise question or prompt (≤ 200 chars)
  "back"  — concise correct answer with the key term in **bold** (≤ 400 chars)
  "hint"  — one-sentence cue that nudges memory without revealing the answer
  "tags"  — short kebab-case tags (e.g. "formula", "definition", "mechanism")

For mode=from_quiz, each card MUST be derived from a single wrong-answer
entry: front=the original question, back=the correct option restated as a
factual sentence (with the key term bold), hint=a misleading-distractor cue.
Do not include markdown fences. Do not include text outside the JSON array.
```

Same robustness logic as `science_quiz`: strip `\`\`\`json` fences if present, fail soft to `{error, raw}` if JSON parse fails.

## Data Models

| Storage location          | Key / Output            | Owner               | Purpose                                |
|---------------------------|-------------------------|---------------------|----------------------------------------|
| `localStorage`            | `vsl.flashcards`        | `flashcards.js`     | Decks, cards, Leitner box state.        |
| `localStorage` (existing) | `selectedSubject`       | `common.js`         | Pre-fills the new-deck Subject select.  |
| `localStorage` (existing) | `vsl.quizHistory`       | `quiz.html`         | Read-only source for "Save incorrect".  |
| Lambda env                | `MODEL_ID` (existing)   | `bedrock_stream.py` | Same Claude Haiku 4.5 model.            |
| CloudFormation Output     | `FlashcardGeneratorUrl` | `infra/template.yaml`| Sed-injected into `frontend/config.js`. |

## Error Handling

- **Lambda not deployed** → `STREAM_URLS.flashcard_generator` still has the placeholder. UI shows "Flashcards backend not yet deployed" toast on any generation attempt; library still works for any decks already in `localStorage`.
- **AI returns malformed JSON** → Lambda returns `{error, raw}` with HTTP 200, frontend shows a toast and offers a "Try again" button.
- **`localStorage` quota exceeded** → Truncate oldest cards in largest deck, toast "Older cards trimmed to free space".
- **User deletes a deck mid-study** → Active study session detects deck disappearance via storage version, shows "Deck removed", returns to library.
- **Clock skew / timezone change** → Leitner uses `Date.now()` (UTC ms), so DST and TZ moves don't double-count days; "today" check uses local `YYYY-MM-DD` only for the daily-new-cap reset.
- **Bab field empty** → Form-level validation prevents submit; the field shows a red border + toast.
- **Quiz "save incorrect" with zero wrong answers** → Button is disabled; tooltip "Nothing to save — perfect score!".

## Correctness Properties

Invariants the implementation must hold.

### Property 1: Bab required for every deck
**Validates: Requirements 3.2, 3.3**

Every persisted `Deck` object has a non-empty string `bab` field. The library UI rejects submission of the new-deck form when `newBab` is blank. No code path creates a deck (cross-module hooks or library form) without supplying `bab`.

### Property 2: Box monotonicity rules
**Validates: Requirements 7.1, 7.2, 7.3**

After `applyGrade(card, grade)`:
- If `grade === 'easy'` then `card.box === Math.min(5, oldBox + 1)`.
- If `grade === 'hard'` then `card.box === 1`.
- If `grade === 'okay'` then `card.box === oldBox`.
And in all three cases `card.nextReviewDate === Date.now() + LEITNER_DAYS[card.box] * MS_PER_DAY` (within ±1 ms tolerance).

### Property 3: Box bounds
**Validates: Requirements 7.1**

For every card at every moment, `card.box` is an integer in `{1, 2, 3, 4, 5}`. No grading or migration step can produce a value outside this set.

### Property 4: Due-queue correctness
**Validates: Requirements 7.4**

A card appears in `buildDueQueue(deck)` if and only if `card.nextReviewDate <= Date.now()`, subject to the daily new-card cap on cards where `lastReviewedAt === null`.

### Property 5: Daily cap honored
**Validates: Requirements 7.5**

The number of cards with `lastReviewedAt === null` returned by `buildDueQueue(deck)` in a single local-day session is at most `deck.dailyNewCap`.

### Property 6: Bidirectional flip toggle
**Validates: Requirements 5.3, 5.4**

The card responds only to two flip inputs: a left-click on `.fc-stage` (button === 0) and Enter while `.fc-stage` has keyboard focus. Each invocation toggles `ui.flipped` (front ↔ back), so an unbounded sequence of valid inputs produces an alternating front/back sequence. Spacebar, double-click, right/middle clicks, hover, and Tab key changes never trigger a flip.

### Property 7: Always-on grading
**Validates: Requirements 6.1, 6.2, 6.3**

The three grade buttons (and keyboard 1/2/3) are visible and enabled for every card during a study session, regardless of `ui.flipped`. Invoking a grade applies it via `applyGrade()` and advances `ui.idx`, with no flip-state guard. The persisted Leitner box update is identical whether the card was flipped before grading or not.

### Property 8: Storage atomicity
**Validates: Requirements 7.6**

Every write to `localStorage` serializes the entire `Store` object in a single `setItem`. There is no partial save (e.g. updating one card without saving the deck). Reads always go through `Store.load()` which falls back to a fresh empty store on parse failure.

### Property 9: Cross-module hook idempotency
**Validates: Requirements 2.1, 2.2**

`createDeckFromText` and `saveQuizMistakes` always create a *new* deck (never mutate an existing one). Calling them twice with identical input produces two separate decks with distinct ids — no silent merging that could surprise the user.

### Property 10: No backend persistence
**Validates: Requirements 4.1**

The `flashcard_generator` Lambda has no DynamoDB / S3 / RDS dependency. Its only AWS call is `bedrock:InvokeModel`. Decks and progress are server-invisible.

### Property 11: Locked tile, live tile, no Beta badge
**Validates: Requirements 1.2, 1.3**

The dashboard 5th tile is rendered with `.tile-locked` and a "Coming Soon" badge if and only if `STREAM_URLS.flashcard_generator` is missing or starts with `__URL_`. After a successful deploy that replaces the placeholder, a hard reload yields a clickable Smart Flashcards tile with NO badge — the `flashBadge` element is removed from the DOM (not just hidden) when the tile is live.

### Property 12: Keyboard scope
**Validates: Requirements 6.1**

The flashcards keyboard handler is only active when the study overlay is mounted. Closing the overlay (Escape, exit button, or session-complete) removes the listener. Other pages' keyboard shortcuts (`Ctrl+Enter` from `common.js`, etc.) continue to work unaffected.

### Property 13: Preview never persists
**Validates: Requirements 9.1, 9.3, 9.5**

A deck is committed to `localStorage` if and only if the user clicks "Confirm & Start Studying" on the Preview screen. Generated cards held in `pendingPreview` are never written to storage, never visible in the deck library, and never participate in `buildDueQueue`. Closing the page, navigating away, or clicking "Back to Setup" discards them with no cleanup logic required.

### Property 14: Accordion independence
**Validates: Requirements 10.1, 10.5**

Each preview card row's open/closed state is independent: opening or closing one row does not change any other row's state. The bulk Expand-All / Collapse-All toggle is the only operation that affects multiple rows, and it sets every row to the same target state in one operation.

### Property 15: Anchored controls move with the card
**Validates: Requirements 11.1, 11.2, 11.3**

The progress indicator and Exit button are flex children of `.fc-session` (the same container that holds `.fc-stage`). They have zero `position: absolute / fixed` declarations relative to the viewport. At every viewport width and at every responsive breakpoint, the progress label aligns to the card's left edge and the Exit button aligns to the card's right edge — they cannot drift to the screen corners under any layout.

### Property 16: Cross-module hooks honour preview
**Validates: Requirements 2.1, 2.2, 9.1**

When a user invokes "Turn this Chapter into Flashcards" or "Save incorrect answers to Flashcards", no deck is added to `localStorage` until they pass through the Preview screen on `flashcards.html` and click Confirm. The seed mechanism (`vsl.flashcardsPreviewSeed`) holds generated cards in `sessionStorage` for at most 5 minutes and is consumed exactly once on first read.

## Testing Strategy

Manual smoke-tests for the v2 revision:

1. **Header** — every page now shows a "Flashcards" link between Quiz Generator and Lab Tools; clicking lands on `flashcards.html`. Active state highlights only on `flashcards.html`.
2. **Dashboard tile** — pre-deploy: shows "Coming Soon" badge, click → toast. Post-deploy: NO badge, click → flashcards page. Confirm the badge node is genuinely removed from the DOM (Inspect Element shows no `#flashBadge`).
3. **New deck (manual)** — fill subject + bab + topic + paste source notes + select 12 cards → click Generate → spinner → **Preview screen appears** with 12 collapsed accordion rows. Click each chevron → row expands/collapses independently. Click "Expand All" → all 12 open. Click "Collapse All" → all 12 close.
4. **Preview discard** — click "Back to Setup" → form re-shown with all entered values intact, deck library is unchanged.
5. **Preview confirm** — click "Confirm & Start Studying" → deck appears in library, study overlay opens immediately.
6. **New deck — Bab empty** — submit with empty bab → toast "Chapter Name / Bab is required", no network call, no preview.
7. **Cross-module: Chapter** — open Chapter Assistant, generate overview for "Circular Motion" → click "Turn this Chapter into Flashcards" → lands on `flashcards.html?previewSeed=…`, Preview screen pops up. Click "Back to Setup" → form is shown empty, NO deck saved (verify deck library is unchanged).
8. **Cross-module: Quiz** — complete a quiz with wrong answers → "Save incorrect answers to Flashcards" → Preview screen appears with one card per wrong answer.
9. **Flip — left-click** — click center of card → flip front→back. Click again → back→front. Click again → front→back. (Unbounded toggle.)
10. **Flip — Enter** — Tab into the page until `.fc-stage` is focused → press Enter → flips. Press Enter again → flips back.
11. **Flip — non-triggers** — press Space → no flip (page may scroll). Right-click → no flip (context menu may show). Double-click → no flip on the second click. Hover → no flip.
12. **Always-on grading — pre-flip** — without flipping, click 🟢 Easy → card advances, Leitner box increments to 2. Repeat across cards mixing pre-flip and post-flip grades; both produce identical box updates.
13. **Always-on grading — keyboard pre-flip** — without flipping, press 1 → grades Hard and advances.
14. **Anchored controls** — open the study overlay on a 1920 px monitor: progress sits just above the card's left edge, Exit just above the card's right edge. Resize to 800 px wide: both controls stay glued to the card edges.
15. **Anchored controls — session complete** — finish a session → progress reads "12 / 12 done", Exit still works, both still anchored to the summary panel.
16. **Leitner progression** — grade a card Easy three times → box: 1→2→3 with nextReviewDates 1d/3d/7d ahead. Grade Hard once → box drops to 1 with nextReviewDate 1d ahead.
17. **Mobile swipe** — on a phone (or Chrome devtools touch mode), tap card on front → flips to back. Swipe left on back → marked Hard. Swipe on front → no grade (must flip first on touch).
18. **Due counter** — manually edit `vsl.flashcards` in DevTools to set a card's `nextReviewDate` to 0 → reload library → "Due today" counter increments.
19. **Daily cap** — generate a 50-card deck, set `dailyNewCap = 5`, study → only 5 new cards appear interleaved among due reviews.
20. **Backend down** — block the Function URL in DevTools → click Generate → toast surfaces error, no preview shown, library remains intact.
21. **localStorage full** — manually fill `localStorage` to ~5 MB → generate one more deck → toast "Older cards trimmed", store size stays under cap.

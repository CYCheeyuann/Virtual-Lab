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
- If `flashcardsLive` is true → tile loses `.tile-locked`, becomes a real link to `flashcards.html`, badge text becomes empty (or "Beta" for first release).
- If false → tile retains `.tile-locked`, badge reads "Coming Soon", click shows toast.

**Markup:**
```html
<a class="tile" href="flashcards.html" id="flashTile" data-desc="AI-generated spaced repetition decks to lock science concepts into your long-term memory.">
  <span class="tile-badge" id="flashBadge">Beta</span>
  <div class="tile-icon">
    <!-- layered cards / brain SVG -->
  </div>
  <h3>Smart Flashcards</h3>
  <p></p>
</a>
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
Handler reads the rendered overview text from the same panel currently used for the Lambda response, then calls:
```js
window.Flashcards.createDeckFromText({
  subject: currentSubject,
  chapter: currentChapter,        // the user's chapter input
  topic: currentTopic || currentChapter,
  source_text: panel.innerText,
  num_cards: 12,
}).then(deckId => location.href = `flashcards.html?deck=${deckId}&autostudy=1`);
```
Deep link `?deck=ID&autostudy=1` lets the Flashcards page open the new deck and immediately drop into study mode.

**Quiz Generator.** In Phase 4 (Results), one new button:
```html
<button id="saveWrongToFlashBtn" class="btn btn-ghost">
  <span>🧠</span><span>Save incorrect answers to Flashcards</span>
</button>
```
Disabled if there are no incorrect answers. Handler:
```js
const wrong = quizData
  .map((q, i) => ({ q, i, picked: userAnswers[i] }))
  .filter(x => !x.picked || x.picked !== x.q.correct_answer);

window.Flashcards.saveQuizMistakes({
  subject: quizMeta.subject,
  chapter: quizMeta.topic,         // quiz "topic" maps to chapter for tagging
  topic: quizMeta.topic,
  wrong_answers: wrong.map(({ q, picked }) => ({
    question: q.question_stem,
    correct: q.options[q.correct_answer],
    picked: picked ? q.options[picked] : null,
    explanation: q.detailed_explanation,
  })),
}).then(deckId => showToast(`Saved ${wrong.length} cards to deck`, 'success'));
```

The Lambda receives a different `mode: "from_quiz"` payload and is prompted to convert each wrong answer into a `{front: question, back: correct + brief reason, hint: short cue}` card. No user interaction needed beyond clicking the button.

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

A full-viewport overlay with `position: fixed; inset: 0; backdrop-filter: blur(20px); background: rgba(20,13,38,0.85)` covers the dashboard, dimming the background.

**Card markup:**
```html
<div class="fc-stage" data-flipped="false">
  <div class="fc-card">
    <div class="fc-face fc-front">
      <div class="fc-prompt"><!-- card.front --></div>
      <button class="fc-hint-toggle">Reveal Hint</button>
      <div class="fc-hint" hidden><!-- card.hint --></div>
    </div>
    <div class="fc-face fc-back">
      <div class="fc-answer"><!-- card.back --></div>
    </div>
  </div>
</div>
<div class="fc-actions" hidden>
  <button class="fc-grade fc-hard">🔴 Hard</button>
  <button class="fc-grade fc-okay">🟡 Okay</button>
  <button class="fc-grade fc-easy">🟢 Easy</button>
</div>
<div class="fc-progress">3 / 12 · Box avg 1.8</div>
```

**3D flip CSS:**
```css
.fc-stage { perspective: 1600px; }
.fc-card {
  position: relative;
  transform-style: preserve-3d;
  transition: transform 0.55s cubic-bezier(0.2, 0.8, 0.2, 1);
  width: min(640px, 90vw);
  height: min(420px, 60vh);
}
.fc-stage[data-flipped="true"] .fc-card { transform: rotateY(180deg); }
.fc-face {
  position: absolute;
  inset: 0;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  /* ... glass card styles ... */
}
.fc-back { transform: rotateY(180deg); }
```

**State machine** (controlled by `flashcards.js`):
```
queued → showing(front) → [click/Space/tap] → showing(back, actions visible)
   ↑                                                │
   │                                       [Hard/Okay/Easy/1/2/3/swipe]
   │                                                │
   └────────────── applyGrade → next card ──────────┘
```

When the queue empties, the overlay swaps to a "Session complete" panel showing: cards reviewed, breakdown by grade, suggested next session date (= earliest `nextReviewDate` across deck).

### Part 6 — Keyboard & Touch

**Keyboard handler** (only active while overlay is open):
```js
function onKey(e) {
  if (!ui.overlayOpen) return;
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    if (!ui.flipped) ui.flip();
    return;
  }
  if (!ui.flipped) return;        // grading only allowed after flip
  if (e.key === '1') ui.grade('hard');
  else if (e.key === '2') ui.grade('okay');
  else if (e.key === '3') ui.grade('easy');
  else if (e.key === 'Escape') ui.exitStudy();
}
document.addEventListener('keydown', onKey);
```

**Swipe gestures** use raw `pointerdown`/`pointermove`/`pointerup` on `.fc-stage` (no library):
- Threshold: 60 px horizontal AND velocity > 0.3 px/ms
- Left swipe → `grade('hard')`; right swipe → `grade('easy')`
- Below threshold → animate card snap-back, no grade applied
- Disabled until the card is flipped (consistent with keyboard rule)

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

### Property 6: Study UI grading gate
**Validates: Requirements 5.3, 6.1**

Grade buttons (and keyboard shortcuts 1/2/3, and swipe gestures) are no-ops until the current card has been flipped (`stage[data-flipped="true"]`). The first user input always either flips the card or is ignored — never grades.

### Property 7: Single source of truth for grading
**Validates: Requirements 7.2, 7.3**

All three grading inputs (button click, keyboard shortcut, swipe) call exactly the same `ui.grade(grade)` function. There is no duplicated grading logic.

### Property 8: Storage atomicity
**Validates: Requirements 7.6**

Every write to `localStorage` serializes the entire `Store` object in a single `setItem`. There is no partial save (e.g. updating one card without saving the deck). Reads always go through `Store.load()` which falls back to a fresh empty store on parse failure.

### Property 9: Cross-module hook idempotency
**Validates: Requirements 2.1, 2.2**

`createDeckFromText` and `saveQuizMistakes` always create a *new* deck (never mutate an existing one). Calling them twice with identical input produces two separate decks with distinct ids — no silent merging that could surprise the user.

### Property 10: No backend persistence
**Validates: Requirements 4.1**

The `flashcard_generator` Lambda has no DynamoDB / S3 / RDS dependency. Its only AWS call is `bedrock:InvokeModel`. Decks and progress are server-invisible.

### Property 11: Locked tile vs live tile
**Validates: Requirements 1.2**

The dashboard 5th tile is rendered with `.tile-locked` and a "Coming Soon" badge if and only if `STREAM_URLS.flashcard_generator` is missing or starts with `__URL_`. After a successful deploy that replaces the placeholder, a hard reload yields a clickable Smart Flashcards tile with a "Beta" badge.

### Property 12: Keyboard scope
**Validates: Requirements 6.1**

The flashcards keyboard handler is only active when the study overlay is mounted. Closing the overlay (Escape, exit button, or session-complete) removes the listener. Other pages' keyboard shortcuts (`Ctrl+Enter` from `common.js`, etc.) continue to work unaffected.

## Testing Strategy

Manual smoke-tests, mirroring the project's existing approach:

1. **Header** — every page now shows a "Flashcards" link between Quiz Generator and Lab Tools; clicking lands on `flashcards.html`. Active state highlights only on `flashcards.html`.
2. **Dashboard tile** — pre-deploy: shows "Coming Soon" badge, click → toast. Post-deploy: shows "Beta" badge, click → flashcards page.
3. **New deck (manual)** — fill subject + bab + topic + paste source notes + select 12 cards → click Generate → spinner → 12 cards appear in the deck library with correct subject icon and bab label.
4. **New deck — Bab empty** — submit with empty bab → toast "Chapter Name / Bab is required", no network call.
5. **Cross-module: Chapter** — open Chapter Assistant, generate overview for "Circular Motion" → click "Turn this Chapter into Flashcards" → lands on `flashcards.html?deck=…&autostudy=1`, study mode opens immediately with new deck.
6. **Cross-module: Quiz** — complete a quiz with at least one wrong answer → click "Save incorrect answers to Flashcards" → new deck appears named after the quiz topic with one card per wrong answer.
7. **Study flip** — click card → flips with rotateY(180deg). Press Space again → no double-flip. Press 1/2/3 → grades and advances. Escape → exits cleanly.
8. **Leitner progression** — grade a card Easy three times → box: 1→2→3 with nextReviewDates 1d/3d/7d ahead. Grade Hard once → box drops to 1 with nextReviewDate 1d ahead.
9. **Due counter** — manually edit `vsl.flashcards` in DevTools to set a card's `nextReviewDate` to 0 → reload library → "Due today" counter increments.
10. **Daily cap** — generate a 50-card deck, set `dailyNewCap = 5`, study → only 5 new cards appear interleaved among due reviews.
11. **Mobile swipe** — on a phone (or Chrome devtools touch mode), tap to flip, swipe left → marked Hard, swipe right → marked Easy. Below-threshold swipe → snap back.
12. **Backend down** — block the Function URL in DevTools → click Generate → toast surfaces error, no deck created, library remains intact.
13. **localStorage full** — manually fill `localStorage` to ~5 MB → generate one more deck → toast "Older cards trimmed", store size stays under cap.

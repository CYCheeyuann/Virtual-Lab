# Requirements Document

## Introduction

The Virtual Science Lab needs a spaced-repetition flashcard system so students can lock concepts into long-term memory after they've encountered them in the Chapter Assistant or tested them in the Quiz Generator. The feature lives at every layer of the app: a top-bar nav link, a promoted dashboard tile, a dedicated page for deck management and study, hooks inside Chapter Assistant and Quiz Generator that turn existing AI output into decks with one click, and a backend Lambda that converts free-form text into strict-JSON cards.

The system uses a Leitner-style five-box scheduler running entirely in the user's browser via `localStorage` — no accounts, no server-side state. Every deck is mandatorily tagged with a Bab (chapter name) plus subject so the user's library never devolves into one undifferentiated pile.

## Glossary

- **Deck:** A named collection of flashcards belonging to one Subject + Bab.
- **Bab:** Malay/local term for "chapter"; the user-supplied label that organizes decks into folders (e.g. "Bab 3: Keturunan", "Circular Motion").
- **Card:** A single flashcard with a `front` (prompt), `back` (answer), optional `hint`, and Leitner box state.
- **Box:** One of five Leitner buckets (1–5) controlling how often a card resurfaces.
- **Due card:** A card whose `nextReviewDate` is at or before the current moment.
- **Study session:** A run through the due-card queue inside the full-screen study overlay.
- **Library:** The deck-management view on `flashcards.html` showing all of the user's decks.
- **Cross-module hook:** A button outside `flashcards.html` (currently in Chapter Assistant and Quiz Generator) that creates a deck from existing context.
- **Daily new-card cap:** Maximum number of fresh (never-reviewed) cards introduced into a single day's session, regardless of how many were generated at once.

## Requirements

### Requirement 1: Global Navigation & Dashboard Entry Point

**User Story:** As a user, I want Smart Flashcards to be reachable from anywhere in the app, so I never have to dig through a tool to get to my study decks.

#### Acceptance Criteria

1. WHEN any page loads THEN the top-right navigation bar SHALL include a "Flashcards" link positioned between "Quiz Generator" and "Lab Tools".
2. WHEN the dashboard loads AND the flashcard backend has not been deployed THEN the 5th tile SHALL display as a "Smart Flashcards" tile with a "Coming Soon" badge in a locked visual state, AND clicking it SHALL show a non-blocking notice rather than navigating.
3. WHEN the dashboard loads AND the flashcard backend has been deployed THEN the 5th tile SHALL display as a "Smart Flashcards" tile with a "Beta" badge, AND clicking it SHALL navigate to `flashcards.html`.
4. WHEN the user is on `flashcards.html` THEN the "Flashcards" nav link SHALL render with the active-state styling.
5. WHEN the user clicks the brand logo on `flashcards.html` THEN it SHALL behave the same as on every other page (route to the welcome page), preserving Requirement 3 from the prior 7-part enhancement.

### Requirement 2: Cross-Module AI Generation

**User Story:** As a learner who just finished reading a chapter overview or taking a quiz, I want to convert that context directly into a flashcard deck, so I can lock in what I just learned without retyping anything.

#### Acceptance Criteria

1. WHEN the user has generated a Chapter Assistant overview THEN a "Turn this Chapter into Flashcards" button SHALL appear under the rendered overview, AND clicking it SHALL create a new deck (subject + chapter pre-filled from the Chapter Assistant context) and navigate to the flashcards page with the new deck open in study mode.
2. WHEN the user has finished a quiz with at least one incorrect answer THEN a "Save incorrect answers to Flashcards" button SHALL be visible and enabled in the Results phase, AND clicking it SHALL create a new deck containing one card per wrong answer (front=question, back=correct answer, hint=AI-generated cue).
3. WHEN the user has finished a quiz with zero incorrect answers THEN the "Save incorrect answers to Flashcards" button SHALL be visible but disabled, with a tooltip explaining there is nothing to save.
4. WHEN a cross-module hook fails (network error, malformed JSON, etc.) THEN the user SHALL see a non-blocking error toast and remain on the original page (no deck partially created, no navigation).

### Requirement 3: Deck Setup with Mandatory Bab Field

**User Story:** As a user creating a deck manually, I want every deck tagged with a Subject and a Bab so my library stays organized into clear folders.

#### Acceptance Criteria

1. WHEN the user opens the "Create a New Deck" form on `flashcards.html` THEN the form SHALL include a Subject dropdown (Biology, Chemistry, Physics, Science), a required Bab/Chapter Name input, an optional Topic input, an optional Source Notes textarea, and a Card Count selector.
2. WHEN the user submits the form with an empty Bab field THEN the system SHALL block submission, highlight the Bab field with a validation state, and show a toast "Chapter Name / Bab is required".
3. WHEN the user submits a valid form THEN the system SHALL call the `flashcard_generator` Lambda, persist the returned cards as a new deck in `localStorage` with `subject`, `bab`, and `topic` fields populated, and redirect/refresh into the deck library showing the new deck.
4. WHEN the form is submitted THEN the deck's persisted display label SHALL be the concatenation `"<Subject> · <Bab>"`.

### Requirement 4: Backend Generation (Stateless Lambda)

**User Story:** As a user, I want flashcard generation to feel as fast and reliable as the existing quiz/outline generators.

#### Acceptance Criteria

1. WHEN the system needs to generate cards THEN it SHALL call a new Lambda Function URL (`flashcard_generator`) with no server-side persistence (no database, no cross-request memory).
2. WHEN the Lambda is invoked THEN it SHALL accept JSON containing `mode` ("from_text" | "from_quiz" | "from_topic"), `subject`, `chapter`, `topic`, `num_cards`, and a mode-specific source field (`source_text` or `wrong_answers`).
3. WHEN generation succeeds THEN the Lambda SHALL return HTTP 200 with `{"cards": [...]}` where every card has `front`, `back`, `hint`, and `tags` keys; no markdown fences, no extra prose.
4. WHEN generation fails to produce parseable JSON THEN the Lambda SHALL return HTTP 200 with `{"error": "...", "raw": "..."}` so the frontend can surface a friendly retry option without bubbling a 5xx.
5. WHEN the Lambda is invoked AND an `X-Api-Key` is configured THEN authentication SHALL behave identically to the other Lambdas.
6. WHEN the SAM stack deploys THEN the Function URL SHALL be exported as `FlashcardGeneratorUrl` AND the deploy workflow SHALL sed-replace `__URL_FLASHCARD_GENERATOR__` in `frontend/config.js`.

### Requirement 5: Distraction-Free Study Mode (3D Flip)

**User Story:** As a user studying a deck, I want a focused, immersive study experience so nothing on the page distracts me from the card in front of me.

#### Acceptance Criteria

1. WHEN the user clicks "Study Now" on a deck THEN the system SHALL mount a full-viewport overlay that dims the rest of the page and centers a single card.
2. WHEN the card is showing THEN the front SHALL display the prompt, AND a "Reveal Hint" toggle SHALL be visible underneath, AND the back SHALL be hidden.
3. WHEN the user clicks the card OR presses the Spacebar OR taps the card on touch THEN the card SHALL flip via a smooth `rotateY(180deg)` 3D animation revealing the back, AND the three grading buttons SHALL become visible.
4. WHEN the user clicks "Reveal Hint" before flipping THEN the hint text SHALL fade in below the prompt without flipping the card or revealing the answer.
5. WHEN the user finishes the queue OR presses Escape OR clicks an explicit Exit control THEN the overlay SHALL close cleanly with no scroll-lock or focus left behind.
6. WHEN the queue is empty after grading THEN the overlay SHALL display a session-summary panel showing cards reviewed, grade breakdown, and the next earliest review date for the deck.

### Requirement 6: Self-Grading Inputs (Buttons, Keyboard, Swipe)

**User Story:** As a power user, I want to grade cards by mouse, keyboard, or swipe so I can study quickly on any device.

#### Acceptance Criteria

1. WHEN the card has been flipped THEN three color-coded grade buttons SHALL be enabled: 🔴 Hard, 🟡 Okay, 🟢 Easy.
2. WHEN the card has not been flipped THEN the grade buttons SHALL be hidden or disabled, AND keyboard 1/2/3 and swipe gestures SHALL not register a grade.
3. WHEN the user presses keyboard 1, 2, or 3 after flipping THEN the system SHALL apply Hard, Okay, or Easy grading respectively.
4. WHEN the user swipes left on touch THEN it SHALL register as Hard; WHEN the user swipes right THEN it SHALL register as Easy; below-threshold swipes SHALL animate back to center with no grade applied.
5. WHEN any grading input fires THEN it SHALL call the same single grading function with the same effect on the card and queue.

### Requirement 7: Leitner Spaced Repetition Engine

**User Story:** As a user, I want the system to schedule my reviews automatically using a proven spaced-repetition algorithm so I see harder cards more often and easier cards less often.

#### Acceptance Criteria

1. WHEN a card is created THEN it SHALL start in Box 1 with `nextReviewDate` set to its creation timestamp.
2. WHEN a card is graded Easy THEN it SHALL move from Box `n` to Box `min(5, n+1)`, AND its `nextReviewDate` SHALL be set to `now + interval[newBox] * 1 day`, where intervals are {1: 1d, 2: 3d, 3: 7d, 4: 14d, 5: 30d}.
3. WHEN a card is graded Hard THEN it SHALL drop to Box 1 regardless of prior box, AND its `nextReviewDate` SHALL be set to `now + 1 day`.
4. WHEN a card is graded Okay THEN it SHALL stay in its current box, AND its `nextReviewDate` SHALL be set to `now + interval[currentBox] * 1 day`.
5. WHEN a study session starts THEN at most `dailyNewCap` brand-new (never-reviewed) cards SHALL be introduced that day, while due reviews of previously-seen cards SHALL not be capped.
6. WHEN any grading occurs THEN the entire `vsl.flashcards` store SHALL be persisted in a single atomic `localStorage.setItem` call.

### Requirement 8: Deck Library Management

**User Story:** As a user with multiple decks, I want a clear library view showing what's due, so I always know where to focus my next study session.

#### Acceptance Criteria

1. WHEN the user lands on `flashcards.html` AND has at least one saved deck THEN each deck SHALL render as a glass-style card showing subject icon, "Subject · Bab" label, total card count, and "Due today" counter.
2. WHEN a deck has zero due cards today THEN its card SHALL display a "✓ All caught up" affordance instead of (or alongside) a zero counter.
3. WHEN the user clicks a deck's "Manage" or overflow control THEN the user SHALL be able to: rename the Bab, reset deck progress (all cards back to Box 1), and delete the deck (with double-confirmation).
4. WHEN the user deletes a deck THEN the deck SHALL be removed from `localStorage` and the library view SHALL re-render without it; no orphan card data SHALL remain in storage.

### Requirement 9: Storage & Quota Safety

**User Story:** As a user who may generate many decks, I want the app to gracefully handle storage limits so I don't lose data unexpectedly.

#### Acceptance Criteria

1. WHEN the app saves the flashcard store THEN it SHALL serialize the entire object under a single key `vsl.flashcards`.
2. WHEN a save would push the serialized store past a 3 MB soft cap THEN the app SHALL evict the oldest 10 % of cards in the largest deck, retry the save, and surface a toast informing the user.
3. WHEN the store cannot be parsed on load (corruption / unknown version) THEN the app SHALL fall back to an empty store and show a one-time toast explaining the reset, without crashing the page.
4. WHEN the store schema changes in a future version THEN a `version` field SHALL allow forward-compatible migration without losing existing decks.

### Requirement 10: Contextual Lab Assistant Greeting

**User Story:** As a user arriving on the flashcards page, I want the Lab Assistant to greet me with a flashcard-specific message, consistent with the rest of the app.

#### Acceptance Criteria

1. WHEN the user loads `flashcards.html` THEN the Lab Assistant FAB SHALL show a context-specific greeting bubble shortly after page load, consistent with the existing greeting pattern (auto-dismiss after a few seconds, dismissed instantly on FAB click, suppressed if the chat panel is already open).
2. WHEN no flashcards-specific greeting is configured THEN the system SHALL fall back to the default greeting rather than crash or render nothing.

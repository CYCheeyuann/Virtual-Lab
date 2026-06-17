# Requirements Document

## Introduction

Smart Flashcards adds a spaced-repetition study system to the Virtual Science Lab. The feature is a first-class peer to Chapter Assistant, Experiment Guide, Quiz Generator, and Lab Tools — surfaced in the global header and the dashboard, hosted on its own page, and powered by a new AI-generation Lambda. It earns its place by closing the loop between content and retention: students can convert a chapter overview or their wrong quiz answers into a deck in one click, then review that deck on a Leitner schedule that paces itself automatically.

Decks and progress live entirely in the user's `localStorage` so the feature works without accounts, sync, or server-side state. The backend is stateless and only does AI card generation.

This document supersedes the v1 spec. The v2 revision incorporates several behavioural reversals discovered during user testing — most notably that grading buttons should NOT be gated behind the flip (users want freedom to mark a card "Easy" the moment they recognize they know it, without having to flip first), and that the flip itself should be more deliberate (left-click or Enter only — Space and Tab focus changes were causing accidental flips during keyboard navigation). The Generate flow also gains a Quiz-Generator-style preview/confirmation step so users can vet the AI's extraction before committing a deck to their library.

## Glossary

- **Deck** — a collection of related flashcards, tagged with a Subject and a Bab (chapter).
- **Card** — a single flashcard with a `front` (prompt), `back` (answer), and optional `hint`.
- **Bab** — Malay for "chapter"; the user-typed folder/topic label that organizes cards.
- **Box** — a Leitner box numbered 1 through 5; defines the review interval for cards in that box.
- **Due** — a card whose `nextReviewDate` is on or before "now"; eligible for the current study session.
- **Study mode** — the full-screen, distraction-free overlay where cards are flipped and graded.
- **Grade** — the user's self-assessment of a flipped card (Hard / Okay / Easy).
- **Preview step** — an intermediate review screen between "Generate" and deck commit, showing all extracted cards in a collapsed accordion.
- **Card container** — the central rectangular surface that holds the card face. Session-level controls (progress, exit, grade buttons, hint) anchor to this container, not to the viewport.

## Requirements

### Requirement 1: Global Navigation & Dashboard Entry Point

**User Story:** As a user, I want Flashcards to appear as a peer feature in the global header and on the dashboard, so I can find it as easily as Chapter Assistant or Quiz Generator.

#### Acceptance Criteria

1. WHEN any page renders THEN the top navigation bar SHALL include a "Flashcards" link positioned between "Quiz Generator" and "Lab Tools".
2. WHEN the Flashcards backend has not been deployed yet (placeholder URL still present) THEN the dashboard's 5th tile SHALL render as a "Smart Flashcards" tile with a visible "Coming Soon" badge AND clicking it SHALL show a non-blocking notice rather than navigate.
3. WHEN the Flashcards backend has been deployed THEN the dashboard's 5th tile SHALL render as an active "Smart Flashcards" link to `flashcards.html` with NO badge of any kind. The "Beta" badge specified in the v1 spec is REMOVED — once the backend is live, the tile is indistinguishable in adornment from the four sibling tool tiles.
4. WHEN the user clicks the active Smart Flashcards tile THEN the browser SHALL navigate to `flashcards.html`.
5. WHEN the Flashcards page is the current page THEN the header's "Flashcards" link SHALL display in its active state.

### Requirement 2: Cross-Module Generation Hooks

**User Story:** As a learner, I want to turn a chapter overview I just generated, or my wrong quiz answers, into flashcards in one click, so the feature feels integrated rather than bolted on.

#### Acceptance Criteria

1. WHEN a chapter overview has finished rendering in Chapter Assistant THEN a "Turn this Chapter into Flashcards" button SHALL be visible AND clicking it SHALL trigger the AI generation, present the user with the preview step (Requirement 9), and only after user confirmation create a new deck pre-tagged with the current Subject and Chapter.
2. WHEN a quiz has been graded and at least one answer was wrong THEN a "Save incorrect answers to Flashcards" button SHALL be visible AND clicking it SHALL trigger the AI generation, present the preview step, and only after user confirmation create a new deck containing one card per wrong answer (front = question, back = correct answer with the key term emphasized).
3. WHEN a quiz has been graded with zero wrong answers THEN the "Save incorrect answers to Flashcards" button SHALL be disabled or hidden.
4. WHEN flashcards are created via either cross-module hook AND the user has confirmed the preview THEN the resulting deck SHALL be persisted in `localStorage` and immediately visible on the deck library.

### Requirement 3: Manual Deck Setup with Bab Input

**User Story:** As a user creating flashcards from my own notes, I want to be required to label every deck with a Subject and a Bab (chapter), so my study library never devolves into one giant unsorted pile.

#### Acceptance Criteria

1. WHEN the user opens the deck library THEN a "Create New Deck" form SHALL be available with fields for Subject (dropdown), Bab/Chapter (text input), Topic (optional text input), Source Notes (optional textarea), and Number of Cards (numeric).
2. WHEN the Subject dropdown is rendered THEN it SHALL include exactly Biology, Chemistry, Physics, and Science (matching the rest of the app), AND its `id` SHALL be `subject` so `common.js`'s `bindSubjectSelect()` automatically applies the corresponding accent theme on change.
3. WHEN the user submits the form with an empty Bab field THEN the system SHALL reject the submission with an inline validation error AND SHALL NOT make a network call.
4. WHEN the user submits a valid form THEN the system SHALL call the `flashcard_generator` Lambda, render the preview step (Requirement 9), and only on user confirmation persist a deck tagged with the chosen Subject and Bab.
5. WHEN a deck is created THEN every card in that deck SHALL inherit the deck's Subject and Bab tags.

### Requirement 4: Deck Library

**User Story:** As a returning user, I want to see all my decks at a glance with a clear "due today" count for each, so I know exactly what to study and what's already mastered.

#### Acceptance Criteria

1. WHEN the user lands on `flashcards.html` THEN the page SHALL render a "Deck Library" view listing every deck currently in `localStorage`, including each deck's Subject icon, Bab label, total card count, and "Due today" count.
2. WHEN a deck has zero cards due today THEN the deck card SHALL display an "All caught up" indicator instead of a numeric due count.
3. WHEN a deck card is rendered THEN it SHALL provide actions for "Study Now" (enabled only if cards exist), "Reset" (move all cards back to Box 1), and "Delete" (double-confirm).
4. WHEN the user deletes a deck THEN the system SHALL require a double confirmation (consistent with the Quiz history delete flow).
5. WHEN no decks exist THEN the library SHALL display an empty-state placeholder pointing the user to the "Create New Deck" form or the cross-module hooks.
6. WHEN the user clicks "Study Now" on any deck listed in the library THEN the system SHALL be able to seamlessly resume that deck's study session at any time, treating the library as the canonical "View My Decks" history view.

### Requirement 5: Distraction-Free Study UI with 3D Flip

**User Story:** As a student studying, I want a focused full-screen view where I see one card at a time, can reveal a hint, and flip the card with a smooth animation, so I'm fully engaged in recall rather than juggling layout.

#### Acceptance Criteria

1. WHEN the user clicks "Study Now" on a deck (or arrives via the autostudy deep link) THEN the system SHALL open a full-viewport overlay that dims the underlying page and shows exactly one card at a time.
2. WHEN a card's front is shown THEN the system SHALL also show a "Reveal Hint" toggle that displays the card's hint inline without revealing the back.
3. WHEN the user performs a Left-Click on the card OR presses Enter while the card has keyboard focus THEN the card SHALL animate via a 3D `rotateY(180deg)` flip to toggle between front and back. This toggle SHALL work bidirectionally and unlimited times (front → back → front → back → …).
4. WHEN the user presses Spacebar, Tab, arrow keys, right-clicks, middle-clicks, double-clicks, or hovers THEN the card SHALL NOT flip. Only the two specified inputs (Left-Click on the card, Enter while focused) trigger a flip.
5. WHEN the study queue empties THEN the overlay SHALL replace the card with a "Session complete" panel summarizing cards reviewed and grade breakdown.
6. WHEN the user presses Escape OR clicks the explicit Exit button THEN the overlay SHALL close and return the user to the deck library.

### Requirement 6: Always-On Self-Assessment Grading

**User Story:** As a power user, I want to grade a card the moment I know my answer — even before flipping — because I already know whether I remembered it, so I shouldn't be forced to flip just to satisfy a UI gate.

#### Acceptance Criteria

1. WHEN the study overlay is open THEN the three grading buttons (Hard, Okay, Easy) SHALL be visible AND enabled at all times during the session, regardless of whether the current card is showing front or back.
2. WHEN the user clicks any grade button (or presses 1, 2, or 3 with the overlay focused) THEN the system SHALL apply the grade to the current card immediately AND advance to the next card, REGARDLESS of whether the card was flipped.
3. WHEN a card is graded without ever being flipped THEN the recorded grade and Leitner box update SHALL be identical to the case where the card was flipped first — flip state has no influence on grading semantics.
4. WHEN the user is on a touch device AND the current card has been flipped to its back THEN swiping the card left past a threshold SHALL grade Hard AND swiping right past the threshold SHALL grade Easy. (Swipe-grade is allowed only after a flip because tap-on-front is reserved for flipping; this is a touch ergonomics distinction, not a Leitner rule.)
5. WHEN a swipe falls below the distance/velocity threshold THEN the card SHALL animate back to its resting position with no grade applied.
6. WHEN the study overlay is closed THEN the keyboard shortcuts 1/2/3 SHALL no longer fire (other pages' shortcuts continue to work as before).

### Requirement 7: Leitner Spaced-Repetition Engine

**User Story:** As a learner, I want the system to schedule each card for me automatically based on how well I knew it, so I review difficult cards more often and stop wasting time on cards I've mastered.

#### Acceptance Criteria

1. WHEN a card is created THEN it SHALL start in Box 1 with `nextReviewDate` set to "now".
2. WHEN a card is graded Easy THEN its box SHALL increase by 1 (capped at Box 5) AND `nextReviewDate` SHALL be set to `now + interval(newBox)` where the intervals are Box 1 = 1 day, Box 2 = 3 days, Box 3 = 7 days, Box 4 = 14 days, Box 5 = 30 days.
3. WHEN a card is graded Hard THEN its box SHALL be reset to Box 1 AND `nextReviewDate` SHALL be set to `now + 1 day`.
4. WHEN a card is graded Okay THEN its box SHALL remain unchanged AND `nextReviewDate` SHALL be set to `now + interval(currentBox)`.
5. WHEN building a study session for a deck THEN the system SHALL include only cards whose `nextReviewDate <= now`, AND SHALL cap the number of fresh (never-reviewed) cards in that session to the deck's `dailyNewCap` (default 20).
6. WHEN any card grading occurs THEN the entire flashcards store SHALL be persisted back to `localStorage` atomically in a single write.

### Requirement 8: Backend Generation Lambda

**User Story:** As the platform operator, I want a stateless backend Lambda that generates flashcards from a topic, source text, or quiz mistakes, so the frontend has a single endpoint to call regardless of which entry point the user came from.

#### Acceptance Criteria

1. WHEN the system needs to generate cards THEN the frontend SHALL POST to a single new Lambda Function URL (`flashcard_generator`) with a JSON body containing `mode`, `subject`, `chapter`, optional `topic`, `num_cards`, and either `source_text` or `wrong_answers`.
2. WHEN the Lambda receives a valid request THEN it SHALL return a JSON object `{ "cards": [...] }` where each card has `front`, `back`, `hint`, and `tags` fields.
3. WHEN the Lambda receives `mode: "from_quiz"` THEN each generated card SHALL be derived from one entry in `wrong_answers`: `front` is the question, `back` is the correct answer restated as a sentence with the key term emphasized.
4. WHEN the Lambda's underlying model returns malformed JSON THEN the Lambda SHALL respond with HTTP 200 and a `{ "error": "...", "raw": "..." }` body so the frontend can show a retry-able error rather than a 5xx.
5. WHEN the Lambda is deployed THEN it SHALL reuse the existing `AppBedrockRole` IAM role and the existing Claude Haiku 4.5 model — no new IAM, no new model permissions.
6. WHEN the deploy workflow runs THEN it SHALL replace `__URL_FLASHCARD_GENERATOR__` in `frontend/config.js` with the new Function URL output by CloudFormation.

### Requirement 9: Multi-Step Generation with Preview Confirmation

**User Story:** As a careful learner, I want to see what the AI extracted from my source material before it gets saved as a permanent deck in my library, so I can catch low-quality or off-topic cards before they pollute my study schedule.

#### Acceptance Criteria

1. WHEN a generation request returns successfully (from any entry point — manual form, Chapter Assistant button, or Quiz wrong-answer button) THEN the system SHALL render a Preview screen instead of immediately persisting the deck.
2. WHEN the Preview screen renders THEN it SHALL display a header showing "Preview: N cards for «Bab»" and a list of all generated cards in a collapsed accordion (Requirement 10), plus exactly two action buttons: "Confirm & Start Studying" and "Back to Setup".
3. WHEN the user clicks "Back to Setup" THEN the preview SHALL be discarded entirely (no partial save) AND the new-deck form SHALL be re-shown with all originally entered values intact so the user can adjust and regenerate.
4. WHEN the user clicks "Confirm & Start Studying" THEN the deck SHALL be persisted to `localStorage`, the new-deck form SHALL be cleared, the deck library SHALL re-render to include the new deck, AND the study overlay SHALL open immediately on the just-saved deck.
5. WHEN the user navigates away from the page during the preview step (e.g., clicks a nav link) THEN the unconfirmed cards SHALL NOT be persisted — they exist only in memory and are lost on navigation, consistent with the "preview = nothing committed" contract.

### Requirement 10: Collapsed Accordion Preview Cards

**User Story:** As a user reviewing a 12-card preview, I want to see only the questions at first so I can scan the deck quickly, and only expand the cards whose answers I want to spot-check, so I'm not overwhelmed by a wall of text.

#### Acceptance Criteria

1. WHEN the Preview screen first renders THEN every card row in the list SHALL be in its collapsed state, showing only the card number and the front/question text. The back/answer and the hint MUST be hidden by default.
2. WHEN a card row is rendered THEN it SHALL include a chevron indicator (▼ or 🔽) on the right side OR be entirely click-targetable as a header. The chevron orientation SHALL reflect the current expand/collapse state.
3. WHEN the user clicks a card row OR its chevron THEN the row SHALL smoothly expand to also reveal the back and the hint (if present), AND the chevron SHALL rotate to an "up" orientation (▲ or 🔼).
4. WHEN the user clicks an already-expanded card row OR its chevron THEN the row SHALL collapse back to the question-only view, AND the chevron SHALL return to its "down" orientation.
5. WHEN multiple card rows are open simultaneously THEN they SHALL all stay open — opening one row does not close the others (this is an "accordion list" with independent rows, not a "single open at a time" pattern).
6. WHEN the Preview header renders THEN a small "Expand All / Collapse All" toggle SHALL be visible next to the card count. Clicking it SHALL set every row to the new state in one operation, AND the toggle's label SHALL flip between the two states based on the dominant current state of the list.

### Requirement 11: Anchored Session Controls (Progress + Exit)

**User Story:** As a user studying, I want the progress counter and the exit button to feel like part of the card, not detached labels floating in the corners of my browser, so my attention stays focused on the current card.

#### Acceptance Criteria

1. WHEN the study overlay is open THEN the progress indicator (e.g. "1 / 12 · Box 1/5") SHALL be visually anchored to the top-left of the central card container — positioned just above the card's top edge AND aligned to the card's left edge — NOT floated to the top-left corner of the viewport.
2. WHEN the study overlay is open THEN the Exit button (✕) SHALL be visually anchored to the top-right of the central card container — positioned just above the card's top edge AND aligned to the card's right edge — NOT floated to the top-right corner of the viewport.
3. WHEN the viewport is resized OR the card container's width changes responsively THEN the progress indicator and Exit button SHALL move with the card container so the visual proximity is preserved at every breakpoint.
4. WHEN the card container is sized for mobile (≤ 600 px) THEN the progress and Exit controls SHALL remain anchored to the card edges; they MAY shrink in font/padding but MUST NOT detach from the container.
5. WHEN the session-complete summary panel replaces the card THEN the progress and Exit anchors SHALL remain attached to the new panel, so the user has a consistent way to leave the session at any time.

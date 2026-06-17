# Requirements Document

## Introduction

Smart Flashcards adds a spaced-repetition study system to the Virtual Science Lab. The feature is a first-class peer to Chapter Assistant, Experiment Guide, Quiz Generator, and Lab Tools — surfaced in the global header and the dashboard, hosted on its own page, and powered by a new AI-generation Lambda. It earns its place by closing the loop between content and retention: students can convert a chapter overview or their wrong quiz answers into a deck in one click, then review that deck on a Leitner schedule that paces itself automatically.

Decks and progress live entirely in the user's `localStorage` so the feature works without accounts, sync, or server-side state. The backend is stateless and only does AI card generation.

## Glossary

- **Deck** — a collection of related flashcards, tagged with a Subject and a Bab (chapter).
- **Card** — a single flashcard with a `front` (prompt), `back` (answer), and optional `hint`.
- **Bab** — Malay for "chapter"; the user-typed folder/topic label that organizes cards.
- **Box** — a Leitner box numbered 1 through 5; defines the review interval for cards in that box.
- **Due** — a card whose `nextReviewDate` is on or before "now"; eligible for the current study session.
- **Study mode** — the full-screen, distraction-free overlay where cards are flipped and graded.
- **Grade** — the user's self-assessment of a flipped card (Hard / Okay / Easy).

## Requirements

### Requirement 1: Global Navigation & Dashboard Entry Point

**User Story:** As a user, I want Flashcards to appear as a peer feature in the global header and on the dashboard, so I can find it as easily as Chapter Assistant or Quiz Generator.

#### Acceptance Criteria

1. WHEN any page renders THEN the top navigation bar SHALL include a "Flashcards" link positioned between "Quiz Generator" and "Lab Tools".
2. WHEN the Flashcards backend has not been deployed yet (placeholder URL still present) THEN the dashboard's 5th tile SHALL render as a "Smart Flashcards" tile with a visible "Coming Soon" badge AND clicking it SHALL show a non-blocking notice rather than navigate.
3. WHEN the Flashcards backend has been deployed THEN the dashboard's 5th tile SHALL render as an active "Smart Flashcards" link to `flashcards.html`, with a "Beta" badge.
4. WHEN the user clicks the active Smart Flashcards tile THEN the browser SHALL navigate to `flashcards.html`.
5. WHEN the Flashcards page is the current page THEN the header's "Flashcards" link SHALL display in its active state.

### Requirement 2: Cross-Module Generation Hooks

**User Story:** As a learner, I want to turn a chapter overview I just generated, or my wrong quiz answers, into flashcards in one click, so the feature feels integrated rather than bolted on.

#### Acceptance Criteria

1. WHEN a chapter overview has finished rendering in Chapter Assistant THEN a "Turn this Chapter into Flashcards" button SHALL be visible AND clicking it SHALL create a new deck pre-tagged with the current Subject and Chapter and route the user into study mode for that deck.
2. WHEN a quiz has been graded and at least one answer was wrong THEN a "Save incorrect answers to Flashcards" button SHALL be visible AND clicking it SHALL create a new deck containing one card per wrong answer (front = question, back = correct answer with the key term emphasized).
3. WHEN a quiz has been graded with zero wrong answers THEN the "Save incorrect answers to Flashcards" button SHALL be disabled or hidden.
4. WHEN flashcards are created via either cross-module hook THEN the resulting deck SHALL be persisted in `localStorage` and immediately visible on the deck library.

### Requirement 3: Manual Deck Setup with Bab Input

**User Story:** As a user creating flashcards from my own notes, I want to be required to label every deck with a Subject and a Bab (chapter), so my study library never devolves into one giant unsorted pile.

#### Acceptance Criteria

1. WHEN the user opens the deck library THEN a "Create New Deck" form SHALL be available with fields for Subject (dropdown), Bab/Chapter (text input), Topic (optional text input), Source Notes (optional textarea), and Number of Cards (numeric).
2. WHEN the Subject dropdown is rendered THEN it SHALL include exactly Biology, Chemistry, Physics, and Science (matching the rest of the app).
3. WHEN the user submits the form with an empty Bab field THEN the system SHALL reject the submission with an inline validation error and SHALL NOT make a network call.
4. WHEN the user submits a valid form THEN the system SHALL call the `flashcard_generator` Lambda, create a deck tagged with the chosen Subject and Bab, and append it to the deck library.
5. WHEN a deck is created THEN every card in that deck SHALL inherit the deck's Subject and Bab tags.

### Requirement 4: Deck Library

**User Story:** As a returning user, I want to see all my decks at a glance with a clear "due today" count for each, so I know exactly what to study and what's already mastered.

#### Acceptance Criteria

1. WHEN the user lands on `flashcards.html` THEN the page SHALL render a "Deck Library" view listing every deck currently in `localStorage`, including each deck's Subject icon, Bab label, total card count, and "Due today" count.
2. WHEN a deck has zero cards due today THEN the deck card SHALL display an "All caught up" indicator instead of a numeric due count.
3. WHEN a deck card is rendered THEN it SHALL provide actions for "Study Now" (enabled only if cards exist), "Manage" (rename Bab, reset progress, delete), and a context menu for advanced actions.
4. WHEN the user deletes a deck THEN the system SHALL require a double confirmation (consistent with the Quiz history delete flow).
5. WHEN no decks exist THEN the library SHALL display an empty-state placeholder pointing the user to the "Create New Deck" form or the cross-module hooks.

### Requirement 5: Distraction-Free Study UI with 3D Flip

**User Story:** As a student studying, I want a focused full-screen view where I see one card at a time, can reveal a hint, and flip the card with a smooth animation, so I'm fully engaged in recall rather than juggling layout.

#### Acceptance Criteria

1. WHEN the user clicks "Study Now" on a deck (or arrives via the autostudy deep link) THEN the system SHALL open a full-viewport overlay that dims the underlying page and shows exactly one card at a time.
2. WHEN a card's front is shown THEN the system SHALL also show a "Reveal Hint" toggle that displays the card's hint inline without revealing the back.
3. WHEN the user clicks anywhere on the visible card OR presses Space/Enter THEN the card SHALL animate via a 3D `rotateY(180deg)` flip to show the back.
4. WHEN the card is showing the back THEN the three grading buttons (Hard, Okay, Easy) SHALL become visible.
5. WHEN the study queue empties THEN the overlay SHALL replace the card with a "Session complete" panel summarizing cards reviewed and grade breakdown.
6. WHEN the user presses Escape OR clicks an explicit Exit control THEN the overlay SHALL close and return the user to the deck library.

### Requirement 6: Keyboard & Mobile Gesture Controls

**User Story:** As a power user studying many cards, I want to grade cards with the keyboard or with mobile swipe gestures, so I can run through a deck rapidly without breaking focus.

#### Acceptance Criteria

1. WHEN the study overlay is open AND the current card has been flipped THEN pressing `1`, `2`, or `3` SHALL grade the card as Hard, Okay, or Easy respectively.
2. WHEN the study overlay is open AND the current card has NOT been flipped THEN pressing `1`, `2`, or `3` SHALL be a no-op (the user must flip first).
3. WHEN the user is on a touch device AND the current card has been flipped THEN swiping the card left past a threshold SHALL grade Hard AND swiping right past the threshold SHALL grade Easy.
4. WHEN a swipe falls below the distance/velocity threshold THEN the card SHALL animate back to its resting position with no grade applied.
5. WHEN the study overlay is closed THEN the keyboard shortcuts SHALL no longer fire (other pages' shortcuts continue to work as before).

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

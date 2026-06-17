# Requirements Document

## Introduction

The Virtual Science Lab dashboard, navigation, and floating utilities need a coordinated polish pass to feel like a modern, intentional product rather than a stack of independently-built tools. Seven discrete enhancement areas were specified by the product owner: dynamic dashboard tiles, structured quiz outline headings, a redesigned top header with a clickable brand and a new welcome page, a five-card horizontal dashboard layout, first-class support for "Science" (general science) as a subject across the whole app, consolidation of all floating utilities to the bottom-right corner, and a proactive context-aware greeting from the Lab Assistant on every page load.

These seven items are scoped to land together because they share visual conventions (single accent palette, same FAB stack, same nav chrome) and several touch the same files; landing them as one feature avoids visual drift between pages.

## Glossary

- **Tile:** A clickable card on the dashboard (`.tile` in `index.html`) that links to one of the tools.
- **FAB:** Floating Action Button — the round, fixed-position buttons at the corners of the viewport (toolkit calculator and Lab Assistant chat).
- **Brand:** The "🔬 Virtual Science Lab" logo + text element in the top navbar.
- **Subject:** One of the four content domains used to theme and prompt the AI: Biology, Chemistry, Physics, Science.
- **Outline:** The AI-generated, user-editable list of knowledge points the Quiz Generator produces before generating the quiz itself.
- **Welcome page:** A new static landing page (`welcome.html`) reachable by clicking the brand from anywhere in the app.

## Requirements

### Requirement 1: Dynamic Dashboard Cards (Hover-to-Reveal Typewriter)

**User Story:** As a learner landing on the dashboard, I want a clean, uncluttered grid of large module cards that reveal their description only when I hover, so the interface feels modern and lets me focus on one tool at a time.

#### Acceptance Criteria

1. WHEN the dashboard renders THEN each module card SHALL display only its icon and title, vertically and horizontally centered, with no description text visible.
2. WHEN the user hovers over a module card THEN the icon and title SHALL animate upward with a smooth transition to make room for the description.
3. WHEN a card is hovered AND space has opened up THEN the description text SHALL appear character-by-character left-to-right, simulating a typewriter / terminal output effect.
4. WHEN the user moves the cursor off a hovered card THEN the typed description SHALL disappear immediately AND the icon and title SHALL animate back to centered.
5. WHEN compared to the prior layout THEN each module card SHALL be visibly larger (greater height and width / padding) to provide a more spacious, premium click target.

### Requirement 2: Quiz Outline Header Styling

**User Story:** As a learner reviewing the AI-generated quiz outline, I want the topic title to stand out clearly from the editable knowledge points, so the document reads as a structured artifact rather than a wall of plain text — without losing the ability to edit it.

#### Acceptance Criteria

1. WHEN the quiz outline finishes streaming THEN the main outline title (e.g., "Quiz Outline — Circular Motion") SHALL render in a heavyweight bold font visibly distinct from the body text.
2. WHEN the title renders THEN it SHALL be displayed in a brand accent color (or with a subtle accent-tinted background highlight) consistent with the rest of the application's theming.
3. WHEN the title renders THEN a contextual icon (e.g., 🎯 or document glyph) SHALL be prepended to the title text.
4. WHEN the title renders THEN a stylized horizontal divider line SHALL appear directly beneath it, separating it from the editable knowledge-point list.
5. WHEN any of the above styling is applied THEN the outline area SHALL remain fully editable so the user can still modify the title and points.
6. WHEN the user submits the outline to the backend THEN the serialized text sent to the AI SHALL contain only the human-readable text, not decorative glyphs or styling markup.

### Requirement 3: Header & Navigation Redesign

**User Story:** As a user navigating between tools, I want a tall, balanced header where the brand is on the far left and the navigation links are on the far right, so the layout feels like a polished web application instead of a centered hero block.

#### Acceptance Criteria

1. WHEN any page loads THEN the top navigation bar SHALL be visibly taller than the previous compact version.
2. WHEN any page loads THEN the brand element (microscope icon + "Virtual Science Lab" text) SHALL be aligned flush to the far-left edge of the navbar.
3. WHEN the user clicks the brand THEN the browser SHALL navigate to a new "Welcome Page" (`welcome.html`).
4. WHEN any page loads THEN all navigation menu links (Dashboard, Chapter Assistant, Experiment Guide, Quiz Generator, Lab Tools) SHALL be aligned flush to the far-right edge of the navbar.
5. WHEN the welcome page is opened THEN it SHALL present a brand introduction (logo, tagline, brief feature list) with a clear call-to-action linking to the dashboard.
6. WHEN the brand is interacted with via middle-click or Cmd/Ctrl-click THEN it SHALL behave as a normal anchor (open in new tab) rather than a button.

### Requirement 4: Dashboard Card Reorganization (Horizontal Row)

**User Story:** As a user scanning the dashboard, I want all the feature cards in a single horizontal row that reads naturally left-to-right, with a visible placeholder for upcoming features, so I see the full product surface at a glance.

#### Acceptance Criteria

1. WHEN the dashboard renders on a wide screen THEN exactly five tile cards SHALL be arranged in a single horizontal row.
2. WHEN the row renders THEN the first four cards SHALL represent active tools (Chapter Assistant, Experiment Guide, Quiz Generator, Lab Tools) and SHALL retain the hover-to-reveal typewriter behavior from Requirement 1.
3. WHEN the row renders THEN the fifth card SHALL be a "Coming Soon" placeholder, visually distinct via reduced opacity, desaturation, or a padlock icon, and prominently labeled "Coming Soon".
4. WHEN the user clicks the "Coming Soon" card THEN the click SHALL be intercepted (no navigation) and a non-blocking notice SHALL inform the user that the tool is upcoming.
5. WHEN the dashboard is rendered at narrow widths THEN the row SHALL gracefully reflow to fewer columns rather than overflow horizontally.

### Requirement 5: Global Subject Expansion ("Science")

**User Story:** As a student who is not specializing in a single pure science (e.g., taking integrated lower-secondary science), I want to pick "Science" as my subject everywhere I previously had to choose Biology / Chemistry / Physics, so the AI generates content tailored to my general-science syllabus.

#### Acceptance Criteria

1. WHEN any page presents a subject `<select>` (Chapter Assistant, Experiment Guide, Quiz Generator, Tutor, Lab Tools, etc.) THEN it SHALL include a "Science" (or equivalent "General Science") option in addition to Biology, Chemistry, and Physics.
2. WHEN the user picks "Science" THEN the page SHALL apply a distinct accent color theme so it is visually identifiable as a separate subject.
3. WHEN the user picks "Science" THEN the floating decorative icons SHALL switch to a Science-appropriate glyph set.
4. WHEN the client sends a request with `subject: "Science"` to any AI Lambda THEN the backend SHALL accept it as a valid subject (no 400 / validation error).
5. WHEN the AI generates content for `subject: "Science"` THEN the prompt context SHALL instruct the model to draw from integrated, cross-disciplinary general science material rather than a single pure-science domain.
6. WHEN the user's selected subject is persisted across sessions THEN "Science" SHALL be a valid persisted value and SHALL restore correctly on reload.

### Requirement 6: Floating Tools Consolidation (Action Hub Bottom-Right)

**User Story:** As a user, I want all the floating utility buttons grouped together in one corner of the screen, so the interface looks intentional and the rest of the viewport stays distraction-free.

#### Acceptance Criteria

1. WHEN any page loads THEN the calculator / toolkit FAB SHALL be positioned in the bottom-right region of the viewport rather than the bottom-left.
2. WHEN both FABs (toolkit and Lab Assistant) are present THEN the toolkit FAB SHALL sit directly above the Lab Assistant FAB, vertically stacked with a small visible gap between them.
3. WHEN any page loads THEN no floating UI element SHALL be anchored to the left edge of the viewport.
4. WHEN a user who previously dragged the toolkit FAB to a custom position visits the app after the change THEN the FAB SHALL appear in the new bottom-right stack position rather than its previously remembered position.

### Requirement 7: Proactive Lab Assistant (Page Transition Greeting)

**User Story:** As a user navigating between sections, I want the Lab Assistant to briefly say hello and offer help relevant to the page I just opened, so the assistant feels alive and aware rather than dormant until I click it.

#### Acceptance Criteria

1. WHEN the user successfully loads a new page THEN the Lab Assistant SHALL display a small contextual greeting bubble near its FAB shortly after page load.
2. WHEN the greeting bubble is shown THEN its message SHALL be specific to the current page (e.g., a different message on the Experiment Guide than on the Quiz Generator).
3. WHEN the greeting bubble has been visible for a few seconds AND the user has not interacted with it THEN it SHALL fade away on its own (auto-dismiss) without blocking the page.
4. WHEN the user clicks the Lab Assistant FAB while a greeting bubble is visible THEN the bubble SHALL dismiss immediately.
5. WHEN the chat panel is already open at page-load time THEN the greeting bubble SHALL NOT appear.
6. WHEN multiple page loads occur in quick succession (e.g., back/forward navigation) THEN at most one greeting bubble SHALL exist in the DOM at any moment.

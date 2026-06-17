# Requirements Document

## Introduction

The Experiment Guide today streams a single long markdown document into one scrollable text panel. Users land on it, wait for the full guide to render, and then have to scroll through eight implicit sections (Objective, Materials, Safety, Procedure, etc.) one after another. This is functional but feels like reading a textbook — there is no visual hierarchy and no sense of "which section am I on."

This feature replaces the streaming text panel with a **two-step generation workflow** ending in an **interactive node-map view**. The node map renders the experiment topic as a prominent header node with eight clickable sub-section boxes branching off it. Each sub-section opens a detail panel on demand, so the user can dip into any section in any order without scrolling through the whole document. All eight sections are generated up-front and cached locally so the click-to-expand interaction is instant and offline-tolerant.

The change aligns the Experiment Guide's UX with the multi-step preview/confirmation pattern already used by the Quiz Generator (outline → confirm → quiz) and the Smart Flashcards (generate → preview → confirm → study), and replaces a passive reading surface with an explorable diagram.

## Glossary

- **Node map** — the experiment-output view consisting of one main topic node plus eight sub-section boxes connected by visual lines.
- **Main topic node** — the prominent header element at the top of the node map showing the experiment title (e.g., "Circular Motion Experiment").
- **Sub-section box** — one of the eight categorized clickable cards (Objective, Materials, Safety, Procedure, Expected Results, Scientific Explanation, Real-Life Applications, Summary).
- **Detail panel** — the modal or expanding panel that displays the full text of a single sub-section when clicked.
- **Confirmation step** — the intermediate screen between Setup form submission and node-map rendering, showing the AI's validation of inputs.
- **Section cache** — the in-memory + sessionStorage object holding all eight section bodies for the current experiment, so re-clicking a sub-section is instant.

## Requirements

### Requirement 1: Two-Step Generation Workflow

**User Story:** As a user generating an experiment, I want to see a brief confirmation of what the AI is about to produce before it commits resources to a full generation, so I have a chance to abort if I made a typo or picked the wrong subject.

#### Acceptance Criteria

1. WHEN the user clicks "Generate Experiment" with valid inputs THEN the page SHALL transition to an intermediate Confirmation screen instead of immediately rendering the full guide.
2. WHEN the Confirmation screen renders THEN it SHALL display the AI's validation message acknowledging the inputs and the uploaded file (if any), in the form: "Proceeding to generate a complete interactive {Subject} experiment guide on {Topic} at {Difficulty} level."
3. WHEN a reference document was uploaded AND the document is judged science-related THEN the Confirmation screen SHALL also display a brief 1-2 sentence summary of what the document contains and how it will be used.
4. WHEN a reference document was uploaded AND the document is NOT science-related THEN the Confirmation screen SHALL display an error block explaining the rejection AND SHALL NOT offer a "Continue" button — the user must return to setup.
5. WHEN the Confirmation screen is shown AND validation passed THEN it SHALL provide exactly two action buttons: "Continue & Generate Guide" and "Back to Setup".
6. WHEN the user clicks "Back to Setup" THEN the Setup form SHALL be re-displayed with all originally entered values intact (subject, topic, difficulty, uploaded file).
7. WHEN the user clicks "Continue & Generate Guide" THEN the system SHALL invoke the full eight-section generation AND on completion transition to the node-map view.

### Requirement 2: Main Topic Node

**User Story:** As a user reviewing my experiment, I want a clear, prominently styled header that names the experiment, so I always know what I'm exploring as I dip in and out of sub-sections.

#### Acceptance Criteria

1. WHEN the node-map view renders THEN a single Main Topic Node SHALL be displayed at the top of the view, horizontally centered relative to the row of sub-section boxes.
2. WHEN the Main Topic Node renders THEN it SHALL display the experiment topic in heavyweight typography (≥ 1.4 rem, weight ≥ 700) AND use a distinct accent treatment (gradient, glow, or border) that visually separates it from the sub-section boxes below.
3. WHEN the user has selected a Subject THEN the Main Topic Node's accent treatment SHALL match the active subject theme (Biology green / Chemistry purple / Physics blue / Science amber).
4. WHEN the experiment topic is too long for one line THEN the Main Topic Node SHALL wrap gracefully without overlapping the sub-section row beneath it.

### Requirement 3: Eight Sub-Section Boxes with Visual Connection

**User Story:** As a user, I want to see all eight categorized parts of the experiment at a glance and know they belong to the same parent topic, so I can navigate by purpose rather than by scrolling position.

#### Acceptance Criteria

1. WHEN the node-map view renders THEN exactly 8 sub-section boxes SHALL be displayed below the Main Topic Node in a grid or radial layout.
2. WHEN the sub-section boxes render THEN they SHALL appear in this exact order: 🎯 Objective, 🧰 Materials, ⚠️ Safety Briefing, 🔬 Procedure, 📊 Expected Results, 🧠 Scientific Explanation, 🌍 Real-Life Applications, 📝 Summary.
3. WHEN a sub-section box renders by default (collapsed state) THEN it SHALL show only its icon and section title — NOT the body text.
4. WHEN the node-map view renders THEN visual connecting lines SHALL emanate from the Main Topic Node down to each sub-section box, drawn either as SVG paths or as CSS borders, conveying the parent-child relationship at a glance.
5. WHEN the viewport width is below 700 px THEN the connecting lines MAY be omitted in favour of a simple stacked layout, but the eight boxes and the Main Topic Node SHALL remain visible without horizontal scrolling.

### Requirement 4: Click-to-Expand Detail Panel

**User Story:** As a user, I want to click on a sub-section to read its full content without losing my place in the node map, so I can compare sections by clicking back and forth quickly.

#### Acceptance Criteria

1. WHEN the user clicks any sub-section box THEN a Detail Panel SHALL open displaying the full AI-generated text for that section.
2. WHEN the Detail Panel renders THEN it SHALL display the section's icon, full title, and body text formatted with appropriate markdown rendering (bullet lists, numbered procedure steps, bold key terms).
3. WHEN the Detail Panel is open THEN the underlying node map SHALL remain visible (either via partial overlay/modal with backdrop, or via inline expansion that pushes other boxes aside) so the user retains spatial context.
4. WHEN the user clicks a Close button on the Detail Panel OR clicks outside the panel OR presses Escape THEN the panel SHALL close AND the node map SHALL return to its default collapsed state.
5. WHEN the user clicks a different sub-section box while a Detail Panel is already open THEN the system SHALL switch the panel content to the newly clicked section without first closing and re-opening the panel chrome (smooth content swap).
6. WHEN the user closes the Detail Panel THEN the previously clicked sub-section box SHALL retain a subtle "viewed" marker (e.g., checkmark or color change) for the duration of the session.

### Requirement 5: Local Section Caching

**User Story:** As a user clicking between sections rapidly, I want each click to feel instantaneous with no spinner or AI re-call, so I can flip between sections like reading a book.

#### Acceptance Criteria

1. WHEN the AI generates the experiment THEN ALL EIGHT sections SHALL be returned in a single response payload — there is no per-section lazy generation.
2. WHEN the eight sections arrive THEN they SHALL be stored in an in-memory cache keyed by section name AND mirrored to `sessionStorage` under a key like `vsl.experimentGuide` for cross-page persistence.
3. WHEN the user clicks a sub-section box THEN the Detail Panel SHALL render the cached body text immediately, with no network call, no spinner, no re-generation.
4. WHEN the user navigates away and returns to the page within the same session THEN the previously generated experiment SHALL be restored from `sessionStorage` AND the node-map SHALL render without requiring a fresh AI call.
5. WHEN the user clicks "Reset" or generates a new experiment THEN the cache for the previous experiment SHALL be discarded.

### Requirement 6: Backend JSON Contract

**User Story:** As the platform operator, I want the experiment-guide Lambda to return strict JSON with named section keys instead of free-form streaming markdown, so the frontend can route each section to its own UI surface without parsing.

#### Acceptance Criteria

1. WHEN the user clicks "Continue & Generate Guide" THEN the frontend SHALL POST to the existing `experiment_guide` Lambda Function URL with a JSON body containing `subject`, `topic`, `difficulty`, optional `file_data` / `file_mime`, AND a new `mode: "node_map"` flag.
2. WHEN the Lambda receives `mode: "node_map"` THEN it SHALL return a JSON object with the shape:
   ```
   {
     "topic_title": "Circular Motion Experiment",
     "sections": {
       "objective": "...",
       "materials": "...",
       "safety": "...",
       "procedure": "...",
       "expected_results": "...",
       "scientific_explanation": "...",
       "real_life_applications": "...",
       "summary": "..."
     }
   }
   ```
3. WHEN the Lambda receives a request without `mode: "node_map"` THEN it SHALL preserve its existing streaming-markdown behaviour for backward compatibility with any other consumers.
4. WHEN the Lambda receives `mode: "validate"` (the new confirmation-step request) THEN it SHALL return a small JSON object `{ valid: true, summary: "..." }` for the Confirmation screen WITHOUT generating the full eight-section content.
5. WHEN the document is judged irrelevant during validation THEN the Lambda SHALL return `{ valid: false, error: "..." }` so the frontend can show the rejection block.
6. WHEN any section's text exceeds a sensible length (suggested cap: 4000 chars) THEN the Lambda SHALL truncate it before returning, preventing one runaway section from breaking the JSON envelope.
7. WHEN the model output cannot be parsed as JSON THEN the Lambda SHALL return HTTP 200 with `{ "error": "...", "raw": "..." }` so the frontend can display a retry-able error.

### Requirement 7: Backward Compatibility & Reuse

**User Story:** As the platform operator, I want this new feature to use the existing Experiment Guide Lambda, IAM role, and deploy pipeline rather than introducing parallel infrastructure.

#### Acceptance Criteria

1. WHEN the feature is implemented THEN it SHALL reuse the existing `ExperimentGuideFunction` Lambda — no new function URL, no new CloudFormation resource.
2. WHEN the feature is implemented THEN it SHALL reuse the existing `AppBedrockRole` IAM permissions — no new IAM changes are required.
3. WHEN the feature is implemented THEN the existing `experiment.html` page SHALL be modified in place rather than replaced by a new file.
4. WHEN the feature is implemented THEN the existing `validate_file` and `sanitize_*` helpers in `lambdas/shared/validators.py` SHALL be reused unchanged.

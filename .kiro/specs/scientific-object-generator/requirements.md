# Requirements Document

## Introduction

The current Lab Tools Image Generator captures a single short concept (e.g. "Mitochondrion structure") and pipelines it through Claude → Titan in one step on one screen. It is fine for casual queries but inadequate for the platform's flagship use case — a researcher, technician, or student needing a polished visual + scientific narrative of a specific lab tool (e.g. a 50 mL sterile centrifuge tube made of polypropylene for molecular biology work).

This feature replaces that flow with a **dedicated Scientific Object Generator**: a structured input page that captures the tool's full context, an editable AI-summarized overview the user can manually correct, a separate results page that runs a strictly sequential image-then-narrative pipeline (using Stability SD 3.5 Large in us-west-2 for the image and Claude Haiku 4.5 for the narrative), and a final output that is a coherent paragraph narrative — not a bullet list — describing the tool's material science, lab use, handling, and safety considerations.

The feature is intentionally split across **two pages** with state carried via `sessionStorage`, mirroring the multi-step preview pattern already used by Quiz Generator and Smart Flashcards. The image generation happens **before** the narrative call so the user sees the visual artifact while the paragraph text generates against the now-visible image context. Loading states use skeleton placeholders, not just spinners, so the user always understands what surface is rendering.

## Glossary

- **Scientific Object** — the lab tool the user wants to visualize and describe (e.g. centrifuge tube, micropipette, Petri dish, oscilloscope probe).
- **Input page** — the new dedicated form page that collects the structured object inputs and produces the editable AI overview sentence.
- **Overview sentence** — the short AI-summarized description shown in an editable textarea on the input page; the user-edited version becomes the source of truth carried to the results page.
- **Results page** — the second page that renders the image and narrative based on the approved overview + structured inputs.
- **Sequential pipeline** — the strict ordering rule: image generation must complete and the image must be rendered to the DOM before the narrative generation request fires.
- **Narrative** — the long-form, paragraph-style scientific description produced by the second LLM call. It is NOT a bulleted feature list.
- **Stability SD 3.5 Large** — Bedrock model `stability.sd3-5-large-v1:0` in region `us-west-2`. The new image backend.

## Requirements

### Requirement 1: Dedicated Input Page with Structured Form

**User Story:** As a user creating a lab-tool visualization, I want a dedicated form that collects the full context of the object — material, purpose, use case, appearance, sterility, style — so the AI has enough specificity to generate a meaningful image and narrative rather than a generic illustration.

#### Acceptance Criteria

1. WHEN the user navigates to the Lab Tools area AND selects the Scientific Object Generator THEN the system SHALL render a dedicated input page (separate from the legacy Image Gen tab in lab-tools.html).
2. WHEN the input page renders THEN it SHALL display structured form fields including (at minimum): Lab Tool Name, Material, Scientific Purpose, Biological/Chemical Use Case, Physical Appearance, Sterility/Safety Context, Preferred Visual Style.
3. WHEN the input page renders THEN every text-style field SHALL include a placeholder with a realistic example (e.g. "Material" → "Polypropylene, stainless steel, borosilicate glass…").
4. WHEN the user submits the form with any of the required fields blank (Lab Tool Name, Material, Purpose) THEN the system SHALL reject the submission with an inline validation message AND SHALL NOT make a network call.
5. WHEN the user submits a complete form THEN the system SHALL call a lightweight LLM endpoint to produce the overview sentence AND display it in an editable textarea below the form.
6. WHEN the input page loads THEN it SHALL inherit the global navbar, footer, floating Lab Assistant bubble, toolkit FAB, and subject-theming rules consistent with the rest of the site.

### Requirement 2: AI Overview Sentence with User Editing

**User Story:** As a careful user, I want to see and edit the AI's one-sentence summary of the object before committing to the heavy generation step, so I can correct any wording the AI got wrong before it shapes the image and narrative.

#### Acceptance Criteria

1. WHEN the lightweight LLM returns the overview sentence THEN the system SHALL render it inside an editable textarea (`<textarea>`, NOT a read-only span or a static caption).
2. WHEN the overview sentence is rendered THEN it SHALL be one to three sentences in length, focused on what the tool is and its key visual/functional attributes; it MUST NOT contain bullet lists, headings, or markdown styling.
3. WHEN the user types into the overview textarea THEN their edits SHALL be preserved in component state without losing focus or auto-saving.
4. WHEN the user clicks a "Regenerate Overview" button THEN the system SHALL re-call the lightweight LLM with the current form values AND replace the textarea content with the new sentence (only if the user confirms via dialog when the textarea has unsaved manual edits).
5. WHEN the user clicks the "Confirm" / "Generate Lab Tool" button THEN the system SHALL treat the current contents of the overview textarea — NOT the original AI output — as the approved overview that downstream steps consume.
6. WHEN the user clicks "Confirm" with an empty overview textarea THEN the system SHALL reject the action and prompt the user to either edit or regenerate.

### Requirement 3: Cross-Page State Transfer

**User Story:** As a user, I want my form inputs and approved overview to persist when the application routes to the results page, so I never have to re-type the structured data.

#### Acceptance Criteria

1. WHEN the user clicks "Confirm" on the input page THEN the system SHALL persist both the structured form values AND the user-approved overview sentence into `sessionStorage` under a single keyed object before navigation.
2. WHEN the results page loads THEN it SHALL read the persisted state from `sessionStorage` AND use those exact values for both the image and narrative generation calls — it SHALL NOT reach back to the form to re-read DOM values.
3. WHEN the results page is loaded directly (e.g. user pastes the URL) WITHOUT any persisted state THEN the system SHALL display a "No object configured" placeholder AND offer a button routing back to the input page.
4. WHEN the user clicks the "Back" / "New Object" button on the results page THEN the system SHALL clear the persisted state AND route back to the input page with the form reset.
5. WHEN navigation between input and results pages occurs THEN it SHALL be a regular page navigation (full page load), NOT a single-page-app route — consistent with the rest of the static site.

### Requirement 4: Sequential Image-Then-Narrative Pipeline

**User Story:** As a user, I want the image to render first and the long written narrative to start only after the image is on screen, so I have something visual to anchor my reading and the system never juggles two heavy AI calls in parallel.

#### Acceptance Criteria

1. WHEN the results page mounts AND it has valid persisted state THEN the system SHALL immediately fire the image generation request — and ONLY the image request — to the backend.
2. WHEN the image request returns successfully AND the returned image is fully rendered to the DOM (the `<img>` element has fired its `load` event or its `src` has been committed) THEN AND ONLY THEN SHALL the narrative LLM request be fired.
3. WHEN the image request fails (network error, model error, safety rejection) THEN the narrative request SHALL NOT be fired automatically. The user SHALL be shown a retry control for the image; only on a successful retry does the narrative phase proceed.
4. WHEN the narrative request is in flight AND the user navigates away or clicks "Back" THEN the in-flight narrative request SHALL be aborted via `AbortController` so it doesn't write to a stale page.
5. WHEN both phases have completed THEN the page SHALL display the rendered image alongside the rendered narrative as a single cohesive output.

### Requirement 5: Image Generation via Stability SD 3.5 Large

**User Story:** As the platform operator, I want the new image generator to use Stability SD 3.5 Large in us-west-2 for higher visual fidelity than the existing Titan-based generator, while preserving the existing CORS / API-key / IAM patterns.

#### Acceptance Criteria

1. WHEN the system needs to generate the image THEN the backend SHALL invoke Bedrock model `stability.sd3-5-large-v1:0` in region `us-west-2` — NOT Titan v2 in us-east-1, NOT Nova Canvas, NOT any other model.
2. WHEN the new model is invoked THEN the request body SHALL conform to Stability SD 3.5 Large's API contract (`prompt`, optional `negative_prompt`, `aspect_ratio`, `seed`, `output_format`, `mode: text-to-image`).
3. WHEN the model returns the image bytes THEN the backend SHALL re-encode them as base64 and return JSON `{ "image_base64": "<b64>", "prompt_used": "<final prompt>", "model": "stability.sd3-5-large-v1:0" }`.
4. WHEN the user has not configured Stability SD 3.5 access via Bedrock model access THEN the backend SHALL surface a clear "Model access not enabled in us-west-2 — please enable Stability SD 3.5 Large in the Bedrock console" error message rather than a raw `AccessDeniedException`.
5. WHEN the IAM role is updated THEN it SHALL grant `bedrock:InvokeModel` on `arn:aws:bedrock:us-west-2::foundation-model/stability.sd3-5-large-v1:0` AND retain the existing Titan/Nova permissions so the legacy Image Gen tab continues to work unchanged.
6. WHEN the new image endpoint is wired THEN it SHALL be a NEW Lambda Function URL (e.g. `scientific_object_generator`) — it SHALL NOT replace or modify the existing `image_generator` Lambda used by the legacy tab.

### Requirement 6: Loading States via Skeleton Placeholders

**User Story:** As a user waiting for AI output, I want clear, descriptive loading states that show me what surface is rendering — not just a generic spinner — so I always understand what the system is doing.

#### Acceptance Criteria

1. WHEN the image generation is in flight THEN the image surface SHALL display a skeleton-style placeholder (animated shimmer block sized roughly to the expected image aspect ratio) with a short caption ("Rendering image…").
2. WHEN the narrative generation is in flight THEN the narrative surface SHALL display a skeleton with multiple shimmer lines mimicking paragraph text (varying widths) and a short caption ("Writing detailed description…").
3. WHEN either skeleton is visible THEN it SHALL NOT be replaced by a generic full-page spinner overlay — each surface owns its own loading state independently.
4. WHEN the lightweight overview LLM call is in flight on the input page THEN the overview textarea SHALL show a single-line skeleton with a "Summarizing…" caption rather than a generic spinner.

### Requirement 7: Long-Form Narrative Generation

**User Story:** As a researcher reading the generated description, I want a coherent multi-paragraph scientific narrative that explains the tool's material, use, handling, and safety considerations as connected prose — not a list of labels — so the description is genuinely informative.

#### Acceptance Criteria

1. WHEN the narrative LLM is invoked THEN its system prompt SHALL explicitly instruct the model to produce paragraph-form prose, NOT bullet lists, NOT headings labeled "Material" / "Use" / "Warning" as isolated items.
2. WHEN the narrative is rendered THEN it SHALL be at least 4 substantive paragraphs covering: (a) what the tool is and its physical form, (b) realistic lab use, (c) material properties relevant to handling and performance, (d) safety, contamination, or compatibility considerations.
3. WHEN the narrative discusses a material (e.g. stainless steel, polypropylene, borosilicate glass) THEN it SHALL explain why the material was chosen, how it behaves under repeated handling or cleaning, and what reagent compatibility or thermal limitations apply — NOT just name the material.
4. WHEN the narrative LLM returns its output THEN the backend SHALL strip any markdown bullet syntax (`- `, `* `, `1. `) at the start of lines that the model may have included against instructions, replacing them with prose-friendly punctuation.
5. WHEN the narrative is rendered to the DOM THEN it SHALL render as a series of `<p>` elements — NOT as a `<ul>` or `<ol>`. The final visual presentation SHALL look like an article excerpt, not a checklist.
6. WHEN the narrative call uses the same approved overview sentence and form inputs as the image call THEN the prompt SHALL include those values in a `Context:` block at the top, so the narrative is consistent with what the image was generated from.

### Requirement 8: Backend Architecture & Reuse

**User Story:** As the platform operator, I want this feature to add a single new Lambda whose URL is wired through the existing deploy pipeline, while reusing existing CORS, API-key validation, and shared validators — so we keep one consistent back-end pattern.

#### Acceptance Criteria

1. WHEN the new feature is implemented THEN it SHALL add exactly one new Lambda (`scientific_object_generator`) with three modes selected by a `mode` field in the request body: `"overview"`, `"image"`, `"narrative"`.
2. WHEN the new Lambda is invoked THEN it SHALL reuse `lambdas/shared/cors.py`, `lambdas/shared/validators.py`, and the existing `bedrock_stream.py` helpers — NO new shared modules are introduced.
3. WHEN the new Lambda is added to `infra/template.yaml` THEN it SHALL declare its IAM permissions as a delta on the existing `AppBedrockRole` (adding the Stability SD 3.5 model ARN), NOT a new IAM role.
4. WHEN the deploy workflow runs THEN it SHALL replace `__URL_SCIENTIFIC_OBJECT_GENERATOR__` in `frontend/config.js` with the new Function URL via the same `sed` pattern used for every other Lambda.
5. WHEN the existing `image_generator` Lambda and lab-tools.html Image Gen tab are inspected after this feature lands THEN they SHALL be functionally unchanged (legacy path preserved).

### Requirement 9: Dashboard & Navigation Integration

**User Story:** As a user discovering the new generator, I want to find it via the Lab Tools area on the dashboard rather than as a hidden URL, so it feels like part of the product.

#### Acceptance Criteria

1. WHEN the user lands on the Lab Tools page THEN a clearly-labeled entry point ("Scientific Object Generator" or similar) SHALL route to the new input page.
2. WHEN the new input page or results page is the active page THEN the existing "Lab Tools" nav link SHALL show its active state (the new pages are sub-views of Lab Tools, not a new top-level nav item).
3. WHEN the global Lab Assistant greeting bubble fires on either of the new pages THEN it SHALL display a context-appropriate message (e.g. "Designing a lab tool? Tell me what you're working on.").
4. WHEN the user uses the existing "Send to AI Lab Assistant" button on the results page THEN the system SHALL inject the rendered image caption + narrative into the global chat with a `🧰 Lab Tool: <name>` source label.

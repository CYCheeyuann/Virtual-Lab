# Design: Scientific Object Generator

## Overview

This feature adds a dedicated, two-page workflow inside Lab Tools for generating a high-fidelity image + long-form narrative of a specific lab tool. The flow is intentionally split:

1. **Input page (`lab-object.html`)** — structured form (name, material, purpose, use case, appearance, sterility/safety, visual style) → lightweight LLM call → editable overview textarea → "Confirm" button persists state to `sessionStorage` and routes to the results page.
2. **Results page (`lab-object-result.html`)** — reads persisted state → fires Stability SD 3.5 Large image generation in `us-west-2` → after the image's `load` event fires → fires the narrative LLM call (Claude Haiku 4.5) → renders both as a single cohesive output.

The pipeline is **strictly sequential**. Image first, narrative second, never in parallel. Loading states are skeleton placeholders, not generic spinners. The final narrative is paragraph prose (`<p>` elements only), not bullet lists.

A single new Lambda (`scientific_object_generator`) handles all three AI calls (`overview`, `image`, `narrative`) via a `mode` discriminator. The existing `image_generator` Lambda and the legacy "Image Gen" tab in `lab-tools.html` remain functionally unchanged.

### Goals
- Capture enough structured context up-front that the AI produces a meaningful, lab-specific output instead of a generic illustration.
- Give the user explicit editorial control over the AI's overview before the heavy generation runs.
- Land on Stability SD 3.5 Large for image fidelity that matches a real research-grade visualization.
- Produce a narrative that reads like an article excerpt for a researcher/technician, not a feature checklist.
- Reuse every existing back-end pattern (CORS module, validators, IAM role) so this is one new Lambda + one new IAM ARN, nothing more.

### Non-goals
- No replacement of the legacy `image_generator` Lambda or the `lab-tools.html` Image Gen tab. Both stay.
- No streaming (response_stream) for either AI call — the contracts are JSON-in / JSON-out.
- No per-section regeneration controls on the results page beyond "Retry" buttons. v1 is "regenerate the whole result by going back to the input page".
- No user accounts, no cross-device sync. State lives in `sessionStorage` only.

### Affected files (canonical list)
```
NEW  frontend/lab-object.html                       (Input page)
NEW  frontend/lab-object-result.html                (Results page)
NEW  frontend/lab-object.css                        (Form + result styles, including skeletons)
NEW  frontend/lab-object.js                         (Shared helpers: state I/O, validation, abort control)
NEW  lambdas/scientific_object_generator/app.py     (3-mode handler: overview / image / narrative)
NEW  lambdas/scientific_object_generator/requirements.txt
NEW  lambdas/scientific_object_generator/run.sh

MOD  frontend/lab-tools.html                        (Add "Scientific Object Generator" entry CTA)
MOD  frontend/config.js                             (Add __URL_SCIENTIFIC_OBJECT_GENERATOR__)
MOD  frontend/global-chat.js                        (Greeting entries for the two new pages)
MOD  infra/template.yaml                            (New Lambda + IAM ARN for Stability SD 3.5 Large)
MOD  .github/workflows/deploy.yml                   (Sed replace + copy shared module into new lambda)
```

## Architecture

### Page flow & state
```
[Lab Tools page]
       │
       │  Click "Scientific Object Generator"
       ▼
[lab-object.html — Input page]
       │
       │  1. User fills 7 structured fields
       │  2. Click "Generate Overview" → POST {mode:"overview", ...}
       │  3. Editable textarea populated with one-sentence summary
       │  4. User edits sentence as needed
       │  5. Click "Confirm & Generate Lab Tool"
       ▼
sessionStorage["vsl.scientificObject"] = { form, approvedOverview, ts }
       │
       │  location.href = "lab-object-result.html"
       ▼
[lab-object-result.html — Results page]
       │
       │  1. Read sessionStorage; if missing → empty-state with back link
       │  2. Show image skeleton + narrative skeleton
       │  3. Fire image request: POST {mode:"image", form, approvedOverview}
       │  4. Wait for fetch to resolve AND <img> .load event fires
       │  5. Fire narrative request: POST {mode:"narrative", form, approvedOverview}
       │  6. Replace narrative skeleton with rendered <p> paragraphs
       ▼
[Done — image + narrative side-by-side]
```

### Sequence (results page)
```
mount
  ├─ readState()
  ├─ if !state → renderEmptyState()
  ├─ renderImageSkeleton()
  ├─ renderNarrativeSkeleton()
  ├─ image: AbortController A
  │    ├─ fetch(url, {mode:"image",...})
  │    ├─ on response → set <img>.src = "data:image/png;base64,..."
  │    └─ await imgEl.load event (or imgEl.complete polled)
  │         │
  │         ▼
  │     imageReady === true
  ├─ narrative: AbortController B
  │    ├─ fetch(url, {mode:"narrative",...})
  │    ├─ on response → renderParagraphs(json.narrative)
  │    └─ done
  │
  └─ Both AbortControllers wired to "Back" button so navigation cancels in-flight requests.
```

### Single Lambda, three modes
```
POST <function-url>
{
  "mode": "overview" | "image" | "narrative",
  "form": { name, material, purpose, useCase, appearance, sterility, style },
  "approvedOverview": "..."   // required for "image" and "narrative"
}

Responses:
  overview  → { "overview": "<one to three sentences>" }
  image     → { "image_base64": "<b64>", "prompt_used": "...",
                 "model": "stability.sd3-5-large-v1:0" }
  narrative → { "narrative": "<paragraph 1>\n\n<paragraph 2>\n\n..." }

Errors → { "error": "..." } with HTTP 400/500/etc.
```

This shape lets the frontend make three separate calls with progress visibility on each. Bundling them into one Lambda call would prevent the user from seeing the image while the narrative is still generating.

## Components and Interfaces

### Part 1 — Input Page (`lab-object.html`)

**Markup outline:**
```html
<main class="page">
  <div class="page-header">
    <h1>🧰 Scientific Object Generator</h1>
    <p>Describe the lab tool you want to visualize. We'll summarize, you'll edit, then we'll generate the image and narrative.</p>
  </div>

  <section class="card" id="phase-form">
    <h2>1 · Object Details</h2>

    <label for="objName">Lab Tool Name <span class="required">*</span></label>
    <input id="objName" class="input" type="text" placeholder="e.g. 50 mL sterile centrifuge tube" />

    <label for="objMaterial">Material <span class="required">*</span></label>
    <input id="objMaterial" class="input" type="text" placeholder="e.g. Polypropylene, stainless steel, borosilicate glass" />

    <label for="objPurpose">Scientific Purpose <span class="required">*</span></label>
    <input id="objPurpose" class="input" type="text" placeholder="e.g. Sample storage during high-speed centrifugation" />

    <label for="objUseCase">Biological / Chemical Use Case</label>
    <input id="objUseCase" class="input" type="text" placeholder="e.g. Molecular biology, DNA/RNA isolation, cell culture" />

    <label for="objAppearance">Physical Appearance</label>
    <input id="objAppearance" class="input" type="text" placeholder="e.g. Conical bottom, frosted writing area, screw cap" />

    <label for="objSterility">Sterility / Safety Context</label>
    <input id="objSterility" class="input" type="text" placeholder="e.g. Gamma-sterilized, RNase/DNase-free, autoclavable to 121°C" />

    <label for="objStyle">Preferred Visual Style</label>
    <select id="objStyle" class="input">
      <option>Photorealistic studio</option>
      <option>Scientific catalog photo</option>
      <option>Detailed 3D render</option>
      <option>Technical product illustration</option>
      <option>Microscope-style close-up</option>
    </select>

    <div class="btn-row" style="margin-top:18px">
      <button id="genOverviewBtn" class="btn btn-primary">
        <span>✨</span><span>Generate Overview</span>
      </button>
      <button id="formResetBtn" class="btn btn-ghost">Reset</button>
    </div>
  </section>

  <section class="card" id="phase-overview" style="display:none">
    <h2>2 · Approve the Overview</h2>
    <p style="color:var(--c-muted);font-size:0.88rem;margin-bottom:12px">
      The AI summarised your inputs into a one- to three-sentence description.
      Edit it directly to fix anything before we generate the visual + narrative.
    </p>
    <textarea id="overviewText" class="input" rows="5" placeholder="The AI-generated overview will appear here…"></textarea>
    <div id="overviewSkeleton" class="overview-skeleton" hidden>
      <div class="shimmer-line"></div>
      <div class="shimmer-line short"></div>
      <p class="skel-caption">Summarizing…</p>
    </div>
    <div class="btn-row" style="margin-top:14px">
      <button id="confirmBtn" class="btn btn-primary">
        <span>🚀</span><span>Confirm &amp; Generate Lab Tool</span>
      </button>
      <button id="regenerateOverviewBtn" class="btn btn-ghost">
        <span>↻</span><span>Regenerate Overview</span>
      </button>
      <button id="backToFormBtn" class="btn btn-ghost">
        <span>←</span><span>Edit Inputs</span>
      </button>
    </div>
  </section>
</main>
```

**JS contract (`lab-object.js`):**
```js
const STATE_KEY = 'vsl.scientificObject';

function readForm() {
  return {
    name:       valOf('objName').trim(),
    material:   valOf('objMaterial').trim(),
    purpose:    valOf('objPurpose').trim(),
    useCase:    valOf('objUseCase').trim(),
    appearance: valOf('objAppearance').trim(),
    sterility:  valOf('objSterility').trim(),
    style:      valOf('objStyle'),
  };
}
function validateRequired(form) {
  const required = ['name', 'material', 'purpose'];
  return required.filter(k => !form[k]);
}

async function generateOverview() {
  const form = readForm();
  const missing = validateRequired(form);
  if (missing.length) {
    showToast(`Missing required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`, 'warning');
    return;
  }
  showOverviewSkeleton(true);
  try {
    const url = window.STREAM_URLS.scientific_object_generator;
    if (!url || url.startsWith('__URL_')) throw new Error('Backend not deployed');
    const resp = await fetch(url, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ mode: 'overview', form }),
    });
    const json = await resp.json();
    if (json.error) throw new Error(json.error);
    document.getElementById('overviewText').value = json.overview || '';
    document.getElementById('phase-overview').style.display = '';
  } catch (err) {
    showToast('Overview failed: ' + err.message, 'error');
  } finally {
    showOverviewSkeleton(false);
  }
}

function confirmAndRoute() {
  const overview = document.getElementById('overviewText').value.trim();
  if (!overview) {
    showToast('Edit or regenerate the overview before confirming', 'warning');
    return;
  }
  const form = readForm();
  sessionStorage.setItem(STATE_KEY, JSON.stringify({
    form, approvedOverview: overview, ts: Date.now()
  }));
  location.href = 'lab-object-result.html';
}
```

The overview textarea is a real `<textarea>` so the user can freely edit. Regenerating shows a confirm dialog if the textarea has been manually edited (detected by comparing against the last AI-returned value held in JS state).

**Why two phases on one page (not three pages).** The form → overview transition is in-page so the user can iterate quickly. Only the heavy generation (image + narrative) earns a full page navigation, mirroring the Quiz Generator pattern.

### Part 2 — Results Page (`lab-object-result.html`)

**Markup outline:**
```html
<main class="page">
  <div class="page-header">
    <h1 id="resultTitle">🧰 Lab Tool</h1>
    <p id="resultMeta" class="result-meta"></p>
  </div>

  <section class="card result-grid">
    <div class="result-image-col">
      <div id="resultImage" class="result-image">
        <!-- Skeleton initially, then <img> -->
      </div>
      <p class="result-image-caption" id="resultImageCaption"></p>
      <button id="retryImageBtn" class="btn btn-ghost btn-sm" hidden>
        <span>↻</span><span>Retry image</span>
      </button>
    </div>
    <div class="result-narrative-col">
      <div id="resultNarrative" class="result-narrative">
        <!-- Skeleton initially, then <p> elements -->
      </div>
      <button id="retryNarrativeBtn" class="btn btn-ghost btn-sm" hidden>
        <span>↻</span><span>Retry narrative</span>
      </button>
    </div>
  </section>

  <section class="card" id="resultEmpty" style="display:none">
    <h2>No object configured</h2>
    <p>Head back to the Scientific Object Generator and describe a lab tool first.</p>
    <a class="btn btn-primary" href="lab-object.html">
      <span>←</span><span>Back to Setup</span>
    </a>
  </section>

  <div class="btn-row" style="margin-top:18px">
    <a class="btn btn-ghost" href="lab-object.html">
      <span>↻</span><span>New Object</span>
    </a>
    <button id="exportBtn" class="btn btn-ghost btn-export"></button>
    <button id="sendToAiBtn" class="btn btn-ghost"></button>
  </div>
</main>
```

**Pipeline JS:**
```js
const STATE_KEY = 'vsl.scientificObject';
let imageAbort = null;
let narrativeAbort = null;

async function run() {
  const raw = sessionStorage.getItem(STATE_KEY);
  if (!raw) { showEmptyState(); return; }
  const state = JSON.parse(raw);
  document.getElementById('resultTitle').textContent = `🧰 ${state.form.name}`;
  document.getElementById('resultMeta').textContent =
    `${state.form.material} · ${state.form.purpose}`;

  renderImageSkeleton();
  renderNarrativeSkeleton();

  // PHASE 1 — image
  let imageOk = false;
  try {
    imageAbort = new AbortController();
    const img = await callImage(state, imageAbort.signal);
    await renderImage(img.image_base64, state.form.name);   // resolves on <img>.load
    document.getElementById('resultImageCaption').textContent =
      `${state.form.style} — generated by ${img.model}`;
    imageOk = true;
  } catch (err) {
    if (err.name !== 'AbortError') {
      renderImageError(err.message);
      document.getElementById('retryImageBtn').hidden = false;
    }
  }
  if (!imageOk) {
    // Pause narrative — only fire on retry success
    return;
  }

  // PHASE 2 — narrative (sequential, only after image is rendered)
  try {
    narrativeAbort = new AbortController();
    const nar = await callNarrative(state, narrativeAbort.signal);
    renderNarrative(nar.narrative);
  } catch (err) {
    if (err.name !== 'AbortError') {
      renderNarrativeError(err.message);
      document.getElementById('retryNarrativeBtn').hidden = false;
    }
  }
}

function renderImage(b64, name) {
  return new Promise((resolve, reject) => {
    const host = document.getElementById('resultImage');
    const img = new Image();
    img.alt = name;
    img.className = 'generated-image';
    img.onload = () => {
      host.innerHTML = '';
      host.appendChild(img);
      resolve();           // sequential gate: narrative only fires after this
    };
    img.onerror = () => reject(new Error('Image failed to load'));
    img.src = 'data:image/png;base64,' + b64;
  });
}

function renderNarrative(text) {
  // Strip stray bullet syntax that the model may emit despite instructions
  const cleaned = text
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '');
  const paragraphs = cleaned.split(/\n{2,}/).filter(p => p.trim());
  const host = document.getElementById('resultNarrative');
  host.innerHTML = paragraphs
    .map(p => `<p>${escapeHtml(p)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')}</p>`)
    .join('');
}
```

**Sequential gate is real.** `renderImage` returns a Promise that resolves only when the `<img>.onload` event fires — the byte download has finished AND the browser has decoded the image AND it is committed to the DOM. The narrative call is awaited after that resolution. There is no `Promise.all`, no parallel kickoff, and no premature start.

**Cancel-on-leave.** Both `AbortController`s are tied to `beforeunload` and the "New Object" / "Back" buttons so that if the user leaves mid-pipeline, neither response writes back to a stale page.

### Part 3 — Skeleton Loading States

**Image skeleton:**
```html
<div class="image-skeleton">
  <div class="shimmer-block"></div>
  <p class="skel-caption">🖼️ Rendering image…</p>
</div>
```
```css
.image-skeleton {
  width: 100%;
  aspect-ratio: 1 / 1;       /* matches the 1024×1024 SD 3.5 output */
  border-radius: 14px;
  overflow: hidden;
  position: relative;
}
.shimmer-block {
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg,
    rgba(var(--c-accent-rgb), 0.06) 25%,
    rgba(var(--c-accent-rgb), 0.18) 50%,
    rgba(var(--c-accent-rgb), 0.06) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.6s ease infinite;
}
.skel-caption {
  position: absolute;
  bottom: 12px; left: 14px;
  color: var(--c-muted);
  font-size: 0.85rem;
}
```

**Narrative skeleton (multiple lines):**
```html
<div class="narrative-skeleton">
  <div class="shimmer-line w95"></div>
  <div class="shimmer-line w88"></div>
  <div class="shimmer-line w72"></div>
  <div class="shimmer-line w90"></div>
  <div class="shimmer-line w78"></div>
  <div class="shimmer-line w65"></div>
  <p class="skel-caption">✍️ Writing detailed description…</p>
</div>
```

**Why skeletons over a spinner.** Skeleton placeholders communicate (1) what surface is loading and (2) roughly what the loaded content will look like. A generic spinner says only "wait." Skeletons reduce perceived wait time and prevent the page from looking broken when an LLM call takes 8-15 seconds.

### Part 4 — Backend Lambda (`scientific_object_generator`)

**File layout (mirrors existing Lambdas):**
```
lambdas/scientific_object_generator/
├── app.py
├── requirements.txt        (flask, boto3 — same as siblings)
└── run.sh                  (#!/bin/bash; exec python app.py)
```

**`app.py` mode dispatch:**
```python
def handler(path):
    # ... CORS / API key boilerplate identical to siblings ...
    body = request.get_json(force=True, silent=True) or {}
    mode = body.get("mode")
    if mode == "overview":  return _handle_overview(body)
    if mode == "image":     return _handle_image(body)
    if mode == "narrative": return _handle_narrative(body)
    return _err("Unknown mode")
```

**Mode 1 — overview (lightweight Claude Haiku call):**
```python
_OVERVIEW_SYSTEM = (
    "You produce a single concise 1-3 sentence description of a lab tool, "
    "aimed at a researcher or student. Plain prose only — no bullets, no "
    "markdown, no headings, no labelled fields. Focus on what the tool is "
    "and its key visual / functional attributes derived from the inputs."
)

def _handle_overview(body):
    form = body.get("form") or {}
    user_prompt = (
        "Create a 1-3 sentence overview of this lab tool:\n"
        f"  Name:       {form.get('name', '')}\n"
        f"  Material:   {form.get('material', '')}\n"
        f"  Purpose:    {form.get('purpose', '')}\n"
        f"  Use case:   {form.get('useCase', '')}\n"
        f"  Appearance: {form.get('appearance', '')}\n"
        f"  Sterility:  {form.get('sterility', '')}\n"
        f"  Style:      {form.get('style', '')}\n\n"
        "Output only the overview sentences."
    )
    return _claude_text(user_prompt, system=_OVERVIEW_SYSTEM, max_tokens=200,
                        out_key="overview")
```

**Mode 2 — image (Stability SD 3.5 Large in us-west-2):**
```python
IMAGE_REGION   = "us-west-2"
IMAGE_MODEL_ID = "stability.sd3-5-large-v1:0"

def _build_image_client():
    cfg = Config(region_name=IMAGE_REGION,
                 connect_timeout=10, read_timeout=300,
                 retries={"max_attempts": 2, "mode": "standard"})
    return boto3.client("bedrock-runtime", config=cfg)

def _handle_image(body):
    form = body.get("form") or {}
    overview = body.get("approvedOverview", "").strip()
    if not overview:
        return _err("approvedOverview is required for image mode")
    prompt = _compose_image_prompt(form, overview)
    client = _build_image_client()
    req = {
        "prompt": prompt[:4000],
        "mode": "text-to-image",
        "aspect_ratio": "1:1",
        "output_format": "png",
        "seed": 42,
    }
    try:
        resp = client.invoke_model(
            modelId=IMAGE_MODEL_ID,
            body=json.dumps(req),
            accept="application/json",
            contentType="application/json",
        )
        payload = json.loads(resp["body"].read())
    except ClientError as e:
        return _bedrock_error(e)

    # Stability SD 3.5 returns { images: ["<base64>"] } or { artifacts: [{base64: ...}] }
    # depending on version — handle both shapes defensively.
    b64 = _extract_image_b64(payload)
    if not b64:
        return _err("Image model returned no image")
    return _json({"image_base64": b64, "prompt_used": prompt, "model": IMAGE_MODEL_ID})

def _compose_image_prompt(form, overview):
    return (
        f"{form.get('style', 'Photorealistic studio')}: {overview} "
        f"Material: {form.get('material', '')}. "
        f"Physical features: {form.get('appearance', '')}. "
        f"Context: a clean laboratory bench, soft neutral lighting, sharp focus, "
        f"no text overlays, accurate proportions, suitable for a scientific catalog."
    )
```

**Mode 3 — narrative (Claude Haiku, 4-paragraph prose):**
```python
_NARRATIVE_SYSTEM = (
    "You write detailed scientific narratives about lab tools. Output rules:\n"
    "  - Produce 4 to 6 SUBSTANTIVE PARAGRAPHS of connected prose.\n"
    "  - Do NOT use bullet points, numbered lists, or section headings.\n"
    "  - Do NOT label fields like 'Material:' or 'Use:' as standalone lines.\n"
    "  - Cover, woven into prose: (1) what the tool is and its physical form; "
    "    (2) realistic lab use; (3) material properties relevant to handling, "
    "    cleaning, and reagent compatibility; (4) safety, sterility, "
    "    contamination, and thermal/chemical limits the user must know.\n"
    "  - When you mention a material, explain WHY it was chosen and what "
    "    practical limitations it implies — not just the name.\n"
    "  - Use **bold** sparingly to emphasize at most 4-6 key technical terms.\n"
    "  - Tone: informative, professional, suitable for a researcher, "
    "    technician, or upper-level student."
)

def _handle_narrative(body):
    form = body.get("form") or {}
    overview = body.get("approvedOverview", "").strip()
    if not overview:
        return _err("approvedOverview is required for narrative mode")
    user_prompt = (
        f"Context — generate a paragraph-form narrative consistent with this image's subject:\n\n"
        f"Approved overview: {overview}\n"
        f"Lab tool: {form.get('name', '')}\n"
        f"Material: {form.get('material', '')}\n"
        f"Purpose: {form.get('purpose', '')}\n"
        f"Use case: {form.get('useCase', '')}\n"
        f"Appearance: {form.get('appearance', '')}\n"
        f"Sterility / safety: {form.get('sterility', '')}\n\n"
        "Produce the narrative now."
    )
    return _claude_text(user_prompt, system=_NARRATIVE_SYSTEM,
                        max_tokens=2200, out_key="narrative",
                        post=_strip_residual_bullets)

def _strip_residual_bullets(text):
    """Last-line-of-defense: strip any markdown bullet syntax the model
    may have emitted at the start of lines."""
    lines = text.splitlines()
    cleaned = []
    for line in lines:
        stripped = line.lstrip()
        if stripped.startswith(('- ', '* ', '+ ')):
            cleaned.append(stripped[2:])
        elif len(stripped) >= 2 and stripped[0].isdigit() and stripped[1] == '.':
            # "1. Foo" → "Foo"
            parts = stripped.split('.', 1)
            cleaned.append(parts[1].strip() if len(parts) > 1 else stripped)
        else:
            cleaned.append(line)
    return '\n'.join(cleaned)
```

### Part 5 — IAM & CloudFormation

`infra/template.yaml` updates:
```yaml
# In AppBedrockRole's BedrockInvokePolicy.Statement, add:
- Effect: Allow
  Action:
    - bedrock:InvokeModel
  Resource:
    - "arn:aws:bedrock:us-west-2::foundation-model/stability.sd3-5-large-v1:0"
```

(All existing ARNs — Claude Haiku global profile, Titan v1/v2, Nova Canvas — stay in the policy unchanged.)

```yaml
# New function definition under Resources:
ScientificObjectGeneratorFunction:
  Type: AWS::Serverless::Function
  Properties:
    CodeUri: ../lambdas/scientific_object_generator/
    Handler: run.sh
    MemorySize: 512
    Timeout: 300
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

# Outputs section:
ScientificObjectGeneratorUrl:
  Value: !GetAtt ScientificObjectGeneratorFunctionUrl.FunctionUrl
```

**`.github/workflows/deploy.yml`** gains:
- `scientific_object_generator` in the `for fn in ...` loop that copies shared modules.
- `URL=$(get_output ScientificObjectGeneratorUrl); sed -i "s|__URL_SCIENTIFIC_OBJECT_GENERATOR__|$URL|g" frontend/config.js` step.

**`frontend/config.js`** gains `scientific_object_generator: '__URL_SCIENTIFIC_OBJECT_GENERATOR__'`.

### Part 6 — Lab Tools Entry Point

`lab-tools.html` gets a new tile-style CTA above the existing 3-tab layout, linking to the new feature. The existing Image Gen tab is **kept intact** so users with the old workflow muscle memory aren't broken.

Markup snippet:
```html
<section class="card scientific-object-cta">
  <div>
    <h2>🧰 Scientific Object Generator <span class="badge-new">NEW</span></h2>
    <p>Generate a high-fidelity image and an in-depth narrative description for any lab tool — material, sterility, safety, the works.</p>
  </div>
  <a class="btn btn-primary" href="lab-object.html">
    <span>✨</span><span>Open Generator</span>
  </a>
</section>
```

The existing tab bar and 3-tab content (Safety / Image Gen / What If) live below this CTA, untouched.

### Part 7 — Global Chat Greeting & Send-to-AI

`global-chat.js` adds two entries to `PAGE_GREETINGS`:
```js
'lab-object.html':         '🧰 Designing a lab tool? Tell me what you\'re working on.',
'lab-object-result.html':  '🧰 Reviewing your lab tool — ask me about material, handling, or safety.',
```

`lab-object-result.html`'s "Send to AI" button injects the rendered narrative into the global chat using:
```js
window.GlobalChat.injectContent(
  narrativeText,
  'experiment',                       // re-use the experiment source for the label
  '🧰 Lab Tool: ' + state.form.name
);
```

## Data Models

| Storage location          | Key / Output                              | Owner                 | Purpose                                              |
|---------------------------|-------------------------------------------|-----------------------|------------------------------------------------------|
| `sessionStorage`          | `vsl.scientificObject`                    | `lab-object.js`       | Carries form + approvedOverview between input/result pages. |
| In-memory                 | `state` (JS var on results page)          | `lab-object-result.html` | Hot copy used during the sequential pipeline.        |
| Lambda env                | `MODEL_ID` (existing)                     | `bedrock_stream.py`   | Same Claude Haiku 4.5 for overview + narrative.      |
| Lambda env (new)          | `IMAGE_MODEL_ID = stability.sd3-5-large-v1:0`<br>`IMAGE_REGION = us-west-2` | new Lambda `app.py` | Pinned image model & region.                  |
| CloudFormation Output     | `ScientificObjectGeneratorUrl`            | `infra/template.yaml` | Sed-injected into `frontend/config.js`.              |

`sessionStorage["vsl.scientificObject"]` shape:
```ts
type ScientificObjectState = {
  form: {
    name:       string;
    material:   string;
    purpose:    string;
    useCase:    string;
    appearance: string;
    sterility:  string;
    style:      string;
  };
  approvedOverview: string;
  ts: number;             // ms epoch — for stale-state cleanup if needed
};
```

## Error Handling

- **Required field missing on input page** → inline toast, no network call.
- **Overview LLM failure** → toast surfaces error, overview textarea remains empty, user can retry.
- **Empty overview at confirm time** → toast prompts user to edit or regenerate; navigation blocked.
- **Direct visit to results page with no state** → `#resultEmpty` panel shows with a back link; no errors thrown.
- **Image generation failure (network, model, safety reject)** → image surface shows error message + "Retry image" button. Narrative phase is **NOT** triggered. Only on a successful retry does the narrative phase proceed.
- **Bedrock `AccessDeniedException` on Stability SD 3.5 Large** → backend translates into a friendly "Stability SD 3.5 Large model access is not enabled in us-west-2 — please enable it in the Bedrock console (Model access page)." rather than the raw exception.
- **Image loaded but `<img>.onerror` fires (corrupt bytes)** → treated as image failure; narrative not triggered.
- **Narrative failure after image succeeded** → image stays on screen, narrative surface shows error + "Retry narrative" button. User can retry only the narrative.
- **User navigates away mid-pipeline** → both `AbortController`s fire `.abort()` so neither in-flight response writes to a stale page. `beforeunload` listener does the same.
- **Session storage corrupted/empty** → `JSON.parse` failure caught; treated as "no state" → empty-state panel.

## Correctness Properties

### Property 1: Required-field gate
**Validates: Requirements 1.4**

The "Generate Overview" button cannot trigger a network call when any of the three required fields (Lab Tool Name, Material, Scientific Purpose) is empty after `.trim()`. Validation runs on every click.

### Property 2: User-edited overview is the source of truth
**Validates: Requirements 2.5, 2.6**

When the "Confirm" button is clicked, the value passed forward to `sessionStorage` is exactly the current `value` of `#overviewText` — NOT the original AI response. The Lambda for the image and narrative modes receives `approvedOverview` from `sessionStorage`, not from any cached AI output.

### Property 3: Cross-page state contract
**Validates: Requirements 3.1, 3.2, 3.3**

The `sessionStorage["vsl.scientificObject"]` object is the ONLY data path between `lab-object.html` and `lab-object-result.html`. The results page reads it once on mount, validates the shape, and uses those values. No URL query strings, no global window properties.

### Property 4: Sequential pipeline (image before narrative)
**Validates: Requirements 4.1, 4.2, 4.3**

The narrative `fetch()` call is a `then` of (or `await`ed after) the image's `<img>.onload` Promise. There is no code path that fires the narrative request before `imageRendered === true`. If the image phase throws, narrative is skipped entirely and the surface shows a retry control.

### Property 5: Stability SD 3.5 Large pinned to us-west-2
**Validates: Requirements 5.1, 5.5**

The image client is constructed with `region_name="us-west-2"` and the model ID is exactly `"stability.sd3-5-large-v1:0"`. Both are present as constants — not env-var overrides — so a misconfigured environment can't silently switch back to Titan.

### Property 6: Skeleton placeholders, not spinners
**Validates: Requirements 6.1, 6.2, 6.3, 6.4**

While any AI call is in flight, the corresponding surface displays a sized, animated skeleton placeholder (image: aspect-ratio 1:1 shimmer block; narrative: 6 shimmer lines of varying widths; overview: 2 shimmer lines). No surface displays a generic full-page spinner overlay during AI loading.

### Property 7: Narrative renders as `<p>` only
**Validates: Requirements 7.5**

The narrative DOM tree under `#resultNarrative` after a successful response contains only `<p>` (and inline `<strong>`) elements. No `<ul>`, `<ol>`, `<li>`, or `<h*>` tags — even if the LLM returned them, the renderer strips bullet syntax and joins on blank lines into paragraphs.

### Property 8: Backend prompt enforces prose
**Validates: Requirements 7.1, 7.2, 7.3**

The narrative system prompt explicitly forbids bullets, numbered lists, and field-style labels, AND requires explanation of WHY a material was chosen. The post-response `_strip_residual_bullets` function provides a defensive backstop in case the model violates instructions.

### Property 9: Single new Lambda, three modes
**Validates: Requirements 8.1, 8.2, 8.5**

The implementation adds exactly one Lambda named `scientific_object_generator` whose handler dispatches on `mode in {"overview", "image", "narrative"}`. The legacy `image_generator` Lambda is not modified, deleted, or renamed. The legacy lab-tools.html "Image Gen" tab still calls `STREAM_URLS.image_generator` and works unchanged.

### Property 10: Abort on navigation
**Validates: Requirements 4.4**

Every in-flight `fetch()` on the results page is initiated with an `AbortController.signal`. The "Back to Setup" / "New Object" links call `controller.abort()` before navigating, AND a `window.addEventListener('beforeunload', ...)` handler does the same as a fallback for browser-driven navigation.

### Property 11: IAM addition is additive
**Validates: Requirements 5.5, 8.3**

The CloudFormation update adds the Stability SD 3.5 Large ARN to `AppBedrockRole`'s existing `BedrockInvokePolicy`. The previous resource ARNs (Claude global profile, Titan v1/v2, Nova Canvas) remain in the policy. No new role, no policy reorganization.

### Property 12: Page navigation is real, not SPA
**Validates: Requirements 3.5**

Routing between `lab-object.html` and `lab-object-result.html` uses `location.href = ...` (or anchor `<a href>`), producing real full-page reloads. There is no client-side router, no `history.pushState`. `sessionStorage` survives the reloads naturally.

## Testing Strategy

Manual smoke-tests:

1. **Form validation** — open `lab-object.html`, click "Generate Overview" with empty Name → toast "Missing required fields: name". Fill Name only → still missing Material/Purpose. Fill all three → succeeds.
2. **Overview generation** — fill all 7 fields → click Generate Overview → skeleton appears for 1-3s → editable textarea populates with a 1-3 sentence summary. Click Regenerate → confirm dialog only if user has manually edited.
3. **Overview editing** — manually rewrite the textarea content → click Confirm → results page receives the manually-edited string (verify by inspecting `sessionStorage` before navigation).
4. **Empty overview block** — clear the textarea → click Confirm → toast prompt, no navigation.
5. **Direct results page visit** — open `lab-object-result.html` without going through input → empty-state panel with "Back to Setup" link.
6. **Sequential pipeline** — open DevTools Network tab, complete the form, confirm → observe ONLY the image request fires first. Confirm narrative request fires AFTER image's `<img>.onload`. There is no overlap on the timeline.
7. **Image failure** — block the Lambda URL via DevTools request blocking → image shows error + "Retry image" button. Narrative skeleton remains, but the narrative request never fires.
8. **Image succeeds, narrative fails** — let image render, then block subsequent calls → narrative shows error + "Retry narrative" only. Image stays on screen.
9. **Stability SD 3.5 access denied** — temporarily revoke model access in Bedrock console → friendly "Model access not enabled in us-west-2 — please enable Stability SD 3.5 Large…" message renders.
10. **Skeleton visuals** — verify image skeleton is roughly square, narrative skeleton has multiple shimmer lines of varying widths, overview skeleton is 1-2 lines. None show a full-page spinner overlay.
11. **Narrative is paragraphs** — once narrative renders, inspect DOM at `#resultNarrative`. Tree contains only `<p>` and inline `<strong>` elements. No `<ul>`, `<ol>`, `<li>`, or `<h2>` etc.
12. **Material rationale** — narrative discusses WHY the material is suitable (e.g. polypropylene's chemical resistance, autoclavability) — not just naming the material.
13. **Abort on leave** — start narrative phase → click "New Object" mid-call → DevTools shows the request was cancelled, no error toast pops on the now-unmounted results page.
14. **Legacy Image Gen unaffected** — open `lab-tools.html` → Image Gen tab → enter concept, generate → existing Titan/Nova flow still works exactly as before.
15. **Send to AI** — click "Send to AI Lab Assistant" on the results page → global chat opens with a `🧰 Lab Tool: <name>` source-tagged bubble containing the narrative.

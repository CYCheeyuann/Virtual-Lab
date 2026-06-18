"""Scientific Object Generator — three-mode Lambda for the lab-tool flow.

Modes (selected via JSON body field "mode"):
  - overview  : Claude Haiku produces a 1–3 sentence summary of the lab tool.
                Lightweight (max 200 tokens). Used by the input page.
  - image     : Stability SD 3.5 Large (us-west-2) renders the tool image.
                Returns base64 PNG. Sequential — frontend awaits this.
  - narrative : Claude Haiku writes a 4–6 paragraph prose narrative covering
                what the tool is, how it's used, material properties, and
                safety/contamination concerns. NO bullet lists, NO field
                labels — strict prose.
"""

import json
import logging
import os
import sys

_shared = os.path.join(os.path.dirname(__file__), "..", "shared")
if os.path.isdir(_shared):
    sys.path.insert(0, _shared)

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from flask import Flask, request, Response

from cors import cors_headers, preflight_response
from validators import validate_api_key
from bedrock_stream import friendly_error

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.url_map.strict_slashes = False

# ── Config ──────────────────────────────────────────────────────────────────
TEXT_REGION   = os.environ.get("BEDROCK_REGION", "ap-southeast-1")
TEXT_MODEL_ID = os.environ.get("MODEL_ID",
                               "global.anthropic.claude-haiku-4-5-20251001-v1:0")

# Stability SD 3.5 Large is only available in us-west-2 at time of writing.
# Hard-coded (NOT env-overridable) per the spec — keeps a misconfigured env
# from silently swapping models.
IMAGE_REGION   = "us-west-2"
IMAGE_MODEL_ID = "stability.sd3-5-large-v1:0"

VALID_MODES = {"overview", "image", "narrative"}
VALID_STYLES = {
    "Photorealistic studio",
    "Scientific catalog photo",
    "Detailed 3D render",
    "Technical product illustration",
    "Microscope-style close-up",
}

_text_client = None
_image_client = None


def _get_text_client():
    global _text_client
    if _text_client is None:
        _text_client = boto3.client("bedrock-runtime", region_name=TEXT_REGION)
    return _text_client


def _get_image_client():
    """Pinned to us-west-2 with a long read timeout (image gen can take ~30s)."""
    global _image_client
    if _image_client is None:
        cfg = Config(
            region_name=IMAGE_REGION,
            connect_timeout=10,
            read_timeout=300,
            retries={"max_attempts": 2, "mode": "standard"},
        )
        _image_client = boto3.client("bedrock-runtime", config=cfg)
    return _image_client


# ── Helpers ─────────────────────────────────────────────────────────────────
def _err(msg, status=400):
    h = cors_headers()
    h["Content-Type"] = "application/json"
    return Response(json.dumps({"error": msg}), status=status, headers=h)


def _json(payload, status=200):
    h = cors_headers()
    h["Content-Type"] = "application/json"
    return Response(json.dumps(payload), status=status, headers=h)


def _bedrock_err(err, hint=None):
    code = err.response.get("Error", {}).get("Code", "")
    msg = err.response.get("Error", {}).get("Message", str(err))
    logger.exception("Bedrock ClientError code=%s message=%s", code, msg)
    # Both AccessDeniedException AND ResourceNotFoundException can mean
    # "Stability SD 3.5 Large model access is not granted in us-west-2".
    # Bedrock returns ResourceNotFoundException when model access has never
    # been requested (it treats the model as non-existent for your account).
    is_stability_call = "stability" in (msg or "").lower() or "sd3" in (msg or "").lower()
    if code in ("AccessDeniedException", "ResourceNotFoundException") and (
        is_stability_call or _suspect_image_call()
    ):
        friendly = (
            "⚠️ Stability SD 3.5 Large is not accessible in us-west-2. Open the "
            "AWS Console → Bedrock (us-west-2) → Model access page, request "
            "access to 'Stable Diffusion 3.5 Large' from Stability AI, accept "
            "the EULA, then retry. Approval is usually instant."
        )
    else:
        friendly = friendly_error(code, msg)
    payload = {"error": friendly, "code": code}
    if hint:
        payload.update(hint)
    return _json(payload, status=500)


def _suspect_image_call():
    """Heuristic: if the failing path was the image handler, the only Bedrock
    model in play is Stability — surface the Stability hint regardless of
    whether the message body mentions it explicitly."""
    try:
        import sys, traceback
        frames = traceback.extract_stack()
        return any("_handle_image" in f.name for f in frames)
    except Exception:
        return False


def _safe_str(v, max_len=600):
    if v is None:
        return ""
    s = str(v).strip()
    if len(s) > max_len:
        s = s[:max_len]
    return s


def _form_dict(body):
    """Sanitize the structured form sent from the frontend."""
    raw = body.get("form") or {}
    if not isinstance(raw, dict):
        raw = {}
    style = _safe_str(raw.get("style"), 80) or "Photorealistic studio"
    if style not in VALID_STYLES:
        style = "Photorealistic studio"
    return {
        "name":       _safe_str(raw.get("name"),       200),
        "material":   _safe_str(raw.get("material"),   200),
        "purpose":    _safe_str(raw.get("purpose"),    400),
        "useCase":    _safe_str(raw.get("useCase"),    400),
        "appearance": _safe_str(raw.get("appearance"), 400),
        "sterility":  _safe_str(raw.get("sterility"),  400),
        "style":      style,
    }


# ── Routes ──────────────────────────────────────────────────────────────────
@app.route("/", defaults={"path": ""}, methods=["GET", "POST", "OPTIONS"])
@app.route("/<path:path>", methods=["GET", "POST", "OPTIONS"])
def handler(path):
    if request.method == "OPTIONS":
        return preflight_response()
    if request.method == "GET":
        return Response("Scientific Object Generator ready", status=200,
                        headers=cors_headers())

    if not validate_api_key(request):
        return _err("Unauthorized", 401)

    body = request.get_json(force=True, silent=True) or {}
    mode = body.get("mode")
    if mode not in VALID_MODES:
        return _err(f"Unknown mode: {mode}")

    if mode == "overview":
        return _handle_overview(body)
    elif mode == "image":
        return _handle_image(body)
    else:
        return _handle_narrative(body)


# ── Mode 1: overview (Claude, 1–3 sentences) ───────────────────────────────
_OVERVIEW_SYSTEM = (
    "You produce a single concise 1–3 sentence description of a lab tool, "
    "aimed at a researcher or upper-level student. Plain prose only — no "
    "bullets, no markdown, no headings, no labelled fields. Focus on what "
    "the tool is and its key visual/functional attributes derived from the "
    "inputs. Output the sentences only — no preamble."
)


def _handle_overview(body):
    form = _form_dict(body)
    if not form["name"] or not form["material"] or not form["purpose"]:
        return _err("name, material, and purpose are required")

    user_prompt = (
        "Create a 1–3 sentence overview of this lab tool:\n"
        f"  Name:       {form['name']}\n"
        f"  Material:   {form['material']}\n"
        f"  Purpose:    {form['purpose']}\n"
        f"  Use case:   {form['useCase'] or '(not specified)'}\n"
        f"  Appearance: {form['appearance'] or '(not specified)'}\n"
        f"  Sterility:  {form['sterility'] or '(not specified)'}\n"
        f"  Style:      {form['style']}\n\n"
        "Output only the overview sentences."
    )

    try:
        text = _claude_text(_OVERVIEW_SYSTEM, user_prompt, max_tokens=240)
    except ClientError as e:
        return _bedrock_err(e)
    except Exception as e:  # noqa: BLE001
        logger.exception("Overview generation failed")
        return _err(f"Overview failed: {type(e).__name__}", 500)

    # Strip any markdown leakage just in case
    overview = (text or "").strip()
    if overview.startswith("```"):
        overview = overview.strip("`")
    return _json({"overview": overview})


# ── Mode 2: image (Stability SD 3.5 Large, us-west-2) ──────────────────────
def _handle_image(body):
    form = _form_dict(body)
    overview = _safe_str(body.get("approvedOverview"), 1500)
    if not overview:
        return _err("approvedOverview is required for image mode")

    prompt = _compose_image_prompt(form, overview)
    negative = (
        "text, watermark, logo, signature, blurry, distorted proportions, "
        "low quality, low resolution, deformed, cartoonish artifacts"
    )

    client = _get_image_client()
    req_body = {
        "prompt": prompt[:4500],
        "negative_prompt": negative,
        "mode": "text-to-image",
        "aspect_ratio": "1:1",
        "output_format": "png",
        "seed": 42,
    }

    try:
        resp = client.invoke_model(
            modelId=IMAGE_MODEL_ID,
            body=json.dumps(req_body),
            accept="application/json",
            contentType="application/json",
        )
        payload = json.loads(resp["body"].read())
    except ClientError as e:
        return _bedrock_err(e, hint={"prompt_used": prompt})
    except Exception as e:  # noqa: BLE001
        logger.exception("Image step failed")
        return _err(f"Image failed: {type(e).__name__}", 500)

    b64 = _extract_image_b64(payload)
    if not b64:
        # Stability sometimes returns a structured error in `errors` or `error`.
        err_msg = payload.get("error") or payload.get("errors") or payload
        logger.warning("No image in Stability response: %r", err_msg)
        return _err(f"Image model returned no image: {err_msg!r}", 500)

    return _json({
        "image_base64": b64,
        "prompt_used": prompt,
        "model": IMAGE_MODEL_ID,
    })


def _compose_image_prompt(form, overview):
    """Build a single rich prompt string for SD 3.5 Large."""
    style = form["style"] or "Photorealistic studio"
    parts = [
        f"{style}: {overview}",
        f"Material: {form['material']}." if form["material"] else "",
        f"Physical features: {form['appearance']}." if form["appearance"] else "",
        f"Use case: {form['useCase']}." if form["useCase"] else "",
        ("Setting: a clean laboratory bench, soft neutral studio lighting, "
         "sharp focus, accurate scientific proportions, suitable for a "
         "scientific catalog. No text overlays, no labels, no logos."),
    ]
    return " ".join(p for p in parts if p)


def _extract_image_b64(payload):
    """SD 3.5 Large via Bedrock returns a few possible shapes; handle them."""
    if not isinstance(payload, dict):
        return None
    # Common Stability shape used by Bedrock: {"images": ["<b64>"]}
    if isinstance(payload.get("images"), list) and payload["images"]:
        first = payload["images"][0]
        if isinstance(first, str):
            return first
    # Legacy "artifacts" shape: {"artifacts": [{"base64": "..."}]}
    arts = payload.get("artifacts")
    if isinstance(arts, list) and arts:
        a0 = arts[0]
        if isinstance(a0, dict):
            return a0.get("base64") or a0.get("base64_image")
    # Some endpoints wrap under "output"
    out = payload.get("output")
    if isinstance(out, dict):
        return _extract_image_b64(out)
    return None


# ── Mode 3: narrative (Claude, paragraph prose) ─────────────────────────────
_NARRATIVE_SYSTEM = (
    "You write detailed scientific narratives about lab tools.\n"
    "Output rules — apply ALL of them:\n"
    "  1. Produce 4 to 6 SUBSTANTIVE PARAGRAPHS of connected prose.\n"
    "  2. Do NOT use bullet points, numbered lists, or section headings.\n"
    "  3. Do NOT label fields like 'Material:' or 'Use:' as standalone lines.\n"
    "  4. Cover, woven into prose: (a) what the tool is and its physical form; "
    "(b) realistic lab use; (c) material properties relevant to handling, "
    "cleaning, and reagent compatibility; (d) safety, sterility, contamination, "
    "and thermal/chemical limits a user must know.\n"
    "  5. When you mention a material, explain WHY it was chosen and what "
    "practical limitations it implies — never just name the material.\n"
    "  6. Use **bold** sparingly to emphasize at most 4–6 key technical terms.\n"
    "  7. Tone: informative, professional, suitable for a researcher, "
    "technician, or upper-level student. Output only the narrative."
)


def _handle_narrative(body):
    form = _form_dict(body)
    overview = _safe_str(body.get("approvedOverview"), 1500)
    if not overview:
        return _err("approvedOverview is required for narrative mode")

    user_prompt = (
        "Context — produce a paragraph-form narrative consistent with this "
        "lab-tool subject:\n\n"
        f"Approved overview: {overview}\n"
        f"Lab tool name: {form['name']}\n"
        f"Material: {form['material']}\n"
        f"Scientific purpose: {form['purpose']}\n"
        f"Biological/chemical use case: {form['useCase'] or '(not specified)'}\n"
        f"Physical appearance: {form['appearance'] or '(not specified)'}\n"
        f"Sterility / safety context: {form['sterility'] or '(not specified)'}\n\n"
        "Write the 4–6 paragraph narrative now."
    )

    try:
        text = _claude_text(_NARRATIVE_SYSTEM, user_prompt, max_tokens=2400)
    except ClientError as e:
        return _bedrock_err(e)
    except Exception as e:  # noqa: BLE001
        logger.exception("Narrative generation failed")
        return _err(f"Narrative failed: {type(e).__name__}", 500)

    cleaned = _strip_residual_bullets(text or "")
    return _json({"narrative": cleaned})


def _strip_residual_bullets(text):
    """Backstop: strip any markdown bullet/list syntax the model may still emit."""
    if not text:
        return ""
    out_lines = []
    for raw in text.splitlines():
        stripped = raw.lstrip()
        if stripped.startswith(("- ", "* ", "+ ")):
            out_lines.append(stripped[2:])
            continue
        # "1. Foo", "2) Foo" → "Foo"
        if len(stripped) >= 3 and stripped[0].isdigit():
            for sep in (". ", ") "):
                idx = stripped.find(sep)
                if 0 < idx <= 3 and stripped[:idx].isdigit():
                    out_lines.append(stripped[idx + len(sep):])
                    break
            else:
                out_lines.append(raw)
            continue
        # Strip standalone field labels at line start: "Material: …" → "…"
        # Only if the line is a pure label-style line and the label matches a
        # well-known field — this prevents accidentally chewing legitimate prose.
        labels = ("Material:", "Use:", "Purpose:", "Warning:", "Safety:",
                  "Appearance:", "Sterility:")
        for lbl in labels:
            if stripped.startswith(lbl):
                rest = stripped[len(lbl):].strip()
                # Only rewrite if the line is short enough to be a "label line"
                if rest and len(rest) > 0 and len(stripped) < 200:
                    out_lines.append(rest)
                    break
        else:
            out_lines.append(raw)
    return "\n".join(out_lines).strip()


# ── Claude text helper ──────────────────────────────────────────────────────
def _claude_text(system_prompt, user_prompt, max_tokens=1500):
    client = _get_text_client()
    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": max_tokens,
        "system": system_prompt,
        "messages": [
            {"role": "user", "content": [{"type": "text", "text": user_prompt}]}
        ],
    }
    resp = client.invoke_model(modelId=TEXT_MODEL_ID, body=json.dumps(body))
    payload = json.loads(resp["body"].read())
    return "".join(
        b.get("text", "")
        for b in (payload.get("content") or [])
        if b.get("type") == "text"
    ).strip()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)

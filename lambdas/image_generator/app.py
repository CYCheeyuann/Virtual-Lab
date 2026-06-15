"""Science Image Generator — two-step pipeline.

Step 1: Claude (synchronous) generates a markdown scientific explanation
        plus an optimised English image prompt.
Step 2: Titan Image Generator v2 turns that prompt into a base64 PNG.

Returns a single JSON document — text and image cannot share a stream.
"""

import json
import logging
import os
import sys

_shared = os.path.join(os.path.dirname(__file__), "..", "shared")
if os.path.isdir(_shared):
    sys.path.insert(0, _shared)

import boto3
from botocore.exceptions import ClientError
from flask import Flask, request, Response

from cors import cors_headers, preflight_response
from validators import validate_api_key, sanitize_subject, sanitize_topic

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.url_map.strict_slashes = False

# ── Config ───────────────────────────────────────────────────────────────────
REGION         = os.environ.get("BEDROCK_REGION", "ap-southeast-1")
TEXT_MODEL_ID  = os.environ.get("MODEL_ID",      "anthropic.claude-haiku-4-5-20250609-v1:0")
IMAGE_MODEL_ID = os.environ.get("IMAGE_MODEL_ID","amazon.titan-image-generator-v2:0")

VALID_STYLES = {
    "Scientific Diagram", "Textbook Illustration", "3D Render",
    "Microscope View", "Space Photo", "Cartoon Educational",
}
VALID_DETAILS = {"Simple", "Detailed", "Advanced"}

_client = None
def _get_client():
    global _client
    if _client is None:
        _client = boto3.client("bedrock-runtime", region_name=REGION)
    return _client


# ── Routes ───────────────────────────────────────────────────────────────────
@app.route("/", defaults={"path": ""}, methods=["GET", "POST", "OPTIONS"])
@app.route("/<path:path>", methods=["GET", "POST", "OPTIONS"])
def handler(path):
    if request.method == "OPTIONS":
        return preflight_response()
    if request.method == "GET":
        return Response("Image Generator ready", status=200, headers=cors_headers())

    if not validate_api_key(request):
        return _json_response({"error": "Unauthorized"}, status=401)

    body    = request.get_json(force=True, silent=True) or {}
    subject = sanitize_subject(body.get("subject", ""))
    concept = sanitize_topic(body.get("concept", ""), max_len=300)
    style   = body.get("style", "Scientific Diagram")
    detail  = body.get("detail", "Detailed")
    if style  not in VALID_STYLES:  style  = "Scientific Diagram"
    if detail not in VALID_DETAILS: detail = "Detailed"

    if not concept:
        return _json_response({"error": "concept is required"}, status=400)

    logger.info("Image gen subject=%s concept=%s style=%s detail=%s",
                subject, concept, style, detail)

    # Step 1 — Claude
    try:
        explanation, image_prompt = _claude_step(subject, concept, style, detail)
    except ClientError as e:
        return _bedrock_error("Claude prompt generation failed", e)
    except Exception as e:           # noqa: BLE001
        logger.exception("Claude step failed")
        return _json_response(
            {"error": f"Claude prompt generation failed: {type(e).__name__}: {e}"},
            status=500,
        )

    # Step 2 — Titan Image
    try:
        image_b64 = _titan_step(image_prompt)
    except ClientError as e:
        return _bedrock_error("Titan image generation failed", e, fallback_text=explanation,
                              prompt_used=image_prompt)
    except Exception as e:           # noqa: BLE001
        logger.exception("Titan step failed")
        return _json_response(
            {
                "error": f"Titan image generation failed: {type(e).__name__}: {e}",
                "explanation": explanation,
                "prompt_used": image_prompt,
            },
            status=500,
        )

    return _json_response({
        "explanation": explanation,
        "image_base64": image_b64,
        "prompt_used": image_prompt,
    })


# ── Step 1: Claude (synchronous) ─────────────────────────────────────────────
_CLAUDE_SYSTEM = (
    "You are a science visualisation expert. For each request, output a single "
    "JSON object with EXACTLY these two string keys:\n"
    '  "explanation"  — markdown-formatted scientific explanation (150–250 words) '
    "with short headings (## / ###) and bullet points. Be accurate and engaging.\n"
    '  "image_prompt" — detailed English prompt for an image-generation model '
    "(< 450 characters). Describe subject, composition, perspective, lighting, "
    "labelled features, and visual style. No camera brand names. No text overlays "
    "unless the style demands them.\n"
    "Output ONLY the JSON object — no prose, no markdown fences."
)


def _claude_step(subject, concept, style, detail):
    client = _get_client()
    user = (
        f"Subject: {subject}\n"
        f"Concept: {concept}\n"
        f"Visual style: {style}\n"
        f"Detail level: {detail}\n\n"
        "Return JSON now."
    )
    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 1500,
        "system": _CLAUDE_SYSTEM,
        "messages": [{"role": "user", "content": [{"type": "text", "text": user}]}],
    }
    resp    = client.invoke_model(modelId=TEXT_MODEL_ID, body=json.dumps(body))
    payload = json.loads(resp["body"].read())
    text    = "".join(b.get("text", "")
                      for b in (payload.get("content") or [])
                      if b.get("type") == "text").strip()
    return _extract_json(text, concept, style, detail)


def _extract_json(text, concept, style, detail):
    """Robustly extract { explanation, image_prompt } from Claude output."""
    cleaned = (text or "").strip()
    # Strip ```json … ``` fences if present
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3].rstrip()

    obj = None
    try:
        obj = json.loads(cleaned)
    except json.JSONDecodeError:
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if 0 <= start < end:
            try:
                obj = json.loads(cleaned[start:end + 1])
            except json.JSONDecodeError:
                obj = None

    if isinstance(obj, dict):
        explanation = (obj.get("explanation") or "").strip()
        prompt      = (obj.get("image_prompt") or "").strip()
    else:
        explanation, prompt = "", ""

    return (
        explanation or _fallback_explanation(concept, style),
        prompt      or _fallback_prompt(concept, style, detail),
    )


def _fallback_explanation(concept, style):
    return (
        f"## {concept}\n\n"
        f"*A {style.lower()} visualising **{concept}**. "
        "Detailed text explanation could not be parsed — the image below "
        "still represents the requested concept.*"
    )


def _fallback_prompt(concept, style, detail):
    return (
        f"{detail.lower()} {style.lower()} of {concept}, "
        "clear composition, accurate proportions, educational labels, "
        "high-quality scientific illustration"
    )


# ── Step 2: Titan Image v2 ───────────────────────────────────────────────────
def _titan_step(prompt):
    client = _get_client()
    body = {
        "taskType": "TEXT_IMAGE",
        "textToImageParams": {"text": prompt[:1024]},
        "imageGenerationConfig": {
            "numberOfImages": 1,
            "height": 1024,
            "width": 1024,
            "cfgScale": 8.0,
            "seed": 42,
        },
    }
    resp    = client.invoke_model(modelId=IMAGE_MODEL_ID, body=json.dumps(body))
    payload = json.loads(resp["body"].read())
    images  = payload.get("images") or []
    if not images:
        raise RuntimeError(f"Titan returned no images: {payload!r}")
    return images[0]


# ── Helpers ──────────────────────────────────────────────────────────────────
def _json_response(obj, status=200):
    headers = cors_headers()
    headers["Content-Type"] = "application/json"
    return Response(json.dumps(obj), status=status, headers=headers)


def _bedrock_error(prefix, err, fallback_text=None, prompt_used=None):
    code = err.response.get("Error", {}).get("Code", "")
    msg  = err.response.get("Error", {}).get("Message", str(err))
    logger.exception("%s code=%s message=%s", prefix, code, msg)
    payload = {"error": f"{prefix} ({code}): {msg}"}
    if fallback_text is not None: payload["explanation"]  = fallback_text
    if prompt_used   is not None: payload["prompt_used"]  = prompt_used
    return _json_response(payload, status=500)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)

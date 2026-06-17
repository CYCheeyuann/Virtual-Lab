"""Experiment Guide — three modes:

  - mode="validate"  : tiny pre-flight check; returns
                       {valid: true, summary: "..."} or {valid: false, error: "..."}
  - mode="node_map"  : full eight-section experiment guide as a strict JSON object
                       {topic_title, sections: {objective, materials, safety,
                       procedure, expected_results, scientific_explanation,
                       real_life_applications, summary}}
  - default          : legacy streaming markdown (kept for backward compatibility)
"""

import json
import logging
import os
import sys

_shared = os.path.join(os.path.dirname(__file__), "..", "shared")
if os.path.isdir(_shared):
    sys.path.insert(0, _shared)

from flask import Flask, request, Response, stream_with_context
from cors import cors_headers, preflight_response
from validators import (
    validate_api_key, sanitize_subject, sanitize_difficulty,
    sanitize_topic, validate_file,
)
from bedrock_stream import stream_bedrock, get_client, MODEL_ID

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.url_map.strict_slashes = False


SECTION_KEYS = [
    "objective", "materials", "safety", "procedure",
    "expected_results", "scientific_explanation",
    "real_life_applications", "summary",
]


def _err(msg, status=400):
    h = cors_headers()
    h["Content-Type"] = "application/json"
    return Response(json.dumps({"error": msg}), status=status, headers=h)


def _json(payload, status=200):
    h = cors_headers()
    h["Content-Type"] = "application/json"
    return Response(json.dumps(payload), status=status, headers=h)


@app.route("/", defaults={"path": ""}, methods=["GET", "POST", "OPTIONS"])
@app.route("/<path:path>", methods=["GET", "POST", "OPTIONS"])
def handler(path):
    if request.method == "OPTIONS":
        return preflight_response()
    if request.method == "GET":
        return Response("Experiment Guide ready", status=200, headers=cors_headers())

    if not validate_api_key(request):
        return _err("Unauthorized", 401)

    body = request.get_json(force=True, silent=True) or {}
    mode = body.get("mode", "stream")

    if mode == "validate":
        return _handle_validate(body)
    elif mode == "node_map":
        return _handle_node_map(body)
    else:
        return _handle_legacy_stream(body)


# ── Mode: validate ──────────────────────────────────────────────────────────

def _handle_validate(body):
    subject    = sanitize_subject(body.get("subject", ""))
    topic      = sanitize_topic(body.get("topic", ""))
    difficulty = sanitize_difficulty(body.get("difficulty", ""))
    file_data  = body.get("file_data")
    file_mime  = body.get("file_mime")
    file_name  = sanitize_topic(body.get("file_name", ""), max_len=255) or "uploaded_file"

    _, file_err = validate_file(file_data, file_mime)
    if file_err:
        return _err(file_err, 413)

    if not topic:
        return _json({"valid": False, "error": "Please provide an experiment topic."})

    has_file = bool(file_data and file_mime)

    prompt = (
        f"You are a science lab instructor. The user wants an experiment guide for:\n"
        f"  Subject: {subject}\n"
        f"  Topic: {topic}\n"
        f"  Difficulty: {difficulty}\n"
    )
    if has_file:
        prompt += (
            f"  Document attached: a {file_mime} file titled '{file_name}'. "
            "Briefly assess if the document is science-related.\n"
        )
    prompt += (
        "\nRespond ONLY in compact JSON:\n"
        '{"valid": true, "summary": "<one sentence about what you will produce>"}\n'
        "OR (only if a file was attached AND it is clearly NOT science-related):\n"
        '{"valid": false, "error": "<one sentence explaining the rejection>"}\n'
        "\nDo not include markdown fences. Do not include any text outside the JSON."
    )

    content_blocks = []
    if has_file:
        if file_mime.startswith("image/"):
            content_blocks.append({
                "type": "image",
                "source": {"type": "base64", "media_type": file_mime, "data": file_data},
            })
        else:
            content_blocks.append({
                "type": "document",
                "source": {"type": "base64", "media_type": file_mime, "data": file_data},
                "title": file_name,
            })
    content_blocks.append({"type": "text", "text": prompt})

    client = get_client()
    invoke_body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 300,
        "messages": [{"role": "user", "content": content_blocks}],
    }
    try:
        resp = client.invoke_model(modelId=MODEL_ID, body=json.dumps(invoke_body))
        payload = json.loads(resp["body"].read())
        text = "".join(
            b.get("text", "") for b in (payload.get("content") or [])
            if b.get("type") == "text"
        ).strip()
    except Exception as e:
        logger.exception("Validate call failed")
        return _err(f"Validation failed: {type(e).__name__}", 500)

    parsed = _strip_and_parse_json(text)
    if isinstance(parsed, dict) and "valid" in parsed:
        return _json(parsed)
    # Fallback: if model didn't return clean JSON, treat as valid with a synthesized summary
    summary = (
        f"Proceeding to generate a complete interactive {subject} experiment guide on {topic} "
        f"at {difficulty} level."
    )
    return _json({"valid": True, "summary": summary})


# ── Mode: node_map ─────────────────────────────────────────────────────────

_NODE_SYSTEM = """You are an expert science educator and lab instructor. You
MUST output ONLY a single valid JSON object — no markdown fences, no preamble,
no commentary outside the JSON.

The JSON object MUST have exactly two keys at the top level:
  "topic_title"  — string, e.g. "Circular Motion Experiment"
  "sections"     — object with EXACTLY these eight keys:
                     "objective", "materials", "safety", "procedure",
                     "expected_results", "scientific_explanation",
                     "real_life_applications", "summary"

Each section is a string of plain text or simple markdown (bullets with "- ",
numbered steps "1. ", and **bold** for key terms). Each section should be
100-400 words, focused only on its named role. Do not repeat the topic title
inside section bodies."""


def _handle_node_map(body):
    subject    = sanitize_subject(body.get("subject", ""))
    topic      = sanitize_topic(body.get("topic", ""))
    difficulty = sanitize_difficulty(body.get("difficulty", ""))
    file_data  = body.get("file_data")
    file_mime  = body.get("file_mime")
    file_name  = sanitize_topic(body.get("file_name", ""), max_len=255) or "uploaded_file"

    _, file_err = validate_file(file_data, file_mime)
    if file_err:
        return _err(file_err, 413)

    if not topic:
        return _err("Please provide an experiment topic.")

    user_prompt = (
        f"Subject: {subject}\n"
        f"Topic: {topic}\n"
        f"Difficulty: {difficulty}\n\n"
        f"Generate the JSON experiment guide now."
    )

    content_blocks = []
    if file_data and file_mime:
        if file_mime.startswith("image/"):
            content_blocks.append({
                "type": "image",
                "source": {"type": "base64", "media_type": file_mime, "data": file_data},
            })
        else:
            content_blocks.append({
                "type": "document",
                "source": {"type": "base64", "media_type": file_mime, "data": file_data},
                "title": file_name,
            })
    content_blocks.append({"type": "text", "text": user_prompt})

    client = get_client()
    invoke_body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 8000,
        "system": _NODE_SYSTEM,
        "messages": [{"role": "user", "content": content_blocks}],
    }
    try:
        resp = client.invoke_model(modelId=MODEL_ID, body=json.dumps(invoke_body))
        payload = json.loads(resp["body"].read())
        text = "".join(
            b.get("text", "") for b in (payload.get("content") or [])
            if b.get("type") == "text"
        ).strip()
    except Exception as e:
        logger.exception("Node-map generation failed")
        return _err(f"Generation failed: {type(e).__name__}", 500)

    parsed = _strip_and_parse_json(text)
    if not isinstance(parsed, dict) or "sections" not in parsed:
        # Soft failure — return the raw so frontend can show retry UI
        return _json({"error": "Could not parse experiment guide. Try again.", "raw": text})

    # Defensive cleanup: ensure all 8 sections exist; truncate runaway sections.
    sections_in = parsed.get("sections") or {}
    sections_out = {}
    for k in SECTION_KEYS:
        v = sections_in.get(k) or ""
        if not isinstance(v, str):
            v = str(v)
        sections_out[k] = v.strip()[:4000]

    return _json({
        "topic_title": str(parsed.get("topic_title") or f"{topic} Experiment").strip()[:200],
        "sections": sections_out,
    })


# ── Mode: legacy streaming markdown (unchanged behaviour) ──────────────────

def _handle_legacy_stream(body):
    subject    = sanitize_subject(body.get("subject", ""))
    topic      = sanitize_topic(body.get("topic", ""))
    difficulty = sanitize_difficulty(body.get("difficulty", ""))
    file_data  = body.get("file_data")
    file_mime  = body.get("file_mime")
    file_name  = sanitize_topic(body.get("file_name", ""), max_len=255) or "uploaded_file"

    _, file_err = validate_file(file_data, file_mime)
    if file_err:
        return _err(file_err, 413)

    prompt = f"""You are an expert science educator and lab instructor.

Generate a complete experiment guide:
Subject: {subject}
Difficulty: {difficulty}
Topic: {topic}

Sections:

🎯 Objective — purpose and learning goal.

🧰 Materials — everything needed with quantities.

🔬 Procedure — numbered step-by-step instructions.

⚠️ Safety Briefing — list each hazard and precaution.

📊 Expected Results — what to observe and measure.

🧠 Scientific Explanation — underlying concepts.

🌍 Real-Life Applications — 3-4 real-world examples.

📝 Summary — 2-3 sentence recap.

Make it educational, accurate, and exciting."""

    content_blocks = []
    if file_data and file_mime:
        if file_mime.startswith("image/"):
            content_blocks.append({
                "type": "image",
                "source": {"type": "base64", "media_type": file_mime, "data": file_data},
            })
        else:
            content_blocks.append({
                "type": "document",
                "source": {"type": "base64", "media_type": file_mime, "data": file_data},
                "title": file_name,
            })
    content_blocks.append({"type": "text", "text": prompt})
    messages = [{"role": "user", "content": content_blocks}]

    headers = cors_headers()
    headers["Content-Type"] = "text/plain; charset=utf-8"
    return Response(stream_with_context(stream_bedrock(messages)), headers=headers)


# ── Helpers ────────────────────────────────────────────────────────────────

def _strip_and_parse_json(text):
    """Strip optional ```json fences and parse. Returns dict/list or None on failure."""
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        # Drop the opening fence line and any trailing fence
        first_newline = cleaned.find("\n")
        if first_newline != -1:
            cleaned = cleaned[first_newline + 1:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3].rstrip()
    try:
        return json.loads(cleaned)
    except (json.JSONDecodeError, ValueError):
        return None


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)

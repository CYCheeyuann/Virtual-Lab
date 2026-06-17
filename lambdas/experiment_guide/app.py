"""Experiment Guide — generates a STRUCTURED JSON lab guide with 8 sections.

The frontend renders this as a node-map (1 central node + 8 children) so the
response shape is fixed: {topic, subject, difficulty, sections: {...}}.
"""

import json
import logging
import os
import sys

_shared = os.path.join(os.path.dirname(__file__), "..", "shared")
if os.path.isdir(_shared):
    sys.path.insert(0, _shared)

from flask import Flask, request, Response
from cors import cors_headers, preflight_response
from validators import (
    validate_api_key, sanitize_subject, sanitize_difficulty,
    sanitize_topic, validate_file,
)
from bedrock_stream import get_client, MODEL_ID

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.url_map.strict_slashes = False


SECTION_KEYS = [
    "objective", "materials", "safety", "procedure",
    "expected_results", "explanation", "applications", "summary",
]


def _err(msg, status=400):
    h = cors_headers()
    h["Content-Type"] = "application/json"
    return Response(json.dumps({"error": msg}), status=status, headers=h)


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
    subject    = sanitize_subject(body.get("subject", ""))
    topic      = sanitize_topic(body.get("topic", ""))
    difficulty = sanitize_difficulty(body.get("difficulty", ""))
    file_data  = body.get("file_data")
    file_mime  = body.get("file_mime")
    file_name  = sanitize_topic(body.get("file_name", ""), max_len=255) or "uploaded_file"

    if not topic:
        return _err("`topic` is required")

    logger.info("Experiment request subject=%s topic=%s diff=%s file=%s",
                subject, topic, difficulty, bool(file_data))

    # File validation (non-fatal: client will see the parsed status in JSON)
    file_status = "none"
    if file_data:
        _, file_err = validate_file(file_data, file_mime)
        if file_err:
            return _err(file_err, 413)
        file_status = "validated"

    system_prompt = """You are an expert science educator writing a structured
lab experiment guide. You MUST return ONLY a valid JSON object — no markdown
fences, no preamble, no commentary.

The JSON object MUST have exactly these top-level keys:
  "topic"      — the experiment title (string)
  "subject"    — Biology / Chemistry / Physics / Science (string)
  "difficulty" — the difficulty level (string)
  "doc_summary" — short note about any uploaded reference document, or empty string
  "sections"   — object with EXACTLY these 8 keys, each mapping to a string of
                 detailed content (markdown-style with **bold** terms allowed):
      "objective"        — purpose and learning goal (2-4 sentences)
      "materials"        — list materials with quantities (markdown bullet list)
      "safety"           — list each hazard and precaution (markdown bullet list)
      "procedure"        — numbered step-by-step instructions
      "expected_results" — what to observe and measure (2-5 sentences)
      "explanation"      — underlying scientific concepts (3-6 sentences)
      "applications"     — 3-4 real-world examples (markdown bullet list)
      "summary"          — 2-3 sentence recap

If a non-science document is uploaded, return:
  {"error": "Uploaded document is not science-related"}
instead of the structure above.

Be educational, accurate, and exciting. Bold the most important scientific terms
inline with **double-asterisks** so the frontend can highlight them."""

    user_prompt = f"""Subject: {subject}
Topic: {topic}
Difficulty: {difficulty}

Generate the experiment guide JSON now. Return ONLY the JSON object."""

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
    messages = [{"role": "user", "content": content_blocks}]

    client = get_client()
    invoke_body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 8000,
        "system": system_prompt,
        "messages": messages,
    }

    try:
        resp = client.invoke_model(modelId=MODEL_ID, body=json.dumps(invoke_body))
        payload = json.loads(resp["body"].read())
        text = "".join(
            b.get("text", "") for b in (payload.get("content") or [])
            if b.get("type") == "text"
        ).strip()
    except Exception as e:
        logger.exception("Experiment generation failed")
        return _err(f"Generation failed: {type(e).__name__}", 500)

    cleaned = text
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3].rstrip()

    try:
        guide = json.loads(cleaned)
    except json.JSONDecodeError as e:
        logger.warning("Experiment JSON parse failed: %s | raw=%s", e, text[:200])
        h = cors_headers()
        h["Content-Type"] = "application/json"
        return Response(json.dumps({
            "error": "Guide format could not be parsed. Try again.",
            "raw": text,
        }), status=200, headers=h)

    # Pass through model-rejection of non-science documents
    if isinstance(guide, dict) and guide.get("error") and not guide.get("sections"):
        return _err(guide["error"], 400)

    if not isinstance(guide, dict) or "sections" not in guide:
        return _err("Generated guide missing sections", 502)

    sections = guide.get("sections") or {}
    # Ensure all 8 keys exist (fill blanks rather than error so the UI degrades gracefully)
    for k in SECTION_KEYS:
        if k not in sections or not isinstance(sections[k], str):
            sections[k] = ""

    out = {
        "topic":       guide.get("topic") or topic,
        "subject":     guide.get("subject") or subject,
        "difficulty":  guide.get("difficulty") or difficulty,
        "doc_summary": guide.get("doc_summary") or "",
        "doc_status":  file_status,
        "sections":    {k: sections[k] for k in SECTION_KEYS},
    }

    h = cors_headers()
    h["Content-Type"] = "application/json"
    return Response(json.dumps(out), status=200, headers=h)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)

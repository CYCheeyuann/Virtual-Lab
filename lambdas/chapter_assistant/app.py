"""Chapter Assistant — multi-mode JSON + streaming chapter overview system.

Actions:
  - list:   Returns JSON array of chapter cards (full syllabus or filtered by topic)
  - detail: Returns JSON object with expanded chapter information
  - stream: Legacy streaming markdown overview (co-pilot context generation)
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
from validators import validate_api_key, sanitize_subject, sanitize_topic
from bedrock_stream import stream_bedrock, get_client, MODEL_ID

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.url_map.strict_slashes = False

VALID_LEVELS = {"Form 4", "SPM", "STPM", "University"}


def _level(v):
    return v if v in VALID_LEVELS else "SPM"


@app.route("/", defaults={"path": ""}, methods=["GET", "POST", "OPTIONS"])
@app.route("/<path:path>", methods=["GET", "POST", "OPTIONS"])
def handler(path):
    if request.method == "OPTIONS":
        return preflight_response()
    if request.method == "GET":
        return Response("Chapter Assistant ready", status=200, headers=cors_headers())

    if not validate_api_key(request):
        return Response(json.dumps({"error": "Unauthorized"}), status=401,
                        content_type="application/json", headers=cors_headers())

    body = request.get_json(force=True, silent=True) or {}
    action = body.get("action", "stream")

    if action == "list":
        return _handle_list(body)
    elif action == "detail":
        return _handle_detail(body)
    else:
        return _handle_stream(body)


# ── Action: list — returns JSON array of chapter cards ────────────────────────

_LIST_SYSTEM = """You are a syllabus expert. Return ONLY a valid JSON array.
No markdown, no explanation, no code fences.
Each element: {"chapterNumber": "1", "title": "...", "shortDescription": "..."}"""


def _handle_list(body):
    subject = sanitize_subject(body.get("subject", ""))
    level = _level(body.get("level", ""))
    topic = sanitize_topic(body.get("topic", ""), max_len=300)

    if topic:
        user = (
            f"Based on the {level}-level syllabus for {subject}, find the chapter(s) "
            f"most relevant to '{topic}'. Output as a JSON array (may be 1–3 items)."
        )
    else:
        user = (
            f"Based on the {level}-level syllabus for {subject}, list ALL main chapters "
            f"students study. Output as a JSON array."
        )

    logger.info("Chapter list subject=%s level=%s topic=%s", subject, level, topic)
    return _invoke_json(user, _LIST_SYSTEM)


# ── Action: detail — returns JSON object with expanded chapter info ───────────

_DETAIL_SYSTEM = """You are a curriculum expert. Return ONLY a valid JSON object.
No markdown, no explanation, no code fences.
Schema: {"title": "...", "subtopics": ["..."], "learningObjectives": ["..."],
"keyConcepts": ["..."], "keyTerms": [{"term": "...", "definition": "..."}]}"""


def _handle_detail(body):
    subject = sanitize_subject(body.get("subject", ""))
    level = _level(body.get("level", ""))
    chapter_title = sanitize_topic(body.get("chapter_title", ""), max_len=300)

    if not chapter_title:
        h = cors_headers()
        h["Content-Type"] = "application/json"
        return Response(json.dumps({"error": "chapter_title is required"}),
                        status=400, headers=h)

    user = (
        f"Provide a detailed overview of '{chapter_title}' for {subject} at {level} level. "
        f"Include subtopics, learning objectives, key concepts, and important vocabulary with definitions."
    )

    logger.info("Chapter detail subject=%s level=%s title=%s", subject, level, chapter_title)
    return _invoke_json(user, _DETAIL_SYSTEM)


# ── Action: stream — legacy streaming markdown (for co-pilot context) ─────────

def _handle_stream(body):
    subject = sanitize_subject(body.get("subject", ""))
    level = _level(body.get("level", ""))
    topic = sanitize_topic(body.get("topic", ""), max_len=300)

    topic_clause = f" focusing specifically on **{topic}**" if topic else ""
    prompt = (
        f"You are an expert {subject} educator teaching at the **{level}** level.\n\n"
        f"Generate a comprehensive, structured Chapter Overview for {subject} at {level} level{topic_clause}.\n\n"
        "Include:\n"
        "- Main chapters/topics students cover at this level\n"
        "- Core concepts and key definitions for each chapter\n"
        "- Important formulas or equations (where applicable)\n"
        "- Real-world laboratory applications\n"
        "- Study tips specific to this academic tier\n\n"
        "Use clear markdown headings (## for chapters, ### for subtopics). "
        "Be thorough, accurate, and grade-appropriate."
    )

    messages = [{"role": "user", "content": [{"type": "text", "text": prompt}]}]
    headers = cors_headers()
    headers["Content-Type"] = "text/plain; charset=utf-8"
    return Response(stream_with_context(stream_bedrock(messages)), headers=headers)


# ── Shared JSON invocation helper ─────────────────────────────────────────────

def _invoke_json(user_prompt, system_prompt):
    client = get_client()
    invoke_body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 4000,
        "system": system_prompt,
        "messages": [{"role": "user", "content": [{"type": "text", "text": user_prompt}]}],
    }
    try:
        resp = client.invoke_model(modelId=MODEL_ID, body=json.dumps(invoke_body))
        payload = json.loads(resp["body"].read())
        text = "".join(
            b.get("text", "") for b in (payload.get("content") or [])
            if b.get("type") == "text"
        ).strip()
    except Exception as e:
        logger.exception("Chapter JSON invoke failed")
        h = cors_headers()
        h["Content-Type"] = "application/json"
        return Response(json.dumps({"error": f"Generation failed: {type(e).__name__}"}),
                        status=500, headers=h)

    # Parse — strip ```json fences if present
    cleaned = text
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3].rstrip()

    try:
        data = json.loads(cleaned)
    except (json.JSONDecodeError, ValueError):
        logger.warning("Chapter JSON parse failed: %s", text[:200])
        h = cors_headers()
        h["Content-Type"] = "application/json"
        return Response(json.dumps({"error": "Could not parse AI response", "raw": text}),
                        status=200, headers=h)

    h = cors_headers()
    h["Content-Type"] = "application/json"
    return Response(json.dumps({"data": data}), status=200, headers=h)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)

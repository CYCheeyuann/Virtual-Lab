"""Science Quiz — two-step pipeline.

Step 1 (outline): Generate structured learning objectives from topic + difficulty.
Step 2 (quiz):    Generate strict JSON quiz from confirmed outline.

Both steps use streaming for the outline (markdown) and non-streaming JSON
for the quiz payload to guarantee parseable output.
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
    validate_api_key, sanitize_subject, sanitize_difficulty, sanitize_topic,
    validate_file,
)
from bedrock_stream import stream_bedrock, get_client, MODEL_ID

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.url_map.strict_slashes = False

VALID_DIFFICULTIES = {"Form 4", "SPM", "STPM", "University",
                      "Beginner", "Standard", "Expert", "Master"}


def _sanitize_diff(v):
    return v if v in VALID_DIFFICULTIES else "SPM"


# ── Routes ───────────────────────────────────────────────────────────────────

@app.route("/", defaults={"path": ""}, methods=["GET", "POST", "OPTIONS"])
@app.route("/<path:path>", methods=["GET", "POST", "OPTIONS"])
def handler(path):
    if request.method == "OPTIONS":
        return preflight_response()
    if request.method == "GET":
        return Response("Science Quiz ready", status=200, headers=cors_headers())

    if not validate_api_key(request):
        return Response(json.dumps({"error": "Unauthorized"}), status=401,
                        content_type="application/json", headers=cors_headers())

    body = request.get_json(force=True, silent=True) or {}
    action = body.get("action", "outline")

    if action == "outline":
        return _handle_outline(body)
    elif action == "generate":
        return _handle_generate(body)
    else:
        h = cors_headers()
        h["Content-Type"] = "application/json"
        return Response(json.dumps({"error": f"Unknown action: {action}"}),
                        status=400, headers=h)


# ── Phase 1: Outline generation (streaming markdown) ─────────────────────────

def _handle_outline(body):
    subject    = sanitize_subject(body.get("subject", ""))
    topic      = sanitize_topic(body.get("topic", ""), max_len=500)
    difficulty = _sanitize_diff(body.get("difficulty", ""))
    file_data  = body.get("file_data")
    file_mime  = body.get("file_mime")

    # File validation
    _, file_err = validate_file(file_data, file_mime)
    if file_err:
        h = cors_headers()
        h["Content-Type"] = "application/json"
        return Response(json.dumps({"error": file_err}), status=413, headers=h)

    prompt = f"""You are an expert {subject} educator preparing a quiz outline.

Topic/Chapter: {topic or "(general)"}
Difficulty level: {difficulty}

Generate a structured outline of 8–15 key learning objectives or knowledge
points that a quiz at this level should cover.

STRICT FORMATTING RULE (you must follow this exactly):
- Do NOT use any markdown formatting (no ##, no **, no bold, no headers).
- The very first line must be the outline title written in ALL CAPS, followed by two pipe characters, then a brief subtitle in normal case.
  Example: QUIZ OUTLINE — CIRCULAR MOTION || Key concepts for SPM-level assessment
- Each numbered point must follow this format: write the core topic keyword in ALL CAPS, then two pipe characters ( || ), then the explanation in normal sentence case.
  Example: 1. CENTRIPETAL FORCE || The inward force required to keep an object moving in a circular path.

After the list, add:
SUGGESTED FOCUS || A brief (2-sentence) recommendation on what to emphasize.

Be specific and educational. Use terminology appropriate for {difficulty} level."""

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
                "title": "uploaded_reference",
            })

    content_blocks.append({"type": "text", "text": prompt})
    messages = [{"role": "user", "content": content_blocks}]

    headers = cors_headers()
    headers["Content-Type"] = "text/plain; charset=utf-8"
    return Response(stream_with_context(stream_bedrock(messages)), headers=headers)


# ── Phase 2: Quiz generation (synchronous JSON) ─────────────────────────────

_QUIZ_SYSTEM = """You are a strict quiz generator. You MUST return ONLY a valid
JSON array. No markdown, no explanation text, no ```json fences.

Each element in the array is an object with exactly these keys:
  "question_stem"       — the question text (string). Wrap core scientific keywords
                          or key terms in **double asterisks** for emphasis
                          (e.g. "What is the **centripetal acceleration** of...").
  "options"             — object with keys "A", "B", "C", "D" (string values).
                          Also bold key scientific terms within options where relevant.
  "correct_answer"      — one of "A", "B", "C", "D"
  "detailed_explanation" — why the correct answer is right and why others are wrong.
                          Bold the most important scientific keywords in the explanation.

Generate exactly the number of questions requested. Ensure questions are
accurate, progressively harder, and appropriate for the stated difficulty."""


def _handle_generate(body):
    subject    = sanitize_subject(body.get("subject", ""))
    topic      = sanitize_topic(body.get("topic", ""), max_len=500)
    difficulty = _sanitize_diff(body.get("difficulty", ""))
    outline    = sanitize_topic(body.get("outline", ""), max_len=4000)
    num_questions = min(max(int(body.get("num_questions", 10)), 3), 20)

    logger.info("Quiz generate subject=%s topic=%s difficulty=%s n=%d",
                subject, topic, difficulty, num_questions)

    user_prompt = f"""Subject: {subject}
Topic: {topic}
Difficulty: {difficulty}
Number of questions: {num_questions}

Knowledge points to cover:
{outline}

Generate the JSON array now."""

    # Use synchronous invoke (not streaming) so we get complete JSON.
    client = get_client()
    invoke_body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 8000,
        "system": _QUIZ_SYSTEM,
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
        logger.exception("Quiz generation failed")
        h = cors_headers()
        h["Content-Type"] = "application/json"
        return Response(json.dumps({"error": f"Generation failed: {type(e).__name__}"}),
                        status=500, headers=h)

    # Parse the JSON — Claude should return a bare array but sometimes wraps
    # it in ```json ... ``` fences. Strip those.
    cleaned = text
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3].rstrip()

    try:
        questions = json.loads(cleaned)
        if not isinstance(questions, list):
            raise ValueError("Expected JSON array")
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning("Failed to parse quiz JSON: %s | raw=%s", e, text[:200])
        # Return raw text as fallback so the frontend can show something.
        h = cors_headers()
        h["Content-Type"] = "application/json"
        return Response(json.dumps({
            "error": "Quiz format could not be parsed. Try again.",
            "raw": text,
        }), status=200, headers=h)

    h = cors_headers()
    h["Content-Type"] = "application/json"
    return Response(json.dumps({"questions": questions}), status=200, headers=h)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)

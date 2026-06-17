"""Flashcard Generator — stateless AI card generation.

Modes:
  - from_text:  generate cards from a chapter overview / pasted notes
  - from_quiz:  convert a list of wrong quiz answers into review cards
  - from_topic: generate cards from just subject + chapter + topic (no source)

Output is a strict JSON array of {front, back, hint, tags} objects. No
streaming — frontend wants the full deck in one shot to render the library.
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
    validate_api_key, sanitize_subject, sanitize_topic,
)
from bedrock_stream import get_client, MODEL_ID

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.url_map.strict_slashes = False

VALID_MODES = {"from_text", "from_quiz", "from_topic"}


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
        return Response("Flashcard Generator ready", status=200, headers=cors_headers())

    if not validate_api_key(request):
        return _err("Unauthorized", 401)

    body = request.get_json(force=True, silent=True) or {}
    mode = body.get("mode", "from_topic")
    if mode not in VALID_MODES:
        return _err(f"Unknown mode: {mode}")

    subject = sanitize_subject(body.get("subject", ""))
    chapter = sanitize_topic(body.get("chapter", ""), max_len=200)
    topic   = sanitize_topic(body.get("topic", ""), max_len=300)
    if not chapter:
        return _err("`chapter` is required")

    # Clamp num_cards: 4..30
    try:
        num_cards = int(body.get("num_cards", 12))
    except (TypeError, ValueError):
        num_cards = 12
    num_cards = max(4, min(30, num_cards))

    # Build mode-specific user prompt
    if mode == "from_quiz":
        wrong = body.get("wrong_answers") or []
        if not isinstance(wrong, list) or not wrong:
            return _err("`wrong_answers` must be a non-empty list for mode=from_quiz")
        # Cap to 30 wrong answers and truncate each field defensively
        wrong = wrong[:30]
        formatted = []
        for w in wrong:
            if not isinstance(w, dict):
                continue
            formatted.append({
                "question":    sanitize_topic(w.get("question", ""),    max_len=600),
                "correct":     sanitize_topic(w.get("correct", ""),     max_len=400),
                "picked":      sanitize_topic(w.get("picked") or "",    max_len=400),
                "explanation": sanitize_topic(w.get("explanation", ""), max_len=800),
            })
        if not formatted:
            return _err("No usable wrong-answer entries provided")
        num_cards = len(formatted)  # one card per mistake
        user_prompt = (
            f"Subject: {subject}\nChapter: {chapter}\nTopic: {topic or chapter}\n"
            f"Generate exactly {num_cards} review flashcards — one per wrong answer.\n\n"
            f"Wrong answers JSON:\n{json.dumps(formatted, ensure_ascii=False)}\n\n"
            "For each entry, the card front is the question, the back is the correct "
            "answer as a complete factual sentence with the key term wrapped in **bold**, "
            "and the hint is a one-line cue that hints at the correct concept without "
            "stating it. Tag each card with at least 'mistake-review'."
        )
    else:
        # from_text or from_topic
        source_text = sanitize_topic(body.get("source_text", "") or "", max_len=12000)
        user_prompt = (
            f"Subject: {subject}\nChapter: {chapter}\nTopic: {topic or chapter}\n"
            f"Generate exactly {num_cards} flashcards.\n"
        )
        if source_text:
            user_prompt += (
                "\nSource notes (extract concepts from these — do not copy verbatim):\n"
                f"{source_text}\n"
            )
        else:
            user_prompt += (
                "\nNo source notes were provided. Use your knowledge of the chapter to "
                "produce a balanced set of definition, formula, and concept cards.\n"
            )

    return _generate(subject, num_cards, user_prompt)


_FLASH_SYSTEM = """You are a strict flashcard generator. Output ONLY a valid
JSON array — no markdown fences, no preamble, no trailing commentary.

Each element of the array MUST be an object with exactly these keys:
  "front" — the prompt or question (string, <= 200 chars)
  "back"  — the correct answer as a complete sentence, with the single most
            important key term wrapped in **bold** markdown (string, <= 400 chars)
  "hint"  — a one-line cue that nudges memory without revealing the answer
            (string, <= 160 chars)
  "tags"  — an array of 1-3 short kebab-case tags (e.g. "formula",
            "definition", "mechanism", "mistake-review")

Generate exactly the requested number of cards. Make them progressively
richer (definition → formula → application). Avoid duplicate fronts. Use
terminology appropriate for the stated subject and chapter."""


def _generate(subject, num_cards, user_prompt):
    logger.info("Flashcard generate subject=%s n=%d", subject, num_cards)
    client = get_client()
    invoke_body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 8000,
        "system": _FLASH_SYSTEM,
        "messages": [
            {"role": "user", "content": [{"type": "text", "text": user_prompt}]}
        ],
    }

    try:
        resp = client.invoke_model(modelId=MODEL_ID, body=json.dumps(invoke_body))
        payload = json.loads(resp["body"].read())
        text = "".join(
            b.get("text", "") for b in (payload.get("content") or [])
            if b.get("type") == "text"
        ).strip()
    except Exception as e:
        logger.exception("Flashcard generation failed")
        return _err(f"Generation failed: {type(e).__name__}", 500)

    # Strip optional ```json fences
    cleaned = text
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3].rstrip()

    try:
        cards = json.loads(cleaned)
        if not isinstance(cards, list):
            raise ValueError("Expected JSON array")
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning("Flashcard JSON parse failed: %s | raw=%s", e, text[:200])
        h = cors_headers()
        h["Content-Type"] = "application/json"
        return Response(json.dumps({
            "error": "Card format could not be parsed. Try again.",
            "raw": text,
        }), status=200, headers=h)

    # Light schema cleanup so the frontend gets predictable shapes
    cleaned_cards = []
    for c in cards:
        if not isinstance(c, dict):
            continue
        front = str(c.get("front") or "").strip()
        back  = str(c.get("back")  or "").strip()
        if not front or not back:
            continue
        hint  = c.get("hint")
        tags  = c.get("tags") or []
        if not isinstance(tags, list):
            tags = [str(tags)]
        tags = [str(t).strip().lower() for t in tags if str(t).strip()][:5]
        cleaned_cards.append({
            "front": front[:300],
            "back":  back[:600],
            "hint":  (str(hint).strip()[:200] if hint else None),
            "tags":  tags,
        })

    h = cors_headers()
    h["Content-Type"] = "application/json"
    return Response(json.dumps({"cards": cleaned_cards}), status=200, headers=h)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)

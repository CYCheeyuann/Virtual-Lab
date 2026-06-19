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

from bedrock_stream import MODEL_ID, get_client, invoke_bedrock_buffered
from cors import cors_headers, preflight_response
from flask import Flask, Response, request
from json_parse import parse_json_safe
from prompt_safety import prefix_system, tag
from prompts import load_prompt
from validators import (
    sanitize_subject,
    sanitize_topic,
    validate_api_key,
)

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
            f"{tag('subject', subject)}\n"
            f"{tag('chapter', chapter)}\n"
            f"{tag('topic', topic or chapter)}\n"
            f"{tag('num_cards', str(num_cards))}\n"
            f"{tag('wrong_answers', json.dumps(formatted, ensure_ascii=False))}\n\n"
            "Generate exactly the requested number of review flashcards — one "
            "per entry inside <wrong_answers>. The card front is the question, "
            "the back is the correct answer as a complete factual sentence "
            "with the key term wrapped in **bold**, and the hint is a "
            "one-line cue that hints at the correct concept without stating "
            "it. Tag each card with at least 'mistake-review'."
        )
    else:
        # from_text or from_topic
        # Cap source_text at 8 KB (was 12 KB) — keeps Bedrock input cost
        # bounded while still fitting a typical chapter summary or page of
        # notes. Anything larger is almost certainly someone trying to burn
        # tokens; legitimate use stays well under this.
        source_text = sanitize_topic(body.get("source_text", "") or "", max_len=8000)
        parts = [
            tag("subject",   subject),
            tag("chapter",   chapter),
            tag("topic",     topic or chapter),
            tag("num_cards", str(num_cards)),
        ]
        if source_text:
            parts.append(tag("source_text", source_text))
            tail = (
                "Extract concepts from the contents of <source_text> — do not "
                "copy verbatim — and produce the requested number of cards."
            )
        else:
            tail = (
                "No source notes were provided. Use your knowledge of the "
                "chapter inside <chapter> to produce a balanced set of "
                "definition, formula, and concept cards."
            )
        user_prompt = "\n".join(parts) + "\n\n" + tail

    return _generate(subject, num_cards, user_prompt, mode=mode)


_FLASH_SYSTEM = load_prompt(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompts"),
    "system",
)


def _generate(subject, num_cards, user_prompt, mode=None):
    logger.info("Flashcard generate subject=%s n=%d", subject, num_cards)
    client = get_client()
    invoke_body = {
        "anthropic_version": "bedrock-2023-05-31",
        # 6000 fits 30 cards × ~150 tokens with headroom; previous 8000 was
        # over-provisioned and let abusive callers spend more per request.
        "max_tokens": 6000,
        "system": prefix_system(_FLASH_SYSTEM),
        "messages": [
            {"role": "user", "content": [{"type": "text", "text": user_prompt}]}
        ],
    }

    try:
        payload = invoke_bedrock_buffered(
            client, MODEL_ID, json.dumps(invoke_body),
            function_name="flashcard_generator", mode=mode,
        )
        text = "".join(
            b.get("text", "") for b in (payload.get("content") or [])
            if b.get("type") == "text"
        ).strip()
    except Exception:
        logger.exception("Flashcard generation failed")
        return _err("Generation failed. Please try again.", 500)

    cards = parse_json_safe(text, expect=list)
    if cards is None:
        logger.warning("Flashcard JSON parse failed: raw=%s", (text or "")[:200])
        h = cors_headers()
        h["Content-Type"] = "application/json"
        # Don't return raw model output — could carry an injection payload.
        return Response(json.dumps({
            "error": "Card format could not be parsed. Try again.",
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

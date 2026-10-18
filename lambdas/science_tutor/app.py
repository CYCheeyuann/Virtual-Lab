"""Science Tutor — streaming chatbot with conversation memory and file analysis."""

import json
import logging
import os
import sys

_shared = os.path.join(os.path.dirname(__file__), "..", "shared")
if os.path.isdir(_shared):
    sys.path.insert(0, _shared)

from bedrock_stream import stream_bedrock
from cors import cors_headers, preflight_response
from flask import Flask, Response, request, stream_with_context
from prompt_safety import INJECTION_GUARD, tag
from prompts import load_prompt
from validators import (
    require_object_body,
    sanitize_subject,
    sanitize_topic,
    trim_history,
    validate_api_key,
    validate_file,
    validate_message,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.url_map.strict_slashes = False

_PROMPTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompts")
# The system prompt is a template that interpolates {subject} at request
# time. Loaded once at module import; cheap.
_TUTOR_TEMPLATE = load_prompt(_PROMPTS_DIR, "system")


def _json_error(message, status=400):
    """Consistent JSON error response that KEEPS the CORS headers the normal
    error paths (401, 413) attach — a validation failure must not drop CORS."""
    h = cors_headers()
    h["Content-Type"] = "application/json"
    return Response(json.dumps({"error": message}), status=status, headers=h)


@app.route("/", defaults={"path": ""}, methods=["GET", "POST", "OPTIONS"])
@app.route("/<path:path>", methods=["GET", "POST", "OPTIONS"])
def handler(path):
    if request.method == "OPTIONS":
        return preflight_response()
    if request.method == "GET":
        return Response("Science Tutor ready", status=200, headers=cors_headers())

    if not validate_api_key(request):
        return Response(json.dumps({"error": "Unauthorized"}), status=401,
                        content_type="application/json", headers=cors_headers())

    # Parse the body. A truly EMPTY body is allowed and defaults to {} (so a
    # bare POST still works). But a NON-empty body that is malformed JSON, or a
    # literal `null`, or any non-object JSON (array/string/number/bool), is a
    # client error — reject it as a consistent 4xx instead of silently coercing
    # it to {} and proceeding to a (billable) model call.
    raw = request.get_data(cache=True) or b""
    if raw.strip() == b"":
        body = {}
    else:
        body = request.get_json(force=True, silent=True)
        if body is None:
            # Non-empty body that did not parse as JSON, or parsed to JSON null.
            return _json_error("Request body must be valid JSON.", status=400)

    # Request body must be a JSON OBJECT. An array/string/number/bool used to
    # reach body.get(...) and raise AttributeError → 500; return a consistent
    # 4xx (with CORS headers) instead.
    body_err = require_object_body(body)
    if body_err:
        return _json_error(body_err, status=400)

    # Subject handling at the request boundary:
    #   - absent  → keep the existing default (sanitize_subject → "Biology").
    #   - present but NOT a string (e.g. [] or {}) → reject as a 400 before any
    #     model call. (sanitize_subject tolerates non-strings so it never 500s,
    #     but an explicit wrong TYPE is a client error we refuse rather than
    #     silently default — the requirement is reject-with-400, not coerce.)
    #   - present and a string → sanitize as before (unknown strings default).
    raw_subject = body.get("subject")
    if raw_subject is not None and not isinstance(raw_subject, str):
        return _json_error("subject must be a string.", status=400)
    subject = sanitize_subject(raw_subject if raw_subject is not None else "")
    # message must be a string (a number used to crash sanitize_topic → 500).
    message, msg_err = validate_message(body.get("message", ""), max_len=2000)
    if msg_err:
        return _json_error(msg_err, status=400)
    # Cap history at 10 turns (was 20) to bound per-request input cost.
    # Legitimate conversations rarely need more, and the frontend ringbuffer
    # already keeps its own copy if more context is needed.
    history   = trim_history(body.get("history", []), max_turns=10)
    file_data = body.get("file_data")
    file_mime = body.get("file_mime")
    file_name = sanitize_topic(body.get("file_name", ""), max_len=255) or "uploaded_file"

    logger.info("Tutor request", extra={"subject": subject, "history_len": len(history)})

    # File validation
    _, file_err = validate_file(file_data, file_mime)
    if file_err:
        h = cors_headers()
        h["Content-Type"] = "application/json"
        return Response(json.dumps({"error": file_err}), status=413, headers=h)

    system_prompt = (
        f"{INJECTION_GUARD}\n\n"
        + _TUTOR_TEMPLATE.format(subject=subject)
    )

    # Build messages from history. Per-message content cap prevents a
    # malicious client from sending many huge turns and burning through the
    # Bedrock token budget — `trim_history` only caps the count.
    # 3000 chars ≈ 750 tokens × 10 turns = ~7.5K input tokens worst-case for
    # the history alone, which is reasonable.
    MAX_HISTORY_MSG_CHARS = 3000
    messages = []
    for msg in history:
        # Defence-in-depth: only accept the two roles Bedrock expects, and
        # only string content. Anything else from the client is dropped, so a
        # tampered frontend can't seed fake assistant turns with arbitrary
        # role values. A non-dict history item (e.g. a bare string/number in
        # the array) is skipped rather than crashing on .get().
        if not isinstance(msg, dict):
            continue
        role = msg.get("role")
        content = msg.get("content", "")
        if role not in ("user", "assistant") or not isinstance(content, str) or not content:
            continue
        # Wrap historical USER turns in tags so injection text inside them is
        # treated as data. Assistant turns are model-authored, so we leave
        # them as-is.
        if role == "user":
            wrapped = tag("history_user", content[:MAX_HISTORY_MSG_CHARS])
        else:
            wrapped = content[:MAX_HISTORY_MSG_CHARS]
        messages.append({
            "role": role,
            "content": [{"type": "text", "text": wrapped}],
        })

    # New user message with optional file. The user's text is wrapped in a
    # <message> tag so any "ignore previous instructions" payload inside it
    # is treated as data per the security rule in the system prompt.
    user_content = []
    if file_data and file_mime:
        if file_mime.startswith("image/"):
            user_content.append({
                "type": "image",
                "source": {"type": "base64", "media_type": file_mime, "data": file_data},
            })
        else:
            user_content.append({
                "type": "document",
                "source": {"type": "base64", "media_type": file_mime, "data": file_data},
                "title": file_name,
            })

    user_content.append({"type": "text", "text": tag("message", message or "Hello")})
    messages.append({"role": "user", "content": user_content})

    headers = cors_headers()
    headers["Content-Type"] = "text/plain; charset=utf-8"
    return Response(
        stream_with_context(
            stream_bedrock(messages, system=system_prompt,
                           function_name="science_tutor", mode="chat")
        ),
        headers=headers,
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)

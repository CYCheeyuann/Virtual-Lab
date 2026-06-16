"""Chapter Assistant — generates subject chapter overview via Bedrock streaming."""

import json
import logging
import os
import sys

# In Lambda, shared modules are copied alongside app.py by CI
# For local dev, add parent shared/ to path
_shared = os.path.join(os.path.dirname(__file__), "..", "shared")
if os.path.isdir(_shared):
    sys.path.insert(0, _shared)

from flask import Flask, request, Response, stream_with_context
from cors import cors_headers, preflight_response, ALLOWED_ORIGIN
from validators import validate_api_key, sanitize_subject, sanitize_topic
from bedrock_stream import stream_bedrock

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.url_map.strict_slashes = False


@app.route("/", defaults={"path": ""}, methods=["GET", "POST", "OPTIONS"])
@app.route("/<path:path>", methods=["GET", "POST", "OPTIONS"])
def handler(path):
    if request.method == "OPTIONS":
        return preflight_response()
    if request.method == "GET":
        return Response("Chapter Assistant ready", status=200, headers=cors_headers())

    # Auth check
    if not validate_api_key(request):
        return Response(json.dumps({"error": "Unauthorized"}), status=401,
                        content_type="application/json", headers=cors_headers())

    body = request.get_json(force=True, silent=True) or {}
    subject = sanitize_subject(body.get("subject", ""))
    level = body.get("level", "SPM")
    if level not in ("Form 4", "SPM", "STPM", "University"):
        level = "SPM"
    topic = sanitize_topic(body.get("topic", ""), max_len=300)

    logger.info("Chapter request subject=%s level=%s topic=%s", subject, level, topic)

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


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)

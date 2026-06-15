"""Chapter Assistant — generates subject chapter overview via Bedrock streaming."""

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
from validators import validate_api_key, sanitize_subject
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
        return Response('{"error":"Unauthorized"}', status=401,
                        content_type="application/json", headers=cors_headers())

    body = request.get_json(force=True, silent=True) or {}
    subject = sanitize_subject(body.get("subject", ""))

    logger.info("Chapter request", extra={"subject": subject})

    prompt = (
        f"I want to learn more about the chapters in {subject}. "
        "Can you help me understand the topics better? "
        "Provide a comprehensive overview of the main chapters, key concepts, "
        "and important topics students should focus on."
    )

    messages = [{"role": "user", "content": [{"type": "text", "text": prompt}]}]

    headers = cors_headers()
    headers["Content-Type"] = "text/plain; charset=utf-8"
    return Response(stream_with_context(stream_bedrock(messages)), headers=headers)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)

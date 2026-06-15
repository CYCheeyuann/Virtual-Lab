"""Experiment Guide — generates lab guides with optional file analysis via Bedrock."""

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
        return Response("Experiment Guide ready", status=200, headers=cors_headers())

    if not validate_api_key(request):
        return Response('{"error":"Unauthorized"}', status=401,
                        content_type="application/json", headers=cors_headers())

    body = request.get_json(force=True, silent=True) or {}
    subject    = sanitize_subject(body.get("subject", ""))
    topic      = sanitize_topic(body.get("topic", ""))
    difficulty = sanitize_difficulty(body.get("difficulty", ""))
    file_data  = body.get("file_data")
    file_mime  = body.get("file_mime")
    file_name  = sanitize_topic(body.get("file_name", ""), max_len=255) or "uploaded_file"

    logger.info("Experiment request", extra={"subject": subject, "topic": topic})

    # File validation
    _, file_err = validate_file(file_data, file_mime)
    if file_err:
        h = cors_headers()
        h["Content-Type"] = "application/json"
        return Response(f'{{"error":"{file_err}"}}', status=413, headers=h)

    prompt = f"""You are an expert science educator and lab instructor.

**PART 1: Document Analysis and Validation (if file uploaded)**

If a document is provided, first validate its relevance.

⚠️ **VALIDATION CHECK**
- Examine if the document content is related to science, experiments, laboratory work, scientific concepts, or educational science topics
- If the document is NOT science-related, respond with:

❌ **ERROR: Invalid Document**
The uploaded document does not appear to be related to science or experiments.

Then STOP and do not generate an experiment guide.

---

If the document IS science-related, proceed with analysis:

📄 **Document Summary**
- Describe the document type and purpose
- Summarize the key concepts, findings, or information
- Confirm relevance to the selected subject ({subject})

---

**PART 2: Experiment Guide Generation**

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


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)

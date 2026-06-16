"""Science Quiz — generates multiple-choice quizzes via Bedrock streaming."""

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
        return Response("Science Quiz ready", status=200, headers=cors_headers())

    if not validate_api_key(request):
        return Response(json.dumps({"error": "Unauthorized"}), status=401,
                        content_type="application/json", headers=cors_headers())

    body = request.get_json(force=True, silent=True) or {}
    subject    = sanitize_subject(body.get("subject", ""))
    quiz_topic = sanitize_topic(body.get("quiz_topic", ""))
    difficulty = sanitize_difficulty(body.get("difficulty", ""))

    logger.info("Quiz request", extra={"subject": subject, "topic": quiz_topic})

    prompt = f"""You are an expert science educator and quiz designer specializing in {subject}. Create an engaging multiple-choice quiz:

Subject Area: {subject}
Topic: {quiz_topic}
Difficulty: {difficulty}

**QUIZ STRUCTURE BASED ON DIFFICULTY:**

🟢 **Beginner** — Foundational concepts, basic recall, simple terminology. Suitable for middle school or early high school.

🔵 **Standard** — Mix of recall and application. Moderate complexity. Suitable for high school or intro college.

🟡 **Expert** — Advanced analysis. Complex scenarios. May include calculations. Suitable for advanced college.

🔴 **Master** — Graduate/professional complexity. Cutting-edge concepts. Suitable for researchers.

---

Generate exactly 5 questions. For each use:

📘 **Question N:** [question]

A) First option
B) Second option
C) Third option
D) Fourth option

✅ **Correct Answer:** letter - Full text

💡 **Explanation:** Why correct and why others are wrong.

---

Make questions progressively harder. End with:

🧠 **Fun Fact** — A lesser-known fact related to {quiz_topic}.

🎯 **Difficulty Summary** — What makes this appropriate for {difficulty} level.

Be accurate, educational, engaging. No trick questions."""

    messages = [{"role": "user", "content": [{"type": "text", "text": prompt}]}]

    headers = cors_headers()
    headers["Content-Type"] = "text/plain; charset=utf-8"
    return Response(stream_with_context(stream_bedrock(messages)), headers=headers)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)

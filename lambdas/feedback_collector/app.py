"""User feedback collector — thumbs up / thumbs down ingestion.

Tiny Lambda. No database. The only side effect is one structured CloudWatch
log line per feedback event, plus an EMF metric block so CloudWatch
auto-extracts a `FeedbackCount` metric grouped by feature × rating. The
log lines themselves are the audit trail and can be queried via Logs
Insights.

Deliberately stateless to avoid introducing a database for what is
essentially a counter. If the project later needs richer analytics
(per-user retention, free-text feedback search), promote this to write
into DynamoDB or S3 — the wire contract here is forward-compatible.
"""

import json
import logging
import os
import sys
import time

_shared = os.path.join(os.path.dirname(__file__), "..", "shared")
if os.path.isdir(_shared):
    sys.path.insert(0, _shared)

from cors import cors_headers, preflight_response
from flask import Flask, Response, request
from validators import sanitize_subject, sanitize_topic, validate_api_key

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.url_map.strict_slashes = False

# Allowlist for `feature` so a malicious caller can't poison metrics with
# arbitrary dimension values. Update this whenever a new page emits feedback.
VALID_FEATURES = {
    "tutor", "quiz", "chapter", "experiment", "flashcards",
    "lab-tools", "safety", "image", "what-if",
}

VALID_RATINGS = {"up", "down"}

EMF_NAMESPACE = os.environ.get("METRICS_NAMESPACE", "VirtualScienceLab/AI")


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
        return Response("Feedback Collector ready", status=200, headers=cors_headers())

    if not validate_api_key(request):
        return _err("Unauthorized", 401)

    body = request.get_json(force=True, silent=True) or {}
    feature = body.get("feature", "")
    rating = body.get("rating", "")

    if feature not in VALID_FEATURES:
        return _err("invalid feature")
    if rating not in VALID_RATINGS:
        return _err("invalid rating")

    # Optional context fields. Sanitised to keep log lines bounded and to
    # prevent log-injection via newlines / control chars.
    subject = sanitize_subject(body.get("subject", "")) if body.get("subject") else None
    context = sanitize_topic(body.get("context", ""), max_len=200) if body.get("context") else None
    session_id = sanitize_topic(body.get("session_id", ""), max_len=64) if body.get("session_id") else None

    record = {
        "event":      "user_feedback",
        "feature":    feature,
        "rating":     rating,
        "subject":    subject,
        "context":    context,
        "session_id": session_id,
        # EMF block — CloudWatch extracts FeedbackCount metric.
        "_aws": {
            "Timestamp": int(time.time() * 1000),
            "CloudWatchMetrics": [{
                "Namespace": EMF_NAMESPACE,
                "Dimensions": [["feature", "rating"]],
                "Metrics": [{"Name": "FeedbackCount", "Unit": "Count"}],
            }],
        },
        "FeedbackCount": 1,
    }
    logger.info(json.dumps(record, default=str))

    # 204 No Content is the right shape — nothing to return to the caller.
    headers = cors_headers()
    return Response("", status=204, headers=headers)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)

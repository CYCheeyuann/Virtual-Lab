"""What Happens If — scientific thought-experiment via Bedrock streaming."""

import logging
import os
import sys

_shared = os.path.join(os.path.dirname(__file__), "..", "shared")
if os.path.isdir(_shared):
    sys.path.insert(0, _shared)

from flask import Flask, request, Response, stream_with_context
from cors import cors_headers, preflight_response
from validators import validate_api_key, sanitize_subject, sanitize_topic
from bedrock_stream import stream_bedrock

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.url_map.strict_slashes = False

VALID_REALISM = {"real", "theoretical", "scifi"}
REALISM_LABEL = {
    "real":        "🔬 Real Science",
    "theoretical": "🧪 Theoretical",
    "scifi":       "🚀 Sci-Fi Fun",
}


def sanitize_realism(value):
    return value if value in VALID_REALISM else "real"


@app.route("/", defaults={"path": ""}, methods=["GET", "POST", "OPTIONS"])
@app.route("/<path:path>", methods=["GET", "POST", "OPTIONS"])
def handler(path):
    if request.method == "OPTIONS":
        return preflight_response()
    if request.method == "GET":
        return Response("What If Simulator ready", status=200, headers=cors_headers())

    if not validate_api_key(request):
        return Response('{"error":"Unauthorized"}', status=401,
                        content_type="application/json", headers=cors_headers())

    body = request.get_json(force=True, silent=True) or {}
    subject  = sanitize_subject(body.get("subject", ""))
    scenario = sanitize_topic(body.get("scenario", ""), max_len=1000)
    realism  = sanitize_realism(body.get("realism", ""))
    realism_label = REALISM_LABEL[realism]

    logger.info("WhatIf request",
                extra={"subject": subject, "scenario": scenario[:80], "realism": realism})

    if realism == "real":
        tone = ("Stick strictly to peer-reviewed science. Cite known principles and avoid speculation. "
                "If a scenario is impossible, explain why before exploring closest real analogues.")
    elif realism == "theoretical":
        tone = ("You may extend current physics/biology/chemistry into reasonable speculation. "
                "Distinguish clearly between established science and theoretical extrapolation.")
    else:
        tone = ("Have fun. Use sci-fi creativity while still grounding consequences in cause-and-effect. "
                "Mark obviously fictional elements with a 🌌 marker.")

    prompt = f"""You are a scientific thought-experiment expert who specialises in {subject}.
{tone}

A user asks: **"{scenario}"**

Realism mode: **{realism_label}**

Produce a chain-reaction analysis using this exact markdown structure:

## ⚡ Scenario
> Restate the scenario in one sentence.

## ⏱️ Chain-Reaction Timeline
A timeline of cascading effects. Use sub-headings:
### T+0 seconds
### T+1 minute
### T+1 hour
### T+1 day
### T+1 year
For each, describe what happens and why.

## 🧠 Scientific Principles
Bullet-list the laws, theorems, or mechanisms involved (e.g. conservation of energy,
Le Chatelier's principle, natural selection).

## 🧮 Key Formulas
Include any relevant equations using inline `code` formatting. Skip if none apply.

## 🌍 Real-World Parallels
Cite up to three documented phenomena, experiments, or historical events that
resemble (parts of) this scenario.

## 🤓 Trivia
Two or three fun facts the reader probably doesn't know.

## 📝 Bottom Line
One paragraph summarising the most important consequence.

Be vivid but accurate. Avoid filler. Use lists where useful."""

    messages = [{"role": "user", "content": [{"type": "text", "text": prompt}]}]

    headers = cors_headers()
    headers["Content-Type"] = "text/plain; charset=utf-8"
    return Response(stream_with_context(stream_bedrock(messages)), headers=headers)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)

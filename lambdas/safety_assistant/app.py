"""Safety Assistant — generates a lab-safety report via Bedrock streaming."""

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
from validators import sanitize_subject, sanitize_topic, validate_api_key

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.url_map.strict_slashes = False

VALID_LAB_LEVELS = {"School Lab", "University Lab", "Home Experiment", "Field Work"}

_PROMPTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompts")
_SAFETY_OFFICER_BODY = load_prompt(_PROMPTS_DIR, "system")


def sanitize_lab_level(value):
    return value if value in VALID_LAB_LEVELS else "School Lab"


@app.route("/", defaults={"path": ""}, methods=["GET", "POST", "OPTIONS"])
@app.route("/<path:path>", methods=["GET", "POST", "OPTIONS"])
def handler(path):
    if request.method == "OPTIONS":
        return preflight_response()
    if request.method == "GET":
        return Response("Safety Assistant ready", status=200, headers=cors_headers())

    if not validate_api_key(request):
        return Response(json.dumps({"error": "Unauthorized"}), status=401,
                        content_type="application/json", headers=cors_headers())

    body = request.get_json(force=True, silent=True) or {}
    subject   = sanitize_subject(body.get("subject", ""))
    activity  = sanitize_topic(body.get("activity", ""))
    materials = sanitize_topic(body.get("materials", ""), max_len=2000)
    lab_level = sanitize_lab_level(body.get("lab_level", ""))

    logger.info("Safety request",
                extra={"subject": subject, "activity": activity, "lab_level": lab_level})

    system_prompt = (
        f"{INJECTION_GUARD}\n\n"
        f"{_SAFETY_OFFICER_BODY}"
    )

    user_fields = (
        tag("subject",   subject)        + "\n" +
        tag("activity",  activity)       + "\n" +
        tag("materials", materials or "(not specified)") + "\n" +
        tag("lab_level", lab_level)
    )

    prompt = f"""Generate a safety report based on these inputs:

{user_fields}

Use this exact markdown structure:

## 🦺 Safety Report — (use the value inside the <activity> tag)

### ⚠️ Risk Level
State one of: 🟢 Low / 🟡 Medium / 🟠 High / 🔴 Critical, with a one-sentence justification.

### 🔬 Hazard Sources
Bullet-list each chemical, mechanical, electrical, biological, or radiation hazard
specific to the materials listed.

### 🥽 PPE Required
Bullet-list every piece of personal protective equipment with a brief reason.

### ✅ Pre-Lab Checklist
A numbered checklist of everything to verify or prepare *before* starting.

### 🧰 Procedural Safety Notes
Bullet-list precautions and best-practice tips during the activity.

### 🚨 Emergency Protocol
For each likely incident (spill, fire, exposure, cut, electrical shock),
describe the response in one or two sentences.

### 🗑️ Disposal Guidelines
How to safely dispose of every waste product.

End with a one-line "stay-safe" reminder appropriate for the lab level.
Be precise, accurate, and concise."""

    messages = [{"role": "user", "content": [{"type": "text", "text": prompt}]}]

    headers = cors_headers()
    headers["Content-Type"] = "text/plain; charset=utf-8"
    return Response(
        stream_with_context(
            stream_bedrock(messages, system=system_prompt,
                           function_name="safety_assistant", mode="stream")
        ),
        headers=headers,
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)

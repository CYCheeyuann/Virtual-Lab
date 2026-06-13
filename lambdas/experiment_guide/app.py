import json
import os
import base64
import boto3
from flask import Flask, request, Response, stream_with_context

app = Flask(__name__)
app.url_map.strict_slashes = False

bedrock = boto3.client("bedrock-runtime", region_name="ap-southeast-1")
MODEL_ID = "global.anthropic.claude-sonnet-4-6-20260217-v1:0"


def cors_headers():
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST,OPTIONS,GET",
    }


def doc_format_from_mime(file_mime: str) -> str:
    m = (file_mime or "").lower()
    if "pdf" in m: return "pdf"
    if "csv" in m: return "csv"
    if "html" in m: return "html"
    if "json" in m: return "txt"
    if "docx" in m or "wordprocessingml" in m: return "docx"
    if "xlsx" in m or "spreadsheetml" in m: return "xlsx"
    if "pptx" in m or "presentationml" in m: return "pptx"
    return "txt"


def image_format_from_mime(file_mime: str) -> str:
    m = (file_mime or "").lower()
    if "png"  in m: return "png"
    if "webp" in m: return "webp"
    if "gif"  in m: return "gif"
    return "jpeg"


@app.route("/", defaults={"path": ""}, methods=["GET", "POST", "OPTIONS"])
@app.route("/<path:path>", methods=["GET", "POST", "OPTIONS"])
def handler(path):
    if request.method == "OPTIONS":
        return Response("", status=200, headers=cors_headers())
    if request.method == "GET":
        return Response("Experiment Guide ready", status=200, headers=cors_headers())

    body = request.get_json(force=True, silent=True) or {}
    subject    = body.get("subject", "Biology")
    topic      = body.get("topic", "")
    difficulty = body.get("difficulty", "Standard")
    file_data  = body.get("file_data")
    file_mime  = body.get("file_mime")

    prompt = f"""You are an expert science educator and lab instructor.

**PART 1: Document Analysis and Validation (if file uploaded)**

If a document is provided, first validate its relevance.

⚠️ **VALIDATION CHECK**
- Examine if the document content is related to science, experiments, laboratory work, scientific concepts, or educational science topics
- If the document is NOT science-related, respond with:

❌ **ERROR: Invalid Document**
The uploaded document does not appear to be related to science or experiments. Please upload a document containing:
- Scientific research papers or lab reports
- Experiment procedures or protocols
- Scientific concepts or educational materials
- Chemistry, biology, physics, or other science topics

Then STOP and do not generate an experiment guide.

---

If the document IS science-related, proceed with analysis:

📄 **Document Summary**
- Describe the document type and purpose
- Summarize the key concepts, findings, or information
- Highlight important data, procedures, or conclusions
- Note any relevant scientific principles or applications
- Confirm relevance to the selected subject ({subject})

---

**PART 2: Experiment Guide Generation**

Generate a complete, detailed, engaging experiment guide based on:
Subject: {subject}
Difficulty: {difficulty}
Topic: {topic}

Structure your response with the following emoji-headed sections:

🎯 Objective — purpose and learning goal of the experiment.

🧰 Materials — everything needed with quantities and specifications.

🔬 Procedure — clear numbered step-by-step instructions.

⚠️ Safety Briefing — list each hazard and the corresponding precaution.

📊 Expected Results — what the student should observe and measure.

🧠 Scientific Explanation — explain the underlying concepts at the difficulty level.

🌍 Real-Life Applications — 3-4 real-world examples.

📝 Summary — concise 2-3 sentence recap of the experiment.

If a validated document was provided, incorporate insights from it where relevant.

Make it educational, accurate, and exciting."""

    content_blocks = []
    if file_data and file_mime:
        try:
            raw = base64.b64decode(file_data)
            if file_mime.startswith("image/"):
                content_blocks.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": file_mime,
                        "data": file_data,
                    },
                })
            else:
                content_blocks.append({
                    "type": "document",
                    "source": {
                        "type": "base64",
                        "media_type": file_mime,
                        "data": file_data,
                    },
                })
        except Exception:
            pass

    content_blocks.append({"type": "text", "text": prompt})
    messages = [{"role": "user", "content": content_blocks}]

    def stream():
        try:
            response = bedrock.invoke_model_with_response_stream(
                modelId=MODEL_ID,
                body=json.dumps({
                    "anthropic_version": "bedrock-2023-05-31",
                    "max_tokens": 4096,
                    "messages": messages,
                }),
            )
            for event in response["body"]:
                chunk = event.get("chunk")
                if chunk:
                    data = json.loads(chunk["bytes"])
                    if data.get("type") == "content_block_delta":
                        text = data["delta"].get("text", "")
                        if text:
                            yield text
        except Exception as e:
            yield f"\n\n⚠️ Error: {str(e)}"

    headers = cors_headers()
    headers["Content-Type"] = "text/plain; charset=utf-8"
    return Response(stream_with_context(stream()), headers=headers)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)

import json
import os
import base64
import boto3
from flask import Flask, request, Response, stream_with_context

app = Flask(__name__)

bedrock = boto3.client("bedrock-runtime", region_name="ap-southeast-1")
MODEL_ID = "global.anthropic.claude-sonnet-4-6-20260217-v1:0"


def cors_headers():
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
    }


@app.route("/", methods=["OPTIONS"])
def options():
    return Response("", status=200, headers=cors_headers())


@app.route("/", methods=["POST"])
def generate():
    body = request.get_json(force=True)
    subject = body.get("subject", "Biology")
    topic = body.get("topic", "")
    difficulty = body.get("difficulty", "Standard")
    file_data = body.get("file_data", None)
    file_mime = body.get("file_mime", None)

    prompt = f"""You are an expert science educator and lab instructor.

**PART 1: Document Analysis and Validation (if file uploaded)**

If a document is provided, first validate its relevance:

⚠️ **VALIDATION CHECK**
- Examine if the document content is related to science, experiments, laboratory work, scientific concepts, or educational science topics
- If the document is NOT science-related (e.g. business documents, personal letters, non-scientific content), respond with:

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

Generate a complete, detailed, and engaging experiment guide based on:
Subject: {subject}
Difficulty: {difficulty}
Topic: {topic}

Structure your response with the following emoji-headed sections:

🎯 Objective — State the purpose and learning goal of the experiment.

🧰 Materials — List everything needed with quantities and specifications.

🔬 Procedure — Provide clear numbered step-by-step instructions.

📊 Expected Results — Describe what the student should observe and measure.

🧠 Scientific Explanation — Explain the underlying science concepts in an engaging, accurate way appropriate for the difficulty level.

🌍 Real-Life Applications — Share 3-4 real-world examples where this science is used.

📝 Summary — Provide a concise 2-3 sentence recap of the entire experiment, highlighting the key learning points and main scientific concept explored.

If a validated document was provided, incorporate insights from it into the experiment guide where relevant.

Make it educational, accurate, and exciting. Use clear language appropriate for the selected difficulty level."""

    content_blocks = []

    # Handle file upload - multimodal content
    if file_data and file_mime:
        if file_mime.startswith("image/"):
            content_blocks.append({
                "image": {
                    "format": file_mime.split("/")[1].replace("jpeg", "jpeg"),
                    "source": {
                        "bytes": base64.b64decode(file_data)
                    }
                }
            })
        else:
            # Document block for non-image files
            fmt = "pdf"
            if "pdf" in file_mime:
                fmt = "pdf"
            elif "csv" in file_mime:
                fmt = "csv"
            elif "html" in file_mime:
                fmt = "html"
            elif "docx" in file_mime or "wordprocessingml" in file_mime:
                fmt = "docx"
            elif "xlsx" in file_mime or "spreadsheetml" in file_mime:
                fmt = "xlsx"
            elif "pptx" in file_mime or "presentationml" in file_mime:
                fmt = "pptx"
            content_blocks.append({
                "document": {
                    "format": fmt,
                    "name": "uploaded_document",
                    "source": {
                        "bytes": base64.b64decode(file_data)
                    }
                }
            })

    content_blocks.append({"text": prompt})
    messages = [{"role": "user", "content": content_blocks}]

    def stream():
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

    headers = cors_headers()
    headers["Content-Type"] = "text/plain; charset=utf-8"
    return Response(stream_with_context(stream()), headers=headers)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)

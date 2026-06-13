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
    message = body.get("message", "")
    history = body.get("history", [])
    file_data = body.get("file_data", None)
    file_mime = body.get("file_mime", None)

    system_prompt = f"""You are a Virtual Science Tutor specializing in {subject}. 
You are knowledgeable, friendly, and passionate about making science fun and accessible.
You help students explore topics, answer questions, explain concepts with real examples and fun facts.
If a student uploads a document, analyze it thoroughly and explain the key concepts found within.
Always be encouraging and educational. Use emojis occasionally to keep things engaging.
Remember the conversation context and build upon previous exchanges."""

    # Build messages from history
    messages = []
    for msg in history:
        messages.append({
            "role": msg["role"],
            "content": [{"text": msg["content"]}]
        })

    # Build new user message content
    user_content = []

    # Handle file upload - multimodal content
    if file_data and file_mime:
        if file_mime.startswith("image/"):
            user_content.append({
                "image": {
                    "format": file_mime.split("/")[1].replace("jpeg", "jpeg"),
                    "source": {
                        "bytes": base64.b64decode(file_data)
                    }
                }
            })
        else:
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
            user_content.append({
                "document": {
                    "format": fmt,
                    "name": "uploaded_document",
                    "source": {
                        "bytes": base64.b64decode(file_data)
                    }
                }
            })

    user_content.append({"text": message})
    messages.append({"role": "user", "content": user_content})

    def stream():
        response = bedrock.invoke_model_with_response_stream(
            modelId=MODEL_ID,
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 4096,
                "system": [{"text": system_prompt}],
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

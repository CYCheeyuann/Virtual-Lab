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


@app.route("/", defaults={"path": ""}, methods=["GET", "POST", "OPTIONS"])
@app.route("/<path:path>", methods=["GET", "POST", "OPTIONS"])
def handler(path):
    if request.method == "OPTIONS":
        return Response("", status=200, headers=cors_headers())
    if request.method == "GET":
        return Response("Science Tutor ready", status=200, headers=cors_headers())

    body = request.get_json(force=True, silent=True) or {}
    subject   = body.get("subject", "Biology")
    message   = body.get("message", "")
    history   = body.get("history", [])
    file_data = body.get("file_data")
    file_mime = body.get("file_mime")

    system_prompt = (
        f"You are a Virtual Science Tutor specializing in {subject}. "
        "You are knowledgeable, friendly, and passionate about making science fun and accessible. "
        "Help students explore topics, answer questions, and explain concepts with real examples and fun facts. "
        "If a document is uploaded, analyze it thoroughly and explain the key concepts. "
        "Always be encouraging. Use emojis occasionally to keep things engaging. "
        "Remember the conversation context and build upon previous exchanges."
    )

    # Build messages from history
    messages = []
    for msg in history:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role in ("user", "assistant") and content:
            messages.append({
                "role": role,
                "content": [{"type": "text", "text": content}],
            })

    # Build new user message content blocks
    user_content = []
    if file_data and file_mime:
        try:
            base64.b64decode(file_data)  # validate
            if file_mime.startswith("image/"):
                user_content.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": file_mime,
                        "data": file_data,
                    },
                })
            else:
                user_content.append({
                    "type": "document",
                    "source": {
                        "type": "base64",
                        "media_type": file_mime,
                        "data": file_data,
                    },
                })
        except Exception:
            pass

    user_content.append({"type": "text", "text": message or "Hello"})
    messages.append({"role": "user", "content": user_content})

    def stream():
        try:
            response = bedrock.invoke_model_with_response_stream(
                modelId=MODEL_ID,
                body=json.dumps({
                    "anthropic_version": "bedrock-2023-05-31",
                    "max_tokens": 4096,
                    "system": system_prompt,
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

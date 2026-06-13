import json
import os
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

    prompt = (
        f"I want to learn more about the chapters in {subject}. "
        "Can you help me understand the topics better? "
        "Provide a comprehensive overview of the main chapters, key concepts, "
        "and important topics students should focus on."
    )

    messages = [{"role": "user", "content": [{"text": prompt}]}]

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

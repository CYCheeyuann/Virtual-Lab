import json
import os
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
        return Response("Science Quiz ready", status=200, headers=cors_headers())

    body = request.get_json(force=True, silent=True) or {}
    subject    = body.get("subject", "Biology")
    quiz_topic = body.get("quiz_topic", "")
    difficulty = body.get("difficulty", "Standard")

    prompt = f"""You are an expert science educator and quiz designer specializing in {subject}. Create an engaging multiple-choice quiz on:

Subject Area: {subject}
Topic: {quiz_topic}
Difficulty: {difficulty}

**QUIZ STRUCTURE BASED ON DIFFICULTY:**

🟢 **Beginner** — Foundational concepts, basic recall, simple terminology, clear answer choices. Suitable for middle school or early high school.

🔵 **Standard** — Mix of recall and application questions. Moderate complexity. Suitable for high school or intro college.

🟡 **Expert** — Advanced application and analysis. Complex scenarios. May include calculations or multi-step problems. Suitable for advanced college or early graduate.

🔴 **Master** — Graduate/professional complexity, cutting-edge concepts, technical terminology, critical thinking. Suitable for graduate students, researchers, professionals.

---

**FORMAT:** Generate exactly 5 questions. For each question use this exact structure:

📘 **Question N:** Write the question here.

A) First option
B) Second option
C) Third option
D) Fourth option

✅ **Correct Answer:** letter - Full text of correct answer

💡 **Explanation:** Explain why this answer is correct and briefly clarify why the other options are wrong.

---

Make questions progressively more challenging. Ensure all questions are directly relevant to {subject} and {quiz_topic}.

At the end include:

🧠 **Fun Fact** — A fascinating, lesser-known fact related to {quiz_topic}.

🎯 **Difficulty Summary** — What makes this quiz appropriate for {difficulty} level learners studying {subject}.

Be scientifically accurate and educational. Avoid trick questions."""

    messages = [{"role": "user", "content": [{"type": "text", "text": prompt}]}]

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

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
    quiz_topic = body.get("quiz_topic", "")
    difficulty = body.get("difficulty", "Standard")

    prompt = f"""You are an expert science educator and quiz designer specializing in {subject}. Create an engaging and educational multiple-choice quiz on the following topic:

Subject Area: {subject}
Topic: {quiz_topic}
Difficulty: {difficulty}

**QUIZ STRUCTURE BASED ON DIFFICULTY:**

🟢 **Beginner**
- Foundational concepts and basic recall
- Simple terminology and straightforward questions
- Clear, obvious answer choices
- Suitable for middle school or early high school

🔵 **Standard**
- Mix of recall and application questions
- Moderate complexity with some conceptual thinking
- Standard academic difficulty level
- Suitable for high school or intro college

🟡 **Expert**
- Advanced application and analysis questions
- Complex scenarios requiring deep understanding
- Detailed scientific reasoning required
- May include calculations or multi-step problems
- Suitable for advanced college or early graduate level

🔴 **Master**
- Graduate/professional level complexity
- Cutting-edge concepts and research-level knowledge
- Highly technical terminology and advanced principles
- Critical thinking, synthesis, and expert-level analysis
- May include experimental design, data interpretation, and theoretical applications
- Suitable for graduate students, researchers, and professionals

---

**FORMAT:** For each question, use this exact structure:

📘 **Question number:** Write the question here.

A) First option
B) Second option
C) Third option
D) Fourth option

✅ **Correct Answer:** latter - Full text of correct answer

💡 **Explanation:** Explain why this answer is correct and briefly clarify why the other options are wrong. For Expert and Master levels, provide more detailed scientific explanations with relevant principles from {subject}.

---

Make questions progressively more challenging within the quiz. Ensure all questions are directly relevant to {subject} and {quiz_topic}. Adjust language complexity, conceptual depth, and technical detail to match the selected {difficulty} level.

At the end, include:

🧠 **Fun Fact** — Share a fascinating, lesser-known fact related to {quiz_topic} in {subject} that's appropriate for the {difficulty} level.

🎯 **Difficulty Summary** — Briefly describe what makes this quiz appropriate for {difficulty} level learners studying {subject}.

Be scientifically accurate, educational, and engaging. Avoid trick questions. All questions must be relevant to the {subject} area."""

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

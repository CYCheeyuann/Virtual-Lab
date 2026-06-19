"""Functional tests for the science_quiz Lambda."""

import json

import pytest
from botocore.exceptions import ClientError
from jsonschema import validate

from tests.conftest import last_invoke_body
from tests.schemas import QUIZ_RESPONSE


def _questions(n=3):
    return [
        {
            "question_stem": f"What is concept {i}?",
            "options": {"A": "Alpha", "B": "Beta", "C": "Gamma", "D": "Delta"},
            "correct_answer": "A",
            "detailed_explanation": f"Because **alpha** is correct for {i}.",
        }
        for i in range(n)
    ]


# ── action=outline (streaming) ─────────────────────────────────────────────

class TestOutline:
    def test_streams_text(self, mock_bedrock, app_for):
        _, client = app_for("science_quiz")
        mock_bedrock.set_stream_chunks([
            "QUIZ OUTLINE — CIRCULAR MOTION || Key concepts\n",
            "1. CENTRIPETAL FORCE || Inward force.\n",
        ])
        resp = client.post("/", json={
            "action": "outline",
            "subject": "Physics",
            "topic": "Circular Motion",
            "difficulty": "SPM",
        })
        assert resp.status_code == 200
        text = resp.get_data(as_text=True)
        assert "QUIZ OUTLINE" in text

    def test_oversized_file_rejected(self, mock_bedrock, app_for):
        _, client = app_for("science_quiz")
        import base64
        big = base64.b64encode(b"x" * (11 * 1024 * 1024)).decode()
        resp = client.post("/", json={
            "action": "outline",
            "subject": "Physics",
            "topic": "Test",
            "file_data": big,
            "file_mime": "application/pdf",
        })
        assert resp.status_code == 413


# ── action=generate (JSON) ─────────────────────────────────────────────────

class TestGenerate:
    def test_happy_path_matches_schema(self, mock_bedrock, app_for):
        _, client = app_for("science_quiz")
        mock_bedrock.set_text_response(json.dumps(_questions(5)))
        resp = client.post("/", json={
            "action": "generate",
            "subject": "Physics",
            "topic": "Motion",
            "difficulty": "SPM",
            "outline": "Key points...",
            "num_questions": 5,
        })
        assert resp.status_code == 200
        body = resp.get_json()
        validate(body, QUIZ_RESPONSE)
        assert len(body["questions"]) == 5

    def test_num_questions_clamped_to_max_20(self, mock_bedrock, app_for):
        _, client = app_for("science_quiz")
        mock_bedrock.set_text_response(json.dumps(_questions(20)))
        client.post("/", json={
            "action": "generate",
            "subject": "Physics",
            "topic": "Motion",
            "difficulty": "SPM",
            "outline": "x",
            "num_questions": 9999,
        })
        body = last_invoke_body(mock_bedrock)
        user_text = body["messages"][0]["content"][0]["text"]
        import re
        match = re.search(r"<num_questions>\s*(\d+)\s*</num_questions>", user_text)
        assert match and int(match.group(1)) == 20

    def test_num_questions_clamped_to_min_3(self, mock_bedrock, app_for):
        _, client = app_for("science_quiz")
        mock_bedrock.set_text_response(json.dumps(_questions(3)))
        client.post("/", json={
            "action": "generate",
            "subject": "Physics",
            "topic": "Motion",
            "difficulty": "SPM",
            "outline": "x",
            "num_questions": 1,
        })
        body = last_invoke_body(mock_bedrock)
        user_text = body["messages"][0]["content"][0]["text"]
        import re
        match = re.search(r"<num_questions>\s*(\d+)\s*</num_questions>", user_text)
        assert match and int(match.group(1)) == 3

    def test_outline_wrapped_in_tag(self, mock_bedrock, app_for):
        _, client = app_for("science_quiz")
        mock_bedrock.set_text_response(json.dumps(_questions()))
        client.post("/", json={
            "action": "generate",
            "subject": "Physics",
            "topic": "Motion",
            "difficulty": "SPM",
            "outline": "Newton's first law",
            "num_questions": 5,
        })
        body = last_invoke_body(mock_bedrock)
        user_text = body["messages"][0]["content"][0]["text"]
        assert "<outline>" in user_text and "Newton" in user_text

    def test_garbled_output_returns_parse_error(self, mock_bedrock, app_for):
        _, client = app_for("science_quiz")
        mock_bedrock.set_text_response("not a json array")
        resp = client.post("/", json={
            "action": "generate",
            "subject": "Physics",
            "topic": "Motion",
            "difficulty": "SPM",
            "outline": "x",
            "num_questions": 5,
        })
        body = resp.get_json()
        assert "error" in body
        assert "raw" not in body  # re-injection guard

    def test_bedrock_failure_returns_generic_500(self, mock_bedrock, app_for):
        _, client = app_for("science_quiz")
        mock_bedrock.invoke_model.side_effect = ClientError(
            {"Error": {"Code": "ThrottlingException", "Message": "rate"}},
            "InvokeModel",
        )
        resp = client.post("/", json={
            "action": "generate",
            "subject": "Physics",
            "topic": "Motion",
            "difficulty": "SPM",
            "outline": "x",
            "num_questions": 5,
        })
        assert resp.status_code == 500
        assert "ThrottlingException" not in json.dumps(resp.get_json())

    def test_unknown_action_returns_400(self, mock_bedrock, app_for):
        _, client = app_for("science_quiz")
        resp = client.post("/", json={"action": "explode", "subject": "Physics"})
        assert resp.status_code == 400

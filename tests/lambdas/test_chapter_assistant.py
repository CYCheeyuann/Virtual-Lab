"""Functional tests for the chapter_assistant Lambda."""

import json

import pytest
from botocore.exceptions import ClientError
from jsonschema import validate

from tests.conftest import last_invoke_body
from tests.schemas import CHAPTER_DETAIL_RESPONSE, CHAPTER_LIST_RESPONSE


def _list_payload():
    return [
        {"chapterNumber": "1", "title": "Cell Biology", "shortDescription": "Cell structure and function"},
        {"chapterNumber": "2", "title": "Genetics", "shortDescription": "Inheritance"},
    ]


def _detail_payload():
    return {
        "title": "Cell Biology",
        "subtopics": ["Cell membrane", "Organelles"],
        "learningObjectives": ["Describe cell structure", "Explain organelle function"],
        "keyConcepts": ["Cell theory"],
        "keyTerms": [{"term": "Cytoplasm", "definition": "Fluid inside the cell."}],
    }


# ── action=list ────────────────────────────────────────────────────────────

class TestListHappyPath:
    def test_returns_array_matching_schema(self, mock_bedrock, app_for):
        _, client = app_for("chapter_assistant")
        mock_bedrock.set_text_response(json.dumps(_list_payload()))
        resp = client.post("/", json={
            "action": "list",
            "subject": "Biology",
            "level": "SPM",
        })
        assert resp.status_code == 200
        data = resp.get_json()
        validate(data, CHAPTER_LIST_RESPONSE)
        assert len(data["data"]) == 2

    def test_invalid_subject_falls_back_to_biology(self, mock_bedrock, app_for):
        _, client = app_for("chapter_assistant")
        mock_bedrock.set_text_response(json.dumps(_list_payload()))
        resp = client.post("/", json={
            "action": "list",
            "subject": "Astrology",  # not on allowlist
            "level": "SPM",
        })
        assert resp.status_code == 200
        body = last_invoke_body(mock_bedrock)
        # Allowlist fallback should land "Biology" in the prompt body.
        user_text = body["messages"][0]["content"][0]["text"]
        assert "<subject>" in user_text and "Biology" in user_text

    def test_topic_is_wrapped_in_tag(self, mock_bedrock, app_for):
        _, client = app_for("chapter_assistant")
        mock_bedrock.set_text_response(json.dumps(_list_payload()))
        client.post("/", json={
            "action": "list",
            "subject": "Biology",
            "level": "SPM",
            "topic": "Photosynthesis",
        })
        body = last_invoke_body(mock_bedrock)
        user_text = body["messages"][0]["content"][0]["text"]
        assert "<topic>" in user_text
        assert "Photosynthesis" in user_text


class TestListErrorHandling:
    def test_empty_topic_treated_as_full_syllabus(self, mock_bedrock, app_for):
        _, client = app_for("chapter_assistant")
        mock_bedrock.set_text_response(json.dumps(_list_payload()))
        resp = client.post("/", json={"action": "list", "subject": "Biology", "level": "SPM", "topic": ""})
        assert resp.status_code == 200

    def test_topic_exceeding_max_length_is_truncated(self, mock_bedrock, app_for):
        _, client = app_for("chapter_assistant")
        mock_bedrock.set_text_response(json.dumps(_list_payload()))
        client.post("/", json={
            "action": "list",
            "subject": "Biology",
            "level": "SPM",
            "topic": "A" * 5000,
        })
        body = last_invoke_body(mock_bedrock)
        user_text = body["messages"][0]["content"][0]["text"]
        # 300-char cap applied before tagging.
        assert user_text.count("A") <= 350

    def test_bedrock_throttling_returns_500_with_generic_message(self, mock_bedrock, app_for):
        _, client = app_for("chapter_assistant")
        mock_bedrock.invoke_model.side_effect = ClientError(
            {"Error": {"Code": "ThrottlingException", "Message": "rate exceeded"}},
            "InvokeModel",
        )
        resp = client.post("/", json={"action": "list", "subject": "Biology", "level": "SPM"})
        assert resp.status_code == 500
        # Error must NOT leak the exception class name (audit finding #6).
        body = resp.get_json()
        assert "ThrottlingException" not in json.dumps(body)
        assert "ClientError" not in json.dumps(body)

    def test_empty_model_output_returns_parse_error(self, mock_bedrock, app_for):
        _, client = app_for("chapter_assistant")
        mock_bedrock.set_text_response("")
        resp = client.post("/", json={"action": "list", "subject": "Biology", "level": "SPM"})
        # 200 with error field — frontend handles the empty case gracefully.
        assert resp.status_code == 200
        body = resp.get_json()
        assert "error" in body
        # And the raw model output is NOT echoed back (re-injection guard).
        assert "raw" not in body

    def test_garbled_model_output_returns_parse_error(self, mock_bedrock, app_for):
        _, client = app_for("chapter_assistant")
        mock_bedrock.set_text_response("not json at all")
        resp = client.post("/", json={"action": "list", "subject": "Biology", "level": "SPM"})
        body = resp.get_json()
        assert "error" in body


# ── action=detail ──────────────────────────────────────────────────────────

class TestDetail:
    def test_happy_path_matches_schema(self, mock_bedrock, app_for):
        _, client = app_for("chapter_assistant")
        mock_bedrock.set_text_response(json.dumps(_detail_payload()))
        resp = client.post("/", json={
            "action": "detail",
            "subject": "Biology",
            "level": "SPM",
            "chapter_title": "Cell Biology",
        })
        assert resp.status_code == 200
        validate(resp.get_json(), CHAPTER_DETAIL_RESPONSE)

    def test_missing_chapter_title_returns_400(self, mock_bedrock, app_for):
        _, client = app_for("chapter_assistant")
        resp = client.post("/", json={
            "action": "detail",
            "subject": "Biology",
            "level": "SPM",
        })
        assert resp.status_code == 400


# ── system prompt + auth ───────────────────────────────────────────────────

class TestSecurityProperties:
    def test_system_prompt_contains_injection_guard(self, mock_bedrock, app_for):
        _, client = app_for("chapter_assistant")
        mock_bedrock.set_text_response(json.dumps(_list_payload()))
        client.post("/", json={"action": "list", "subject": "Biology", "level": "SPM"})
        body = last_invoke_body(mock_bedrock)
        assert "SECURITY RULE" in body["system"]

    def test_options_returns_cors_preflight(self, app_for):
        _, client = app_for("chapter_assistant")
        resp = client.open("/", method="OPTIONS")
        assert resp.status_code == 200
        assert "Access-Control-Allow-Origin" in resp.headers

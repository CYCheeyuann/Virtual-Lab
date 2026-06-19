"""Functional tests for the experiment_guide Lambda."""

import json

import pytest
from botocore.exceptions import ClientError
from jsonschema import validate

from tests.conftest import last_invoke_body
from tests.schemas import EXPERIMENT_NODE_MAP, EXPERIMENT_VALIDATE


def _node_map_payload():
    sections = {
        k: f"Body of {k}." for k in (
            "objective", "materials", "safety", "procedure",
            "expected_results", "scientific_explanation",
            "real_life_applications", "summary",
        )
    }
    return {"topic_title": "Photosynthesis Experiment", "sections": sections}


# ── mode=validate ──────────────────────────────────────────────────────────

class TestValidate:
    def test_happy_path(self, mock_bedrock, app_for):
        _, client = app_for("experiment_guide")
        mock_bedrock.set_text_response(json.dumps({
            "valid": True,
            "summary": "Will produce a complete experiment guide.",
        }))
        resp = client.post("/", json={
            "mode": "validate",
            "subject": "Biology",
            "topic": "Photosynthesis",
            "difficulty": "Standard",
        })
        assert resp.status_code == 200
        body = resp.get_json()
        validate(body, EXPERIMENT_VALIDATE)
        assert body["valid"] is True

    def test_empty_topic_rejected(self, mock_bedrock, app_for):
        _, client = app_for("experiment_guide")
        resp = client.post("/", json={
            "mode": "validate",
            "subject": "Biology",
            "topic": "",
            "difficulty": "Standard",
        })
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["valid"] is False

    def test_garbled_model_output_fails_closed(self, mock_bedrock, app_for):
        """Audit finding #12: parse failure must NOT silently approve."""
        _, client = app_for("experiment_guide")
        mock_bedrock.set_text_response("I think this is fine.")
        resp = client.post("/", json={
            "mode": "validate",
            "subject": "Biology",
            "topic": "Osmosis",
            "difficulty": "Standard",
        })
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["valid"] is False, "Validation must fail closed on parse failure"


# ── mode=node_map ──────────────────────────────────────────────────────────

class TestNodeMap:
    def test_happy_path(self, mock_bedrock, app_for):
        _, client = app_for("experiment_guide")
        mock_bedrock.set_text_response(json.dumps(_node_map_payload()))
        resp = client.post("/", json={
            "mode": "node_map",
            "subject": "Biology",
            "topic": "Photosynthesis",
            "difficulty": "Standard",
        })
        assert resp.status_code == 200
        validate(resp.get_json(), EXPERIMENT_NODE_MAP)

    def test_missing_topic_returns_400(self, mock_bedrock, app_for):
        _, client = app_for("experiment_guide")
        resp = client.post("/", json={
            "mode": "node_map",
            "subject": "Biology",
            "topic": "",
            "difficulty": "Standard",
        })
        assert resp.status_code == 400

    def test_topic_is_wrapped_in_tag(self, mock_bedrock, app_for):
        _, client = app_for("experiment_guide")
        mock_bedrock.set_text_response(json.dumps(_node_map_payload()))
        client.post("/", json={
            "mode": "node_map",
            "subject": "Biology",
            "topic": "Centripetal Force",
            "difficulty": "Standard",
        })
        body = last_invoke_body(mock_bedrock)
        user_text = body["messages"][0]["content"][0]["text"]
        assert "<topic>" in user_text and "Centripetal Force" in user_text

    def test_section_too_long_is_truncated(self, mock_bedrock, app_for):
        """Each section value is capped at 4000 chars defensively."""
        _, client = app_for("experiment_guide")
        bloated = _node_map_payload()
        bloated["sections"]["objective"] = "X" * 6000
        mock_bedrock.set_text_response(json.dumps(bloated))
        resp = client.post("/", json={
            "mode": "node_map",
            "subject": "Biology",
            "topic": "Test",
            "difficulty": "Standard",
        })
        assert len(resp.get_json()["sections"]["objective"]) <= 4000

    def test_oversized_file_returns_413(self, mock_bedrock, app_for):
        _, client = app_for("experiment_guide")
        # 11 MB base64 → exceeds 10 MB cap
        import base64
        big = base64.b64encode(b"x" * (11 * 1024 * 1024)).decode()
        resp = client.post("/", json={
            "mode": "node_map",
            "subject": "Biology",
            "topic": "Test",
            "difficulty": "Standard",
            "file_data": big,
            "file_mime": "application/pdf",
            "file_name": "huge.pdf",
        })
        assert resp.status_code == 413

    def test_missing_sections_key_returns_parse_error(self, mock_bedrock, app_for):
        _, client = app_for("experiment_guide")
        mock_bedrock.set_text_response(json.dumps({"topic_title": "X"}))
        resp = client.post("/", json={
            "mode": "node_map",
            "subject": "Biology",
            "topic": "Test",
            "difficulty": "Standard",
        })
        body = resp.get_json()
        assert "error" in body
        assert "raw" not in body  # don't echo model output

    def test_bedrock_failure_returns_generic_500(self, mock_bedrock, app_for):
        _, client = app_for("experiment_guide")
        mock_bedrock.invoke_model.side_effect = ClientError(
            {"Error": {"Code": "ModelTimeoutException", "Message": "timeout"}},
            "InvokeModel",
        )
        resp = client.post("/", json={
            "mode": "node_map",
            "subject": "Biology",
            "topic": "Test",
            "difficulty": "Standard",
        })
        assert resp.status_code == 500
        body = resp.get_json()
        assert "ModelTimeoutException" not in json.dumps(body)

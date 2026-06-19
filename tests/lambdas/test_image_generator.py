"""Functional tests for the image_generator Lambda.

Two-step pipeline (Claude expand → Stability render). Tests have to drive
the mock to return different bodies on the two `invoke_model` calls.
"""

import json
from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError
from jsonschema import validate

from tests.schemas import IMAGE_GENERATOR_RESPONSE


def _claude_response_body(text):
    body = MagicMock()
    body.read.return_value = json.dumps({"content": [{"type": "text", "text": text}]}).encode()
    return {"body": body}


def _stability_response_body(b64):
    body = MagicMock()
    body.read.return_value = json.dumps({"images": [b64]}).encode()
    return {"body": body}


class TestHappyPath:
    def test_returns_explanation_and_image(self, mock_bedrock, app_for):
        _, client = app_for("image_generator")
        # Two-step: Claude returns JSON describing image_prompt + explanation,
        # then Stability returns base64 PNG.
        claude_payload = json.dumps({
            "explanation": "## Mitochondrion\nThe powerhouse of the cell.",
            "image_prompt": "Detailed anatomical illustration of a mitochondrion.",
        })
        mock_bedrock.invoke_model.side_effect = [
            _claude_response_body(claude_payload),
            _stability_response_body("FAKEBASE64IMAGE"),
        ]
        resp = client.post("/", json={
            "subject": "Biology",
            "concept": "Mitochondrion",
            "style": "Scientific Diagram",
            "detail": "Detailed",
        })
        assert resp.status_code == 200
        body = resp.get_json()
        validate(body, IMAGE_GENERATOR_RESPONSE)
        assert body["image_base64"] == "FAKEBASE64IMAGE"


class TestInputValidation:
    def test_missing_concept_returns_400(self, mock_bedrock, app_for):
        _, client = app_for("image_generator")
        resp = client.post("/", json={"subject": "Biology", "concept": ""})
        assert resp.status_code == 400

    def test_invalid_style_falls_back(self, mock_bedrock, app_for):
        _, client = app_for("image_generator")
        claude = json.dumps({"explanation": "x", "image_prompt": "y"})
        mock_bedrock.invoke_model.side_effect = [
            _claude_response_body(claude),
            _stability_response_body("IMG"),
        ]
        resp = client.post("/", json={
            "subject": "Biology",
            "concept": "Cell",
            "style": "Photorealistic Anime",  # not on allowlist
        })
        assert resp.status_code == 200

    def test_concept_wrapped_in_tag(self, mock_bedrock, app_for):
        _, client = app_for("image_generator")
        claude = json.dumps({"explanation": "x", "image_prompt": "y"})
        mock_bedrock.invoke_model.side_effect = [
            _claude_response_body(claude),
            _stability_response_body("IMG"),
        ]
        client.post("/", json={"subject": "Biology", "concept": "Photosynthesis"})
        # The first call (Claude expand) should have a tagged body.
        first_body = json.loads(mock_bedrock.invoke_model.call_args_list[0].kwargs["body"])
        user_text = first_body["messages"][0]["content"][0]["text"]
        assert "<concept>" in user_text and "Photosynthesis" in user_text


class TestFailureModes:
    def test_claude_failure_returns_500(self, mock_bedrock, app_for):
        _, client = app_for("image_generator")
        mock_bedrock.invoke_model.side_effect = ClientError(
            {"Error": {"Code": "AccessDeniedException", "Message": "no"}},
            "InvokeModel",
        )
        resp = client.post("/", json={"subject": "Biology", "concept": "Cell"})
        assert resp.status_code == 500
        # No exception class leaked.
        assert "AccessDeniedException" not in json.dumps(resp.get_json() or {})

    def test_image_step_failure_returns_explanation_with_error(self, mock_bedrock, app_for):
        """When Claude succeeds but Stability fails, response should still
        include the explanation so the user gets something useful."""
        _, client = app_for("image_generator")
        claude = json.dumps({"explanation": "## X", "image_prompt": "y"})
        mock_bedrock.invoke_model.side_effect = [
            _claude_response_body(claude),
            ClientError(
                {"Error": {"Code": "ThrottlingException", "Message": "rate"}},
                "InvokeModel",
            ),
        ]
        resp = client.post("/", json={"subject": "Biology", "concept": "Cell"})
        assert resp.status_code == 500
        body = resp.get_json()
        assert "explanation" in body  # graceful partial response

    def test_stability_returns_no_images_handled(self, mock_bedrock, app_for):
        _, client = app_for("image_generator")
        claude = json.dumps({"explanation": "x", "image_prompt": "y"})
        empty = MagicMock()
        empty.read.return_value = json.dumps({"images": [], "finish_reasons": ["safety"]}).encode()
        mock_bedrock.invoke_model.side_effect = [
            _claude_response_body(claude),
            {"body": empty},
        ]
        resp = client.post("/", json={"subject": "Biology", "concept": "Cell"})
        # Should not 200 with valid image; check we get a sensible payload.
        body = resp.get_json()
        assert "image_base64" not in body or body.get("image_base64") in (None, "")


class TestSecurityProperties:
    def test_claude_system_includes_injection_guard(self, mock_bedrock, app_for):
        _, client = app_for("image_generator")
        claude = json.dumps({"explanation": "x", "image_prompt": "y"})
        mock_bedrock.invoke_model.side_effect = [
            _claude_response_body(claude),
            _stability_response_body("IMG"),
        ]
        client.post("/", json={"subject": "Biology", "concept": "Cell"})
        first_body = json.loads(mock_bedrock.invoke_model.call_args_list[0].kwargs["body"])
        assert "SECURITY RULE" in first_body["system"]

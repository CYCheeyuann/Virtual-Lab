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


class TestErrorLoggingPerStage:
    """A single _bedrock_error() serves both pipeline stages. These tests make
    the text stage and the image stage each raise AccessDeniedException and
    assert the log line names the correct stage / model / region, and never
    leaks the API key or image bytes."""

    _DENY = {
        "Error": {
            "Code": "AccessDeniedException",
            "Message": "User is not authorized to perform: bedrock:InvokeModel",
        },
        "ResponseMetadata": {"RequestId": "req-abc-123", "HTTPStatusCode": 403},
    }

    def test_text_stage_access_denied_logs_text_model_region(
        self, mock_bedrock, app_for, caplog
    ):
        mod, client = app_for("image_generator")
        # First invoke (Claude text expand) is denied.
        mock_bedrock.invoke_model.side_effect = ClientError(self._DENY, "InvokeModel")
        with caplog.at_level("ERROR"):
            resp = client.post(
                "/", json={"subject": "Biology", "concept": "Cell", "detail": "Simple"}
            )
        assert resp.status_code == 500
        line = "\n".join(r.getMessage() for r in caplog.records)
        assert "stage=text" in line
        assert mod.TEXT_MODEL_ID in line
        assert mod.TEXT_REGION in line
        assert "req-abc-123" in line and "httpStatus=403" in line
        # The text stage must NOT be mislabelled with the image model/region.
        assert "stage=image" not in line
        assert mod.IMAGE_MODEL_ID not in line

    def test_image_stage_access_denied_logs_image_model_region(
        self, mock_bedrock, app_for, caplog
    ):
        mod, client = app_for("image_generator")
        claude = json.dumps({"explanation": "## X", "image_prompt": "a labelled cell"})
        # First invoke (Claude) succeeds; second (Stability image) is denied.
        mock_bedrock.invoke_model.side_effect = [
            _claude_response_body(claude),
            ClientError(self._DENY, "InvokeModel"),
        ]
        with caplog.at_level("ERROR"):
            resp = client.post(
                "/", json={"subject": "Biology", "concept": "Cell", "detail": "Simple"}
            )
        assert resp.status_code == 500
        line = "\n".join(r.getMessage() for r in caplog.records)
        assert "stage=image" in line
        assert mod.IMAGE_MODEL_ID in line
        assert mod.IMAGE_REGION in line
        assert "req-abc-123" in line and "httpStatus=403" in line
        # The image stage must NOT be mislabelled with the text model/region.
        assert "stage=text" not in line

    def test_error_log_does_not_leak_api_key_or_image_bytes(
        self, mock_bedrock, app_for, caplog, monkeypatch
    ):
        monkeypatch.setenv("API_KEY", "super-secret-key-value")
        mod, client = app_for("image_generator")
        claude = json.dumps({"explanation": "## X", "image_prompt": "a labelled cell"})
        mock_bedrock.invoke_model.side_effect = [
            _claude_response_body(claude),
            ClientError(self._DENY, "InvokeModel"),
        ]
        with caplog.at_level("INFO"):
            client.post(
                "/",
                json={"subject": "Biology", "concept": "Cell"},
                headers={"X-Api-Key": "super-secret-key-value"},
            )
        logged = "\n".join(r.getMessage() for r in caplog.records)
        assert "super-secret-key-value" not in logged
        assert "FAKEBASE64IMAGE" not in logged
        assert "image_base64" not in logged

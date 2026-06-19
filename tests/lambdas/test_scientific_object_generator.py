"""Functional tests for the scientific_object_generator Lambda."""

import json
from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError
from jsonschema import validate

from tests.schemas import OBJECT_IMAGE, OBJECT_NARRATIVE, OBJECT_OVERVIEW


def _claude_response_body(text):
    body = MagicMock()
    body.read.return_value = json.dumps({"content": [{"type": "text", "text": text}]}).encode()
    return {"body": body}


def _stability_response_body(b64):
    body = MagicMock()
    body.read.return_value = json.dumps({"images": [b64]}).encode()
    return {"body": body}


def _form():
    return {
        "form": {
            "name":       "Erlenmeyer flask",
            "material":   "Borosilicate glass",
            "purpose":    "Mixing reagents under heat",
            "useCase":    "Acid-base titrations",
            "appearance": "Conical body, narrow neck",
            "sterility":  "Autoclavable up to 180°C",
            "style":      "Photorealistic studio",
        },
    }


# ── overview ───────────────────────────────────────────────────────────────

class TestOverview:
    def test_happy_path(self, mock_bedrock, app_for):
        _, client = app_for("scientific_object_generator")
        mock_bedrock.invoke_model.return_value = _claude_response_body(
            "An Erlenmeyer flask is a conical lab vessel for mixing liquids."
        )
        resp = client.post("/", json={"mode": "overview", **_form()})
        assert resp.status_code == 200
        validate(resp.get_json(), OBJECT_OVERVIEW)

    def test_missing_required_returns_400(self, mock_bedrock, app_for):
        _, client = app_for("scientific_object_generator")
        resp = client.post("/", json={
            "mode": "overview",
            "form": {"name": "x"},  # missing material + purpose
        })
        assert resp.status_code == 400

    def test_unknown_mode_returns_400(self, mock_bedrock, app_for):
        _, client = app_for("scientific_object_generator")
        resp = client.post("/", json={"mode": "render"})
        assert resp.status_code == 400


# ── narrative ──────────────────────────────────────────────────────────────

class TestNarrative:
    def test_happy_path_strips_residual_bullets(self, mock_bedrock, app_for):
        _, client = app_for("scientific_object_generator")
        # The model occasionally slips bullets in despite the system prompt.
        # The Lambda has a backstop that strips them.
        mock_bedrock.invoke_model.return_value = _claude_response_body(
            "- This is a paragraph that should be unbulletted.\n"
            "Material: borosilicate.\n"
            "The flask is broadly resistant to thermal shock."
        )
        resp = client.post("/", json={
            "mode": "narrative",
            "approvedOverview": "An Erlenmeyer flask is a conical lab vessel.",
            **_form(),
        })
        assert resp.status_code == 200
        body = resp.get_json()
        validate(body, OBJECT_NARRATIVE)
        # No residual bullet markers.
        assert "- This is" not in body["narrative"]
        assert "Material: borosilicate" not in body["narrative"]

    def test_missing_overview_returns_400(self, mock_bedrock, app_for):
        _, client = app_for("scientific_object_generator")
        resp = client.post("/", json={"mode": "narrative", **_form()})
        assert resp.status_code == 400


# ── image ──────────────────────────────────────────────────────────────────

class TestImage:
    def test_happy_path(self, mock_bedrock, app_for):
        _, client = app_for("scientific_object_generator")
        mock_bedrock.invoke_model.return_value = _stability_response_body("IMG_B64")
        resp = client.post("/", json={
            "mode": "image",
            "approvedOverview": "An Erlenmeyer flask is a conical lab vessel.",
            **_form(),
        })
        assert resp.status_code == 200
        validate(resp.get_json(), OBJECT_IMAGE)

    def test_stability_access_denied_returns_friendly_hint(self, mock_bedrock, app_for):
        _, client = app_for("scientific_object_generator")
        mock_bedrock.invoke_model.side_effect = ClientError(
            {"Error": {"Code": "AccessDeniedException", "Message": "stability sd3"}},
            "InvokeModel",
        )
        resp = client.post("/", json={
            "mode": "image",
            "approvedOverview": "x",
            **_form(),
        })
        assert resp.status_code == 500
        body = resp.get_json()
        # The friendly handler mentions Stability + the model-access page.
        assert "Stability" in body["error"] or "stability" in body["error"].lower()

    def test_no_images_in_response_returns_500(self, mock_bedrock, app_for):
        _, client = app_for("scientific_object_generator")
        empty = MagicMock()
        empty.read.return_value = json.dumps({"images": []}).encode()
        mock_bedrock.invoke_model.return_value = {"body": empty}
        resp = client.post("/", json={
            "mode": "image",
            "approvedOverview": "x",
            **_form(),
        })
        assert resp.status_code == 500


class TestSecurityProperties:
    def test_overview_system_includes_injection_guard(self, mock_bedrock, app_for):
        _, client = app_for("scientific_object_generator")
        mock_bedrock.invoke_model.return_value = _claude_response_body("ok")
        client.post("/", json={"mode": "overview", **_form()})
        first_body = json.loads(mock_bedrock.invoke_model.call_args.kwargs["body"])
        assert "SECURITY RULE" in first_body["system"]

    def test_form_fields_wrapped_in_tags(self, mock_bedrock, app_for):
        _, client = app_for("scientific_object_generator")
        mock_bedrock.invoke_model.return_value = _claude_response_body("ok")
        client.post("/", json={"mode": "overview", **_form()})
        first_body = json.loads(mock_bedrock.invoke_model.call_args.kwargs["body"])
        user_text = first_body["messages"][0]["content"][0]["text"]
        for field in ("<name>", "<material>", "<purpose>"):
            assert field in user_text

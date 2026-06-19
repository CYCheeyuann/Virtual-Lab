"""Functional tests for the safety_assistant Lambda (streaming)."""

import pytest
from botocore.exceptions import ClientError


def _last_stream_call(mock_bedrock):
    return mock_bedrock.invoke_model_with_response_stream.call_args


class TestHappyPath:
    def test_streams_safety_report(self, mock_bedrock, app_for):
        _, client = app_for("safety_assistant")
        mock_bedrock.set_stream_chunks([
            "## 🦺 Safety Report — Acid-Base Titration\n",
            "### ⚠️ Risk Level\n🟡 Medium\n",
        ])
        resp = client.post("/", json={
            "subject": "Chemistry",
            "activity": "Acid-Base Titration",
            "materials": "1.0 M HCl, 1.0 M NaOH",
            "lab_level": "School Lab",
        })
        assert resp.status_code == 200
        assert resp.headers["Content-Type"].startswith("text/plain")
        text = resp.get_data(as_text=True)
        assert "Safety Report" in text


class TestInputHandling:
    def test_invalid_lab_level_falls_back(self, mock_bedrock, app_for):
        _, client = app_for("safety_assistant")
        mock_bedrock.set_stream_chunks(["ok"])
        resp = client.post("/", json={
            "subject": "Chemistry",
            "activity": "Test",
            "lab_level": "Mars Lab",  # not on allowlist
        })
        assert resp.status_code == 200
        # Verify body landed "School Lab" inside the prompt.
        import json
        body = json.loads(_last_stream_call(mock_bedrock).kwargs["body"])
        user_text = body["messages"][0]["content"][0]["text"]
        assert "School Lab" in user_text

    def test_materials_empty_uses_placeholder(self, mock_bedrock, app_for):
        _, client = app_for("safety_assistant")
        mock_bedrock.set_stream_chunks(["ok"])
        client.post("/", json={
            "subject": "Chemistry",
            "activity": "Test",
            "materials": "",
            "lab_level": "School Lab",
        })
        import json
        body = json.loads(_last_stream_call(mock_bedrock).kwargs["body"])
        user_text = body["messages"][0]["content"][0]["text"]
        # The Lambda inserts "(not specified)" into the materials tag.
        assert "<materials>" in user_text


class TestSecurityProperties:
    def test_system_prompt_contains_injection_guard(self, mock_bedrock, app_for):
        _, client = app_for("safety_assistant")
        mock_bedrock.set_stream_chunks(["ok"])
        client.post("/", json={
            "subject": "Chemistry",
            "activity": "Test",
            "lab_level": "School Lab",
        })
        import json
        body = json.loads(_last_stream_call(mock_bedrock).kwargs["body"])
        assert "SECURITY RULE" in body["system"]

    def test_activity_wrapped_in_tag(self, mock_bedrock, app_for):
        _, client = app_for("safety_assistant")
        mock_bedrock.set_stream_chunks(["ok"])
        client.post("/", json={
            "subject": "Chemistry",
            "activity": "Acid-Base Titration",
            "lab_level": "School Lab",
        })
        import json
        body = json.loads(_last_stream_call(mock_bedrock).kwargs["body"])
        user_text = body["messages"][0]["content"][0]["text"]
        assert "<activity>" in user_text
        assert "Acid-Base Titration" in user_text


class TestStreamingResilience:
    def test_bedrock_throttling_yields_friendly_message(self, mock_bedrock, app_for):
        """Streaming exceptions are swallowed inside the generator and a
        friendly message is appended; the response itself stays 200."""
        _, client = app_for("safety_assistant")
        mock_bedrock.invoke_model_with_response_stream.side_effect = ClientError(
            {"Error": {"Code": "ThrottlingException", "Message": "rate"}},
            "InvokeModelWithResponseStream",
        )
        resp = client.post("/", json={
            "subject": "Chemistry",
            "activity": "Test",
            "lab_level": "School Lab",
        })
        # Streaming endpoint returns 200 even on Bedrock failure (the
        # exception text is yielded as part of the stream body).
        assert resp.status_code == 200
        text = resp.get_data(as_text=True)
        assert "Too many requests" in text or "rate" in text.lower() or "⚠️" in text

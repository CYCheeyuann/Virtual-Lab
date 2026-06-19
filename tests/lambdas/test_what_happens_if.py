"""Functional tests for the what_happens_if Lambda (streaming)."""

import json

import pytest


class TestHappyPath:
    def test_streams_simulation(self, mock_bedrock, app_for):
        _, client = app_for("what_happens_if")
        mock_bedrock.set_stream_chunks([
            "## ⚡ Scenario\n",
            "> The sun disappears.\n",
            "## ⏱️ Chain-Reaction Timeline\n",
        ])
        resp = client.post("/", json={
            "subject": "Physics",
            "scenario": "The sun suddenly disappears.",
            "realism": "real",
        })
        assert resp.status_code == 200
        assert resp.headers["Content-Type"].startswith("text/plain")
        assert "Scenario" in resp.get_data(as_text=True)


class TestInputHandling:
    def test_invalid_realism_falls_back_to_real(self, mock_bedrock, app_for):
        _, client = app_for("what_happens_if")
        mock_bedrock.set_stream_chunks(["ok"])
        client.post("/", json={
            "subject": "Physics",
            "scenario": "Test",
            "realism": "fantasy",  # not on allowlist
        })
        body = json.loads(mock_bedrock.invoke_model_with_response_stream.call_args.kwargs["body"])
        user_text = body["messages"][0]["content"][0]["text"]
        # The default realism label is "🔬 Real Science"
        assert "Real Science" in user_text or "real" in body["system"].lower()

    def test_scenario_wrapped_in_tag(self, mock_bedrock, app_for):
        _, client = app_for("what_happens_if")
        mock_bedrock.set_stream_chunks(["ok"])
        client.post("/", json={
            "subject": "Physics",
            "scenario": "Earth stops rotating.",
            "realism": "real",
        })
        body = json.loads(mock_bedrock.invoke_model_with_response_stream.call_args.kwargs["body"])
        user_text = body["messages"][0]["content"][0]["text"]
        assert "<scenario>" in user_text
        assert "Earth stops rotating." in user_text

    def test_scenario_truncated_at_max_length(self, mock_bedrock, app_for):
        _, client = app_for("what_happens_if")
        mock_bedrock.set_stream_chunks(["ok"])
        client.post("/", json={
            "subject": "Physics",
            "scenario": "X" * 5000,  # cap at 1000
            "realism": "real",
        })
        body = json.loads(mock_bedrock.invoke_model_with_response_stream.call_args.kwargs["body"])
        user_text = body["messages"][0]["content"][0]["text"]
        assert user_text.count("X") <= 1100


class TestSecurityProperties:
    def test_system_prompt_contains_injection_guard(self, mock_bedrock, app_for):
        _, client = app_for("what_happens_if")
        mock_bedrock.set_stream_chunks(["ok"])
        client.post("/", json={
            "subject": "Physics",
            "scenario": "Test",
            "realism": "real",
        })
        body = json.loads(mock_bedrock.invoke_model_with_response_stream.call_args.kwargs["body"])
        assert "SECURITY RULE" in body["system"]

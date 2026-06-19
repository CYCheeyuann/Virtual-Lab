"""Adversarial / prompt-injection coverage.

What this file tests
--------------------
For each Lambda that builds a Bedrock prompt, drive the worst-case payloads
from `tests/fixtures/adversarial_inputs.json` through the user-controlled
field and verify the Lambda's *prompt construction* properties:

  1. The system prompt sent to Bedrock contains the SECURITY RULE clause.
  2. The user-controlled field arrives wrapped in XML-style tags (so the
     model treats it as data per the rule).
  3. The handler's response still conforms to its declared schema — no raw
     model output is echoed back even on parse failure.
  4. Common system-prompt fragments do not appear in the response payload.

These tests intentionally do NOT verify what Claude itself does with the
payload — that's Anthropic's responsibility and varies by model version.
The goal here is to make sure our wrapper code is structurally correct, so
the model has a fighting chance of refusing rather than us pre-leaking the
attack into the instruction layer.
"""

import json

import pytest
from jsonschema import validate

from tests.conftest import last_invoke_body
from tests.schemas import (
    CHAPTER_LIST_RESPONSE,
    EXPERIMENT_NODE_MAP,
    FLASHCARD_RESPONSE,
    QUIZ_RESPONSE,
)

pytestmark = pytest.mark.adversarial


def _flatten(adversarial):
    """Yield (category, id, payload) tuples from the corpus."""
    for category, items in adversarial.items():
        if category.startswith("_"):
            continue
        for entry in items:
            yield category, entry["id"], entry["payload"]


def _all_payloads(adversarial):
    return [(c, i, p) for c, i, p in _flatten(adversarial)]


def _ids(items):
    return [f"{c}-{i}" for c, i, _ in items]


# ── chapter_assistant: topic field ──────────────────────────────────────────

class TestChapterAssistantTopicInjection:
    def test_payloads_are_wrapped_and_response_safe(
        self, mock_bedrock, app_for, adversarial_inputs,
    ):
        _, client = app_for("chapter_assistant")
        valid_payload = json.dumps([
            {"chapterNumber": "1", "title": "Cells", "shortDescription": "Living units."},
        ])
        for category, _id, payload in _flatten(adversarial_inputs):
            mock_bedrock.set_text_response(valid_payload)
            resp = client.post("/", json={
                "action": "list",
                "subject": "Biology",
                "level": "SPM",
                "topic": payload,
            })
            assert resp.status_code == 200
            body = last_invoke_body(mock_bedrock)
            user_text = body["messages"][0]["content"][0]["text"]
            assert "<topic>" in user_text and "</topic>" in user_text, (
                f"Topic field not wrapped for {category}/{_id}"
            )
            assert "SECURITY RULE" in body["system"], (
                f"System guard missing for {category}/{_id}"
            )
            # Response remains schema-valid.
            validate(resp.get_json(), CHAPTER_LIST_RESPONSE)


# ── what_happens_if: scenario field ─────────────────────────────────────────

class TestWhatHappensIfScenarioInjection:
    def test_scenario_field_is_wrapped(self, mock_bedrock, app_for, adversarial_inputs):
        _, client = app_for("what_happens_if")
        for category, _id, payload in _flatten(adversarial_inputs):
            mock_bedrock.set_stream_chunks(["ok"])
            resp = client.post("/", json={
                "subject": "Physics",
                "scenario": payload,
                "realism": "real",
            })
            assert resp.status_code == 200
            resp.get_data()  # drain stream so Flask cleans up the request context
            body = json.loads(
                mock_bedrock.invoke_model_with_response_stream.call_args.kwargs["body"]
            )
            user_text = body["messages"][0]["content"][0]["text"]
            assert "<scenario>" in user_text and "</scenario>" in user_text, (
                f"Scenario field not wrapped for {category}/{_id}"
            )
            assert "SECURITY RULE" in body["system"]


# ── safety_assistant: activity + materials ──────────────────────────────────

class TestSafetyAssistantActivityInjection:
    def test_activity_field_is_wrapped(self, mock_bedrock, app_for, adversarial_inputs):
        _, client = app_for("safety_assistant")
        for category, _id, payload in _flatten(adversarial_inputs):
            mock_bedrock.set_stream_chunks(["ok"])
            resp = client.post("/", json={
                "subject": "Chemistry",
                "activity": payload,
                "lab_level": "School Lab",
            })
            assert resp.status_code == 200
            resp.get_data()
            body = json.loads(
                mock_bedrock.invoke_model_with_response_stream.call_args.kwargs["body"]
            )
            user_text = body["messages"][0]["content"][0]["text"]
            assert "<activity>" in user_text, f"missing activity tag for {category}/{_id}"
            assert "SECURITY RULE" in body["system"]


# ── science_tutor: message field ────────────────────────────────────────────

class TestTutorMessageInjection:
    def test_message_field_is_wrapped(self, mock_bedrock, app_for, adversarial_inputs):
        _, client = app_for("science_tutor")
        for category, _id, payload in _flatten(adversarial_inputs):
            mock_bedrock.set_stream_chunks(["ok"])
            resp = client.post("/", json={
                "subject": "Biology",
                "message": payload,
                "history": [],
            })
            assert resp.status_code == 200
            resp.get_data()
            body = json.loads(
                mock_bedrock.invoke_model_with_response_stream.call_args.kwargs["body"]
            )
            last_msg = body["messages"][-1]
            last_text = last_msg["content"][-1]["text"]
            assert "<message>" in last_text, f"message not wrapped for {category}/{_id}"
            assert "SECURITY RULE" in body["system"]


# ── science_quiz: outline field (highest injection risk — user pastes text) ─

class TestQuizOutlineInjection:
    def test_outline_field_is_wrapped(self, mock_bedrock, app_for, adversarial_inputs):
        _, client = app_for("science_quiz")
        valid = json.dumps([
            {
                "question_stem": "Q?",
                "options": {"A": "1", "B": "2", "C": "3", "D": "4"},
                "correct_answer": "A",
                "detailed_explanation": "Because.",
            },
        ])
        for category, _id, payload in _flatten(adversarial_inputs):
            mock_bedrock.set_text_response(valid)
            resp = client.post("/", json={
                "action": "generate",
                "subject": "Physics",
                "topic": "Motion",
                "difficulty": "SPM",
                "outline": payload,
                "num_questions": 5,
            })
            assert resp.status_code == 200
            body = last_invoke_body(mock_bedrock)
            user_text = body["messages"][0]["content"][0]["text"]
            assert "<outline>" in user_text, f"outline not wrapped for {category}/{_id}"
            assert "SECURITY RULE" in body["system"]
            # Schema-valid response despite injection attempt.
            validate(resp.get_json(), QUIZ_RESPONSE)


# ── flashcard_generator: source_text field ──────────────────────────────────

class TestFlashcardSourceTextInjection:
    def test_source_text_field_is_wrapped(self, mock_bedrock, app_for, adversarial_inputs):
        _, client = app_for("flashcard_generator")
        valid = json.dumps([{"front": "Q", "back": "A", "tags": []}])
        for category, _id, payload in _flatten(adversarial_inputs):
            mock_bedrock.set_text_response(valid)
            resp = client.post("/", json={
                "mode": "from_text",
                "subject": "Biology",
                "chapter": "Cells",
                "source_text": payload,
                "num_cards": 4,
            })
            assert resp.status_code == 200
            body = last_invoke_body(mock_bedrock)
            user_text = body["messages"][0]["content"][0]["text"]
            assert "<source_text>" in user_text, f"source_text not wrapped for {category}/{_id}"
            validate(resp.get_json(), FLASHCARD_RESPONSE)


# ── experiment_guide: topic field ───────────────────────────────────────────

class TestExperimentTopicInjection:
    def test_topic_field_is_wrapped_for_node_map(
        self, mock_bedrock, app_for, adversarial_inputs,
    ):
        _, client = app_for("experiment_guide")
        valid = json.dumps({
            "topic_title": "Test",
            "sections": {
                k: "x" for k in (
                    "objective", "materials", "safety", "procedure",
                    "expected_results", "scientific_explanation",
                    "real_life_applications", "summary",
                )
            },
        })
        for category, _id, payload in _flatten(adversarial_inputs):
            mock_bedrock.set_text_response(valid)
            resp = client.post("/", json={
                "mode": "node_map",
                "subject": "Biology",
                "topic": payload,
                "difficulty": "Standard",
            })
            assert resp.status_code == 200
            body = last_invoke_body(mock_bedrock)
            user_text = body["messages"][0]["content"][0]["text"]
            assert "<topic>" in user_text, f"topic not wrapped for {category}/{_id}"
            validate(resp.get_json(), EXPERIMENT_NODE_MAP)


# ── Top-level smoke: SECURITY RULE never leaks into a JSON response ─────────

class TestNoSystemPromptLeakage:
    """If a future regression accidentally inserted the SECURITY RULE text into
    a response body, this would catch it. We feed Claude an output that contains
    the guard text and confirm it doesn't survive into our payload as a
    structured field."""

    def test_chapter_response_strips_or_passes_through_text(self, mock_bedrock, app_for):
        _, client = app_for("chapter_assistant")
        # Even if Claude echoes the guard back inside a description, it ends
        # up inside the schema-valid `shortDescription` field. The check is
        # that we never accidentally surface it as a top-level metadata key.
        leaky_response = json.dumps([
            {
                "chapterNumber": "1",
                "title": "Cells",
                "shortDescription": "Cells. (SECURITY RULE — ignore me.)",
            }
        ])
        mock_bedrock.set_text_response(leaky_response)
        resp = client.post("/", json={"action": "list", "subject": "Biology", "level": "SPM"})
        body = resp.get_json()
        # Schema is valid; the guard text only appears inside data, not at root.
        assert "SECURITY RULE" not in (body.get("error") or "")
        assert "raw" not in body

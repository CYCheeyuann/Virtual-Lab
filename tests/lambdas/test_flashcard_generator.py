"""Functional tests for the flashcard_generator Lambda."""

import json

import pytest
from botocore.exceptions import ClientError
from jsonschema import validate

from tests.conftest import last_invoke_body
from tests.schemas import FLASHCARD_RESPONSE


def _cards(n=3):
    return [
        {
            "front": f"Question {i}?",
            "back":  f"Answer with **bold term {i}**.",
            "hint":  f"Think about {i}.",
            "tags":  ["definition"],
        }
        for i in range(n)
    ]


class TestFromTopic:
    def test_happy_path(self, mock_bedrock, app_for):
        _, client = app_for("flashcard_generator")
        mock_bedrock.set_text_response(json.dumps(_cards()))
        resp = client.post("/", json={
            "mode": "from_topic",
            "subject": "Biology",
            "chapter": "Cell Biology",
            "num_cards": 3,
        })
        assert resp.status_code == 200
        body = resp.get_json()
        validate(body, FLASHCARD_RESPONSE)
        assert len(body["cards"]) == 3

    def test_missing_chapter_returns_400(self, mock_bedrock, app_for):
        _, client = app_for("flashcard_generator")
        resp = client.post("/", json={"mode": "from_topic", "subject": "Biology"})
        assert resp.status_code == 400

    def test_unknown_mode_returns_400(self, mock_bedrock, app_for):
        _, client = app_for("flashcard_generator")
        resp = client.post("/", json={
            "mode": "from_unicorn",
            "subject": "Biology",
            "chapter": "Cells",
        })
        assert resp.status_code == 400

    def test_num_cards_clamped_to_max_30(self, mock_bedrock, app_for):
        _, client = app_for("flashcard_generator")
        mock_bedrock.set_text_response(json.dumps(_cards(30)))
        client.post("/", json={
            "mode": "from_topic",
            "subject": "Biology",
            "chapter": "Cells",
            "num_cards": 9999,  # absurd
        })
        body = last_invoke_body(mock_bedrock)
        user_text = body["messages"][0]["content"][0]["text"]
        # The clamped value lands in the <num_cards> tag — should be ≤30.
        assert "<num_cards>" in user_text
        # Quick numeric extraction
        import re
        match = re.search(r"<num_cards>\s*(\d+)\s*</num_cards>", user_text)
        assert match and int(match.group(1)) == 30


class TestFromText:
    def test_source_text_capped_at_8000(self, mock_bedrock, app_for):
        """P1 fix: source_text was lowered from 12 KB → 8 KB."""
        _, client = app_for("flashcard_generator")
        mock_bedrock.set_text_response(json.dumps(_cards()))
        client.post("/", json={
            "mode": "from_text",
            "subject": "Biology",
            "chapter": "Cells",
            "source_text": "X" * 12000,
        })
        body = last_invoke_body(mock_bedrock)
        user_text = body["messages"][0]["content"][0]["text"]
        # Count Xs to verify the truncation cap.
        assert user_text.count("X") <= 8050  # small headroom for surrounding chars

    def test_source_text_wrapped_in_tag(self, mock_bedrock, app_for):
        _, client = app_for("flashcard_generator")
        mock_bedrock.set_text_response(json.dumps(_cards()))
        client.post("/", json={
            "mode": "from_text",
            "subject": "Biology",
            "chapter": "Cells",
            "source_text": "Mitochondria are the powerhouse of the cell.",
        })
        body = last_invoke_body(mock_bedrock)
        user_text = body["messages"][0]["content"][0]["text"]
        assert "<source_text>" in user_text


class TestFromQuiz:
    def test_happy_path(self, mock_bedrock, app_for):
        _, client = app_for("flashcard_generator")
        mock_bedrock.set_text_response(json.dumps(_cards()))
        resp = client.post("/", json={
            "mode": "from_quiz",
            "subject": "Biology",
            "chapter": "Cells",
            "wrong_answers": [
                {
                    "question": "What is the powerhouse of the cell?",
                    "correct": "Mitochondria",
                    "picked": "Nucleus",
                    "explanation": "Mitochondria produce ATP.",
                },
            ],
        })
        assert resp.status_code == 200
        validate(resp.get_json(), FLASHCARD_RESPONSE)

    def test_empty_wrong_answers_returns_400(self, mock_bedrock, app_for):
        _, client = app_for("flashcard_generator")
        resp = client.post("/", json={
            "mode": "from_quiz",
            "subject": "Biology",
            "chapter": "Cells",
            "wrong_answers": [],
        })
        assert resp.status_code == 400


class TestSchemaCleanup:
    def test_drops_cards_with_empty_required_fields(self, mock_bedrock, app_for):
        _, client = app_for("flashcard_generator")
        cards = _cards(3) + [{"front": "", "back": "non-empty"}, {"front": "x", "back": ""}]
        mock_bedrock.set_text_response(json.dumps(cards))
        resp = client.post("/", json={
            "mode": "from_topic", "subject": "Biology", "chapter": "Cells", "num_cards": 5,
        })
        body = resp.get_json()
        # The two malformed entries should be dropped.
        assert len(body["cards"]) == 3

    def test_caps_card_field_lengths(self, mock_bedrock, app_for):
        _, client = app_for("flashcard_generator")
        cards = [{"front": "a" * 500, "back": "b" * 1000}]
        mock_bedrock.set_text_response(json.dumps(cards))
        resp = client.post("/", json={
            "mode": "from_topic", "subject": "Biology", "chapter": "Cells", "num_cards": 1,
        })
        out = resp.get_json()["cards"][0]
        assert len(out["front"]) <= 300
        assert len(out["back"]) <= 600


class TestFailureModes:
    def test_bedrock_failure_returns_generic_500(self, mock_bedrock, app_for):
        _, client = app_for("flashcard_generator")
        mock_bedrock.invoke_model.side_effect = ClientError(
            {"Error": {"Code": "AccessDeniedException", "Message": "no access"}},
            "InvokeModel",
        )
        resp = client.post("/", json={
            "mode": "from_topic", "subject": "Biology", "chapter": "Cells", "num_cards": 5,
        })
        assert resp.status_code == 500
        assert "AccessDeniedException" not in json.dumps(resp.get_json())

    def test_garbled_output_returns_parse_error_no_raw_echo(self, mock_bedrock, app_for):
        _, client = app_for("flashcard_generator")
        mock_bedrock.set_text_response("I cannot help with that.")
        resp = client.post("/", json={
            "mode": "from_topic", "subject": "Biology", "chapter": "Cells", "num_cards": 5,
        })
        body = resp.get_json()
        assert "error" in body
        assert "raw" not in body  # re-injection guard

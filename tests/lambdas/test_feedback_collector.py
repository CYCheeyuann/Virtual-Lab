"""Functional tests for the feedback_collector Lambda."""

import json
import logging


class TestHappyPath:
    def test_thumbs_up_returns_204(self, app_for):
        _, client = app_for("feedback_collector")
        resp = client.post("/", json={
            "feature": "tutor",
            "rating":  "up",
            "subject": "Biology",
            "context": "Photosynthesis",
            "session_id": "abc123",
        })
        assert resp.status_code == 204

    def test_thumbs_down_returns_204(self, app_for):
        _, client = app_for("feedback_collector")
        resp = client.post("/", json={
            "feature": "quiz",
            "rating":  "down",
        })
        assert resp.status_code == 204

    def test_emits_structured_log_with_emf(self, app_for, caplog):
        _, client = app_for("feedback_collector")
        with caplog.at_level(logging.INFO):
            resp = client.post("/", json={
                "feature": "tutor",
                "rating":  "up",
                "subject": "Biology",
            })
        assert resp.status_code == 204
        # Find the JSON log line.
        records = [r for r in caplog.records if r.message.startswith("{")]
        assert records, "expected a JSON log line"
        record = json.loads(records[-1].message)
        assert record["event"] == "user_feedback"
        assert record["feature"] == "tutor"
        assert record["rating"] == "up"
        assert record["subject"] == "Biology"
        # EMF block present.
        assert "_aws" in record
        assert record["FeedbackCount"] == 1


class TestInputValidation:
    def test_invalid_feature_rejected(self, app_for):
        _, client = app_for("feedback_collector")
        resp = client.post("/", json={"feature": "hacking", "rating": "up"})
        assert resp.status_code == 400

    def test_invalid_rating_rejected(self, app_for):
        _, client = app_for("feedback_collector")
        resp = client.post("/", json={"feature": "tutor", "rating": "meh"})
        assert resp.status_code == 400

    def test_unknown_subject_falls_back_silently(self, app_for):
        _, client = app_for("feedback_collector")
        # `sanitize_subject` maps unknown subjects to Biology — feedback
        # still goes through.
        resp = client.post("/", json={
            "feature": "tutor", "rating": "up", "subject": "Astrology",
        })
        assert resp.status_code == 204

    def test_long_context_truncated(self, app_for, caplog):
        _, client = app_for("feedback_collector")
        with caplog.at_level(logging.INFO):
            client.post("/", json={
                "feature": "tutor", "rating": "up",
                "context": "x" * 5000,
            })
        records = [r for r in caplog.records if r.message.startswith("{")]
        record = json.loads(records[-1].message)
        # Cap at 200 chars per validators.sanitize_topic with that max_len.
        assert len(record["context"]) <= 200


class TestCors:
    def test_options_preflight_succeeds(self, app_for):
        _, client = app_for("feedback_collector")
        resp = client.open("/", method="OPTIONS")
        assert resp.status_code == 200

    def test_get_returns_health_text(self, app_for):
        _, client = app_for("feedback_collector")
        resp = client.get("/")
        assert resp.status_code == 200
        assert b"ready" in resp.data.lower()

"""Pure-function tests for `validators.py`."""

import base64

import pytest
from validators import (  # noqa: E402
    MAX_FILE_SIZE,
    MAX_TOPIC_LENGTH,
    sanitize_difficulty,
    sanitize_subject,
    sanitize_topic,
    trim_history,
    validate_file,
)


class TestSanitizeSubject:
    def test_allowlist_passes(self):
        for s in ["Biology", "Chemistry", "Physics", "Science"]:
            assert sanitize_subject(s) == s

    def test_unknown_falls_back_to_biology(self):
        assert sanitize_subject("Astrology") == "Biology"
        assert sanitize_subject("") == "Biology"
        assert sanitize_subject(None) == "Biology"

    def test_case_sensitive(self):
        # The allowlist is case-sensitive on purpose; case-folding could let
        # prompt-injection variants like "biology<script>" slip through.
        assert sanitize_subject("biology") == "Biology"


class TestSanitizeDifficulty:
    def test_allowlist_passes(self):
        for d in ["Beginner", "Standard", "Expert", "Master"]:
            assert sanitize_difficulty(d) == d

    def test_unknown_defaults_to_standard(self):
        assert sanitize_difficulty("Trivial") == "Standard"


class TestSanitizeTopic:
    def test_truncates_to_default_max_length(self):
        s = "a" * (MAX_TOPIC_LENGTH + 50)
        assert len(sanitize_topic(s)) == MAX_TOPIC_LENGTH

    def test_strips_surrounding_whitespace(self):
        assert sanitize_topic("   hello   ") == "hello"

    def test_handles_none_and_empty(self):
        assert sanitize_topic(None) == ""
        assert sanitize_topic("") == ""

    def test_custom_max_length_respected(self):
        assert len(sanitize_topic("z" * 1000, max_len=50)) == 50

    def test_preserves_unicode(self):
        # Subject names sometimes include en-dash and accents; keep them.
        assert sanitize_topic("Newton — laws") == "Newton — laws"


class TestValidateFile:
    def test_no_file_returns_no_error(self):
        raw, err = validate_file(None, None)
        assert raw is None
        assert err is None

    def test_valid_base64_decodes(self):
        payload = b"hello world"
        b64 = base64.b64encode(payload).decode()
        raw, err = validate_file(b64, "text/plain")
        assert raw == payload
        assert err is None

    def test_invalid_base64_returns_error(self):
        raw, err = validate_file("not!!base64!!!", "text/plain")
        assert raw is None
        assert err is not None
        # Error must be user-friendly, not a Python traceback fragment.
        assert "decode" in err.lower() or "could not" in err.lower()

    def test_oversized_file_rejected(self):
        # Build a base64 string that decodes to MAX_FILE_SIZE + 1 bytes.
        oversized = b"x" * (MAX_FILE_SIZE + 1)
        b64 = base64.b64encode(oversized).decode()
        raw, err = validate_file(b64, "application/pdf")
        assert raw is None
        assert err is not None
        assert "too large" in err.lower() or "maximum" in err.lower()


class TestTrimHistory:
    def test_returns_empty_for_empty(self):
        assert trim_history([]) == []
        assert trim_history(None) == []

    def test_keeps_recent_turns(self):
        history = [{"role": "user", "content": str(i)} for i in range(30)]
        trimmed = trim_history(history, max_turns=10)
        assert len(trimmed) == 10
        # Should keep the LATEST 10, not the first 10.
        assert trimmed[0]["content"] == "20"
        assert trimmed[-1]["content"] == "29"

    def test_under_cap_passes_through(self):
        history = [{"role": "user", "content": "hi"}]
        assert trim_history(history, max_turns=20) == history

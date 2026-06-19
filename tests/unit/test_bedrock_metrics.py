"""Tests for the structured AI-call logger."""

import json
import logging

import pytest
from bedrock_metrics import EMF_NAMESPACE, CallTimer, extract_usage, log_ai_call


class TestExtractUsage:
    def test_anthropic_payload(self):
        payload = {"usage": {"input_tokens": 120, "output_tokens": 340}}
        assert extract_usage(payload) == (120, 340)

    def test_payload_without_usage(self):
        # Stability / Titan responses look like this — no usage block.
        assert extract_usage({"images": ["abc"]}) == (None, None)

    def test_partial_usage(self):
        # Some providers report only one side; missing field stays None.
        assert extract_usage({"usage": {"input_tokens": 5}}) == (5, None)

    def test_non_dict(self):
        assert extract_usage(None) == (None, None)
        assert extract_usage("garbage") == (None, None)


class TestLogAiCall:
    def test_emits_structured_record(self, caplog):
        with caplog.at_level(logging.INFO, logger="bedrock_metrics"):
            log_ai_call(
                function_name="chapter_assistant",
                model_id="claude-haiku-4-5",
                latency_ms=42.7,
                status="ok",
                input_tokens=100,
                output_tokens=200,
                mode="list",
            )
        # The logger emits a single JSON line.
        assert len(caplog.records) == 1
        record = json.loads(caplog.records[0].message)
        assert record["event"] == "ai_invocation"
        assert record["function"] == "chapter_assistant"
        assert record["model_id"] == "claude-haiku-4-5"
        assert record["latency_ms"] == 42  # truncated to int
        assert record["status"] == "ok"
        assert record["input_tokens"] == 100
        assert record["output_tokens"] == 200
        assert record["mode"] == "list"

    def test_emits_emf_block(self, caplog):
        with caplog.at_level(logging.INFO, logger="bedrock_metrics"):
            log_ai_call(
                function_name="image_generator",
                model_id="stability.sd3-5-large-v1:0",
                latency_ms=15000,
                status="ok",
            )
        record = json.loads(caplog.records[0].message)
        assert "_aws" in record
        emf = record["_aws"]
        assert emf["CloudWatchMetrics"][0]["Namespace"] == EMF_NAMESPACE
        # EMF requires the metric values at the top level of the record.
        assert record["LatencyMs"] == 15000
        assert record["Errors"] == 0
        # Tokens default to 0 in EMF when None — CloudWatch can't aggregate null.
        assert record["InputTokens"] == 0
        assert record["OutputTokens"] == 0

    def test_error_status_increments_errors_metric(self, caplog):
        with caplog.at_level(logging.INFO, logger="bedrock_metrics"):
            log_ai_call(
                function_name="flashcard_generator",
                model_id="claude-haiku-4-5",
                latency_ms=80,
                status="error",
                error_code="ThrottlingException",
            )
        record = json.loads(caplog.records[0].message)
        assert record["status"] == "error"
        assert record["Errors"] == 1
        assert record["error_code"] == "ThrottlingException"

    def test_keyword_only_args_enforced(self):
        # Adding a positional kwarg accidentally is rejected — guards against
        # silent argument-order bugs in future refactors.
        with pytest.raises(TypeError):
            log_ai_call("chapter_assistant", "claude", 100, "ok")  # type: ignore


class TestCallTimer:
    def test_measures_elapsed(self):
        with CallTimer() as t:
            sum(range(1000))
        assert t.elapsed_ms >= 0

    def test_does_not_swallow_exceptions(self):
        with pytest.raises(ValueError):
            with CallTimer():
                raise ValueError("boom")

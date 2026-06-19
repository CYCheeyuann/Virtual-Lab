"""Structured logging + CloudWatch EMF metrics for Bedrock calls.

Every AI invocation goes through one of two helpers:
  * `stream_bedrock`           — streaming path (in bedrock_stream.py)
  * `invoke_bedrock_buffered`  — non-streaming path (in bedrock_stream.py)

Both call `log_ai_call` here exactly once per invocation, regardless of
whether the call succeeded, threw a Bedrock ClientError, or got an empty
response. The log line is JSON and contains every dimension we need to
investigate a cost or latency spike after the fact:

    function, model_id, mode, latency_ms, status, input_tokens,
    output_tokens, error_code

The same log line embeds a CloudWatch Embedded Metric Format (EMF) block
under the `_aws` key. CloudWatch's log-extraction pipeline turns that into
custom metrics under the namespace named in `METRICS_NAMESPACE` (default
"VirtualScienceLab/AI"), so we get LatencyMs / InputTokens / OutputTokens /
Errors metrics per-function-per-model with no separate `PutMetricData` API
call. EMF is the cheapest way to ship custom metrics from Lambda — see
https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html

Tokens are reported as `null` when the response carries no usage block
(Stability and Titan image responses don't), so dashboards must treat
those nulls as expected, not as errors.
"""

import json
import logging
import os
import time

logger = logging.getLogger("bedrock_metrics")

EMF_NAMESPACE = os.environ.get("METRICS_NAMESPACE", "VirtualScienceLab/AI")


def extract_usage(response_payload):
    """Pull (input_tokens, output_tokens) out of a Bedrock invoke_model body.

    Anthropic format: top-level `usage: {input_tokens, output_tokens}`.
    Stability / Titan: no usage block — both come back as None.
    """
    if not isinstance(response_payload, dict):
        return None, None
    usage = response_payload.get("usage") or {}
    return usage.get("input_tokens"), usage.get("output_tokens")


def _coerce_int(v):
    """Return v as int, or 0 if unknown / non-numeric (EMF wants numbers)."""
    if v is None:
        return 0
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def log_ai_call(
    *,
    function_name,
    model_id,
    latency_ms,
    status,
    input_tokens=None,
    output_tokens=None,
    mode=None,
    error_code=None,
):
    """Emit one structured JSON log line + EMF metric block for an AI call.

    Parameters are keyword-only on purpose so a future field (e.g. cost
    estimate) can be added without breaking call sites.
    """
    record = {
        "event": "ai_invocation",
        "function": function_name,
        "model_id": model_id,
        "latency_ms": int(latency_ms),
        "status": status,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
    }
    if mode:
        record["mode"] = mode
    if error_code:
        record["error_code"] = error_code

    # EMF block — CloudWatch reads this and emits proper metrics.
    record["_aws"] = {
        "Timestamp": int(time.time() * 1000),
        "CloudWatchMetrics": [
            {
                "Namespace": EMF_NAMESPACE,
                "Dimensions": [["function", "model_id"]],
                "Metrics": [
                    {"Name": "LatencyMs",    "Unit": "Milliseconds"},
                    {"Name": "InputTokens",  "Unit": "Count"},
                    {"Name": "OutputTokens", "Unit": "Count"},
                    {"Name": "Errors",       "Unit": "Count"},
                ],
            }
        ],
    }
    record["LatencyMs"]    = int(latency_ms)
    record["InputTokens"]  = _coerce_int(input_tokens)
    record["OutputTokens"] = _coerce_int(output_tokens)
    record["Errors"]       = 0 if status == "ok" else 1

    logger.info(json.dumps(record, default=str))
    return record  # returning helps tests assert on shape


# ── Helpers for the call-site wrappers ──────────────────────────────────────
class CallTimer:
    """Tiny context manager so callers don't repeat time.perf_counter() math.

    Usage:
        with CallTimer() as t:
            ... do bedrock work ...
        log_ai_call(latency_ms=t.elapsed_ms, ...)
    """

    def __enter__(self):
        self._start = time.perf_counter()
        self.elapsed_ms = 0
        return self

    def __exit__(self, exc_type, exc, tb):
        self.elapsed_ms = (time.perf_counter() - self._start) * 1000
        return False  # never swallow exceptions

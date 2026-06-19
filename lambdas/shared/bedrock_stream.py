"""Shared Bedrock streaming + buffered helpers — DRY utility for all Lambdas.

Two public entry points:

  * `stream_bedrock(messages, ...)` — streaming text. Yields text chunks while
    quietly harvesting `input_tokens` / `output_tokens` / `stop_reason` from
    the Anthropic stream's `message_start` and `message_delta` events.

  * `invoke_bedrock_buffered(client, model_id, body, ...)` — non-streaming
    invoke_model. Returns the parsed JSON payload and emits the same
    structured usage record before returning.

Both paths flow through `log_ai_call` in `bedrock_metrics.py`, so every AI
invocation produces exactly one JSON log line that doubles as a CloudWatch
EMF metric source.
"""

import json
import logging
import os

import boto3
from bedrock_metrics import CallTimer, extract_usage, log_ai_call
from botocore.config import Config
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

REGION = os.environ.get("BEDROCK_REGION", "ap-southeast-1")
MODEL_ID = os.environ.get("MODEL_ID", "global.anthropic.claude-haiku-4-5-20251001-v1:0")

_client = None


def _default_function_name():
    """Resolve a short, log-friendly function label.

    Each Lambda's app.py sets AI_FUNCTION_NAME via env var (or passes
    `function_name=` explicitly). Falls back to AWS_LAMBDA_FUNCTION_NAME
    for forgotten cases, and finally "unknown".
    """
    return (
        os.environ.get("AI_FUNCTION_NAME")
        or os.environ.get("AWS_LAMBDA_FUNCTION_NAME")
        or "unknown"
    )


def get_client():
    """Lazy-init singleton Bedrock client.

    Configured with:
      - adaptive retries (up to 4 attempts) so transient ThrottlingException
        and ModelStreamErrorException are absorbed automatically rather than
        bubbling straight to the user.
      - explicit connect / read timeouts. Default boto3 read timeout is 60s
        which is shorter than our Lambda timeout (180s) — without an
        explicit override, a slow Bedrock response truncates streaming
        mid-flight with a confusing socket error.
    """
    global _client
    if _client is None:
        cfg = Config(
            region_name=REGION,
            connect_timeout=10,
            # 170s leaves headroom for the 180s Lambda timeout to return a
            # graceful error instead of being killed by the runtime.
            read_timeout=170,
            retries={"max_attempts": 4, "mode": "adaptive"},
        )
        _client = boto3.client("bedrock-runtime", config=cfg)
    return _client


def _friendly_error(error_code, message):
    """Map a Bedrock error code to a user-friendly message."""
    mapping = {
        "AccessDeniedException": (
            "⚠️ Access denied. The AI model may not be enabled for this account "
            "or region. Please verify Bedrock model access."
        ),
        "ValidationException": f"⚠️ Request validation error: {message}",
        "ThrottlingException": "⚠️ Too many requests. Please wait a moment and try again.",
        "ModelTimeoutException": "⚠️ The AI model timed out. Please try a shorter prompt.",
        "ModelNotReadyException": "⚠️ The AI model is not ready. Please retry in a few seconds.",
        "ModelStreamErrorException": "⚠️ Streaming error from the AI model. Please try again.",
        "ModelErrorException": "⚠️ The AI model returned an error. Please try again.",
        "ResourceNotFoundException": (
            "⚠️ Model not found. Open AWS Console → Bedrock → Model access in "
            "the model's home region and verify access has been granted "
            "(MODEL_ID + region must both match a model your account can use)."
        ),
        "ServiceQuotaExceededException": (
            "⚠️ Service quota exceeded. Please try again later."
        ),
        "InternalServerException": "⚠️ Bedrock internal error. Please try again later.",
    }
    return mapping.get(
        error_code,
        f"⚠️ An error occurred ({error_code or 'Unknown'}). Please try again later.",
    )


# Public alias so other lambdas can render the same friendly error text.
friendly_error = _friendly_error


def stream_bedrock(messages, system=None, max_tokens=4096, *, function_name=None, mode=None):
    """Yield text chunks from invoke_model_with_response_stream.

    Quietly harvests usage fields out of the stream's bookkeeping events
    (`message_start` carries input_tokens; `message_delta` carries
    output_tokens). One structured log line is emitted at the end of the
    stream, regardless of how the call ended.
    """
    client = get_client()
    function_name = function_name or _default_function_name()
    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": max_tokens,
        "messages": messages,
    }
    if system:
        body["system"] = system

    logger.info(
        "Invoking Bedrock model=%s region=%s max_tokens=%s",
        MODEL_ID, REGION, max_tokens,
    )

    input_tokens = None
    output_tokens = None
    status = "ok"
    error_code = None
    timer = CallTimer()
    timer.__enter__()

    try:
        response = client.invoke_model_with_response_stream(
            modelId=MODEL_ID,
            body=json.dumps(body),
        )
        for event in response["body"]:
            chunk = event.get("chunk")
            if not chunk:
                continue
            try:
                data = json.loads(chunk["bytes"])
            except (ValueError, TypeError):
                continue

            etype = data.get("type")

            if etype == "message_start":
                # Anthropic event: data["message"]["usage"]["input_tokens"]
                msg = data.get("message") or {}
                u = msg.get("usage") or {}
                if u.get("input_tokens") is not None:
                    input_tokens = u.get("input_tokens")
            elif etype == "message_delta":
                u = data.get("usage") or {}
                if u.get("output_tokens") is not None:
                    output_tokens = u.get("output_tokens")
            elif etype == "content_block_delta":
                delta = data.get("delta") or {}
                # Only forward visible text. Skip "thinking_delta",
                # "input_json_delta", etc.
                if delta.get("type") and delta.get("type") != "text_delta":
                    continue
                text = delta.get("text", "")
                if text:
                    yield text
    except ClientError as e:
        status = "error"
        error_code = e.response.get("Error", {}).get("Code", "")
        msg = e.response.get("Error", {}).get("Message", str(e))
        logger.exception(
            "Bedrock ClientError code=%s model=%s region=%s message=%s",
            error_code, MODEL_ID, REGION, msg,
        )
        yield "\n\n" + _friendly_error(error_code, msg)
    except Exception as e:
        status = "error"
        error_code = type(e).__name__
        logger.exception(
            "Bedrock invocation failed model=%s region=%s", MODEL_ID, REGION,
        )
        yield f"\n\n⚠️ An unexpected error occurred ({error_code}). Please try again later."
    finally:
        timer.__exit__(None, None, None)
        log_ai_call(
            function_name=function_name,
            model_id=MODEL_ID,
            latency_ms=timer.elapsed_ms,
            status=status,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            mode=mode or "stream",
            error_code=error_code,
        )


def invoke_bedrock_buffered(
    client,
    model_id,
    body,
    *,
    function_name=None,
    mode=None,
):
    """Run a non-streaming `invoke_model` call and emit one usage log line.

    Returns the parsed JSON payload (the same object the caller would have
    obtained via `json.loads(resp["body"].read())`). Re-raises Bedrock /
    JSON errors after logging so callers can keep their existing
    error-handling branches.
    """
    function_name = function_name or _default_function_name()
    timer = CallTimer()
    timer.__enter__()
    try:
        resp = client.invoke_model(modelId=model_id, body=body)
        payload = json.loads(resp["body"].read())
    except ClientError as e:
        timer.__exit__(None, None, None)
        log_ai_call(
            function_name=function_name,
            model_id=model_id,
            latency_ms=timer.elapsed_ms,
            status="error",
            mode=mode,
            error_code=e.response.get("Error", {}).get("Code", "ClientError"),
        )
        raise
    except Exception as e:
        timer.__exit__(None, None, None)
        log_ai_call(
            function_name=function_name,
            model_id=model_id,
            latency_ms=timer.elapsed_ms,
            status="error",
            mode=mode,
            error_code=type(e).__name__,
        )
        raise

    timer.__exit__(None, None, None)
    input_tokens, output_tokens = extract_usage(payload)
    log_ai_call(
        function_name=function_name,
        model_id=model_id,
        latency_ms=timer.elapsed_ms,
        status="ok",
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        mode=mode,
    )
    return payload

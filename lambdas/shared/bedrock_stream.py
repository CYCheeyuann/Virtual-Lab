"""Shared Bedrock streaming helper — DRY utility for all Lambdas."""

import json
import logging
import os
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

REGION = os.environ.get("BEDROCK_REGION", "ap-southeast-1")
MODEL_ID = os.environ.get("MODEL_ID", "global.anthropic.claude-haiku-4-5-20251001-v1:0")

_client = None


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


def stream_bedrock(messages, system=None, max_tokens=4096):
    """
    Generator that yields text chunks from Bedrock invoke_model_with_response_stream.
    Catches exceptions gracefully so the frontend gets a friendly error message
    while preserving the real error in CloudWatch logs.
    """
    client = get_client()
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

    try:
        response = client.invoke_model_with_response_stream(
            modelId=MODEL_ID,
            body=json.dumps(body),
        )
        for event in response["body"]:
            chunk = event.get("chunk")
            if not chunk:
                continue
            data = json.loads(chunk["bytes"])
            if data.get("type") != "content_block_delta":
                continue
            delta = data.get("delta", {}) or {}
            # Only forward visible text. Skip "thinking_delta", "input_json_delta", etc.
            if delta.get("type") and delta.get("type") != "text_delta":
                continue
            text = delta.get("text", "")
            if text:
                yield text
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        msg = e.response.get("Error", {}).get("Message", str(e))
        logger.exception(
            "Bedrock ClientError code=%s model=%s region=%s message=%s",
            code, MODEL_ID, REGION, msg,
        )
        yield "\n\n" + _friendly_error(code, msg)
    except Exception as e:
        logger.exception(
            "Bedrock invocation failed model=%s region=%s", MODEL_ID, REGION,
        )
        yield f"\n\n⚠️ An unexpected error occurred ({type(e).__name__}). Please try again later."

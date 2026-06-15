"""Shared Bedrock streaming helper — DRY utility for all Lambdas."""

import json
import logging
import os
import boto3
from botocore.exceptions import ClientError, BotoCoreError

logger = logging.getLogger(__name__)

REGION = os.environ.get("BEDROCK_REGION", "ap-southeast-1")
MODEL_ID = os.environ.get("MODEL_ID", "global.anthropic.claude-sonnet-4-6-20260217-v1:0")

_client = None


def get_client():
    """Lazy-init singleton Bedrock client."""
    global _client
    if _client is None:
        _client = boto3.client("bedrock-runtime", region_name=REGION)
    return _client


def _format_error(message):
    """User-facing error message with model/region context appended."""
    return (
        f"\n\n⚠️ {message}\n"
        f"_Model: `{MODEL_ID}` · Region: `{REGION}`_"
    )


def _handle_client_error(e):
    """Map a botocore ClientError to a friendly streaming message."""
    err = e.response.get("Error", {}) if hasattr(e, "response") else {}
    code = err.get("Code", "ClientError")
    msg = err.get("Message", str(e))
    logger.exception(
        "Bedrock ClientError code=%s model=%s region=%s message=%s",
        code, MODEL_ID, REGION, msg,
    )
    if code == "AccessDeniedException":
        return _format_error(
            "Access denied. Enable Claude Sonnet 4.6 in Bedrock → Model access, "
            "and verify the Lambda IAM role has `bedrock:InvokeModelWithResponseStream`."
        )
    if code == "ValidationException":
        return _format_error(f"Request validation error: {msg}")
    if code == "ThrottlingException":
        return _format_error("Too many requests. Please wait a moment and try again.")
    if code == "ResourceNotFoundException":
        return _format_error(
            f"Model not found. Check that the inference profile is available in {REGION}."
        )
    if code in ("ModelTimeoutException", "ModelErrorException"):
        return _format_error("The AI model timed out. Try a shorter prompt.")
    if code == "ServiceQuotaExceededException":
        return _format_error("Service quota exceeded. Try again later.")
    return _format_error(f"AWS error ({code}): {msg}")


def stream_bedrock(messages, system=None, max_tokens=4096):
    """
    Generator that yields text chunks from Bedrock invoke_model_with_response_stream.
    Catches exceptions gracefully and surfaces meaningful error messages to the frontend.
    """
    client = get_client()
    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": max_tokens,
        "messages": messages,
    }
    if system:
        body["system"] = system

    # ─── 1. Initial invocation ─────────────────────────────────────────
    try:
        response = client.invoke_model_with_response_stream(
            modelId=MODEL_ID,
            body=json.dumps(body),
        )
    except ClientError as e:
        yield _handle_client_error(e)
        return
    except BotoCoreError as e:
        logger.exception(
            "Bedrock BotoCoreError model=%s region=%s", MODEL_ID, REGION
        )
        yield _format_error(f"AWS SDK error: {type(e).__name__}")
        return
    except Exception as e:
        logger.exception(
            "Bedrock invoke setup failed model=%s region=%s", MODEL_ID, REGION
        )
        yield _format_error(f"Unexpected error: {type(e).__name__}")
        return

    # ─── 2. Stream consumption ─────────────────────────────────────────
    try:
        for event in response["body"]:
            # Mid-stream error events surfaced as keys in the event dict
            if "internalServerException" in event:
                logger.error("Bedrock internalServerException: %s", event["internalServerException"])
                yield _format_error("Internal server error during streaming.")
                return
            if "modelStreamErrorException" in event:
                logger.error("Bedrock modelStreamErrorException: %s", event["modelStreamErrorException"])
                yield _format_error("Model stream error during generation.")
                return
            if "validationException" in event:
                detail = event["validationException"].get("message", "")
                logger.error("Bedrock mid-stream validationException: %s", detail)
                yield _format_error(f"Validation error: {detail}")
                return
            if "throttlingException" in event:
                logger.error("Bedrock mid-stream throttlingException")
                yield _format_error("Throttled mid-stream. Please retry.")
                return
            if "modelTimeoutException" in event:
                logger.error("Bedrock mid-stream modelTimeoutException")
                yield _format_error("Model timed out mid-stream.")
                return

            chunk = event.get("chunk")
            if not chunk:
                continue
            data = json.loads(chunk["bytes"])
            if data.get("type") != "content_block_delta":
                continue

            delta = data.get("delta", {})
            delta_type = delta.get("type")
            # Only forward visible text. Skip thinking_delta / input_json_delta etc.
            if delta_type == "text_delta":
                text = delta.get("text", "")
                if text:
                    yield text
            elif delta_type is None and delta.get("text"):
                # Backwards-compat for older schemas without explicit delta.type
                yield delta["text"]
    except ClientError as e:
        yield _handle_client_error(e)
    except Exception as e:
        logger.exception(
            "Bedrock stream consumption failed model=%s region=%s", MODEL_ID, REGION
        )
        yield _format_error(f"Stream error: {type(e).__name__}")

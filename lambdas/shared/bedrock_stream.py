"""Shared Bedrock streaming helper — DRY utility for all Lambdas."""

import json
import logging
import os
import boto3

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


def stream_bedrock(messages, system=None, max_tokens=4096):
    """
    Generator that yields text chunks from Bedrock invoke_model_with_response_stream.
    Catches exceptions gracefully so the frontend gets a friendly error.
    """
    client = get_client()
    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": max_tokens,
        "messages": messages,
    }
    if system:
        body["system"] = system

    try:
        response = client.invoke_model_with_response_stream(
            modelId=MODEL_ID,
            body=json.dumps(body),
        )
        for event in response["body"]:
            chunk = event.get("chunk")
            if chunk:
                data = json.loads(chunk["bytes"])
                if data.get("type") == "content_block_delta":
                    text = data["delta"].get("text", "")
                    if text:
                        yield text
    except Exception:
        logger.exception("Bedrock invocation failed")
        yield "\n\n⚠️ An error occurred while generating the response. Please try again later."

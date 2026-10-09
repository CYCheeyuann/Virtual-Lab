import io
import json
from unittest.mock import Mock

import bedrock_stream
from bedrock_stream import invoke_bedrock_buffered


def test_haiku55_low_effort_preserves_messages():
    client = Mock()
    client.invoke_model.return_value = {"body": io.BytesIO(b'{"content": []}')}
    request = {"messages": [{"role": "user", "content": "hello"}], "max_tokens": 1000}
    invoke_bedrock_buffered(client, "global.anthropic.claude-haiku-5-5", json.dumps(request))
    sent = json.loads(client.invoke_model.call_args.kwargs["body"])
    assert sent["messages"] == request["messages"]
    assert sent["output_config"] == {"effort": "low"}


def test_haiku55_preserves_explicit_effort():
    client = Mock()
    client.invoke_model.return_value = {"body": io.BytesIO(b'{}')}
    request = {"output_config": {"effort": "medium"}}
    invoke_bedrock_buffered(client, "global.anthropic.claude-haiku-5-5", json.dumps(request))
    assert json.loads(client.invoke_model.call_args.kwargs["body"]) == request


def test_image_request_is_not_changed():
    client = Mock()
    client.invoke_model.return_value = {"body": io.BytesIO(b'{"images": []}')}
    body = '{"prompt": "a laboratory", "seed": 42}'
    invoke_bedrock_buffered(client, "stability.sd3-5-large-v1:0", body)
    assert client.invoke_model.call_args.kwargs["body"] == body


def test_stream_ignores_thinking_and_yields_answer(monkeypatch):
    client = Mock()
    events = [
        {"type": "content_block_delta", "delta": {"type": "thinking_delta", "thinking": "hidden"}},
        {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "answer"}},
    ]
    client.invoke_model_with_response_stream.return_value = {
        "body": [{"chunk": {"bytes": json.dumps(event).encode()}} for event in events]
    }
    monkeypatch.setattr(bedrock_stream, "MODEL_ID", "global.anthropic.claude-haiku-5-5")
    monkeypatch.setattr(bedrock_stream, "get_client", lambda: client)
    assert list(bedrock_stream.stream_bedrock([{"role": "user", "content": "hello"}])) == ["answer"]
    request = json.loads(client.invoke_model_with_response_stream.call_args.kwargs["body"])
    assert request["output_config"]["effort"] == "low"

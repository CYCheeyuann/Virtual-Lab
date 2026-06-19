"""Shared pytest fixtures for Lambda + shared-module tests.

Design notes
------------
- Each Lambda is loaded by absolute path via `importlib.util.spec_from_file_location`
  with a unique module name so the 9 Flask apps don't clash on `__name__`.
- `lambdas/shared/` is added to `sys.path` once at session start so each app's
  `from cors import …` style import works the same way it does in production.
- The `mock_bedrock` fixture replaces `boto3.client` with a single MagicMock,
  resets cached client globals across all loaded Lambda modules, and exposes
  three helpers — `set_text_response`, `set_image_response`, `set_stream_chunks`
  — so individual tests don't need to know the Bedrock wire format.

All tests are offline by default. Anything that needs real AWS access must be
marked `@pytest.mark.live` (skipped unless `RUN_LIVE_TESTS=1`).
"""

import importlib.util
import json
import os
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

ROOT = Path(__file__).resolve().parent.parent
LAMBDAS_DIR = ROOT / "lambdas"
SHARED_DIR = LAMBDAS_DIR / "shared"

if str(SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(SHARED_DIR))

# Cache loaded Lambda modules so the same Flask `app` object is reused across
# tests in the same session — Flask app construction is fine to repeat but
# caching it makes test runs measurably faster.
_LOADED: dict = {}

ALL_LAMBDAS = (
    "chapter_assistant",
    "experiment_guide",
    "flashcard_generator",
    "image_generator",
    "safety_assistant",
    "science_quiz",
    "science_tutor",
    "scientific_object_generator",
    "what_happens_if",
)


def load_lambda(name):
    """Load a Lambda's `app.py` as a uniquely-named module."""
    if name in _LOADED:
        return _LOADED[name]
    path = LAMBDAS_DIR / name / "app.py"
    if not path.exists():
        raise FileNotFoundError(f"Lambda not found: {path}")
    spec = importlib.util.spec_from_file_location(f"_lambda_{name}", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    _LOADED[name] = module
    return module


def _build_invoke_response(text):
    """Shape a fake Bedrock invoke_model response with the given text."""
    body_payload = {"content": [{"type": "text", "text": text}]}
    body_mock = MagicMock()
    body_mock.read.return_value = json.dumps(body_payload).encode("utf-8")
    return {"body": body_mock}


def _build_image_response(b64):
    """Shape a fake Stability/Titan invoke_model response."""
    body_mock = MagicMock()
    body_mock.read.return_value = json.dumps({"images": [b64]}).encode("utf-8")
    return {"body": body_mock}


def _build_stream(chunks):
    """Shape a fake invoke_model_with_response_stream response."""
    events = []
    for c in chunks:
        chunk_data = {
            "type": "content_block_delta",
            "delta": {"type": "text_delta", "text": c},
        }
        events.append({"chunk": {"bytes": json.dumps(chunk_data).encode("utf-8")}})
    return {"body": iter(events)}


@pytest.fixture
def mock_bedrock(monkeypatch):
    """Replace `boto3.client` with a Mock and clear any cached clients.

    Returns the mock so individual tests can configure responses or assert
    on `invoke_model.call_args`.
    """
    import boto3

    mock = MagicMock(name="bedrock_client_mock")

    def _factory(*args, **kwargs):
        return mock

    monkeypatch.setattr(boto3, "client", _factory)

    # Reset the cached client in the shared helper.
    import bedrock_stream

    bedrock_stream._client = None

    # Lambdas that have their own per-region clients also need their cached
    # globals reset so the mock factory is picked up the next time.
    for mod_name in ("_lambda_image_generator", "_lambda_scientific_object_generator"):
        mod = sys.modules.get(mod_name)
        if mod is not None:
            if hasattr(mod, "_text_client"):
                mod._text_client = None
            if hasattr(mod, "_image_client"):
                mod._image_client = None

    # Default: empty text response. Tests should override with a helper below
    # so they're explicit about what Claude "returned".
    mock.invoke_model.return_value = _build_invoke_response("")
    mock.invoke_model_with_response_stream.return_value = _build_stream([])

    # Convenience helpers attached to the mock so tests read naturally.
    mock.set_text_response = lambda text: setattr(
        mock, "invoke_model",
        MagicMock(return_value=_build_invoke_response(text), wraps=None),
    )
    mock.set_image_response = lambda b64: setattr(
        mock, "invoke_model",
        MagicMock(return_value=_build_image_response(b64), wraps=None),
    )
    mock.set_stream_chunks = lambda chunks: setattr(
        mock, "invoke_model_with_response_stream",
        MagicMock(return_value=_build_stream(chunks), wraps=None),
    )

    return mock


@pytest.fixture
def app_for():
    """Factory: load a Lambda app and return (module, Flask test client)."""
    def _make(name):
        mod = load_lambda(name)
        return mod, mod.app.test_client()
    return _make


@pytest.fixture(scope="session")
def adversarial_inputs():
    """Load the adversarial input corpus once per session."""
    path = Path(__file__).parent / "fixtures" / "adversarial_inputs.json"
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="session")
def schemas():
    """Single import surface for output JSON schemas."""
    from tests import schemas as s
    return s


def pytest_collection_modifyitems(config, items):
    """Skip @pytest.mark.live tests unless RUN_LIVE_TESTS=1."""
    if os.environ.get("RUN_LIVE_TESTS") == "1":
        return
    skip_live = pytest.mark.skip(reason="live AWS — set RUN_LIVE_TESTS=1 to enable")
    for item in items:
        if "live" in item.keywords:
            item.add_marker(skip_live)


# Helper: get the body Claude was last invoked with.
def last_invoke_body(mock_bedrock):
    """Return the parsed JSON body of the most recent invoke_model call."""
    call = mock_bedrock.invoke_model.call_args
    if call is None:
        return None
    body_kw = call.kwargs.get("body") or (call.args[1] if len(call.args) > 1 else None)
    if body_kw is None:
        return None
    return json.loads(body_kw)


# Re-export so test files can import without reaching into conftest globals.
__all__ = ["load_lambda", "ALL_LAMBDAS", "last_invoke_body"]

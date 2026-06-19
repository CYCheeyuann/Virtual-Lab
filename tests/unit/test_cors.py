"""Tests for the shared CORS helper.

`cors.ALLOWED_ORIGIN` is read from the env var at import time, so to test
the variants we reload the module under different env values.
"""

import importlib

import pytest


def _reload_cors_with(env, monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGIN", env)
    import cors
    return importlib.reload(cors)


class TestCorsHeadersWithExplicitOrigin:
    def test_emits_allow_origin(self, monkeypatch):
        cors = _reload_cors_with("https://example.cloudfront.net", monkeypatch)
        h = cors.cors_headers()
        assert h["Access-Control-Allow-Origin"] == "https://example.cloudfront.net"

    def test_includes_x_api_key_header(self, monkeypatch):
        cors = _reload_cors_with("https://example.cloudfront.net", monkeypatch)
        h = cors.cors_headers()
        assert "X-Api-Key" in h["Access-Control-Allow-Headers"]

    def test_emits_security_headers(self, monkeypatch):
        cors = _reload_cors_with("https://example.cloudfront.net", monkeypatch)
        h = cors.cors_headers()
        assert h["X-Content-Type-Options"] == "nosniff"
        assert h["Access-Control-Max-Age"] == "3600"


class TestCorsHeadersWildcard:
    def test_wildcard_origin_strips_x_api_key(self, monkeypatch):
        # Per CORS spec, `*` is incompatible with credential-bearing headers.
        # The helper should drop X-Api-Key from Allow-Headers in that case.
        cors = _reload_cors_with("*", monkeypatch)
        h = cors.cors_headers()
        assert h["Access-Control-Allow-Origin"] == "*"
        assert "X-Api-Key" not in h["Access-Control-Allow-Headers"]


class TestPreflightResponse:
    def test_returns_200_with_headers(self, monkeypatch):
        cors = _reload_cors_with("https://example.cloudfront.net", monkeypatch)
        resp = cors.preflight_response()
        assert resp.status_code == 200
        assert resp.headers["Access-Control-Allow-Origin"] == "https://example.cloudfront.net"


@pytest.fixture(autouse=True)
def _reset_cors_after_test(monkeypatch):
    """Reset the env after every test so the next test starts fresh."""
    yield
    monkeypatch.delenv("ALLOWED_ORIGIN", raising=False)
    import cors
    importlib.reload(cors)

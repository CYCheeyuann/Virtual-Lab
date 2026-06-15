"""CORS helper — reads allowed origin from env var."""

import os
from flask import Response

ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")


def cors_headers():
    return {
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Headers": "Content-Type,X-Api-Key",
        "Access-Control-Allow-Methods": "POST,OPTIONS,GET",
    }


def preflight_response():
    return Response("", status=200, headers=cors_headers())

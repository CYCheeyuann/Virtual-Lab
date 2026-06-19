"""CORS helper — reads allowed origin from env var.

Production deploys pin ALLOWED_ORIGIN to the CloudFront HTTPS URL via the
GitHub Actions workflow. Falling back to "*" is only acceptable on the very
first bootstrap deploy before CloudFront exists. We log a warning when the
fallback fires so misconfigurations show up in CloudWatch.

Note: when ALLOWED_ORIGIN="*", we deliberately strip X-Api-Key from the
allow-headers list. Browsers reject the combination of `Access-Control-
Allow-Origin: *` together with credential-bearing headers, and quietly
returning 403 from CORS preflight is far harder to debug than this explicit
behaviour.
"""

import logging
import os

from flask import Response

logger = logging.getLogger(__name__)

ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")

if ALLOWED_ORIGIN == "*":
    logger.warning(
        "ALLOWED_ORIGIN is '*' — CORS is wide open. This should only happen "
        "on first-deploy bootstrap; redeploy once CloudFront is provisioned "
        "to lock CORS to the production origin."
    )


def cors_headers():
    headers = {
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Methods": "POST,OPTIONS,GET",
        # Cache preflight results for an hour so repeat requests from the
        # same browser don't re-OPTIONS on every fetch.
        "Access-Control-Max-Age": "3600",
        # Defense-in-depth: tells browsers not to MIME-sniff our JSON/text
        # responses as something executable.
        "X-Content-Type-Options": "nosniff",
    }
    if ALLOWED_ORIGIN == "*":
        # X-Api-Key incompatible with the wildcard origin per the CORS spec.
        headers["Access-Control-Allow-Headers"] = "Content-Type"
    else:
        headers["Access-Control-Allow-Headers"] = "Content-Type,X-Api-Key"
    return headers


def preflight_response():
    return Response("", status=200, headers=cors_headers())

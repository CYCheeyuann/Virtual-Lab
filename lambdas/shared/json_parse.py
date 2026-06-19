"""Shared JSON parsing helpers.

Claude periodically wraps JSON output in markdown code fences or adds a
sentence of preamble even when told not to. Every Lambda used to ship its
own near-duplicate cleanup logic; this module centralises it.
"""

import json
import logging

logger = logging.getLogger(__name__)


def strip_fences(text):
    """Strip leading/trailing ```json … ``` fences. Returns a plain string."""
    if not text:
        return ""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        nl = cleaned.find("\n")
        if nl != -1:
            cleaned = cleaned[nl + 1:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3].rstrip()
    return cleaned


def parse_json_safe(text, expect=None):
    """Strip fences, parse JSON, return None on failure.

    `expect` may be `dict` or `list` to require a specific top-level type;
    pass a tuple like `(dict, list)` to accept either. Mismatched shapes
    return None too.
    """
    cleaned = strip_fences(text)
    if not cleaned:
        return None
    obj = None
    try:
        obj = json.loads(cleaned)
    except (json.JSONDecodeError, ValueError):
        # Last-ditch: pull the first balanced {…} or […] block out of any
        # surrounding prose. Cheap and good enough for Claude's failure modes.
        for opener, closer in (("{", "}"), ("[", "]")):
            i = cleaned.find(opener)
            j = cleaned.rfind(closer)
            if 0 <= i < j:
                try:
                    obj = json.loads(cleaned[i:j + 1])
                    break
                except (json.JSONDecodeError, ValueError):
                    continue
    if obj is None:
        return None
    if expect is not None and not isinstance(obj, expect):
        return None
    return obj

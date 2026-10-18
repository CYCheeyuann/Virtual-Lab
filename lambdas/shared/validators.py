"""Input validation and sanitization utilities."""

import base64
import logging
import os

logger = logging.getLogger(__name__)

VALID_SUBJECTS = {"Biology", "Chemistry", "Physics", "Science"}
VALID_DIFFICULTIES = {"Beginner", "Standard", "Expert", "Master"}
MAX_TOPIC_LENGTH = 200
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB after base64 decode
MAX_HISTORY_TURNS = 20
API_KEY = os.environ.get("API_KEY", "")

# ── MIME allowlist + magic-byte signatures ────────────────────────────────────
ALLOWED_IMAGE_MIME = {"image/png", "image/jpeg", "image/webp", "image/gif"}
ALLOWED_DOC_MIME = {"application/pdf", "text/plain", "text/markdown"}
ALLOWED_MIME = ALLOWED_IMAGE_MIME | ALLOWED_DOC_MIME

_MAGIC = {
    "image/png": [b"\x89PNG\r\n\x1a\n"],
    "image/jpeg": [b"\xff\xd8\xff"],
    "image/gif": [b"GIF87a", b"GIF89a"],
    "application/pdf": [b"%PDF-"],
}


def validate_api_key(request):
    """Return True if API_KEY env is empty (disabled) or header matches."""
    if not API_KEY:
        return True
    return request.headers.get("X-Api-Key", "") == API_KEY


def sanitize_subject(value):
    # A non-string value (e.g. [] or {}) is unhashable, so ``value in
    # VALID_SUBJECTS`` would raise ``TypeError: unhashable type`` → 500.
    # Treat any non-string as "not a valid subject" and fall back safely.
    if not isinstance(value, str):
        return "Biology"
    return value if value in VALID_SUBJECTS else "Biology"


def sanitize_difficulty(value):
    return value if value in VALID_DIFFICULTIES else "Standard"


def sanitize_topic(value, max_len=MAX_TOPIC_LENGTH):
    return (value or "")[:max_len].strip()


def validate_file(file_data, file_mime):
    """
    Validate and decode base64 file_data.
    Returns (decoded_bytes, error_message).
    If error_message is not None, the file is invalid.
    """
    if not file_data or not file_mime:
        return None, None

    # Strict MIME allowlist
    if file_mime not in ALLOWED_MIME:
        return None, f"Unsupported file type: {file_mime}"

    try:
        raw = base64.b64decode(file_data, validate=True)
    except Exception as e:
        logger.warning(f"Base64 decode failed: {e}")
        return None, "The uploaded file could not be decoded."

    if len(raw) > MAX_FILE_SIZE:
        return None, f"File too large. Maximum size is {MAX_FILE_SIZE // (1024*1024)}MB."

    # Magic-byte verification (skip for text/* types)
    if file_mime == "image/webp":
        if not (raw[:4] == b"RIFF" and raw[8:12] == b"WEBP"):
            return None, "File contents do not match the declared type."
    else:
        sigs = _MAGIC.get(file_mime, [])
        if sigs and not any(raw.startswith(s) for s in sigs):
            return None, "File contents do not match the declared type."

    return raw, None


def trim_history(history, max_turns=MAX_HISTORY_TURNS):
    """Keep only the last N conversation turns.

    Defensive: a non-list (string, number, dict, None) yields an empty
    history rather than raising, so a tampered/mistyped client body cannot
    crash the handler. Item-shape filtering (role/content types) is handled
    by the caller when it builds the Bedrock messages.
    """
    if not isinstance(history, list):
        return []
    return history[-max_turns:]


def require_object_body(body):
    """Validate that a parsed JSON request body is an object (dict).

    A JSON array, string, number, boolean or null is NOT a valid request body
    for these services (which read named fields), and letting one through
    causes an AttributeError (→ 500) on the first ``body.get(...)``. Returns an
    error string when the body is not a dict, else None.
    """
    if not isinstance(body, dict):
        return "Request body must be a JSON object."
    return None


def validate_message(value, max_len=MAX_TOPIC_LENGTH):
    """Validate a free-text message field, returning (text, error).

    - A missing/empty value is allowed (callers may default it).
    - A non-string value (e.g. a number or array) is REJECTED with an error so
      it surfaces as a 4xx instead of crashing ``sanitize_topic`` with a
      TypeError (→ 500).
    - A valid string is trimmed to ``max_len`` via ``sanitize_topic``.
    """
    if value is None or value == "":
        return "", None
    if not isinstance(value, str):
        return None, "message must be a string."
    return sanitize_topic(value, max_len=max_len), None

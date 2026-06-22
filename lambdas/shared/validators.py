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
    """Keep only the last N conversation turns."""
    if not history:
        return []
    return history[-max_turns:]

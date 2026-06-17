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

    try:
        raw = base64.b64decode(file_data)
    except Exception as e:
        logger.warning(f"Base64 decode failed: {e}")
        return None, "The uploaded file could not be decoded."

    if len(raw) > MAX_FILE_SIZE:
        return None, f"File too large. Maximum size is {MAX_FILE_SIZE // (1024*1024)}MB."

    return raw, None


def trim_history(history, max_turns=MAX_HISTORY_TURNS):
    """Keep only the last N conversation turns."""
    if not history:
        return []
    return history[-max_turns:]

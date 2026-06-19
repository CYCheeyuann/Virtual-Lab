"""File-based prompt loader.

Each Lambda keeps its system prompts as plain markdown files in its own
`prompts/` subdirectory. The loader is deliberately tiny — git history is
the version control story, and the per-Lambda directory layout means the
deploy workflow doesn't need any extra bundling step (SAM packages
everything under each Lambda's CodeUri automatically).

Usage:

    from prompts import load_prompt

    _PROMPTS_DIR = os.path.join(os.path.dirname(__file__), "prompts")
    _SYSTEM = load_prompt(_PROMPTS_DIR, "list_system")

The loader:
  - reads UTF-8 only (no encoding ambiguity)
  - strips trailing whitespace
  - rejects any path traversal in the prompt name
  - cache-misses cheaply: filesystem reads on cold-start are negligible
    next to a Bedrock call
"""

import os

_ALLOWED_NAME_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")


def _validate_name(name):
    """Reject path traversal — names must be plain identifiers."""
    if not name or not all(c in _ALLOWED_NAME_CHARS for c in name):
        raise ValueError(f"invalid prompt name: {name!r}")


def load_prompt(prompt_dir, name):
    """Load `<prompt_dir>/<name>.md` and return its trimmed UTF-8 contents.

    Raises FileNotFoundError if the prompt is missing — that surfaces a
    misconfiguration at module load time rather than as a Bedrock 400 hours
    later when someone actually invokes the function.
    """
    _validate_name(name)
    path = os.path.join(prompt_dir, f"{name}.md")
    with open(path, encoding="utf-8") as f:
        return f.read().strip()


def list_prompts(prompt_dir):
    """List the prompt files available under `prompt_dir`. Used by tests."""
    if not os.path.isdir(prompt_dir):
        return []
    return sorted(
        os.path.splitext(f)[0]
        for f in os.listdir(prompt_dir)
        if f.endswith(".md") and not f.startswith("_")
    )

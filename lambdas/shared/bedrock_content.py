"""Build Anthropic content_blocks from validated user input.

Used by every Lambda that may receive an optional file attachment alongside
a text prompt. Caller MUST have already passed file_data/file_mime through
shared.validators.validate_file().
"""


def build_content_blocks(text, *, file_data=None, file_mime=None,
                         file_title="uploaded_reference"):
    """
    Produce the list of Anthropic content blocks for a user message.

    Parameters
    ----------
    text : str
        The text prompt to send to the model.
    file_data : str | None
        Base64-encoded file payload (already validated).
    file_mime : str | None
        MIME type of the file (already validated against allowlist).
    file_title : str
        Title metadata for document blocks.

    Returns
    -------
    list[dict]
        Ready-to-use Anthropic content blocks for the ``messages`` API.
    """
    blocks = []
    if file_data and file_mime:
        if file_mime.startswith("image/"):
            blocks.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": file_mime,
                    "data": file_data,
                },
            })
        else:
            blocks.append({
                "type": "document",
                "source": {
                    "type": "base64",
                    "media_type": file_mime,
                    "data": file_data,
                },
                "title": file_title,
            })
    blocks.append({"type": "text", "text": text})
    return blocks

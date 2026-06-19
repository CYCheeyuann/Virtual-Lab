"""JSON Schemas for Lambda outputs.

Used both by the test suite (to assert structural conformance) and by the
eval harness (to mark each result `schema_pass: true|false`). Kept as plain
Python dicts so they can be imported without any extra build step.
"""

# ── chapter_assistant ───────────────────────────────────────────────────────
CHAPTER_LIST_RESPONSE = {
    "type": "object",
    "required": ["data"],
    "properties": {
        "data": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["chapterNumber", "title", "shortDescription"],
                "properties": {
                    "chapterNumber":    {"type": "string"},
                    "title":            {"type": "string", "minLength": 1},
                    "shortDescription": {"type": "string"},
                },
            },
        },
    },
}

CHAPTER_DETAIL_RESPONSE = {
    "type": "object",
    "required": ["data"],
    "properties": {
        "data": {
            "type": "object",
            "required": ["title"],
            "properties": {
                "title":              {"type": "string"},
                "subtopics":          {"type": "array", "items": {"type": "string"}},
                "learningObjectives": {"type": "array", "items": {"type": "string"}},
                "keyConcepts":        {"type": "array", "items": {"type": "string"}},
                "keyTerms": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["term", "definition"],
                        "properties": {
                            "term":       {"type": "string"},
                            "definition": {"type": "string"},
                        },
                    },
                },
            },
        },
    },
}

# ── experiment_guide ────────────────────────────────────────────────────────
EXPERIMENT_VALIDATE = {
    "type": "object",
    "required": ["valid"],
    "properties": {
        "valid":   {"type": "boolean"},
        "summary": {"type": "string"},
        "error":   {"type": "string"},
    },
}

EXPERIMENT_NODE_MAP = {
    "type": "object",
    "required": ["topic_title", "sections"],
    "properties": {
        "topic_title": {"type": "string"},
        "sections": {
            "type": "object",
            "required": [
                "objective", "materials", "safety", "procedure",
                "expected_results", "scientific_explanation",
                "real_life_applications", "summary",
            ],
            "additionalProperties": False,
            "patternProperties": {"^.*$": {"type": "string"}},
        },
    },
}

# ── flashcard_generator ─────────────────────────────────────────────────────
FLASHCARD_RESPONSE = {
    "type": "object",
    "required": ["cards"],
    "properties": {
        "cards": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["front", "back"],
                "properties": {
                    "front": {"type": "string", "minLength": 1, "maxLength": 300},
                    "back":  {"type": "string", "minLength": 1, "maxLength": 600},
                    "hint":  {"type": ["string", "null"]},
                    "tags":  {"type": "array", "items": {"type": "string"}},
                },
            },
        },
    },
}

# ── image_generator ─────────────────────────────────────────────────────────
IMAGE_GENERATOR_RESPONSE = {
    "type": "object",
    "required": ["explanation", "image_base64", "prompt_used"],
    "properties": {
        "explanation":  {"type": "string", "minLength": 1},
        "image_base64": {"type": "string", "minLength": 1},
        "prompt_used":  {"type": "string", "minLength": 1},
    },
}

# ── science_quiz ────────────────────────────────────────────────────────────
QUIZ_RESPONSE = {
    "type": "object",
    "required": ["questions"],
    "properties": {
        "questions": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "required": ["question_stem", "options", "correct_answer", "detailed_explanation"],
                "properties": {
                    "question_stem":        {"type": "string", "minLength": 1},
                    "correct_answer":       {"type": "string", "enum": ["A", "B", "C", "D"]},
                    "detailed_explanation": {"type": "string"},
                    "options": {
                        "type": "object",
                        "required": ["A", "B", "C", "D"],
                        "properties": {
                            "A": {"type": "string"},
                            "B": {"type": "string"},
                            "C": {"type": "string"},
                            "D": {"type": "string"},
                        },
                    },
                },
            },
        },
    },
}

# ── scientific_object_generator ─────────────────────────────────────────────
OBJECT_OVERVIEW = {
    "type": "object",
    "required": ["overview"],
    "properties": {"overview": {"type": "string", "minLength": 1}},
}

OBJECT_NARRATIVE = {
    "type": "object",
    "required": ["narrative"],
    "properties": {"narrative": {"type": "string", "minLength": 1}},
}

OBJECT_IMAGE = {
    "type": "object",
    "required": ["image_base64", "prompt_used", "model"],
    "properties": {
        "image_base64": {"type": "string", "minLength": 1},
        "prompt_used":  {"type": "string", "minLength": 1},
        "model":        {"type": "string", "minLength": 1},
    },
}


def lookup(name):
    """Lookup a schema by short name; used by eval/run.py."""
    return {
        "chapter_list":           CHAPTER_LIST_RESPONSE,
        "chapter_detail":         CHAPTER_DETAIL_RESPONSE,
        "experiment_validate":    EXPERIMENT_VALIDATE,
        "experiment_node_map":    EXPERIMENT_NODE_MAP,
        "flashcard":              FLASHCARD_RESPONSE,
        "image_generator":        IMAGE_GENERATOR_RESPONSE,
        "quiz":                   QUIZ_RESPONSE,
        "object_overview":        OBJECT_OVERVIEW,
        "object_narrative":       OBJECT_NARRATIVE,
        "object_image":           OBJECT_IMAGE,
    }.get(name)

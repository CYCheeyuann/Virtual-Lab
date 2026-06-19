"""Tests for the file-based prompt loader."""

import os

import pytest
from prompts import list_prompts, load_prompt


@pytest.fixture
def prompt_tree(tmp_path):
    """Build a tiny prompts tree on disk for the loader to read."""
    (tmp_path / "alpha.md").write_text("Alpha body.\n", encoding="utf-8")
    (tmp_path / "beta.md").write_text(
        "Beta body with **bold** and {placeholder}.\n", encoding="utf-8"
    )
    (tmp_path / "_internal.md").write_text("ignored", encoding="utf-8")
    return tmp_path


class TestLoadPrompt:
    def test_returns_trimmed_contents(self, prompt_tree):
        assert load_prompt(str(prompt_tree), "alpha") == "Alpha body."

    def test_preserves_inner_whitespace(self, prompt_tree):
        body = load_prompt(str(prompt_tree), "beta")
        assert "**bold**" in body
        assert "{placeholder}" in body

    def test_missing_file_raises(self, prompt_tree):
        with pytest.raises(FileNotFoundError):
            load_prompt(str(prompt_tree), "no_such_prompt")


class TestPathTraversal:
    @pytest.mark.parametrize("bad", [
        "../etc/passwd",
        "..",
        "../../something",
        "with/slash",
        "back\\slash",
        "spaces in name",
        "",
        "null\x00byte",
    ])
    def test_rejected(self, prompt_tree, bad):
        with pytest.raises(ValueError):
            load_prompt(str(prompt_tree), bad)


class TestListPrompts:
    def test_lists_visible_prompts(self, prompt_tree):
        # `_internal.md` (leading underscore) is filtered as private.
        assert list_prompts(str(prompt_tree)) == ["alpha", "beta"]

    def test_missing_dir_returns_empty(self, tmp_path):
        assert list_prompts(str(tmp_path / "nope")) == []


class TestRealLambdaPrompts:
    """Sanity-check that every Lambda has loadable prompts at the expected path."""

    LAMBDA_PROMPTS = {
        "chapter_assistant":           ["list_system", "detail_system"],
        "experiment_guide":            ["node_map_system"],
        "flashcard_generator":         ["system"],
        "image_generator":             ["claude_system"],
        "safety_assistant":            ["system"],
        "science_quiz":                ["quiz_system"],
        "science_tutor":               ["system"],
        "scientific_object_generator": ["overview_system", "narrative_system"],
    }

    def test_all_expected_prompts_load(self):
        from pathlib import Path
        root = Path(__file__).resolve().parent.parent.parent / "lambdas"
        for lambda_name, prompt_names in self.LAMBDA_PROMPTS.items():
            prompt_dir = str(root / lambda_name / "prompts")
            for name in prompt_names:
                body = load_prompt(prompt_dir, name)
                assert body, f"{lambda_name}/{name} loaded empty"
                # No prompt file should leak the SECURITY RULE clause —
                # that's added at runtime via prefix_system().
                assert "SECURITY RULE" not in body, (
                    f"{lambda_name}/{name} accidentally contains the runtime guard"
                )

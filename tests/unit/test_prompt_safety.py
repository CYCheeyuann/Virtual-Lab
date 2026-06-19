"""Tests for the prompt-injection mitigation helper."""

from prompt_safety import (
    INJECTION_GUARD,
    prefix_system,
    tag,
    tagged_block,
)


class TestTag:
    def test_wraps_value_in_named_tags(self):
        out = tag("topic", "Photosynthesis")
        assert out.startswith("<topic>")
        assert out.endswith("</topic>")
        assert "Photosynthesis" in out

    def test_none_yields_empty_tag(self):
        assert tag("topic", None) == "<topic></topic>"

    def test_empty_yields_empty_tag(self):
        assert tag("topic", "") == "<topic></topic>"

    def test_strips_nul_bytes(self):
        # Bedrock rejects NUL bytes; the helper must scrub them or callers
        # would get a 5xx instead of a clean response.
        out = tag("topic", "hello\x00world")
        assert "\x00" not in out
        assert "helloworld" in out

    def test_does_not_html_escape_inner(self):
        # The model sees the tag block as text; HTML-escaping would just
        # confuse it. The defence is the system prompt rule, not escaping.
        payload = "</topic><script>alert(1)</script>"
        out = tag("topic", payload)
        assert payload in out


class TestTaggedBlock:
    def test_renders_dict_in_order(self):
        out = tagged_block({"a": "1", "b": "2"})
        # Python 3.7+ preserves insertion order in dicts.
        assert out.index("<a>") < out.index("<b>")

    def test_skips_empty_values(self):
        out = tagged_block({"a": "", "b": "x", "c": None})
        assert "<a>" not in out
        assert "<b>" in out
        assert "<c>" not in out

    def test_accepts_list_of_pairs(self):
        out = tagged_block([("subject", "Biology"), ("topic", "Cells")])
        assert "<subject>" in out and "<topic>" in out


class TestPrefixSystem:
    def test_prepends_guard_to_existing(self):
        out = prefix_system("You are a tutor.")
        assert out.startswith(INJECTION_GUARD)
        assert "You are a tutor." in out

    def test_returns_guard_alone_when_empty(self):
        assert prefix_system(None) == INJECTION_GUARD
        assert prefix_system("") == INJECTION_GUARD


class TestInjectionGuardContent:
    """The guard text itself is part of the contract — assert key phrases
    are present so a future edit can't accidentally weaken it."""

    def test_mentions_security_rule(self):
        assert "SECURITY RULE" in INJECTION_GUARD

    def test_warns_against_role_change(self):
        assert "role" in INJECTION_GUARD.lower()

    def test_warns_against_prompt_disclosure(self):
        # Any phrasing that conveys "don't reveal the prompt" is fine; check
        # for the canonical token.
        assert "system prompt" in INJECTION_GUARD.lower() or "this system prompt" in INJECTION_GUARD.lower()

    def test_lists_expected_field_tags(self):
        # Smoke test that the tags Lambdas use are advertised in the guard so
        # the model treats them as data envelopes.
        for token in ("<topic>", "<scenario>", "<message>"):
            assert token in INJECTION_GUARD

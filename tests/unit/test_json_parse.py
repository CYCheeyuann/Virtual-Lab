"""Tests for the shared JSON-parsing helper."""

from json_parse import parse_json_safe, strip_fences


class TestStripFences:
    def test_strips_json_fence(self):
        assert strip_fences('```json\n{"a": 1}\n```') == '{"a": 1}'

    def test_strips_bare_fence(self):
        assert strip_fences('```\n[1,2]\n```') == '[1,2]'

    def test_passes_through_unfenced(self):
        assert strip_fences('{"a": 1}') == '{"a": 1}'

    def test_empty(self):
        assert strip_fences("") == ""
        assert strip_fences(None) == ""


class TestParseJsonSafe:
    def test_parses_object(self):
        assert parse_json_safe('{"a": 1}') == {"a": 1}

    def test_parses_array(self):
        assert parse_json_safe('[1,2,3]') == [1, 2, 3]

    def test_strips_fences(self):
        assert parse_json_safe('```json\n{"a": 1}\n```') == {"a": 1}

    def test_returns_none_on_garbage(self):
        assert parse_json_safe("not json at all") is None
        assert parse_json_safe("") is None

    def test_extracts_balanced_block_from_preamble(self):
        # Claude sometimes adds a sentence before the JSON.
        text = 'Here is the JSON you asked for:\n{"a": 1}\nHope it helps!'
        assert parse_json_safe(text) == {"a": 1}

    def test_expect_dict_rejects_array(self):
        # The expect= guard prevents a top-level type confusion.
        assert parse_json_safe("[1,2]", expect=dict) is None

    def test_expect_list_accepts_array(self):
        assert parse_json_safe("[1,2]", expect=list) == [1, 2]

    def test_expect_tuple_of_types(self):
        assert parse_json_safe('{"a": 1}', expect=(dict, list)) == {"a": 1}
        assert parse_json_safe('[1]', expect=(dict, list)) == [1]

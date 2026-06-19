# Changelog

## Unreleased

### Added — testing & evaluation layer

**Automated test suite** — 137 tests in `tests/`, runs offline in ~3s:

- `tests/conftest.py` — shared fixtures including a Bedrock mock that
  resets cached clients across all 9 Lambdas, plus a `load_lambda` helper
  that imports each Lambda's `app.py` under a unique module name to avoid
  Flask `app` collisions.
- `tests/unit/` — 48 tests covering `validators`, `prompt_safety`,
  `json_parse`, `cors`.
- `tests/lambdas/` — 81 tests, one file per Lambda, covering happy path,
  missing required fields, empty input, length-cap truncation, allowlist
  fallback, model refusal, Bedrock timeout, empty / garbled output, schema
  validation, fail-closed validation in `experiment_guide`, and the P1
  payload caps in `flashcard_generator` / `science_tutor`.
- `tests/adversarial/test_prompt_injection.py` + 8 categorized payloads in
  `tests/fixtures/adversarial_inputs.json`. Drives every JSON-returning
  Lambda with each adversarial payload and asserts the SECURITY RULE clause
  reaches Claude, the user-supplied field arrives wrapped in XML-style
  tags, and the response remains schema-valid.

**Schemas as code** — `tests/schemas.py` declares JSON Schemas for every
JSON-returning Lambda output (chapter list / detail, experiment validate /
node_map, flashcard, image_generator, quiz, object overview / narrative /
image). Used by both pytest and the eval harness.

**Eval harness** — `eval/`:

- `eval/run.py` runs every Lambda against canned mocks (default) or live
  Bedrock (`--live`). Smoke mode (`--smoke`) runs one sample per Lambda for
  CI gating.
- `eval/samples/<lambda>.json` — 4–5 sample inputs per Lambda (40+ total),
  including injection / scope-drift attempts.
- `eval/results/` — timestamped output directories with `_summary.json` and
  per-Lambda result files containing input, output, schema_pass flag, and
  a blank scoring template (correctness, structural_completeness,
  teaching_clarity, safety, consistency, notes, reviewer).
- `eval/README.md` documents usage and sample-file format.

**Output rubric** — `docs/ai-output-rubric.md` defines the 0–5 scoring
scale, per-Lambda quality criteria, and a cross-cutting safety floor.
Includes the explicit policy that any output reproducing the SECURITY RULE
clause, claiming jailbreak modes, or producing CBRN / drug / explosive
instructions is `safety: 0` regardless of other axes.

**CI gate** — `.github/workflows/deploy.yml` now has a `quality` job that
must pass before `deploy` runs:

```
checkout → setup-python → pip install requirements-test.txt →
ruff check → pytest → python -m eval.run --smoke
```

Deploy is gated via `needs: quality`.

**Project files**:

- `requirements-test.txt` — test-only dependencies (pytest, jsonschema, ruff)
- `pyproject.toml` — ruff config (E + F + B + UP + I, line-length 110) and
  pytest config (testpaths, markers, warning filters).

### Assumptions

- Tests run **offline by default**. Real Bedrock calls require
  `RUN_LIVE_TESTS=1` (pytest) or `--live` (eval). CI never hits real AWS.
- The Bedrock mock simulates Anthropic's `content[*].text` shape and
  Stability's `images[*]` shape — same wire format the Lambdas use today.
  If the response shape ever changes, the mock fixtures in
  `tests/conftest.py` are the single point to update.
- The eval harness deliberately does NOT score model output automatically.
  The `scoring` block in each result file is filled in by a human reviewer
  using the rubric. Automatic scoring on the rubric axes (correctness,
  teaching clarity) is a follow-up that needs an LLM-as-judge or a held-out
  eval-grader, both of which were out of scope for this layer.
- Existing Lambda runtime behaviour was **not** changed. The only
  non-test code edits were three pre-existing one-line conditionals in
  `image_generator/app.py` reformatted to satisfy ruff's `E701` rule.

## 2026-06 — security hardening (P0 + P1)

See git log for commits `5cd208a` and `7e11865`.

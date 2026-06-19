# Eval harness

Lightweight, runnable framework for reviewing model output quality across
the 9 Lambdas. The harness exists for two reasons:

1. **CI smoke gate** — one sample per Lambda runs against a canned mock
   Bedrock response on every push. If any Lambda errors out, schemas drift,
   or a parser regresses, the deploy is blocked.
2. **Human review** — `--live` runs the same sample inputs against real
   Bedrock and writes the model output to `results/<timestamp>/`. A reviewer
   then opens each result file, fills in the `scoring` block per the
   [output rubric](../docs/ai-output-rubric.md), and commits the directory
   so quality trend lines stay in version control.

## Usage

```bash
# Offline smoke run (CI default — fast, no AWS needed)
python -m eval.run --smoke

# Full offline run — runs every sample using canned mock responses
python -m eval.run

# Live run — requires AWS_ACCESS_KEY_ID + Bedrock model access in your env
python -m eval.run --live

# One Lambda only
python -m eval.run --lambda chapter_assistant
python -m eval.run --lambda flashcard_generator --live
```

Exit code:
- `0` — every sample returned 2xx and (where a schema is declared) passed
  schema validation
- non-zero — at least one sample failed structurally

## Layout

```
eval/
├── run.py                     # entrypoint
├── samples/
│   ├── chapter_assistant.json
│   ├── experiment_guide.json
│   ├── flashcard_generator.json
│   ├── image_generator.json
│   ├── safety_assistant.json
│   ├── science_quiz.json
│   ├── science_tutor.json
│   ├── scientific_object_generator.json
│   └── what_happens_if.json
└── results/
    └── <UTC timestamp>/
        ├── _summary.json
        └── <lambda_name>.json
```

## Sample file format

Each `samples/<lambda>.json` is an array of sample objects:

```json
{
  "id": "biology-spm-full-syllabus",
  "request": {
    "action": "list",
    "subject": "Biology",
    "level": "SPM"
  },
  "schema": "chapter_list",
  "canned": {
    "text": "[{\"chapterNumber\":\"1\", ...}]"
  }
}
```

- `id` — short kebab-case identifier; appears in result filenames and CI logs
- `request` — the JSON body that gets POSTed to the Lambda
- `schema` — short name from `tests/schemas.lookup`, or `null` for streaming
  endpoints / negative-path tests where structural validation does not apply
- `canned` — the mock Bedrock response used in offline mode. Has one of:
  - `text` — a single Claude-style text response (most JSON Lambdas)
  - `chunks` — an array of streaming text fragments (streaming Lambdas)
  - `image` — base64 PNG bytes (Stability response)
  - `invoke_chain` — ordered list of `{kind: "text"|"image", ...}` for
    multi-step Lambdas like `image_generator`

## Adding a new sample

1. Pick the Lambda you want to test.
2. Open `samples/<lambda>.json` and append a new entry.
3. If you need a new output schema, add it to `tests/schemas.py` and to
   `schema_lookup()`.
4. Run `python -m eval.run --lambda <lambda>` and confirm it passes.
5. For live evaluation, run `--live` and review the result file by hand.

## Scoring rubric

Each result file ships with an empty `scoring` block:

```json
"scoring": {
  "correctness":             null,
  "structural_completeness": null,
  "teaching_clarity":        null,
  "safety":                  null,
  "consistency":             null,
  "notes":                   "",
  "reviewer":                ""
}
```

Reviewers fill these on a 0–5 scale per [`docs/ai-output-rubric.md`](../docs/ai-output-rubric.md).
Commit the populated result directory back to the repo so historical
quality trends are tracked alongside code changes.

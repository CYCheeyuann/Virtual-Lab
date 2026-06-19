# Changelog

## Unreleased

### Added — observability + cost controls

**Per-AI-invocation structured logging**

- New `lambdas/shared/bedrock_metrics.py` — `log_ai_call`, `extract_usage`,
  `CallTimer`. Emits one JSON log line per AI call with `function`,
  `model_id`, `mode`, `latency_ms`, `status`, `input_tokens`,
  `output_tokens`, `error_code`. The same line embeds a CloudWatch
  Embedded Metric Format (EMF) block, so CloudWatch auto-extracts custom
  metrics (`LatencyMs`, `InputTokens`, `OutputTokens`, `Errors`) under the
  namespace `VirtualScienceLab/AI` with `function × model_id` dimensions —
  no `PutMetricData` API call.
- `lambdas/shared/bedrock_stream.py` — extended `stream_bedrock` to
  harvest token usage from the Anthropic stream's `message_start` and
  `message_delta` events, and added `invoke_bedrock_buffered(client,
  model_id, body, function_name=, mode=)` for non-streaming calls. Both
  paths emit exactly one log line per invocation regardless of outcome.
- All 9 Lambdas refactored to use the new wrappers — 9 inline
  `client.invoke_model(...)` call sites removed. Each app passes a short
  `function_name` and `mode` so logs and metrics group cleanly.
- Stability / Titan responses (no `usage` block) log tokens as `null` and
  EMF reports them as `0` Count — handled gracefully, not as errors.

**Lambda Insights**

- Insights extension layer added to `Mappings.RegionToLambdaInsights` (4
  region entries; bump version when AWS publishes new layers).
- `CloudWatchLambdaInsightsExecutionRolePolicy` attached to the shared
  `AppBedrockRole`, so any function can opt in by adding the layer.
- Enabled on the 4 cost-critical Lambdas: `ImageGeneratorFunction`,
  `ScientificObjectGeneratorFunction`, `ScienceTutorFunction`,
  `FlashcardGeneratorFunction`. Other Lambdas can be enabled later by
  appending one line to their `Layers:` block.

**Reserved concurrency**

- `ImageGeneratorFunction`: 5 (Stability ~$0.04/render → $0.20/sec cap)
- `ScientificObjectGeneratorFunction`: 5 (same Stability call in image mode)
- `FlashcardGeneratorFunction`: 5 (high output-token cost per call)
- `ScienceTutorFunction`: 10 (high volume — chat — needs a higher cap)
- Total reserved: 25/1000 — leaves 975 unreserved for other Lambdas.

**CloudWatch alarms (10 total)**

- 4 Lambdas × `Errors` alarm (Sum > 5 in 5 min)
- 4 Lambdas × `Throttles` alarm (Sum > 0 in 5 min)
- 2 image Lambdas × `Duration p99` alarm (> 60000ms over 2 × 5 min)
- All use `TreatMissingData: notBreaching` so quiet periods don't alarm.
- Names prefixed with `${AWS::StackName}-…` so multiple environments
  stay separate.

**Monthly cost budget**

- New `MonthlyCostBudget` (`AWS::Budgets::Budget`) resource, conditional
  on `BudgetNotificationEmail` parameter being non-empty.
- ACTUAL cost notifications at 80% and 100% of `BudgetAmountUSD`
  (default $50/month).
- Forecasted-cost thresholds can be added later by appending entries to
  `NotificationsWithSubscribers`.

**Deploy workflow**

- `.github/workflows/deploy.yml` threads two new GitHub secrets through
  to SAM's `--parameter-overrides`: `BUDGET_NOTIFICATION_EMAIL` and
  `BUDGET_AMOUNT_USD`. Both are optional; missing email simply skips the
  Budget resource.

**Tests**

- `tests/unit/test_bedrock_metrics.py` (10 new tests) covers usage
  extraction, structured-log shape, EMF block presence, error-status
  semantics, keyword-only arg enforcement, and `CallTimer` exception
  propagation.
- All 147 tests pass; ruff clean; eval smoke run still PASS.

**Documentation**

- `docs/observability-and-cost-controls.md` documents what's logged,
  where token usage is extracted, the metric namespace, the alarm
  inventory with thresholds and rationale, the reserved-concurrency
  table with justification, and a tuning playbook for adjusting
  thresholds once production traffic is observed.

### Assumptions

- Lambda Insights extension layer version `:53` was used. AWS ships new
  versions periodically; bump in `Mappings.RegionToLambdaInsights` when
  needed (~once a year).
- The 5/5/5/10 reserved-concurrency values are conservative starting
  points. Real traffic should be observed for ~1 week, then resized
  using the formula `concurrency ≈ avg RPS × avg duration (s)`.
- `Duration p99` alarms are only on the two image Lambdas; tutor and
  flashcard finish in seconds and a duration alarm on them would be
  noisy or useless.
- The budget defaults to USD $50/month based on a hobby-level deployment
  where Stability rendering ($0.04/image) dominates the bill. Production
  traffic should drive the real number.

## 2026-06 — testing & evaluation layer

See git log for commit `19737c7`.

## 2026-06 — security hardening (P0 + P1)

See git log for commits `5cd208a` and `7e11865`.

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

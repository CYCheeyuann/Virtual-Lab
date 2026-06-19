# Changelog

## Unreleased — production operability

**Multi-environment deploy**
- `.github/workflows/deploy.yml` accepts a `workflow_dispatch.inputs.environment`
  of `dev` / `staging` / `prod` (default prod). A push to `main` continues
  to deploy prod; manual runs can target dev or staging.
- Stack name is now parameterised: prod keeps the legacy
  `virtual-science-lab-assistant` (preserves continuity); dev/staging get
  their own `virtual-science-lab-{env}` stacks.
- SAM template exposes an `Environment` parameter (allowed values `dev` /
  `staging` / `prod`) and stamps every Lambda with `Environment` +
  `Project` tags so AWS Cost Explorer can split by env.

**File-based prompt versioning**
- New `lambdas/shared/prompts.py` — `load_prompt(dir, name)` with
  path-traversal protection.
- 10 system prompts extracted from inline strings to
  `lambdas/<name>/prompts/*.md`. `app.py` loads them at module import.
- `science_tutor` prompt is templated with `{subject}` and substituted
  at request time.
- `tests/unit/test_prompts_loader.py` — 7 new tests.

**User feedback widget + collector**
- New `lambdas/feedback_collector` — stateless Lambda that records
  thumbs-up / thumbs-down events as structured CloudWatch logs + EMF
  `FeedbackCount` metric grouped by `feature × rating`. No DB.
- New `frontend/feedback.{js,css}` — drop-in widget with a per-page-load
  random `session_id` (no PII, not persisted). Hooked into tutor, quiz,
  chapter, experiment, lab-tools, and flashcards pages.
- `tests/lambdas/test_feedback_collector.py` — 8 new tests.
- Eval harness sample inputs added.

**Operations documentation**
- `docs/privacy.md` — localStorage inventory, backend data flow,
  retention table, deletion guidance.
- `docs/runbooks/rollback.md` — three rollback paths plus per-env
  stack-name reference.
- `docs/runbooks/incident-response.md` — severity ladder, 6-step triage
  checklist, postmortem template.
- `docs/runbooks/model-migration.md` — IAM-first then code-swap pattern,
  eval rubric gate, A/B testing tip, Stability-specific caveats.
- `docs/runbooks/prompt-updates.md` — workflow for editing a prompt,
  reviewer checklist, escape-hatch override pattern.

**Test totals**: 170 tests passing (was 147), all offline.

**Assumptions**:

- The `Environment` parameter only affects tags; resources within a
  stack don't get renamed. Each environment is its own stack.
- Per-environment GitHub secrets aren't enforced — the same `API_KEY`,
  `BUDGET_NOTIFICATION_EMAIL`, etc. apply to every env. Configure
  GitHub Actions environments to split per env.
- The feedback collector logs to CloudWatch only. Promote to DynamoDB
  or S3 if long-term storage is needed; the wire contract is
  forward-compatible.

## 2026-06 — observability + cost controls (commits `1646920`, `b4813ae`)

- New `lambdas/shared/bedrock_metrics.py` — structured AI-invocation
  log lines + CloudWatch EMF metrics under namespace
  `VirtualScienceLab/AI` with dimensions `function × model_id`.
- Extended `bedrock_stream` to harvest token usage from both streaming
  (`message_start` / `message_delta` events) and buffered paths.
- New `invoke_bedrock_buffered` wrapper; all 9 Lambdas refactored.
- Lambda Insights enabled on the 4 cost-critical functions.
- 10 CloudWatch alarms (Errors + Throttles per critical Lambda; Duration
  p99 for the two image Lambdas).
- Conditional `AWS::Budgets::Budget` resource with 80% / 100% ACTUAL
  notifications.
- Reserved concurrency was attempted (5/5/5/10) but rolled back in
  `b4813ae` because the AWS account's `ap-southeast-1` Lambda
  concurrency quota is at the floor; documented re-enable path.
- 10 new unit tests; total 147 passing.

## 2026-06 — testing & evaluation layer (commit `19737c7`)

- `tests/` — pytest suite with shared Bedrock mock; covers all 9
  Lambdas, the shared utility modules, and an adversarial prompt-
  injection corpus.
- `tests/schemas.py` — JSON Schemas for every JSON-returning Lambda
  output, used by both pytest and the eval harness.
- `eval/run.py` — runnable harness with `--smoke` (mocked, CI gate) and
  `--live` (real Bedrock) modes.
- `eval/samples/*.json` — 4–5 inputs per Lambda.
- `docs/ai-output-rubric.md` — 0–5 scoring rubric per Lambda type.
- CI workflow `quality` job runs lint + pytest + eval smoke before
  deploy.

## 2026-06 — security hardening (commits `5cd208a`, `7e11865`)

- P0: Prompt-injection guards across all 9 Lambdas via shared
  `prompt_safety` helper (`tag()`, `prefix_system()`, `INJECTION_GUARD`).
  Every user-controlled field arrives in XML-style tags; the system
  prompt instructs Claude to treat tag contents as data.
- P0: Stored-XSS fix in `progress.js` (numeric coercion +
  `escapeHtml`); `escapeHtml` hardened to also escape `'`.
- P0: Inline `onclick` removed from `quiz.html`; replaced with
  `data-act` attributes + `addEventListener`.
- P0: `experiment_guide` validation now fails closed.
- P0: Generic error responses; stop returning exception class names.
- P1: Bedrock client retry/timeout config.
- P1: CORS hardening (warn on `*`, drop `X-Api-Key` header in wildcard
  mode, add `nosniff`).
- P1: Lower per-request payload caps in `flashcard_generator` (8KB
  source_text, 6000 max_tokens) and `science_tutor` (10 history turns
  cap × 3000 chars).

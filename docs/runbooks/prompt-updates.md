# Runbook: Prompt Update Workflow

System prompts live as plain markdown files under each Lambda's
`prompts/` subdirectory:

```
lambdas/
├── chapter_assistant/prompts/
│   ├── list_system.md
│   └── detail_system.md
├── experiment_guide/prompts/
│   └── node_map_system.md
├── flashcard_generator/prompts/
│   └── system.md
├── image_generator/prompts/
│   └── claude_system.md
├── safety_assistant/prompts/
│   └── system.md
├── science_quiz/prompts/
│   └── quiz_system.md
├── science_tutor/prompts/
│   └── system.md
└── scientific_object_generator/prompts/
    ├── overview_system.md
    └── narrative_system.md
```

Each Lambda's `app.py` loads its prompts at module import time:

```python
_PROMPTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompts")
_QUIZ_SYSTEM = load_prompt(_PROMPTS_DIR, "quiz_system")
```

This is intentionally simple. Git history is the version control story —
every edit produces a commit, every commit is reviewable.

## How to update a prompt

1. **Open the file** in your editor (e.g.
   `lambdas/science_quiz/prompts/quiz_system.md`).
2. **Make the change**. Markdown comments via `<!-- … -->` are fine for
   notes; Claude treats them as part of the prompt though, so prefer
   external comments in the PR description.
3. **Run pytest**: `pytest tests/unit/test_prompts_loader.py`. This
   verifies every Lambda still has loadable prompts and that none have
   accidentally absorbed the runtime SECURITY RULE clause.
4. **Run the eval harness in live mode** against the affected Lambda:

   ```bash
   python -m eval.run --live --lambda science_quiz
   ```

   Open the resulting `eval/results/<timestamp>/science_quiz.json` and
   spot-check the outputs against `docs/ai-output-rubric.md`. Score each
   axis 0–5 in the `scoring` block.

5. **Open a PR** with:
   - the prompt diff
   - a one-paragraph rationale ("changes the tone to be more concise"
     or "adds a constraint to avoid generating multiple-choice options
     where the answer is in the question stem")
   - a link to the `eval/results/...` directory
6. **Merge**. The push to `main` triggers the CI quality gate
   (lint + pytest + eval smoke); deploy proceeds if it passes.

## What goes in a prompt file vs. inline code

- **In the file**: stable, model-facing instructions that don't depend
  on per-request data. The `_QUIZ_SYSTEM` block, the `_FLASH_SYSTEM`
  block, etc.
- **Inline in `app.py`**: anything that interpolates user input or
  request-time decisions (subject, difficulty, num_questions, mode).
  These get built using `prompt_safety.tag()` and `prefix_system()` so
  the security guard stays applied.

## Templating with `{placeholder}`

Some prompts (notably `science_tutor/prompts/system.md`) include
`{subject}` placeholders that are substituted at request time:

```python
system_prompt = (
    f"{INJECTION_GUARD}\n\n"
    + _TUTOR_TEMPLATE.format(subject=subject)
)
```

If you add a new placeholder to a templated prompt, also update the
caller's `.format(...)` call. `pytest tests/lambdas/test_science_tutor.py`
catches the mismatch with a clear `KeyError`.

## Don't put these in prompt files

- **The SECURITY RULE / `INJECTION_GUARD` text.** It's prepended by
  `prompt_safety.prefix_system()` at runtime to every system prompt
  uniformly. Hard-coding it in a prompt file would risk it drifting
  out of sync when we update the runtime guard.
- **Secrets, API keys, account IDs, customer data.** None should ever
  live in a prompt; the project has no need for any.
- **Per-environment differences.** All envs share the same prompts.
  If a behaviour needs to differ (e.g. dev gets a chattier model), use
  an env var, not a prompt fork.

## Reviewing a prompt change

Reviewer checklist:

- Does the change affect the **declared output schema**? If so, make
  sure `tests/schemas.py` and the Lambda's response parser still
  match.
- Does the change weaken **safety**? Look for removed refusals,
  removed scope guardrails, removed "don't do X" instructions.
- Does the change introduce a **new placeholder**? Check the calling
  code substitutes it.
- Is there an `eval/results/...` link in the PR? If not, ask for one
  before merging anything to `main`.

## Reverting a prompt

A prompt revert is a normal git revert. The `app.py` stays unchanged;
only the `.md` file moves back. CI will redeploy the previous prompt
text. No infra changes needed, no Lambda re-publishing dance.

## Backing out a prompt without a redeploy

If the situation is urgent and a redeploy isn't viable (e.g. CI is
broken), you can override the prompt via Lambda environment variables.
This is escape-hatch only; not recommended for routine changes:

1. Add an env-var-based fallback to the loader call site:

   ```python
   _QUIZ_SYSTEM = (
       os.environ.get("QUIZ_SYSTEM_OVERRIDE")
       or load_prompt(_PROMPTS_DIR, "quiz_system")
   )
   ```

2. In the AWS console → Lambda → ScienceQuizFunction →
   Configuration → Environment variables, set
   `QUIZ_SYSTEM_OVERRIDE` to the desired prompt body.
3. Wait for the next cold start (or invoke once to force one) — the
   override takes effect.

The override mechanism is **not** wired up by default. Add it only if
you need it.

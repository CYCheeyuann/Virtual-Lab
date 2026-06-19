# ADR 0003: Claude Haiku 4.5 as the Default Text Model

## Status

Accepted

## Context

The Virtual Science Lab makes AI calls across multiple features: chapter
generation, experiment guides, quizzes, tutoring chat, safety analysis,
what-if scenarios, flashcard generation, and image prompt expansion.

Model options on Amazon Bedrock (as of early 2026):

- **Claude Haiku 4.5** (`anthropic.claude-haiku-4-5-20251001-v1:0`): Fast,
  low-cost, good quality for structured and instructional tasks.
- **Claude Sonnet 4** (`anthropic.claude-sonnet-4-20250514-v1:0`): Higher
  quality reasoning, but 5–10× more expensive per token and higher latency.
- **Claude Opus 4**: Highest quality, highest cost; not practical for
  interactive use cases at scale.

Constraints:

- The application is educational and targets K-12/undergraduate level
  content — not research-grade reasoning.
- Streaming latency matters for the chat/tutor UX; users expect the first
  token within 1–2 seconds.
- Budget is limited ($50/month default); cost per interaction must stay low.
- The global inference profile routes requests to the nearest region,
  reducing latency further.

## Decision

Use **Claude Haiku 4.5** via the **global inference profile**
(`global.anthropic.claude-haiku-4-5-20251001-v1:0`) for all text-generation
endpoints. Do not use Sonnet or Opus in the current architecture.

## Consequences

### Positive

- **Cost:** ~$0.001/1K input tokens, ~$0.005/1K output tokens. A typical
  tutor exchange costs < $0.01. Monthly budget supports thousands of
  interactions.
- **Latency:** Time-to-first-token is consistently < 1s for most prompts.
  Streaming UX feels responsive.
- **Quality:** For structured educational content (outlines, quizzes,
  flashcards, safety checklists), Haiku 4.5 produces reliably good output.
  The eval suite (`eval/`) confirms this.
- **Simplicity:** One model for all features means one set of prompt
  patterns, one token-counting methodology, and one set of metrics.

### Negative

- **Complex reasoning:** For multi-step scientific reasoning (e.g., deriving
  equations, explaining advanced mechanisms), Haiku occasionally produces
  shallow or slightly inaccurate explanations compared to Sonnet.
- **Nuance in safety:** Haiku is more likely to produce borderline responses
  on edge-case safety prompts. The `prompt_safety.py` module adds a
  defence layer, but Sonnet would be inherently more cautious.
- **No model routing:** All features share the same model regardless of
  complexity. A quiz question and a multi-paragraph experiment guide use
  the same underlying capability.

### When to reconsider

- If the monthly eval shows quality degradation on specific features
  (particularly experiment guides or tutor deep-dives), consider routing
  those features to Sonnet while keeping simpler features on Haiku.
- If Bedrock pricing changes (e.g., Sonnet becomes 2× instead of 5–10×),
  the cost argument weakens.
- If a newer Haiku version ships with improved reasoning, update the
  `MODEL_ID` env var (no IAM changes needed thanks to the global profile).
- If the user base grows significantly, a tiered approach (Haiku for
  standard, Sonnet for "deep dive" mode) could justify the cost.

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| Claude Sonnet 4 for all | Better reasoning, safer edge-case handling | 5–10× cost; higher latency; $50/month budget exhausted quickly |
| Mixed: Sonnet for tutor, Haiku for everything else | Best quality where it matters most | Added complexity; two model configurations; harder to reason about costs |
| Claude Opus 4 | Highest quality | Prohibitively expensive for interactive use; latency inappropriate for streaming chat |
| Non-Anthropic models (Llama, Mistral) | Potentially lower cost | Lower quality for educational content in benchmarks; less predictable safety behaviour |

## Related

- `infra/template.yaml` — `MODEL_ID` environment variable on each Lambda
- `lambdas/shared/bedrock_stream.py` — model invocation logic
- [docs/observability-and-cost-controls.md](../observability-and-cost-controls.md) — token usage metrics
- [docs/runbooks/model-migration.md](../runbooks/model-migration.md) — how to switch models

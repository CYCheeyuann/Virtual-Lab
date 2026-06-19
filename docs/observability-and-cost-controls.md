# Observability & Cost Controls

This is the operator-facing reference for what the AI Lambda stack records,
what alarms fire on, where reserved concurrency caps the blast radius, and
how the cost budget is configured.

## What is logged for every AI invocation

Every Bedrock call — both streaming (`stream_bedrock`) and non-streaming
(`invoke_bedrock_buffered`) — emits exactly **one** structured JSON log line
on completion. Live in CloudWatch Logs Insights, the line looks like:

```json
{
  "event": "ai_invocation",
  "function": "chapter_assistant",
  "model_id": "global.anthropic.claude-haiku-4-5-20251001-v1:0",
  "mode": "list",
  "latency_ms": 437,
  "status": "ok",
  "input_tokens": 312,
  "output_tokens": 540,
  "_aws": { ... CloudWatch EMF block ... },
  "LatencyMs": 437,
  "InputTokens": 312,
  "OutputTokens": 540,
  "Errors": 0
}
```

Fields:

| Field            | Source                                                       |
|------------------|--------------------------------------------------------------|
| `function`       | Short label set by the calling Lambda (e.g. `flashcard_generator`) |
| `model_id`       | The Bedrock model ID actually invoked                        |
| `mode`           | Caller-provided sub-action (e.g. `list`, `detail`, `image`)  |
| `latency_ms`     | Wall-clock duration of the Bedrock call                      |
| `status`         | `ok` on success, `error` on any exception path               |
| `input_tokens`   | Anthropic `usage.input_tokens` (null for Stability/Titan)    |
| `output_tokens`  | Anthropic `usage.output_tokens` (null for Stability/Titan)   |
| `error_code`     | Bedrock error code or Python exception class name on failure |

Tokens are reported as `null` when the response carries no usage block —
Stability SD 3.5 Large and Titan image responses don't include one.
Dashboards must treat these nulls as expected, not as errors.

### Where this is implemented

| File                                       | What it does                              |
|--------------------------------------------|-------------------------------------------|
| `lambdas/shared/bedrock_metrics.py`        | `log_ai_call`, `extract_usage`, `CallTimer` |
| `lambdas/shared/bedrock_stream.py`         | Both wrappers; calls `log_ai_call` once per invocation |
| Each `lambdas/<name>/app.py`               | Passes `function_name=` + `mode=` to the wrappers |

The streaming path harvests usage from the Bedrock stream's bookkeeping
events: `message_start` (carries `input_tokens`) and `message_delta`
(carries `output_tokens`). The buffered path reads `payload["usage"]`.

## CloudWatch metrics — namespace `VirtualScienceLab/AI`

The same log line embeds an EMF block, so CloudWatch automatically extracts
custom metrics under `VirtualScienceLab/AI` with dimensions
`function × model_id`. No separate `PutMetricData` API call is made (saves
cost and latency).

Available metrics:

- `LatencyMs` (Milliseconds)
- `InputTokens` (Count) — null usage is recorded as 0 in EMF
- `OutputTokens` (Count) — same
- `Errors` (Count) — 1 when `status="error"`, 0 otherwise

You can build dashboards by pivoting on `function`, `model_id`, or both.
The EMF namespace can be overridden by setting the `METRICS_NAMESPACE` env
var on the Lambda.

## Lambda Insights

Enabled on the four cost-critical Lambdas:

- `ImageGeneratorFunction`
- `ScientificObjectGeneratorFunction`
- `ScienceTutorFunction`
- `FlashcardGeneratorFunction`

Insights ships per-function CPU, memory, init duration, and cold-start
metrics into the `LambdaInsights` namespace. The shared role
`AppBedrockRole` already has `CloudWatchLambdaInsightsExecutionRolePolicy`
attached; enabling Insights on a non-critical Lambda is now just a matter
of adding the layer to its `Layers` list:

```yaml
Layers:
  - !Sub "arn:aws:lambda:${AWS::Region}:753240598075:layer:LambdaAdapterLayerX86:27"
  - !FindInMap [RegionToLambdaInsights, !Ref "AWS::Region", LayerArn]
```

The Insights layer ARN is mapped per region in the SAM template's
`Mappings.RegionToLambdaInsights`. Update the layer version there as new
Insights releases ship.

## Reserved concurrency

| Function                              | Reserved | Why                                                                 |
|---------------------------------------|---------:|---------------------------------------------------------------------|
| `ImageGeneratorFunction`              | **5**    | Stability SD 3.5 ~$0.04/render; cap parallel spend at ~$0.20/sec    |
| `ScientificObjectGeneratorFunction`   | **5**    | Same Stability call as above when in `mode=image`                   |
| `FlashcardGeneratorFunction`          | **5**    | Up to 6K output tokens per call (~$0.03 of Claude per call)         |
| `ScienceTutorFunction`                | **10**   | Highest-volume endpoint (chat); higher cap so concurrent students aren't queued |
| All others                            | unset    | Share the unreserved account-level pool                             |

Total reserved: **25** out of the account default 1000-concurrency pool.
That leaves 975 concurrency for chapter, experiment, quiz, safety, and
what-if Lambdas, plus any future services.

Reserved concurrency itself is free; it just partitions the account pool
and acts as both a guarantee (the function always has its reservation
available) and a hard cap (it never exceeds it). The throttle alarms
below fire when the cap is hit.

### How to tune these later

Use the formula AWS recommends as a starting point:

> **concurrency ≈ avg requests per second × avg request duration in seconds**

Pull `AVG(IAVG(Invocations / 60))` and `AVG(Duration / 1000)` for each
function over a representative week, multiply, then round up to the next
band of 5. If `Throttles > 0` is firing more than once a week, bump the
reservation. If `ConcurrentExecutions p99` stays well under the
reservation, you can lower it without losing capacity.

## CloudWatch alarms

Total: 10 alarms across 4 critical Lambdas. All alarm names are prefixed
with the stack name so multiple environments stay separate.

| Lambda                               | Alarm                  | Metric    | Stat   | Threshold | Window |
|--------------------------------------|------------------------|-----------|--------|-----------|--------|
| `ImageGeneratorFunction`             | `…-errors`             | Errors    | Sum    | > 5       | 5 min  |
| `ImageGeneratorFunction`             | `…-throttles`          | Throttles | Sum    | > 0       | 5 min  |
| `ImageGeneratorFunction`             | `…-duration-p99`       | Duration  | p99    | > 60000ms | 2 × 5 min |
| `ScientificObjectGeneratorFunction`  | `…-scientific-object-errors`     | Errors    | Sum | > 5    | 5 min  |
| `ScientificObjectGeneratorFunction`  | `…-scientific-object-throttles`  | Throttles | Sum | > 0    | 5 min  |
| `ScientificObjectGeneratorFunction`  | `…-scientific-object-duration-p99` | Duration | p99 | > 60000ms | 2 × 5 min |
| `ScienceTutorFunction`               | `…-science-tutor-errors`         | Errors    | Sum | > 5    | 5 min  |
| `ScienceTutorFunction`               | `…-science-tutor-throttles`      | Throttles | Sum | > 0    | 5 min  |
| `FlashcardGeneratorFunction`         | `…-flashcard-generator-errors`   | Errors    | Sum | > 5    | 5 min  |
| `FlashcardGeneratorFunction`         | `…-flashcard-generator-throttles`| Throttles | Sum | > 0    | 5 min  |

`TreatMissingData: notBreaching` everywhere — no traffic ≠ outage.

The Duration p99 alarm is only on the two image Lambdas because Stability
calls take 30–60s normally; sustained creep above 60s is a real signal.
Tutor and Flashcard calls finish in seconds, so a Duration alarm there
would either be too tight or useless.

### Adding alarm notifications

The alarm resources don't currently have an SNS `AlarmActions`. To get
Slack/email/PagerDuty notifications, attach an SNS topic ARN to each:

```yaml
ImageGeneratorErrorsAlarm:
  Type: AWS::CloudWatch::Alarm
  Properties:
    ...
    AlarmActions:
      - !Ref AlarmTopic
```

A future iteration will create an SNS topic + email subscription via the
same template parameter that wires the budget email.

## Monthly cost budget

`AWS::Budgets::Budget` resource named `<stack>-monthly`. Conditional —
only created when `BudgetNotificationEmail` parameter is non-empty.

| Threshold | Type   | Notification destination       |
|----------:|--------|---------------------------------|
| 80%       | ACTUAL | `BudgetNotificationEmail`       |
| 100%      | ACTUAL | `BudgetNotificationEmail`       |

Default budget amount is **USD $50/month**, overridable via the
`BudgetAmountUSD` parameter.

The deploy workflow reads two GitHub secrets:

| Secret                       | Purpose                              |
|------------------------------|--------------------------------------|
| `BUDGET_NOTIFICATION_EMAIL`  | Email for actual-cost notifications  |
| `BUDGET_AMOUNT_USD`          | Override the $50 default if set      |

Set them under repo settings → Secrets → Actions. Forecasted-cost
notifications can be added later by appending entries to
`MonthlyCostBudget.NotificationsWithSubscribers` in the SAM template:

```yaml
- Notification:
    NotificationType: FORECASTED
    ComparisonOperator: GREATER_THAN
    Threshold: 100
    ThresholdType: PERCENTAGE
  Subscribers:
    - SubscriptionType: EMAIL
      Address: !Ref BudgetNotificationEmail
```

## How to tune thresholds with real traffic

After ~1 week of production traffic:

1. **Reserved concurrency** — pull `AVG(ConcurrentExecutions)` and
   `MAX(ConcurrentExecutions)` per function in CloudWatch. If `MAX` is
   hitting the reservation more than rarely, raise the cap by 5 and
   monitor again. If `MAX` is well under the cap, leave it alone — it's
   working as intended.
2. **Errors threshold** — `> 5` is conservative for low-traffic launch.
   Once you have stable traffic, switch to either a percentage-based
   alarm via a metric math expression, or raise the absolute threshold
   to roughly 1% of the function's expected hourly invocation count.
3. **Duration p99** — 60s for image Lambdas is generous; once you have
   p99 baseline data, drop the threshold to `baseline + 50%`.
4. **Budget amount** — start at $50/month; revisit after first full
   month. Stability rendering dominates the bill (~$0.04/image), so
   actual cost scales linearly with image-generator throughput.
5. **Throttles** — `> 0` is intentionally tight; any throttle is worth
   knowing about during the first month. After that, raise to ~3 to
   filter out single-request bursts.

## Local visibility

The same JSON log lines are produced when the Flask apps run locally
(`python lambdas/<name>/app.py`). Pipe stdout through `jq` for readable
output:

```bash
python lambdas/chapter_assistant/app.py 2>&1 | jq 'select(.event=="ai_invocation")'
```

The pytest suite in `tests/unit/test_bedrock_metrics.py` validates the
log-line shape, EMF block presence, and error-status semantics. CI fails
if those drift.

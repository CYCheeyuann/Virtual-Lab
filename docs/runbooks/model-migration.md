# Runbook: Model Migration / Deprecation

How to safely change the AI model the project uses, whether because:

- AWS deprecates the current model (Anthropic Claude Haiku 4.5 will
  eventually move to a successor; same for Stability SD 3.5 Large).
- A newer model offers better quality or lower cost.
- A specific feature needs a different model than the rest of the stack
  (e.g. switch one Lambda from Claude to Nova).

## Models in use today

| Where             | Model ID                                                              | Region          |
|-------------------|-----------------------------------------------------------------------|-----------------|
| All text Lambdas  | `global.anthropic.claude-haiku-4-5-20251001-v1:0` (global profile)    | `ap-southeast-1`|
| Image generator   | `stability.sd3-5-large-v1:0`                                          | `us-west-2`     |
| Object generator  | `stability.sd3-5-large-v1:0`                                          | `us-west-2`     |

Both are referenced via env vars on the Lambdas — `MODEL_ID`,
`IMAGE_MODEL_ID`, `BEDROCK_REGION`, `IMAGE_REGION`. SAM template
parameters today **don't** expose these; they're hard-coded as defaults
in `bedrock_stream.py` and the per-Lambda `Environment.Variables`.

## When a deprecation notice arrives from AWS

AWS gives 6 months' notice before retiring a Bedrock model. The notice
usually includes the recommended successor.

### Pre-migration checklist

1. **Confirm the successor's region availability.** Some new models
   land in `us-east-1` first. If the new model isn't in
   `ap-southeast-1`, decide whether to migrate the text Lambda there
   (changes latency for users in Asia) or wait.
2. **Confirm IAM model-access** for the successor in the AWS console
   under Bedrock → Model access. Without explicit access, every Bedrock
   call returns `AccessDeniedException`.
3. **Update the IAM policy** in `infra/template.yaml` →
   `AppBedrockRole` → `BedrockInvokePolicy`. Add the successor's ARN
   alongside the old one so the migration can ship the env-var swap and
   the IAM grant in the same deploy.
4. **Run the eval harness** in `--live` mode against the new model
   first:

   ```bash
   MODEL_ID="global.anthropic.<successor>" python -m eval.run --live
   ```

   Compare result files against the previous run side-by-side. Score
   each axis per `docs/ai-output-rubric.md`. Acceptable means
   `correctness ≥ 4` and `safety ≥ 4` on every sample.

### Migration day

The safest path is two deploys:

#### Deploy 1 — IAM-only (no behaviour change)

Add the new model's IAM ARN to `BedrockInvokePolicy`. Push & deploy.
This is reversible without consequence and lets you verify access in
isolation.

```yaml
- Effect: Allow
  Action:
    - bedrock:InvokeModel
    - bedrock:InvokeModelWithResponseStream
  Resource:
    - !Sub "arn:aws:bedrock:*:${AWS::AccountId}:inference-profile/global.anthropic.claude-haiku-4-5-20251001-v1:0"
    - !Sub "arn:aws:bedrock:*:${AWS::AccountId}:inference-profile/<NEW_MODEL_ID>"
    # ... existing entries ...
```

#### Deploy 2 — Switch to the new model

Update the env vars / defaults:

- `lambdas/shared/bedrock_stream.py` — change the `MODEL_ID` default.
- `lambdas/image_generator/app.py` — change the `IMAGE_MODEL_ID`
  default if migrating Stability → Nova or similar.
- SAM template `ImageGeneratorFunction.Environment.Variables` —
  matching update.

Push to `main`. CI runs lint + pytest + eval smoke (mocked, so it
passes regardless of the model). The deploy uses the new model from the
first request after the new Lambda code becomes active.

#### Watch the rollout

For 1 hour after the migration:

- Open CloudWatch metrics for `VirtualScienceLab/AI`. Confirm:
  - `Errors` count is not climbing on any function.
  - `LatencyMs` is within 1.5× the prior baseline.
  - `OutputTokens` distribution looks similar (a sudden drop suggests
    the new model truncates differently; a sudden spike suggests a
    prompt-format regression).
- Spot-check one of each Lambda manually from the live UI.
- Run `python -m eval.run --live` on the prod stack URLs.

#### Rolling back

If something looks off, revert the Deploy 2 commit (or roll the env vars
back via the AWS console — they're plain Lambda env vars). The IAM grant
from Deploy 1 stays — it doesn't cost anything to keep both models
authorised, and it lets you swap back instantly.

## Model A/B without infrastructure churn

If you only want to A/B-test outputs across two models for one Lambda,
add a `MODEL_ID_OVERRIDE` parameter to the request body and let the
Lambda swap based on it:

```python
# Inside the Lambda's invoke_bedrock_buffered call site
mode_model = body.get("model_override") or MODEL_ID
payload = invoke_bedrock_buffered(client, mode_model, json.dumps(invoke_body), ...)
```

Drive the override from a query param, an A/B cookie, or a feature flag.
Don't expose it to anonymous users in production — the override should
only be settable by a tester. (`X-Model-Override` request header works
fine for this and is easy to whitelist behind the API key.)

## Stability SD 3.5 Large specifics

Stability uses a per-account marketplace agreement. When AWS rotates the
SD 3.5 ARN to a successor:

1. Subscribe to the new model in the AWS Marketplace listing.
2. Add the new ARN to `BedrockInvokePolicy` under the `us-west-2`
   block.
3. Update `IMAGE_MODEL_ID` in the two image Lambdas.
4. Confirm the new model uses the same request body shape. If it
   doesn't (e.g. SD 4 ships with new fields), the `_image_step` /
   `_handle_image` builder needs updating; the rest of the project
   doesn't change.

## When to migrate proactively

- A model has been EOL-flagged but not yet retired: schedule the
  migration for the next sprint window.
- A successor offers >25% cost reduction with equal quality on the eval
  harness: migrate within a quarter.
- A successor offers a meaningful capability gap (e.g. native vision
  for the experiment Lambda's file upload): migrate when the feature
  needs it.

## Don't migrate

- Just because a new model exists. Switching costs are non-zero
  (re-run the rubric, retune any prompt tone, watch the alarms).
- For a 5–10% cost difference. The savings rarely outweigh the human
  time.

# Operational Review Cadence

This document defines the recurring review schedule for the Virtual Science
Lab. It ensures that cost, quality, safety, and security are monitored
continuously rather than reactively.

## Weekly

**Owner:** On-call engineer or project lead.
**Time commitment:** ~30 minutes.

| Task | Where to look | Action if anomalous |
|------|---------------|---------------------|
| Check CloudWatch dashboards (latency, error rate, invocation volume) | CloudWatch → Dashboards → `VirtualScienceLab/AI` namespace | Investigate spikes; correlate with deployment or traffic changes |
| Review WAF blocked-request stats | WAF → Web ACLs → `<stack>-rate-limit-acl` → Overview | Add IP blocks if sustained; check if rate limits need tuning |
| Review recent high-severity errors in Lambda logs | CloudWatch Logs Insights: `filter @message like /status.*error/` | File bug or hotfix if pattern is new |
| Check budget burn rate | AWS Budgets → `<stack>-monthly` | If trending above 80% threshold before month-end, throttle expensive endpoints |
| Scan CloudWatch alarms history | CloudWatch → Alarms → History tab | Acknowledge resolved alarms; investigate any that fired without follow-up |

### Useful Logs Insights queries

```
# Errors by function in the last 7 days
filter event = "ai_invocation" and status = "error"
| stats count(*) as errors by function, error_code
| sort errors desc

# p99 latency by function
filter event = "ai_invocation"
| stats pct(latency_ms, 99) as p99_ms by function
| sort p99_ms desc

# Top IPs blocked by WAF (if WAF logs are enabled)
filter action = "BLOCK"
| stats count(*) as blocked by httpRequest.clientIp
| sort blocked desc
| limit 20
```

## Monthly

**Owner:** Project lead + one other team member for fresh eyes.
**Time commitment:** ~2 hours.

### Model output quality review

1. Pull a random sample of 20–30 model outputs from the last month:
   - Use CloudWatch Logs Insights to find `ai_invocation` events with
     `status = "ok"`, grouped by function.
   - For each, retrieve the corresponding request/response from logs
     (or from the eval framework in `eval/`).
2. Score each output against the [AI Output Rubric](ai-output-rubric.md):
   - Accuracy
   - Safety (no policy violations, hallucinations, or harmful content)
   - Relevance and helpfulness
   - Appropriate grade level
3. Flag any outputs that score below threshold for prompt review.

### Prompt and system message review

- Open each `lambdas/<name>/app.py` and review the system prompts.
- Check for:
  - Accumulated patches that could be simplified.
  - Redundant instructions.
  - Instructions that conflict with each other.
  - Opportunities to tighten safety guardrails.
- If changes are warranted, follow the [Prompt Updates runbook](runbooks/prompt-updates.md).

### Cost and usage analysis

| Metric | Source | What to look for |
|--------|--------|-----------------|
| Total Bedrock spend | AWS Cost Explorer → Service: Amazon Bedrock | Month-over-month trend; unexpected jumps |
| Per-function token usage | CloudWatch → `VirtualScienceLab/AI` → `InputTokens` + `OutputTokens` by function | Functions consuming disproportionate tokens |
| Image generation volume | CloudWatch → filter by `function = "image_generator"` or `scientific_object_generator` | Each image costs ~$0.04; volume × cost = monthly image bill |
| Lambda compute cost | Cost Explorer → Service: AWS Lambda | Should be negligible vs Bedrock; flag if not |
| Data transfer | Cost Explorer → Service: Amazon CloudFront | Unusual spikes may indicate scraping |

### Safety review

- Review any outputs flagged by `prompt_safety.py` in the last month.
- Check if any WAF rules blocked legitimate traffic (false positives).
- Review user feedback (thumbs down) from the feedback collector logs.

## Quarterly

**Owner:** Full team.
**Time commitment:** Half-day.

### Architecture and security review

- [ ] Review IAM policies: are they still least-privilege?
- [ ] Review WAF rules: are rate limits appropriate for current traffic?
- [ ] Review S3 and CloudFront configuration: public access blocks, encryption, cache policies.
- [ ] Check for new AWS service features that simplify the architecture (e.g., native WAF on Function URLs, new Bedrock models).
- [ ] Review and update [Architecture Decision Records](adr/).

### Model evaluation

- [ ] Run the full eval suite (`eval/`) against the current prompts.
- [ ] Compare scores to the previous quarter's baseline.
- [ ] Evaluate whether newer models (e.g., Claude Sonnet for complex tasks, newer Haiku versions) offer better cost/quality trade-offs.
- [ ] If a model change is warranted, follow the [Model Migration runbook](runbooks/model-migration.md).

### Security posture

- [ ] Rotate any shared secrets (API keys, if still in use).
- [ ] Review GitHub Actions secrets and IAM credentials for staleness.
- [ ] Check for dependency vulnerabilities (`pip audit`, `npm audit`).
- [ ] Review CloudTrail for unexpected API calls.

### Capacity planning

- [ ] Project next quarter's traffic growth based on current trends.
- [ ] Adjust reserved concurrency limits if needed.
- [ ] Adjust budget thresholds if actual spend pattern has changed.
- [ ] Request Lambda concurrency quota increase if approaching limits.

## Artifacts produced

Each review cycle should produce:

- **Weekly:** No formal artifact; just alarm acknowledgements and any filed issues.
- **Monthly:** A short summary (1 page) in `docs/reviews/YYYY-MM.md` covering:
  - Key metrics snapshot.
  - Any prompt changes made.
  - Any cost anomalies and actions taken.
- **Quarterly:** Updated ADRs if decisions changed; updated eval baselines; updated this document if the cadence itself needs adjustment.

## Escalation

| Condition | Action |
|-----------|--------|
| Budget > 100% actual | Immediately throttle expensive endpoints (set reserved concurrency to 1) |
| WAF blocking > 500 requests / hour sustained | Investigate; consider adding geo-blocking or stricter IP rules |
| Model output safety failure in production | Immediate prompt patch; follow [Incident Response runbook](runbooks/incident-response.md) |
| Eval scores drop > 10% quarter-over-quarter | Trigger model evaluation and prompt review ahead of schedule |

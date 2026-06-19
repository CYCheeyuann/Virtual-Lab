# Runbook: Incident Response

This runbook is a checklist for the first 15 minutes of "the site is
broken" or "we got an alarm." Don't memorise it; have it open in a tab
when an alarm pages.

## Severity ladder

| Level | Examples                                                     | Response time | Page who? |
|-------|--------------------------------------------------------------|---------------|-----------|
| SEV-1 | Site fully unreachable; cost runaway >$100/h; data exposure  | Now           | Everyone  |
| SEV-2 | One Lambda 5xx-ing >50% of requests; chat returns wrong subject | <1h           | On-call   |
| SEV-3 | One alarm flapping; degraded but usable                      | Same day      | Async     |
| SEV-4 | Cosmetic / non-blocking                                      | Next sprint   | None      |

## Step 1 — Confirm the symptom (≤2 min)

Don't chase ghosts. Reproduce or observe the issue first:

- Open the user-facing site:
  `https://<your-cloudfront-domain>/index.html` and `…/chapter.html`
- Open the browser DevTools network tab → make a request → check
  status code, response body, response time.
- Check the [CloudWatch alarms dashboard](https://console.aws.amazon.com/cloudwatch/home?region=ap-southeast-1#alarmsV2:):

  ```
  Alarms by stack: virtual-science-lab-assistant-*
  ```

If nothing is alarming and the site looks healthy, write the reporter
back asking for the exact error / time / browser. Assume false alarm.

## Step 2 — Check the obvious (≤3 min)

Most outages are one of:

1. **Bedrock outage in `ap-southeast-1` or `us-west-2`.** Open
   <https://health.aws.amazon.com/health/status>. If Bedrock is red,
   stand down and post in chat. There's nothing to fix.
2. **CloudFront cache stale.** A recent deploy didn't run an
   invalidation. Run:

   ```
   aws cloudfront create-invalidation --distribution-id <id> --paths "/*"
   ```
3. **Reserved-concurrency throttle.** `…-throttles` alarm fires.
   Inspect the metric; if traffic genuinely exceeded the cap, raise
   it (when account quota allows) per `docs/observability-and-cost-controls.md`.
4. **Bad recent deploy.** Check the most recent merge to `main` and
   recent stack events:

   ```
   aws cloudformation describe-stack-events \
       --stack-name virtual-science-lab-assistant --max-items 30
   ```

If the cause is a recent deploy, jump straight to
[`rollback.md`](rollback.md).

## Step 3 — Inspect logs (5 min)

Each Lambda emits one structured `ai_invocation` log line per Bedrock
call. Use CloudWatch Logs Insights:

```
fields @timestamp, function, model_id, status, latency_ms, input_tokens, output_tokens, error_code
| filter event = "ai_invocation"
| sort @timestamp desc
| limit 100
```

Filter to the affected function or to `status = "error"` to triage.

## Step 4 — Mitigate

| Symptom                                                         | First action                                                            |
|-----------------------------------------------------------------|--------------------------------------------------------------------------|
| Errors > 5/5min on a single Lambda after a deploy               | Roll back: see [`rollback.md`](rollback.md)                              |
| `ResourceNotFoundException` from Bedrock on every call          | Bedrock model access revoked. Open AWS console → Bedrock → Model access → re-grant. |
| `AccessDeniedException` on Stability calls                      | SD 3.5 marketplace agreement expired. Re-accept in Bedrock console (us-west-2). |
| Latency p99 > 60s on image generator                            | Stability is slow today. Check AWS Health. If Bedrock is healthy, increase Lambda memory to 2048 MB. |
| Cost spike alert (Budget 80%)                                   | Run `eval/run.py --live` to confirm correctness; check `OutputTokens` metric for runaway responses. Suspect prompt regression. |
| `ai_invocation` log lines show `output_tokens` near `max_tokens`| The model is generating to the cap. Likely a prompt change requesting too much output. Roll back the prompt. |

## Step 5 — Comms

In a SEV-1 / SEV-2:

1. Post a one-line status in the team channel: *"Investigating
   high-error rate on `science_tutor` since 14:32. Cause unknown.
   Owner: \<name\>."*
2. Update every 15 minutes until resolved.
3. After mitigation, a one-line resolution: *"Resolved at 15:01 by
   reverting commit `1646920`. Postmortem to follow."*

## Step 6 — Postmortem

Write within 48h. Template:

```markdown
# Postmortem — <date> — <one-line description>

## Summary
What happened, in 3 sentences.

## Impact
- User-visible duration:
- Requests affected:
- Estimated cost: $<n>

## Root cause
The single technical reason. Avoid blame.

## Detection
How was it detected? Was it the right alarm? Was it too late?

## Mitigation
What action stopped the bleed? How long did it take from page-to-mitigation?

## Action items
1. Owner — Action — Due date.
2. ...
```

Commit it to `docs/postmortems/YYYY-MM-DD-<slug>.md`. Past postmortems
are an asset; reading them is the cheapest training for the next person
on call.

## Roster (placeholder)

This project doesn't currently have a paged on-call rotation. Until it
does, treat any SEV-1 / SEV-2 as needing **whoever happens to see it
first** to start Step 1 and post in chat. Don't assume someone else is
already on it.

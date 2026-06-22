# Review Cadence — Virtual Science Lab Assistant

Defines how the system stays safe, cheap, and shippable without ad-hoc audits.

## Roles

| Role               | Default DRI   | Backup |
|--------------------|---------------|--------|
| Application owner  | Project lead  | —      |
| Cloud / IaC owner  | Project lead  | —      |
| Security reviewer  | Project lead  | —      |
| Eval / prompt owner| Project lead  | —      |

## Monthly Operational Review (15–30 min)

**When.** First Monday of every month.

**Inputs.**
- CloudWatch dashboards: Lambda errors, throttles, p99 duration, WAF blocks.
- AWS Cost Explorer: month-to-date by service, by Environment tag.
- Feedback Insights queries (negative_rate per function, top categories).
- Open issues tagged `prompt-fix`, `infra`, `security`.

**Checklist.**
- [ ] Any alarm fired this month? Confirm acknowledgement and root cause.
- [ ] Cost vs budget — within 80% threshold? If creeping, raise budget OR cut usage.
- [ ] Negative-feedback rate per function < 10%? If not, file `prompt-fix`.
- [ ] Reserved concurrency vs actual peak — adjust if peak > 70% of reservation for 2 weeks.
- [ ] Eval smoke pass rate ≥ 95% over last month.
- [ ] Lambda runtime / dependency CVEs (Dependabot, AWS runtime advisories).

**Evidence retained** (in `docs/reviews/YYYY-MM.md`):
- Dashboard screenshots, cost screenshot, Insights query results, action-item list.

## Quarterly Security & Configuration Review (1 hr)

**When.** First week of each quarter.

**Checklist.**
- [ ] IAM role audit: `AppBedrockRole` only carries model ARNs in active use.
- [ ] S3 PublicAccessBlock — all four flags `true`.
- [ ] WAF efficacy: blocked-request count, false-positive sample, managed-rule-group versions current.
- [ ] CloudFront viewer cert / TLS version still TLSv1.2_2021 or higher.
- [ ] Function URL `AuthType` audit (target state: `AWS_IAM` for all).
- [ ] Secrets review: `API_KEY` rotation if still in use; `SAM_DEPLOY_BUCKET` access scoped to CI.
- [ ] Drift detection on all stacks → `IN_SYNC`.
- [ ] Rollback drill rehearsal in `dev` (Paths A, B, C) — record times.
- [ ] Bedrock model ARN allowlist matches what is actually invoked (grep for `MODEL_ID`).
- [ ] Logs retention set explicitly on every Lambda log group.

**Evidence retained.**
- Quarterly report in `docs/reviews/YYYY-QN-security.md`.
- Drill timing log.
- Drift detection JSON.

## Out-of-band Reviews (triggered)

Trigger an immediate review when any of the following happens:

- Production incident resolved (review within 5 working days; produce a postmortem).
- New Lambda function or new Bedrock model added.
- IAM policy or trust relationship change.
- Cost > 100% of budget for the month.
- Security advisory affecting a runtime, layer, or dependency in use.
- WAF managed rule group version bump.
- Major frontend release (more than ~30% of files changed).

## Definitions

- **Down-rate.** thumbs-down / (thumbs-up + thumbs-down) for a function over a window.
- **Drift.** Any difference between live AWS resource state and the SAM template.
- **Eval smoke.** `python -m eval.run --smoke` — 1 sample/Lambda, mocked Bedrock.

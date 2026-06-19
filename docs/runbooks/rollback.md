# Runbook: Rollback

When to use this runbook:

- A deploy went out and the site is broken (5xx surge, frontend errors,
  prompt regression noticed in chat output, cost spike, etc).
- An alarm fired immediately after a deploy.
- A new model produced clearly worse output than the previous version.

Three rollback paths, in order of how aggressive they are:

## 1. Frontend-only rollback (fastest, ~3 min)

If only the **static site** is broken (CSS, JS error, missing asset),
rebuild from the previous git commit and re-sync to S3 — no SAM redeploy.

```bash
git checkout <previous-good-commit>
aws s3 sync frontend/ s3://<bucket-name>/ --cache-control no-cache --region ap-southeast-1
aws cloudfront create-invalidation --distribution-id <dist-id> --paths "/*"
```

The bucket name and distribution ID are stack outputs:

```bash
aws cloudformation describe-stacks --stack-name virtual-science-lab-assistant \
    --query "Stacks[0].Outputs[?OutputKey=='BucketName' || OutputKey=='CloudFrontDistributionId']"
```

When done, `git checkout main` and prepare a forward-fix.

## 2. Re-deploy the previous git commit (recommended, ~6–10 min)

This rolls everything — Lambda code, prompts, infra — back to a known-good
commit using the existing CI pipeline.

```bash
# On your local clone
git revert <bad-commit>          # one or more commits
git push origin main
```

The push triggers `.github/workflows/deploy.yml`, which will:

1. Run lint + pytest + eval smoke (gating).
2. SAM-deploy the reverted code to the same stack.
3. Re-sync `frontend/` and invalidate CloudFront.

You can also manually trigger via the Actions tab → "Deploy Virtual
Science Lab Assistant" → Run workflow → choose `prod`.

If the bad change is a single revert-friendly commit, prefer this path
over option 3 — it preserves history and forces the same quality gate.

## 3. CloudFormation stack rollback (~10–15 min)

For schema-breaking infra changes (alarms reverted to wrong dimension,
IAM policy too restrictive), use CloudFormation directly:

```bash
# View recent stack events to confirm what changed
aws cloudformation describe-stack-events --stack-name virtual-science-lab-assistant \
    --max-items 30

# Roll back the most recent UPDATE_COMPLETE
aws cloudformation cancel-update-stack --stack-name virtual-science-lab-assistant
# OR, if the update has already finished:
aws cloudformation rollback-stack --stack-name virtual-science-lab-assistant
```

`rollback-stack` triggers the same rollback CloudFormation does on its
own when an update fails — no code change required, but it only walks
back **one** stack update. Multi-step regressions need option 2.

## Per-environment rollback

The deploy workflow takes an `environment` input (`dev`/`staging`/`prod`).
Each env is a separate CloudFormation stack:

| Environment | Stack name                          |
|-------------|-------------------------------------|
| dev         | `virtual-science-lab-dev`           |
| staging     | `virtual-science-lab-staging`       |
| prod        | `virtual-science-lab-assistant`     |

Substitute the right stack name in any of the commands above.

## After a rollback

1. **Confirm** the alarm or symptom that triggered the rollback has
   cleared. Open CloudWatch → Alarms and watch for `INSUFFICIENT_DATA →
   OK` transitions on the relevant Lambda.
2. **Note the bad commit** in `docs/runbooks/incident-response.md` so
   future operators don't blindly redeploy it.
3. **Open a fix-forward PR** rather than merging the bad commit again.

## Things rollback does NOT cover

- **Bedrock model behaviour changes**: AWS occasionally bumps a global
  inference profile under the same model ID (e.g.
  `global.anthropic.claude-haiku-4-5-20251001-v1:0` could change behind
  the scenes). Rolling back the stack does not roll the model back. See
  `docs/runbooks/model-migration.md`.
- **localStorage data** on user devices: a code rollback doesn't clean
  user-side state. If a previous version wrote a malformed
  `vsl.flashcards` blob, the rolled-back version may still see it. Any
  schema-breaking change on the frontend should ship a version-bump
  migration in the same PR.
- **CloudFront edge caches** outside the regions invalidated. The
  `aws cloudfront create-invalidation --paths "/*"` step covers all
  edges; if you skip it, viewers can keep seeing stale assets for the
  cache TTL (24h with the AWS-managed CachingOptimized policy).

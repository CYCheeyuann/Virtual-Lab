# Security: Rate Limiting & Abuse Protection

This document describes the abuse scenarios, current mitigations, and the
planned steady-state design for protecting the Virtual Science Lab's
public-facing endpoints.

## Threat model

| Threat | Impact | Likelihood |
|--------|--------|------------|
| Scripted abuse of Lambda Function URLs | Uncontrolled Bedrock cost (especially image generation at ~$0.04/render) | High — URLs are discoverable from browser dev tools |
| API key extraction from frontend JS | Bypass of any UI-level rate limiting | Trivial — `config.js` is public |
| Credential stuffing / probing | Noise in logs, potential for triggering alarms | Medium |
| Large-payload attacks | Lambda timeout / memory exhaustion | Low — Flask + validators cap input |

## Current mitigations (short-term)

### AWS WAF Web ACL

Defined in `infra/template.yaml` as `WafWebAcl`. Rules:

| Priority | Rule | Effect |
|----------|------|--------|
| 1 | `RateLimitPerIP` | Block after 100 requests / 5 min per IP |
| 2 | `RateLimitExpensiveEndpoints` | Block after 20 requests / 5 min per IP to image/scientific_object paths |
| 3 | `AWSManagedRulesCommonRuleSet` | AWS-managed rule group blocking known exploit patterns |
| 4 | `AWSManagedRulesKnownBadInputsRuleSet` | AWS-managed rule group blocking known bad inputs (Log4j, etc.) |

**Deployment note:** The WAF is created with `Scope: REGIONAL` in the same
stack. To attach it to the CloudFront distribution, it must be in
`us-east-1`. Options:

1. Deploy the entire stack to `us-east-1` and change Scope to `CLOUDFRONT`.
2. Create a separate mini-stack in `us-east-1` with just the WAF, then
   reference its ARN in the CloudFront `WebACLId` property.
3. Migrate to CDK where cross-region references are first-class.

### CloudWatch alarms

- `WafBlockedRequestsAlarm`: fires when > 50 requests are blocked in 5 min.
- Existing Lambda Errors / Throttles alarms detect abuse-driven spikes.

### Reserved concurrency (pending quota increase)

See [Observability & Cost Controls](observability-and-cost-controls.md) for
the intended per-function caps. Once the account concurrency quota is raised
to ≥ 50, these will limit worst-case parallelism:

- Image Generator: 5
- Scientific Object Generator: 5
- Flashcard Generator: 5
- Science Tutor: 10

### Application-level protections

- Input validation: subject/difficulty whitelist, topic length cap (200 chars).
- File size cap: 10 MB server-side.
- Conversation history cap: 20 turns.
- Optional `X-Api-Key` header check (defence-in-depth, NOT real security).

## Planned steady-state design (medium-term)

### 1. Lambda Function URLs → `AuthType: AWS_IAM`

Change all Function URLs from `AuthType: NONE` to `AuthType: AWS_IAM` in
`template.yaml`. This requires callers to sign requests with valid AWS
credentials (SigV4).

### 2. Cognito Identity Pool for frontend credentials

- Create a Cognito Identity Pool that issues temporary AWS credentials to
  unauthenticated (guest) users.
- Configure the Identity Pool's IAM role to allow only
  `lambda:InvokeFunctionUrl` on the specific Function URL ARNs.
- This gives every browser session a unique, time-limited AWS identity that
  can be tracked, throttled, and revoked.

### 3. Frontend SigV4 signing

- Use `@aws-sdk/credential-providers` + `@aws-sdk/signature-v4` (or the
  full `@aws-sdk/client-lambda`) to sign HTTP requests from the browser.
- Remove `X-Api-Key` from `config.js` and from the backend validator.
- The "secret in JS" anti-pattern is eliminated entirely.

### 4. Per-identity rate limiting

With Cognito identities, WAF can scope rate limits by the
`cognito-identity.amazonaws.com` header or by custom request headers
injected by the SDK. This allows:

- Per-user rate limits (not just per-IP).
- Banning specific identities without affecting shared IPs (school networks).

### 5. API Gateway migration (optional)

If more granular controls are needed (usage plans, request validation,
API keys with per-key quotas), migrate from Function URLs to API Gateway
HTTP APIs. This is not required if WAF + IAM auth are sufficient.

## Operational procedures

### Responding to a rate-limit alarm

1. Check WAF sampled requests in the AWS Console (WAF → Web ACLs → your ACL → Overview).
2. Identify the offending IP(s) or pattern.
3. If sustained, add an IP set rule to the WAF ACL with explicit `Block`.
4. If a single identity is responsible, revoke or disable it in Cognito.

### Responding to a cost spike

1. Check the Budget alarm email and CloudWatch Bedrock metrics.
2. Identify which function and model are responsible.
3. Reduce reserved concurrency for that function to throttle new invocations.
4. If necessary, disable the Function URL temporarily by setting the
   Lambda's reserved concurrency to 0 (instant kill switch).

## References

- [AWS WAF documentation](https://docs.aws.amazon.com/waf/latest/developerguide/)
- [Lambda Function URL auth](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html)
- [Cognito Identity Pools](https://docs.aws.amazon.com/cognito/latest/developerguide/identity-pools.html)
- [Observability & Cost Controls](observability-and-cost-controls.md)

# ADR 0002: Lambda Function URLs over API Gateway

## Status

Accepted — under review for partial migration (see Consequences)

## Context

The application exposes 10 Lambda functions over HTTP. Six of them use
response streaming (chunked transfer encoding) to deliver token-by-token
LLM output to the browser. The remaining four use standard buffered
responses.

Options for exposing Lambda over HTTP:

- **Lambda Function URLs:** Native HTTPS endpoints on each function, with
  built-in support for `RESPONSE_STREAM` invoke mode.
- **API Gateway REST API:** Full-featured but does not support response
  streaming.
- **API Gateway HTTP API:** Lighter weight, lower cost, but also does not
  support response streaming (as of mid-2025).
- **CloudFront + Function URLs:** Use CloudFront as the public-facing layer
  with Function URLs as the origin.

Constraints:

- Response streaming is a hard requirement for the chat/tutor experience.
- The prototype needed to ship quickly with minimal configuration.
- Budget for API Gateway's per-request pricing was a concern for a learning
  project.

## Decision

Use **Lambda Function URLs** for all endpoints, with `AuthType: NONE` and
an optional `X-Api-Key` header check in application code.

## Consequences

### Positive

- **Streaming support:** Function URLs are the only AWS-native way to stream
  a Lambda response without a WebSocket API or custom proxy.
- **Zero additional cost:** No per-request or per-connection charges beyond
  Lambda invocation pricing.
- **Minimal configuration:** One `FunctionUrlConfig` block per function in
  the SAM template; no separate API resource, stage, or route definitions.
- **Low latency:** Direct invocation path without an intermediary service.

### Negative

- **No built-in auth (critical gap):** `AuthType: NONE` means any client
  with the URL can invoke the function. The `X-Api-Key` check in code is
  defence-in-depth only — the key ships to the browser.
- **No native rate limiting:** Function URLs have no throttling, usage plans,
  or quota features. Rate limiting must come from WAF, CloudFront, or
  application code.
- **No request validation:** API Gateway can validate request bodies against
  a schema before the Lambda runs. Function URLs pass everything through.
- **Per-function URLs:** Each function gets its own hostname, making CORS
  and frontend configuration more complex than a single API Gateway endpoint.
- **No native WAF attachment:** WAF cannot attach directly to a Function URL.
  CloudFront or API Gateway must front the URL to use WAF.

### Mitigations in place

- WAF Web ACL defined in `template.yaml` (attach via CloudFront).
- Input validation in `lambdas/shared/validators.py`.
- CloudFront distribution fronts the S3 site (potential proxy for URLs too).

### When to reconsider

- If `AuthType: AWS_IAM` + Cognito is adopted (planned medium-term), the
  Function URL pattern remains viable with proper SigV4 signing.
- If API Gateway adds response streaming support, migrating the buffered
  endpoints (flashcard, image, feedback, scientific object) to HTTP API
  would gain usage plans, throttling, and API keys natively.
- If per-function hostnames become a management burden, an API Gateway HTTP
  API as a unified entry point (proxying to Function URLs for streaming)
  could simplify frontend config.

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| API Gateway REST API | Auth, throttling, request validation, WAF-native | No response streaming; per-request cost |
| API Gateway HTTP API | Lower cost than REST; JWT authorizers | No response streaming |
| ALB + Lambda | Streaming via chunked responses; WAF-native | Higher baseline cost (ALB hourly); more complex networking |
| CloudFront → Function URLs | WAF attachment; single domain; caching | Added complexity; origin config for streaming |

## Related

- `infra/template.yaml` — Function URL definitions
- [docs/security.md](../security.md) — abuse protection strategy
- ADR 0001 — SAM choice influences how Function URLs are configured

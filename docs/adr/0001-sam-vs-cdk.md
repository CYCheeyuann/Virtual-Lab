# ADR 0001: AWS SAM over AWS CDK for Infrastructure-as-Code

## Status

Accepted

## Context

The Virtual Science Lab needs infrastructure-as-code to manage Lambda
functions, S3 buckets, CloudFront distributions, IAM roles, CloudWatch
alarms, and WAF resources. The two primary options in the AWS ecosystem are:

- **AWS SAM (Serverless Application Model):** A YAML-based extension of
  CloudFormation, purpose-built for serverless workloads.
- **AWS CDK (Cloud Development Kit):** A programmatic IaC framework where
  infrastructure is defined in TypeScript, Python, Java, etc.

Constraints at the time of decision:

- The application is purely serverless (Lambda + S3 + managed services).
- The team is small and values simplicity over flexibility.
- CI/CD is GitHub Actions; SAM CLI integrates directly (`sam build`,
  `sam deploy`).
- No complex multi-region orchestration was required at launch.

## Decision

Use **AWS SAM** with a single `template.yaml` file.

## Consequences

### Positive

- **Simplicity:** One YAML file describes the entire stack. New contributors
  can read and understand it without learning a programming framework.
- **Lambda-native:** SAM's `AWS::Serverless::Function` resource type
  provides sensible defaults (IAM, event sources, packaging) that would
  require explicit boilerplate in CDK.
- **Fast iteration:** `sam build && sam deploy` is a single pipeline step
  with no compilation or synthesis phase.
- **Low dependency footprint:** Only SAM CLI + Python are needed; no Node.js
  toolchain required for infrastructure.
- **CloudFormation compatibility:** Any CloudFormation resource can be used
  directly in the template without escape hatches.

### Negative

- **No programmatic constructs:** Loops, conditionals, and abstractions are
  limited to CloudFormation's `Fn::If`, `Conditions`, and `Mappings`. As the
  stack grows (10+ Lambdas, cross-region WAF), the YAML becomes repetitive.
- **Cross-region limitations:** SAM deploys to one region. Resources that
  must live in `us-east-1` (e.g., WAF for CloudFront) require a separate
  stack or manual steps.
- **Testing:** No unit tests for infrastructure logic (CDK has `assertions`
  and snapshot testing out of the box).
- **Refactoring risk:** Renaming or restructuring resources in YAML can
  trigger replacements that CDK's higher-level constructs would handle
  gracefully.

### When to reconsider

- If the stack exceeds ~500 lines of repetitive resource definitions.
- If cross-region deployment becomes a recurring pain point.
- If infrastructure unit testing becomes a team priority.

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| AWS CDK (TypeScript) | Programmatic, testable, cross-region support | Heavier toolchain, synthesis step, overkill for a small serverless app |
| Raw CloudFormation | No SAM dependency | Verbose; loses serverless shortcuts |
| Terraform | Cloud-agnostic, mature state management | Different ecosystem; team is AWS-native |

## Related

- `infra/template.yaml` — the SAM template
- `.github/workflows/deploy.yml` — CI/CD pipeline using SAM CLI

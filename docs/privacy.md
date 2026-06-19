# Privacy Notes

This document describes what data the application stores, where it lives,
how long it lives, and what a user can do about it. Plain-language version
for end users; the technical detail is below.

## What we store on the user's own browser (`localStorage`)

All listed below stay on the device. The application has no backend
account system, so this localStorage is the entire user-side state.

| Key                  | Page that writes it       | Contents                                                  |
|----------------------|---------------------------|-----------------------------------------------------------|
| `vsl.progress`       | quiz, multiple             | Total quizzes taken, accuracy, streak, last-active subject. |
| `vsl.quizHistory`    | quiz                      | Last ~50 quiz attempts: questions, answers, scores.       |
| `vsl.flashcards`     | flashcards                | All decks + cards + Leitner box state per card.           |
| `vsl.globalChat`     | global chatbot widget     | Last ~100 messages with the in-page Lab Assistant.        |
| `vsl.experimentGuide`| experiment                | Last generated experiment node-map.                       |
| `vsl.chapterState`   | chapter                   | Last subject/level/topic + cached chapter cards.          |
| `selectedSubject`    | shared                    | Current subject for theming.                              |
| `theme`              | shared (legacy)           | Cleared on every load — dark mode is fixed.               |

A user can wipe all of this at any time via their browser's "Clear site
data" / "Clear cookies and site data" function. The application does
not synchronise this to any cloud account.

## What we send to the backend

Each AI feature is one HTTPS POST to the corresponding Lambda Function URL:

```
Browser ──► CloudFront ──► S3 (static frontend only)
        │
        └──► Lambda Function URL (HTTPS) ──► AWS Bedrock
```

Each request body contains **only** the fields the user filled into the
form (subject, topic, message, scenario, etc.) plus any document the user
explicitly attached. Specifically:

- We do NOT send cookies, IP geolocation lookups, or device fingerprints.
- We do NOT collect names, emails, or any account identifier (there is no
  account system).
- We do NOT log the request body to CloudWatch. Only the structured
  metadata described below is logged.

### Bedrock data flow

The Lambda forwards user input to AWS Bedrock to invoke a model. Bedrock's
own data-handling policy applies:

- AWS does not use Bedrock prompts/completions to train AWS-owned or
  third-party models.
- Bedrock does not retain prompts or completions after the request
  completes. (See the AWS Bedrock data privacy FAQ for current details.)

### Files / images uploaded to the experiment, quiz, or tutor pages

When a user attaches a document, it is base64-encoded in the browser,
sent to the Lambda inside the request body, forwarded to Bedrock as part
of the prompt, and then discarded. The Lambda does not write the file to
S3 or any other storage. It exists only in the Lambda's RAM during the
request.

## What goes to CloudWatch logs

The backend emits structured log lines that we keep for **operational
debugging only**. They never include the user's prompt body, attached
files, or model output. What they do contain:

| Field           | Why                                                   |
|-----------------|-------------------------------------------------------|
| `function`      | which Lambda handled the request                      |
| `model_id`      | which Bedrock model was called                        |
| `mode`          | sub-action label (e.g. `quiz_generate`, `image`)      |
| `latency_ms`    | how long the Bedrock call took                        |
| `status`        | `ok` or `error`                                       |
| `input_tokens`  | reported by Bedrock; null when not available          |
| `output_tokens` | reported by Bedrock; null when not available          |
| `error_code`    | Bedrock error code on failure                         |

No prompt content, no user identifier, no file content. See
`docs/observability-and-cost-controls.md` for the full schema.

### Feedback events

When a user clicks a thumbs-up / thumbs-down, the backend logs:

```
feature, rating, subject (optional), context (≤200 chars from the form),
session_id (random per-page-load id, NOT persistent)
```

The `session_id` lets analysts group multiple feedback clicks from the
same study session without storing any identifier. It is regenerated on
every page reload and is never written to localStorage.

## Retention

| Layer                        | Default retention                                                     |
|------------------------------|-----------------------------------------------------------------------|
| Browser `localStorage`       | Persists on the user's device until they clear site data.             |
| CloudWatch Logs              | Per-account default (typically "Never expire" until set on each log group). |
| CloudWatch Metrics (EMF)     | AWS standard: 15 months.                                              |
| Bedrock                      | Not retained per AWS Bedrock data policy.                             |
| Audit / S3 storage           | None — the project does not write user data to S3.                    |

**Operator action recommended**: set a CloudWatch Logs retention policy of
30 days on every Lambda's log group. That can be done through:

```
aws logs put-retention-policy --log-group-name /aws/lambda/<function> --retention-in-days 30
```

…or by adding a `LogGroup` resource per Lambda in `infra/template.yaml`.
This is a known follow-up — see the runbook on rotating logs.

## How a user requests deletion

Because no per-user data is held server-side, the deletion path is
entirely client-side: open browser DevTools → Application → Storage →
Clear site data. The frontend has no "delete account" affordance because
there is no account to delete.

## Contact

This is a research / educational project. Issues and questions go to
the GitHub repository at <https://github.com/CYCheeyuann/Virtual-Lab>.

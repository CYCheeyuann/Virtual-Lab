# 🔬 Virtual Science Lab Assistant

An AI-powered learning companion for Biology, Chemistry, and Physics — sliced from a PartyRock prototype into a production-ready AWS application.

## Stack

- **AWS Lambda** (Python 3.12, Flask, Lambda Web Adapter, response streaming)
- **Amazon Bedrock**
  - Text: Claude Haiku 4.5 via the **global** inference profile
    (`global.anthropic.claude-haiku-4-5-20251001-v1:0`), called from
    `ap-southeast-1`.
  - Image: **Amazon Titan Image Generator v2**
    (`amazon.titan-image-generator-v2:0`), called from `us-east-1`. The IAM
    policy also covers Nova Canvas / Titan v1 so you can swap models by
    changing the `IMAGE_MODEL_ID` env var alone.
- **Amazon S3** — static website hosting (multi-page)
- **GitHub Actions** — CI/CD via AWS SAM

## Features

| Page | What it does |
|------|-------------|
| 📖 **Chapter Assistant** | Generates topic overview for the selected subject |
| 🧪 **Experiment Guide** | Full lab guide + safety briefing, supports file upload (PDF, images, DOCX…) |
| 📝 **Science Quiz** | Multiple-choice quiz with blur-hidden answers, 4 difficulty tiers |
| 🤖 **Science Tutor** | Streaming chatbot with full conversation memory + document analysis |

All panels stream token-by-token with a blinking cursor and markdown rendering.

## Architecture

```
Browser (S3 multi-page site)
    │
    │  fetch + ReadableStream
    ▼
Lambda Function URLs (7 Flask apps; 6 RESPONSE_STREAM, 1 BUFFERED)
    │
    ├──► Amazon Bedrock — Claude Haiku 4.5 (global inference profile, ap-southeast-1)
    │       ↳ chapter, experiment, quiz, tutor, safety, what-if, image-prompt expansion
    │
    └──► Amazon Bedrock — Titan Image Generator v2 (us-east-1)
            ↳ image generator (rendered from Claude-expanded prompt)
```

## Security hardening applied

- Input validation and sanitization (subject/difficulty whitelist, topic length cap)
- File size limit (10 MB client + server-side)
- Structured error messages (no internal details leaked to frontend)
- CORS restricted via `ALLOWED_ORIGIN` environment variable
- Optional API Key auth (`X-Api-Key` header, configured via env var)
- Conversation history capped at 20 turns
- Buttons disabled during streaming (no spam clicks)
- HTML output escaped to prevent XSS
- AWS WAF rate limiting (per-IP and per-endpoint caps) — see [docs/security.md](docs/security.md)

## Project layout

```
.
├── frontend/
│   ├── index.html         landing page with tile navigation
│   ├── chapter.html       chapter assistant page
│   ├── experiment.html    experiment guide page
│   ├── quiz.html          science quiz page
│   ├── tutor.html         science tutor chatbot page
│   ├── styles.css         shared CSS (palette: #D4E09B / #F6F4D2 / #CBDFBD)
│   ├── config.js          URL placeholders (sed-injected at deploy)
│   └── common.js          shared streaming + markdown + upload logic
├── lambdas/
│   ├── shared/            DRY: bedrock_stream, cors, validators
│   ├── chapter_assistant/
│   ├── experiment_guide/
│   ├── science_quiz/
│   └── science_tutor/
├── infra/
│   └── template.yaml      SAM template (IAM, 4 Lambdas, S3)
└── .github/workflows/
    └── deploy.yml          CI/CD pipeline
```

## Pre-deployment checklist

1. **Enable Bedrock model access** — request access in **both** regions:
   - `ap-southeast-1` (Singapore): Claude Haiku 4.5 (request via the
     `global.anthropic.claude-haiku-4-5-20251001-v1:0` global profile).
   - `us-east-1` (N. Virginia): `amazon.titan-image-generator-v2:0`
     (and/or `amazon.nova-canvas-v1:0` if you'd rather use Nova).

2. **Create an S3 bucket** for SAM deployment artifacts (any name, in `ap-southeast-1`).

3. **Add GitHub repo secrets** at Settings → Secrets → Actions:
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `SAM_DEPLOY_BUCKET`

4. **Push to `main`** or trigger **Run workflow** in the Actions tab.

5. Open the `WebsiteUrl` printed in the workflow log.

## Local testing

```bash
cd lambdas/chapter_assistant
pip install flask boto3
python app.py
# POST http://localhost:8080/ with {"subject": "Biology"}
```

## License

MIT

## Documentation

| Document | Purpose |
|----------|---------|
| [docs/security.md](docs/security.md) | Abuse protection, WAF configuration, and the Cognito/IAM migration plan |
| [docs/operational-cadence.md](docs/operational-cadence.md) | Weekly/monthly/quarterly review schedule for quality, cost, and security |
| [docs/observability-and-cost-controls.md](docs/observability-and-cost-controls.md) | Metrics, alarms, reserved concurrency, and budget configuration |
| [docs/adr/](docs/adr/) | Architecture Decision Records — canonical log of key design choices |
| [docs/runbooks/](docs/runbooks/) | Operational runbooks (incident response, model migration, prompt updates, rollback) |
| [docs/privacy.md](docs/privacy.md) | Data handling and privacy practices |

### Architecture Decision Records (ADRs)

ADRs are the canonical place to understand *why* the architecture looks the
way it does. They live in [`docs/adr/`](docs/adr/) and follow an append-only
convention: past decisions are never rewritten — they are superseded by new
ADRs when things change.

Current ADRs:

- [0001 — SAM vs CDK](docs/adr/0001-sam-vs-cdk.md)
- [0002 — Function URLs vs API Gateway](docs/adr/0002-function-url-vs-api-gateway.md)
- [0003 — Claude Haiku vs Sonnet](docs/adr/0003-model-selection-claude-haiku-vs-sonnet.md)

When making a new architectural decision, add a new ADR rather than only
discussing it in a PR.

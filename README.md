# LLM-assisted Catalogue QA

AI-assisted catalogue QA for Shopify-shaped product events. Deterministic TypeScript rules validate consequential fields first; an OpenAI-compatible LLM is used only for weak category classification; validated suggestions go to a human review queue.

## Current implementation status

The API, React review UI, fixtures, deterministic evaluation, n8n export, and n8n helper scripts are present, and the root package wires `build`, `test`, `eval`, `validate:n8n`, and `demo`. The live webhook demo still requires a running n8n instance and API.

## Prerequisites

- Node.js `^20.19.0 || >=22.12.0` (or any Node `>=22.12.0`), as declared by the root package.
- npm with workspace support.
- n8n `1.107.4` is the pinned version in `n8n/catalogue-qa-workflow.json` and must be used for the workflow smoke test.
- A real OpenAI-compatible LLM endpoint is needed only for a real-model demo; evaluation does not need network access or credentials.

## Install and workspace commands

```bash
npm install
npm test                    # API and web tests
npm run build               # API TypeScript build and web production build
npm run eval                # 12-fixture evaluation; injected providers only
npm -w api test             # API tests only
npm -w web test             # web typecheck and behavioral tests only
```

The root package exposes `build`, `test`, `eval`, `validate:n8n`, and `demo`. It does not expose a `dev` script; run the API and Vite directly as shown below.

## Run the API and web UI locally

Copy the example as a reference and export its values in each terminal. The application does not load `.env` automatically (there is no dotenv dependency).

```bash
cp .env.example .env
set -a; source .env; set +a
```

In one terminal, run the API on `http://localhost:3000`:

```bash
npm -w api exec -- tsx src/server.ts
```

In another terminal, run Vite on `http://localhost:5173`:

```bash
npm -w web exec -- vite --host localhost
```

`VITE_API_URL` is read by Vite at dev/build time. The API exposes:

- `POST /analyse-product` with an internal `{ "product": ... }` envelope;
- `GET /reviews` for the latest summary and pending queue;
- `POST /reviews/:productId` with `{ "decision": "approve" | "reject" }`.

## n8n workflow

Start the pinned local version:

```bash
npx n8n@1.107.4 start
```

Open `http://localhost:5678`, import `n8n/catalogue-qa-workflow.json`, and activate the workflow (or use **Listen for test event** while testing). The imported Webhook path is `catalogue-qa`, so the production URL is normally `http://127.0.0.1:5678/webhook/catalogue-qa` and the test URL is normally `http://127.0.0.1:5678/webhook-test/catalogue-qa`. Copy the complete URL shown by n8n into `N8N_WEBHOOK_URL`; use the matching `/webhook-test/...` or `/webhook/...` URL and relink it whenever the workflow path, host, or mode changes.

The flow is:

```text
Shopify-shaped webhook → explicit first-variant/product mapping → POST /analyse-product → PASS/REVIEW/BLOCK switch → labelled Set/no-op terminal
```

n8n owns orchestration and mapping. The TypeScript API owns validation, analysis, and review state. The workflow uses the fixed local API URL `http://127.0.0.1:3000/analyse-product`; if the local network topology differs, align the workflow separately. The npm commands are:

```bash
npm run validate:n8n   # parse the export and verify nodes/branches
npm run demo           # send all 12 fixtures through the live webhook
```

`npm run demo` requires `N8N_WEBHOOK_URL`; without it the script fails early with instructions. Structural validation proves the JSON shape only; the demo must run with both n8n and the API live and asserts statuses, issue codes, terminal labels, and mapping-sensitive fields.

## Environment

See `.env.example` for safe, blank-by-default values.

| Variable | Owner | Required | Behavior |
|---|---|---:|---|
| `PORT` | API | No | Defaults to `3000`. |
| `CORS_ORIGIN` | API | No | Defaults to `http://localhost:5173`. |
| `VITE_API_URL` | Web | No | Defaults to `http://localhost:3000`; read by Vite at startup/build time. |
| `N8N_WEBHOOK_URL` | Demo script | For demo | Must be the imported workflow's test/production webhook URL; the demo fails clearly if absent. |
| `LLM_API_KEY` | API | No | Together with the other two LLM fields, selects the provider. |
| `LLM_BASE_URL` | API | No | OpenAI-compatible base URL; any blank LLM field makes the provider unavailable. |
| `LLM_MODEL` | API | No | Model name; any blank LLM field makes the provider unavailable. |
| `SHOPIFY_STORE_URL` | Stretch only | No | Unused by this MVP. |
| `SHOPIFY_ACCESS_TOKEN` | Stretch only | No | Unused by this MVP. |

All three LLM fields must be non-blank to configure the live provider. If any is missing or blank, startup still succeeds and selects an explicit unavailable provider: weak-category products become `REVIEW` with `llm.status = FAILED`, with no transport attempt and no mock substitution. Products that do not need classification do not call the provider and report `llm.status = NOT_USED`.

For a configured provider, the adapter uses JSON-object mode, explicitly parses and Zod-validates the response, checks the category against the allow-list, disables SDK retries, and permits at most one retry for retryable failures. Provider details are not exposed through the API.

## Evaluation and real-model demo

`npm run eval` injects deterministic and malformed test providers into the real analysis/store boundary. It never calls a live model. `npm run demo` is different: after n8n/API setup, configure all three LLM fields with a real endpoint and send the fixtures through the webhook. Record at least one real configured-LLM example separately; do not use or describe evaluation mocks as production behavior.

Verified evaluation output from the current checkout:

```text
> eval
> tsx scripts/eval.ts

LLM-assisted catalogue QA evaluation
Fixtures:                    12
Fixture expectations:        60/60
Actual outcomes:             PASS 2 / REVIEW 6 / BLOCK 4
LLM schema failure handling: PASS
Prompt injection isolation:  PASS
Unsafe state mutations:      0
Publication safety:          architecture property only (publication state is not represented in Product model)
Average fixture latency:      0.07 ms   # varies per run
Fixture provider calls:       4
All-scenario provider calls:  5
Provider errors:               2
Checks:                       65/65
```

The evaluation also verifies malformed-model-output handling and that hostile extra model fields do not mutate protected product state. Publication safety is an architecture property: publication state is not represented in the `Product` model.

## State and safety boundaries

State is process-local and in memory. The store retains the latest product, latest analysis, and review record per product ID. Restarting the API clears all of it. Re-analysis replaces the prior analysis and resets the review decision. `REVIEW` items, including deterministic-only warnings, enter the pending queue; deciding one removes it from pending but retains it in memory. Approval applies only the exact validated category suggestion; deterministic-only approval and rejection do not change product fields. Summary counts describe latest analysis outcomes, not decisions.

Shopify is simulated at the boundary with fictional Shopify-shaped fixtures. The expected mapping takes SKU, price, compare-at price, and inventory from the first variant, description from `body_html`, and image URLs from image `src` values. Approval updates category only in memory. Real Shopify webhooks, authentication/authorization, database persistence, write-back, notifications, and publication changes are non-goals for this MVP.

## Screenshots and video evidence

Do not add an artifact link until it has been captured from a running n8n/API/LLM environment. For operational evidence:

1. Run the pinned n8n version, API, and web UI; import and activate the workflow.
2. Set `N8N_WEBHOOK_URL` to the current webhook URL and configure a real LLM endpoint without exposing the API key.
3. Capture one PASS, one REVIEW, and one BLOCK execution, showing the mapped payload, API response, status switch, and labelled terminal branch.
4. For REVIEW, show the real model-backed suggestion and the human decision in the UI; include the before/after category only, never credentials or raw secret-bearing payloads.
5. Record a short video (target maximum: 90 seconds) covering the same three outcomes and one approve/reject action.

The structural n8n validator in current HEAD has been run successfully against the 1.107.4 export. This is artifact validation only: operational screenshots/video are not included because this checkout has not been run with n8n and a configured LLM endpoint. The real-model demo and n8n runtime evidence remain blocked until that environment is started and captured.

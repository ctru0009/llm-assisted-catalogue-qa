# LLM-assisted catalogue QA

An n8n-orchestrated catalogue QA workflow that separates deterministic product validation from bounded LLM classification and routes every model suggestion through human review. Synthetic, hiring-focused commerce workflow: rules protect consequential fields, the model only interprets ambiguous taxonomy, and a person approves what moves forward.

![Catalogue review dashboard](evidence/web-review-dashboard.png)

*Live local run: 12 synthetic Shopify-shaped products analysed — PASS 2, REVIEW 6, BLOCK 4 — with 6 decisions waiting in the human review queue.*

## Why this exists

Catalogue data fails in two different ways. Some defects are deterministic: a missing title, a negative price, a compare-at price below the sale price. Others are genuinely ambiguous: a supplier taxonomy value such as `Other` that needs interpretation. Sending deterministic defects to a language model wastes money, adds latency, and makes outcomes nondeterministic; asking rules to guess taxonomy produces false confidence. This project demonstrates one boundary between the two: deterministic validation runs first and decides what the model is even allowed to see, and model output stays advisory until a human approves it.

## Design principle

> **LLMs interpret. Deterministic software acts.**

- Rules run before the LLM and own every blocking decision.
- Any critical or high issue blocks: the LLM is skipped entirely, and all deterministic issues are still reported.
- The model answers exactly one narrow question: classify a missing or weak category.
- Every validated suggestion routes to REVIEW. Nothing is auto-applied.
- Provider failure degrades to REVIEW with `llm.status = FAILED`; it cannot corrupt product state.

## Architecture

```mermaid
flowchart TD
    A[Shopify-shaped fixture] --> B[n8n: map to internal Product]
    B --> C[Fastify API: POST /analyse-product]
    C --> D[Deterministic catalogue rules]
    D -->|critical or high issue| E[BLOCK - LLM skipped]
    D -->|medium warnings| F[REVIEW - human queue]
    D -->|clean, weak category| G[LLM category suggestion]
    D -->|clean, strong category| H[PASS - LLM not used]
    G --> I[JSON parse, allow-list, Zod]
    I -->|valid suggestion| F
    I -->|invalid or provider failed| F
```

![n8n workflow canvas](evidence/n8n-workflow-canvas.png)

*The imported workflow in n8n 1.107.4: webhook → payload mapping → API call → status switch → labelled no-op outcome branches.*

n8n owns orchestration and mapping; the TypeScript API owns analysis and review state:

- **Shopify Product Webhook** receives a Shopify-shaped POST body (synthetic fixtures in this MVP).
- **Map Shopify payload to internal product** converts it into the internal `Product` contract: first variant for SKU, price, compare-at price, and inventory; `body_html` → description; image `src` values → images.
- **POST local API /analyse-product** calls the Fastify API. In the Docker-based local run the node targets `http://host.docker.internal:3000` so the container can reach the host; the exported JSON uses `http://127.0.0.1:3000`.
- **Route by analysis status** switches on the returned `status` (PASS / REVIEW / BLOCK).
- **Outcome … (no-op)** Set nodes terminate each branch with a labelled outcome. The MVP deliberately sends no notifications and performs no external writes.

## What the three outcomes mean

### PASS — clean, and the model is never called

Rules found no issue, and the category is strong enough that classification is unnecessary.

![PASS execution](evidence/n8n-execution-pass.png)

*Fixture 01 (Northline Runner Pro): mapped input on the left, API output on the right — `status: PASS`, empty issue list, `llm.status: NOT_USED`.*

### REVIEW — a human decision is required

REVIEW is the destination for deterministic warnings (zero inventory, missing images, missing description), for provider failure, and for every validated model suggestion.

![REVIEW execution](evidence/n8n-execution-review.png)

*Fixture 12 (Runner Pro), whose description carries an intentional prompt-injection string. This local demo ran without LLM credentials, so the unavailable provider degraded safely: `status: REVIEW`, `llm.status: FAILED`, no state change. This demonstrates provider-unavailable fallback, not successful classification; with a configured provider the same weak-category path would attach a validated suggestion and still route to REVIEW.*

### BLOCK — deterministic stop, model skipped

Any critical or high issue blocks before the LLM is considered, and all deterministic issues are still reported.

![BLOCK execution](evidence/n8n-execution-block.png)

*Fixture 06, empty title: `status: BLOCK` with `MISSING_TITLE` (critical). Blocking happens before any model call.*

## Human review

![Pending review queue](evidence/web-review-queue.png)

- Every REVIEW product enters one queue; `GET /reviews` returns `{ summary, items }`, and the summary counts latest unique-product analysis outcomes.
- Deterministic-only approval is an acknowledgement: no product fields change.
- A category suggestion can only be approved exactly as suggested or rejected; rejection leaves the product unchanged.
- Deciding an item removes it from pending but retains the decision in memory; duplicate decisions are idempotent.
- Re-analysing a product replaces its previous state and resets the review: the latest analysis wins.

## LLM boundary

The only model call in the system is one category suggestion, behind an OpenAI-compatible adapter configured by `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL`:

- JSON-object response mode; the reply is `JSON.parse`d, checked against an 8-category allow-list, then Zod-validated.
- SDK retries are disabled; at most one explicit retry happens for retryable failures (timeout, rate limit, 5xx, connection). Authentication and client errors are not retried.
- Configuration is optional. If any of the three fields is blank, an explicit unavailable provider is selected — no transport attempt, no mock substitution — and weak-category products become REVIEW with `llm.status = FAILED`.
- The model has no mutation tools and cannot change price, inventory, SKU, images, or publication state. Product fields are passed as untrusted data, and non-schema output fields are discarded by validation.
- Provider errors are not exposed through the API.

The adapter targets the OpenAI-compatible chat-completions surface; "OpenAI-compatible" providers vary, so no provider behaviour beyond a configured endpoint is asserted here.

## Evaluation

`npm run eval` injects deterministic and malformed mocked providers into the real analysis and store boundary. It never calls a live model.

```text
LLM-assisted catalogue QA evaluation
Fixtures:                    12
Fixture expectations:        60/60
Actual outcomes:             PASS 2 / REVIEW 6 / BLOCK 4
LLM schema failure handling: PASS
Prompt injection isolation:  PASS
Unsafe state mutations:      0
Publication safety:          architecture property only (publication state is not represented in Product model)
Average fixture latency:      0.12 ms
Fixture provider calls:       4
All-scenario provider calls:  5
Provider errors:               2
Checks:                       65/65
```

- 65/65 checks: 60 fixture expectations plus summary and safety assertions.
- The 12 fixtures resolve to PASS 2 / REVIEW 6 / BLOCK 4.
- Unsafe state mutations: 0 — including malformed model output, prompt-injection isolation on approve and reject, and deterministic-only approval isolation.
- `Provider errors: 2` is expected: the malformed-response fixture exhausts its one retry.
- Mocked providers keep the evaluation deterministic and free; live provider behaviour is demonstrated separately when credentials are configured.

## End-to-end n8n proof

![n8n execution history](evidence/n8n-executions.png)

- All 12 fixtures were sent through the real local n8n webhook (`npm run demo`) against n8n 1.107.4 and the live API; every execution succeeded.
- Outcomes matched 2 PASS / 6 REVIEW / 4 BLOCK.
- `npm run demo` asserts statuses, issue codes, terminal outcome labels, and mapping-sensitive fields — not just an HTTP 200.
- `npm run validate:n8n` verifies the export structurally. This is a local MVP run, not a production deployment.

## Safety cases

- Malformed LLM output → REVIEW (after at most one retry).
- Category outside the allow-list → one retry, then REVIEW.
- Provider unavailable → REVIEW with `llm.status = FAILED`; no state change.
- Deterministic BLOCK skips the LLM entirely.
- The prompt-injection fixture cannot mutate protected fields: the model has no mutation tools, and non-schema output is discarded.

## Running locally

Requires Node `^20.19.0 || >=22.12.0` and npm with workspace support.

```bash
npm install
npm test          # 74 API + 9 web tests
npm run build     # API TypeScript build and web production build
npm run eval      # offline 12-fixture evaluation, mocked providers
```

Start the three services:

```bash
# 1. API → http://localhost:3000
cp .env.example .env          # optional; defaults are safe
set -a; source .env; set +a   # no dotenv: export values in the terminal
npm -w api exec -- tsx src/server.ts

# 2. Review UI → http://localhost:5173
npm -w web exec -- vite --host localhost

# 3. n8n 1.107.4 → http://localhost:5678
npx n8n@1.107.4 start
```

Import `n8n/catalogue-qa-workflow.json`, activate the workflow, then run the end-to-end demo. The webhook path is `catalogue-qa`, so the test URL is normally `http://127.0.0.1:5678/webhook-test/catalogue-qa` and the production URL `http://127.0.0.1:5678/webhook/catalogue-qa`.

```bash
N8N_WEBHOOK_URL=http://127.0.0.1:5678/webhook/catalogue-qa npm run demo
npm run validate:n8n
```

If n8n runs in Docker, point the HTTP node at `http://host.docker.internal:3000/analyse-product` so the container reaches the host API.

| Variable | Owner | Notes |
|---|---|---|
| `PORT` | API | Defaults to `3000`. |
| `CORS_ORIGIN` | API | Defaults to `http://localhost:5173`. |
| `VITE_API_URL` | Web | Defaults to `http://localhost:3000`; read at Vite startup/build. |
| `N8N_WEBHOOK_URL` | Demo | Required by `npm run demo`. |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | API | All three together; any blank field selects the unavailable provider. |

## Deliberately out of scope

No authentication, database, queues, real Shopify integration, RAG, autonomous agents, multi-provider routing, production monitoring, or hosting. State is process-local and in memory; restarting the API clears it, and the fixtures are synthetic. The scope is deliberate for an 8–12 hour hiring MVP: the point is the boundary and the engineering restraint, not platform breadth.

## Repository map

```text
api/        Fastify API — deterministic rules, LLM adapter, in-memory review store
web/        React review UI (Vite)
n8n/        Importable workflow export pinned to n8n 1.107.4
fixtures/   12 synthetic Shopify-shaped product payloads
scripts/    eval, demo, and n8n validation scripts
evidence/   Screenshots captured from a real local run (synthetic data only)
```

*Every screenshot, evaluation number, and execution in this README comes from a real local run against synthetic fixtures.*

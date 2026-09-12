import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../src/app";
import { ALLOWED_CATEGORIES } from "../src/llm/categories";
import type { LLMProvider } from "../src/llm/provider";
import { createReviewStore } from "../src/store/review-store";
import type { Product } from "../src/types/product";

const product: Product = {
  id: "prod_route",
  title: "Runner",
  sku: "RUN-1",
  price: 129,
  compareAtPrice: 169,
  inventory: 19,
  category: "Other",
  vendorCategory: "running footwear",
  description: "A road-running shoe.",
  images: ["https://example.test/runner.jpg"],
};

const provider: LLMProvider = {
  async suggestCategory() {
    return {
      suggestedCategory: ALLOWED_CATEGORIES[0],
      confidence: 0.91,
      reason: "The title describes a running shoe.",
    };
  },
};

test("createApp supports inject, CORS, analysis, review listing, and idempotent decisions", async () => {
  const logs: unknown[] = [];
  const app = await createApp({
    provider,
    store: createReviewStore(),
    logger: { info: (entry) => logs.push(entry), error: (entry) => logs.push(entry) },
  });

  const analysis = await app.inject({
    method: "POST",
    url: "/analyse-product",
    payload: { product },
  });
  assert.equal(analysis.statusCode, 200);
  assert.equal(analysis.json().status, "REVIEW");

  const reviews = await app.inject({ method: "GET", url: "/reviews" });
  assert.equal(reviews.statusCode, 200);
  assert.deepEqual(reviews.json().summary, { PASS: 0, REVIEW: 1, BLOCK: 0 });
  assert.equal(reviews.json().items[0].suggestedCategory, ALLOWED_CATEGORIES[0]);

  const approved = await app.inject({
    method: "POST",
    url: "/reviews/prod_route",
    payload: { decision: "approve" },
  });
  assert.equal(approved.statusCode, 200);
  assert.equal(approved.json().status, "APPROVED");
  assert.equal(approved.json().appliedCategory, ALLOWED_CATEGORIES[0]);

  const duplicate = await app.inject({
    method: "POST",
    url: "/reviews/prod_route",
    payload: { decision: "reject" },
  });
  assert.deepEqual(duplicate.json(), approved.json());
  assert.equal((await app.inject({ method: "GET", url: "/reviews" })).json().items.length, 0);

  const cors = await app.inject({ method: "GET", url: "/reviews" });
  assert.equal(cors.headers["access-control-allow-origin"], "http://localhost:5173");
  assert.deepEqual(
    logs.map((entry) => (entry as { event: string }).event),
    ["llm_category_request", "product_analysis_completed"],
  );
});

test("invalid analysis and decision requests return sanitized Zod details", async () => {
  const app = await createApp({ provider, store: createReviewStore() });

  const invalidAnalysis = await app.inject({
    method: "POST",
    url: "/analyse-product",
    payload: { product: { id: "x", price: "secret-payload" }, credentials: "do-not-return" },
  });
  assert.equal(invalidAnalysis.statusCode, 400);
  assert.equal(invalidAnalysis.json().error, "Invalid request");
  assert.ok(Array.isArray(invalidAnalysis.json().details));
  assert.doesNotMatch(invalidAnalysis.body, /secret-payload|do-not-return/);

  const invalidDecision = await app.inject({
    method: "POST",
    url: "/reviews/prod_route",
    payload: { decision: "publish", token: "secret" },
  });
  assert.equal(invalidDecision.statusCode, 400);
  assert.equal(invalidDecision.json().error, "Invalid request");
  assert.ok(invalidDecision.json().details.some((detail: { path: string[] }) => detail.path[0] === "decision"));
  assert.doesNotMatch(invalidDecision.body, /secret/);
});

test("unknown decision target is a deliberate domain error", async () => {
  const app = await createApp({ provider, store: createReviewStore() });

  const response = await app.inject({
    method: "POST",
    url: "/reviews/unknown",
    payload: { decision: "approve" },
  });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: "Review not found" });
});

test("provider failures log named safe events without provider details", async () => {
  const logs: unknown[] = [];
  const failingProvider: LLMProvider = {
    async suggestCategory() {
      throw Object.assign(new Error("api-key secret full response"), { status: 401 });
    },
  };
  const app = await createApp({
    provider: failingProvider,
    store: createReviewStore(),
    logger: { info: (entry) => logs.push(entry), error: (entry) => logs.push(entry) },
  });

  const response = await app.inject({
    method: "POST",
    url: "/analyse-product",
    payload: { product },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().llm.status, "FAILED");
  assert.deepEqual(
    logs.map((entry) => (entry as { event: string }).event),
    ["llm_category_request", "llm_category_failed", "product_analysis_completed"],
  );
  assert.doesNotMatch(JSON.stringify(logs), /api-key|authorization|full response|secret/i);
});

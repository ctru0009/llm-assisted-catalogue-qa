import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import type { FastifyInstance } from "fastify";

import { createApp } from "../src/app";
import { ALLOWED_CATEGORIES } from "../src/llm/categories";
import type { LLMProvider } from "../src/llm/provider";
import { UnavailableProvider } from "../src/llm/unavailable-provider";
import { createReviewStore, type ReviewStore } from "../src/store/review-store";
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

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

function trackedApp(options: Parameters<typeof createApp>[0]): FastifyInstance {
  const app = createApp(options);
  openApps.push(app);
  return app;
}

test("createApp supports inject, CORS, analysis, review listing, and idempotent decisions", async () => {
  const logs: unknown[] = [];
  const app = trackedApp({
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

test("analysis returns PASS and BLOCK responses and deterministic reviews omit suggestions", async () => {
  const app = trackedApp({ provider, store: createReviewStore() });
  const passProduct = { ...product, id: "prod_pass", category: "Vendor > Shoes" };
  const blockProduct = { ...product, id: "prod_block", sku: "" };
  const pass = await app.inject({
    method: "POST",
    url: "/analyse-product",
    payload: { product: passProduct },
  });
  const block = await app.inject({
    method: "POST",
    url: "/analyse-product",
    payload: { product: blockProduct },
  });
  assert.equal(pass.statusCode, 200);
  assert.equal(pass.json().status, "PASS");
  assert.equal(block.statusCode, 200);
  assert.equal(block.json().status, "BLOCK");

  const deterministic = await app.inject({
    method: "POST",
    url: "/analyse-product",
    payload: { product: { ...product, id: "prod_deterministic", category: "Vendor > Shoes", inventory: 0 } },
  });
  assert.equal(deterministic.json().status, "REVIEW");
  assert.equal("suggestion" in deterministic.json().llm, false);
  const reviews = await app.inject({ method: "GET", url: "/reviews" });
  const deterministicItem = reviews.json().items.find(
    (item: { productId: string }) => item.productId === "prod_deterministic",
  );
  assert.equal("suggestedCategory" in deterministicItem, false);
});

test("initial rejection removes pending review and preserves product through the route", async () => {
  const store = createReviewStore();
  const app = trackedApp({ provider, store });
  const before = { ...product };
  await app.inject({ method: "POST", url: "/analyse-product", payload: { product: before } });

  const rejected = await app.inject({
    method: "POST",
    url: "/reviews/prod_route",
    payload: { decision: "reject" },
  });
  assert.deepEqual(rejected.json(), {
    productId: "prod_route",
    decision: "reject",
    status: "REJECTED",
  });
  assert.deepEqual(store.getLatestProduct("prod_route"), before);
  assert.equal((await app.inject({ method: "GET", url: "/reviews" })).json().items.length, 0);
});

test("a product ID accepted during analysis remains accepted during decision, including dots", async () => {
  const app = trackedApp({ provider, store: createReviewStore() });
  const dottedProduct = { ...product, id: "prod.1" };

  const analysis = await app.inject({
    method: "POST",
    url: "/analyse-product",
    payload: { product: dottedProduct },
  });
  assert.equal(analysis.statusCode, 200);
  assert.equal(analysis.json().productId, "prod.1");

  const decision = await app.inject({
    method: "POST",
    url: "/reviews/prod.1",
    payload: { decision: "approve" },
  });
  assert.equal(decision.statusCode, 200);
  assert.equal(decision.json().productId, "prod.1");
  assert.equal(decision.json().status, "APPROVED");
});

test("invalid analysis and decision requests return sanitized Zod details", async () => {
  const app = trackedApp({ provider, store: createReviewStore() });

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
  const app = trackedApp({ provider, store: createReviewStore() });

  const response = await app.inject({
    method: "POST",
    url: "/reviews/unknown",
    payload: { decision: "approve" },
  });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: "Review not found" });
});

test("missing and invalid product IDs return sanitized field-level 400 errors", async () => {
  const app = trackedApp({ provider, store: createReviewStore() });
  for (const url of ["/reviews", "/reviews/", "/reviews/not%20valid", "/reviews/bad%2Fid"]) {
    const response = await app.inject({ method: "POST", url, payload: { decision: "approve" } });
    assert.equal(response.statusCode, 400, url);
    assert.equal(response.json().error, "Invalid request");
    assert.ok(response.json().details.some((detail: { path: string[] }) => detail.path[0] === "productId"));
    assert.doesNotMatch(response.body, /not valid|bad\/id/);
  }
});

test("a syntactically valid unknown product ID remains a deliberate 404", async () => {
  const app = trackedApp({ provider, store: createReviewStore() });
  const response = await app.inject({
    method: "POST",
    url: "/reviews/unknown_product-1",
    payload: { decision: "approve" },
  });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: "Review not found" });
});

test("missing decision is a field-level validation error", async () => {
  const app = trackedApp({ provider, store: createReviewStore() });
  const response = await app.inject({ method: "POST", url: "/reviews/prod_route", payload: {} });
  assert.equal(response.statusCode, 400);
  assert.ok(response.json().details.some((detail: { path: string[] }) => detail.path[0] === "decision"));
});

test("provider failures log named safe events without provider details", async () => {
  const logs: unknown[] = [];
  const failingProvider: LLMProvider = {
    async suggestCategory() {
      throw Object.assign(new Error("api-key secret full response"), { status: 401 });
    },
  };
  const app = trackedApp({
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

test("framework client errors preserve sanitized 4xx statuses", async () => {
  const app = trackedApp({ provider, store: createReviewStore() });
  const malformed = await app.inject({
    method: "POST",
    url: "/analyse-product",
    headers: { "content-type": "application/json" },
    payload: '{"product":',
  });
  assert.equal(malformed.statusCode, 400);
  assert.deepEqual(malformed.json(), { error: "Invalid request" });
  assert.doesNotMatch(malformed.body, /Unexpected|JSON|product/);

  const oversized = await app.inject({
    method: "POST",
    url: "/analyse-product",
    headers: { "content-type": "application/json" },
    payload: `{"credentials":"${"secret".repeat(200_000)}"}`,
  });
  assert.equal(oversized.statusCode, 413);
  assert.deepEqual(oversized.json(), { error: "Request too large" });
  assert.doesNotMatch(oversized.body, /secret|body|payload/i);
});

test("unexpected dependency errors return generic 500 and fixed redacted telemetry", async () => {
  const logs: unknown[] = [];
  const baseStore = createReviewStore();
  const store: ReviewStore = {
    ...baseStore,
    recordAnalysis() {
      throw new Error("provider credentials and full response secret");
    },
  };
  const app = trackedApp({
    provider,
    store,
    logger: { info: (entry) => logs.push(entry), error: (entry) => logs.push(entry) },
  });

  const response = await app.inject({
    method: "POST",
    url: "/analyse-product",
    payload: { product },
  });
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), { error: "Internal server error" });
  assert.doesNotMatch(response.body, /credentials|full response|secret|stack/i);
  assert.deepEqual(logs.map((entry) => (entry as { event: string }).event), [
    "llm_category_request",
    "unexpected_error",
  ]);
});

test("unavailable provider logs failure without a fabricated attempt", async () => {
  const logs: unknown[] = [];
  const app = trackedApp({
    provider: new UnavailableProvider(),
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
  assert.equal("attempt" in (logs[1] as object), false);
});

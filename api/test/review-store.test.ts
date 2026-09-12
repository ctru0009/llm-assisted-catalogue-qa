import assert from "node:assert/strict";
import test from "node:test";

import { ALLOWED_CATEGORIES } from "../src/llm/categories";
import { createReviewStore } from "../src/store/review-store";
import type { Product, ProductAnalysis } from "../src/types/product";

const product = (overrides: Partial<Product> = {}): Product => ({
  id: "prod_1",
  title: "Runner",
  sku: "RUN-1",
  price: 129,
  compareAtPrice: 159,
  inventory: 4,
  category: "Other",
  vendorCategory: "running footwear",
  description: "A road shoe.",
  images: ["https://example.test/runner.jpg"],
  ...overrides,
});

const reviewAnalysis = (productId = "prod_1"): ProductAnalysis => ({
  productId,
  status: "REVIEW",
  issues: [],
  llm: {
    status: "SUCCESS",
    suggestion: {
      suggestedCategory: ALLOWED_CATEGORIES[0],
      confidence: 0.9,
      reason: "The product is a running shoe.",
    },
  },
  metrics: { processingMs: 1, llmUsed: true },
});

test("review store tracks latest state, pending reviews, and summary independently", () => {
  const store = createReviewStore();
  store.recordAnalysis(product(), reviewAnalysis());

  assert.deepEqual(store.getLatestProduct("prod_1"), product());
  assert.deepEqual(store.getLatestAnalysis("prod_1"), reviewAnalysis());
  assert.equal(store.listPendingReviews().length, 1);
  assert.deepEqual(store.getSummary(), { PASS: 0, REVIEW: 1, BLOCK: 0 });
});

test("decisions apply only an exact category suggestion and are idempotent", () => {
  const store = createReviewStore();
  const original = product();
  store.recordAnalysis(original, reviewAnalysis());

  const approved = store.decide("prod_1", "approve");
  assert.deepEqual(approved, {
    productId: "prod_1",
    decision: "approve",
    status: "APPROVED",
    appliedCategory: ALLOWED_CATEGORIES[0],
  });
  assert.equal(store.listPendingReviews().length, 0);
  assert.equal(store.getLatestProduct("prod_1")?.category, ALLOWED_CATEGORIES[0]);
  assert.equal(store.getLatestProduct("prod_1")?.price, original.price);
  assert.equal(store.getLatestProduct("prod_1")?.compareAtPrice, original.compareAtPrice);
  assert.equal(store.getLatestProduct("prod_1")?.inventory, original.inventory);
  assert.equal(store.getLatestProduct("prod_1")?.sku, original.sku);
  assert.equal(store.getLatestProduct("prod_1")?.title, original.title);

  assert.deepEqual(store.decide("prod_1", "reject"), approved);
  assert.deepEqual(store.getReview("prod_1")?.status, "APPROVED");
  assert.deepEqual(store.getSummary(), { PASS: 0, REVIEW: 1, BLOCK: 0 });
});

test("re-analysis replaces the review and resets its decision", () => {
  const store = createReviewStore();
  store.recordAnalysis(product(), reviewAnalysis());
  store.decide("prod_1", "approve");

  const next = product({ title: "Updated Runner", category: "Other", price: 131 });
  const nextAnalysis = reviewAnalysis();
  store.recordAnalysis(next, nextAnalysis);

  assert.equal(store.getReview("prod_1")?.status, "PENDING");
  assert.equal(store.getReview("prod_1")?.title, "Updated Runner");
  assert.equal(store.listPendingReviews().length, 1);
  assert.equal(store.getLatestProduct("prod_1")?.category, "Other");
});

test("deterministic-only reviews are retained after acknowledgement without mutation", () => {
  const store = createReviewStore();
  const original = product({ category: "Apparel > Shoes", inventory: 0 });
  const analysis: ProductAnalysis = {
    productId: original.id,
    status: "REVIEW",
    issues: [{ code: "ZERO_INVENTORY", severity: "medium", message: "No stock." }],
    llm: { status: "NOT_USED" },
    metrics: { processingMs: 0, llmUsed: false },
  };
  store.recordAnalysis(original, analysis);

  assert.deepEqual(store.decide(original.id, "approve"), {
    productId: original.id,
    decision: "approve",
    status: "APPROVED",
  });
  assert.deepEqual(store.getLatestProduct(original.id), original);
});

test("unknown products return a deliberate domain result", () => {
  const store = createReviewStore();

  assert.deepEqual(store.decide("missing", "approve"), { kind: "NOT_FOUND" });
});

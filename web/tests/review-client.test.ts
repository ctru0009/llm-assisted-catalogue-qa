import assert from "node:assert/strict";
import test from "node:test";
import {
  DecisionGate,
  ReviewContractError,
  ReviewRequestError,
  fetchReviews,
  removeReviewItem,
  submitDecision,
} from "../src/review-client.ts";
import type { ReviewItem } from "../src/types.ts";

const reviewItem: ReviewItem = {
  productId: "prod_123",
  status: "REVIEW",
  title: "Velocity Runner X",
  issues: [],
  suggestedCategory: "Apparel & Accessories > Shoes > Athletic Shoes",
  confidence: 0.94,
  reason: "The title indicates an athletic shoe.",
};

const validReviews = {
  summary: { PASS: 2, REVIEW: 1, BLOCK: 0 },
  items: [reviewItem],
};

function response(payload: unknown, ok = true) {
  return {
    ok,
    json: async () => payload,
  };
}

test("malformed GET /reviews data is rejected before render", async () => {
  const malformedPayloads = [
    { summary: { PASS: "2", REVIEW: 1, BLOCK: 0 }, items: [reviewItem] },
    { summary: { PASS: 2, REVIEW: 1, BLOCK: 0 }, items: [{ ...reviewItem, status: "UNKNOWN" }] },
    { summary: { PASS: 2, REVIEW: 1, BLOCK: 0 }, items: [{ ...reviewItem, issues: [{ code: "BAD" }] }] },
    { summary: { PASS: 2, REVIEW: 1, BLOCK: 0 }, items: [{ ...reviewItem, confidence: 1.1 }] },
  ];

  for (const payload of malformedPayloads) {
    await assert.rejects(
      fetchReviews("http://api.test", async () => response(payload)),
      ReviewContractError,
    );
  }
});

test("malformed decision confirmation is rejected before removal", async () => {
  const malformedResponses = [
    { productId: "other", decision: "approve", status: "APPROVED" },
    { productId: reviewItem.productId, decision: "reject", status: "APPROVED" },
    { productId: reviewItem.productId, decision: "approve", status: "REJECTED" },
    { productId: reviewItem.productId, decision: "approve", status: "APPROVED" },
  ];

  for (const payload of malformedResponses) {
    await assert.rejects(
      submitDecision(
        "http://api.test",
        { productId: reviewItem.productId, decision: "approve", suggestedCategory: reviewItem.suggestedCategory },
        async () => response(payload),
      ),
      ReviewContractError,
    );
  }
});

test("request failures use a typed recoverable error", async () => {
  await assert.rejects(
    fetchReviews("http://api.test", async () => {
      throw new Error("private transport details");
    }),
    ReviewRequestError,
  );
});

test("valid decision confirmation allows successful removal", async () => {
  const result = await submitDecision(
    "http://api.test",
    { productId: reviewItem.productId, decision: "approve", suggestedCategory: reviewItem.suggestedCategory },
    async () => response({
      productId: reviewItem.productId,
      decision: "approve",
      status: "APPROVED",
      appliedCategory: reviewItem.suggestedCategory,
    }),
  );

  assert.equal(result.status, "APPROVED");
  assert.deepEqual(removeReviewItem([reviewItem], reviewItem.productId), []);
});

test("decision gate locks duplicate and cross-card requests in flight", () => {
  const gate = new DecisionGate();

  assert.equal(gate.tryAcquire(), true);
  assert.equal(gate.tryAcquire(), false);
  gate.release();
  assert.equal(gate.tryAcquire(), true);
});

test("valid GET /reviews data is accepted", async () => {
  const result = await fetchReviews("http://api.test", async () => response(validReviews));
  assert.equal(result.items[0]?.productId, reviewItem.productId);
});

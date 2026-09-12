import assert from "node:assert/strict";
import test from "node:test";

import {
  LLMProviderError,
  type CategorySuggestionInput,
  type CategorySuggestionResult,
  type LLMProvider,
} from "../src/llm/provider";
import { ALLOWED_CATEGORIES } from "../src/llm/categories";
import { analyseProduct } from "../src/services/analyse-product";
import type { Product } from "../src/types/product";

const validProduct = (overrides: Partial<Product> = {}): Product => ({
  id: "prod_123",
  title: "Velocity Runner X",
  sku: "VX-001",
  price: 129,
  compareAtPrice: 149,
  inventory: 5,
  category: "Apparel & Accessories > Shoes > Athletic Shoes",
  vendorCategory: "mens footwear / running",
  description: "Lightweight road running shoe.",
  images: ["https://example.com/image.jpg"],
  ...overrides,
});

class MockProvider implements LLMProvider {
  calls: CategorySuggestionInput[] = [];

  constructor(private readonly result: CategorySuggestionResult) {}

  async suggestCategory(input: CategorySuggestionInput): Promise<CategorySuggestionResult> {
    this.calls.push(input);
    return this.result;
  }
}

const failedProviderResult = (): CategorySuggestionResult => ({
  status: "FAILED",
  error: new LLMProviderError("UNAVAILABLE", "provider unavailable", true),
});

test("valid category avoids the provider and reports NOT_USED", async () => {
  const provider = new MockProvider({
    suggestedCategory: ALLOWED_CATEGORIES[0],
    confidence: 0.94,
    reason: "unused",
  });

  const result = await analyseProduct(validProduct(), provider);

  assert.equal(provider.calls.length, 0);
  assert.equal(result.status, "PASS");
  assert.deepEqual(result.llm, { status: "NOT_USED" });
  assert.equal(result.metrics.llmUsed, false);
  assert.ok(result.metrics.processingMs >= 0);
});

test("a valid non-weak category outside the suggestion allow-list still passes", async () => {
  const provider = new MockProvider({
    suggestedCategory: ALLOWED_CATEGORIES[0],
    confidence: 0.94,
    reason: "unused",
  });

  const result = await analyseProduct(
    validProduct({ category: "Vendor > Novelty" }),
    provider,
  );

  assert.equal(result.status, "PASS");
  assert.equal(provider.calls.length, 0);
  assert.equal(result.metrics.llmUsed, false);
});

test("a weak category invokes the provider once and successful output routes to REVIEW", async () => {
  const provider = new MockProvider({
    suggestedCategory: ALLOWED_CATEGORIES[0],
    confidence: 1,
    reason: "The title describes an athletic shoe.",
  });

  const result = await analyseProduct(validProduct({ category: "Other" }), provider);

  assert.equal(provider.calls.length, 1);
  assert.deepEqual(provider.calls[0], {
    title: "Velocity Runner X",
    description: "Lightweight road running shoe.",
    vendorCategory: "mens footwear / running",
    currentCategory: "Other",
  });
  assert.equal(result.status, "REVIEW");
  assert.deepEqual(result.llm, {
    status: "SUCCESS",
    suggestion: {
      suggestedCategory: ALLOWED_CATEGORIES[0],
      confidence: 1,
      reason: "The title describes an athletic shoe.",
    },
  });
  assert.equal(result.metrics.llmUsed, true);
});

test("successful provider output exposes only validated suggestion fields", async () => {
  const provider = new MockProvider({
    suggestedCategory: ALLOWED_CATEGORIES[1],
    confidence: 0.8,
    reason: "It is a sneaker.",
    price: 1,
    inventory: 0,
    publish: true,
  } as CategorySuggestionResult);

  const result = await analyseProduct(validProduct({ category: undefined }), provider);

  assert.deepEqual(result.llm, {
    status: "SUCCESS",
    suggestion: {
      suggestedCategory: ALLOWED_CATEGORIES[1],
      confidence: 0.8,
      reason: "It is a sneaker.",
    },
  });
});

test("blocking issues collect together, force BLOCK, and skip the provider", async () => {
  const provider = new MockProvider({
    suggestedCategory: ALLOWED_CATEGORIES[0],
    confidence: 0.9,
    reason: "unused",
  });

  const result = await analyseProduct(
    validProduct({
      sku: "",
      title: "",
      price: 0,
      compareAtPrice: 0,
      category: "Uncategorised",
    }),
    provider,
  );

  assert.equal(result.status, "BLOCK");
  assert.deepEqual(result.issues.map((issue) => issue.code), [
    "MISSING_SKU",
    "MISSING_TITLE",
    "INVALID_PRICE",
    "INVALID_DISCOUNT",
  ]);
  assert.deepEqual(result.llm, { status: "NOT_USED" });
  assert.equal(result.metrics.llmUsed, false);
});

test("provider failure produces REVIEW without exposing provider details", async () => {
  const provider = new MockProvider(failedProviderResult());

  const result = await analyseProduct(validProduct({ category: "Other" }), provider);

  assert.equal(provider.calls.length, 1);
  assert.equal(result.status, "REVIEW");
  assert.deepEqual(result.llm, { status: "FAILED" });
  assert.equal(result.metrics.llmUsed, true);
});

test("provider exceptions produce REVIEW and preserve deterministic review issues", async () => {
  const provider: LLMProvider = {
    async suggestCategory(): Promise<CategorySuggestionResult> {
      throw new Error("secret provider response");
    },
  };

  const result = await analyseProduct(
    validProduct({ category: "Other", inventory: 0 }),
    provider,
  );

  assert.equal(result.status, "REVIEW");
  assert.deepEqual(result.issues.map((issue) => issue.code), ["ZERO_INVENTORY"]);
  assert.deepEqual(result.llm, { status: "FAILED" });
  assert.equal(result.metrics.llmUsed, true);
});

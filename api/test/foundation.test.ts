import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config";
import { ALLOWED_CATEGORIES } from "../src/llm/categories";
import { CategorySuggestionSchema } from "../src/llm/schemas";
import type { CategorySuggestion } from "../src/llm/schemas";
import {
  ProductSchema,
} from "../src/types/product";
import type { ProductAnalysis, ReviewRecord } from "../src/types/product";

test("ProductSchema accepts the internal product envelope", () => {
  const product = ProductSchema.parse({
    id: "prod_123",
    title: "Velocity Runner X",
    sku: "VX-001",
    price: 129,
    compareAtPrice: 149,
    inventory: 5,
    category: "Other",
    vendorCategory: "mens footwear / running",
    description: "Lightweight road running shoe.",
    images: ["https://example.com/image.jpg"],
  });

  assert.equal(product.id, "prod_123");
  assert.deepEqual(product.images, ["https://example.com/image.jpg"]);
});

test("category suggestions use the bounded output shape", () => {
  const suggestion = CategorySuggestionSchema.parse({
    suggestedCategory: ALLOWED_CATEGORIES[0],
    confidence: 0.94,
    reason: "The product is an athletic shoe.",
  });

  assert.equal(suggestion.suggestedCategory, ALLOWED_CATEGORIES[0]);
  assert.throws(() =>
    CategorySuggestionSchema.parse({
      suggestedCategory: ALLOWED_CATEGORIES[0],
      confidence: 1.1,
      reason: "Invalid confidence",
    }),
  );
  assert.throws(() =>
    CategorySuggestionSchema.parse({
      suggestedCategory: "Untrusted > Category",
      confidence: 0.94,
      reason: "Not in the taxonomy",
    }),
  );
});

test("missing LLM fields select an unavailable configuration", () => {
  const config = loadConfig({ PORT: "3000" });

  assert.equal(config.port, 3000);
  assert.equal(config.llm.status, "unavailable");
  if (config.llm.status === "unavailable") {
    assert.deepEqual(config.llm.missing, [
      "LLM_API_KEY",
      "LLM_BASE_URL",
      "LLM_MODEL",
    ]);
  }
});

test("blank LLM fields remain unavailable rather than becoming a mock", () => {
  const config = loadConfig({
    LLM_API_KEY: " ",
    LLM_BASE_URL: "\t",
    LLM_MODEL: "",
  });

  assert.equal(config.llm.status, "unavailable");
});

test("each missing LLM field is reported explicitly", () => {
  for (const key of ["LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL"] as const) {
    const env = {
      LLM_API_KEY: "key",
      LLM_BASE_URL: "https://llm.example.test/v1",
      LLM_MODEL: "catalogue-model",
    };
    delete env[key];

    const config = loadConfig(env);

    assert.equal(config.llm.status, "unavailable");
    if (config.llm.status === "unavailable") {
      assert.ok(config.llm.missing.includes(key));
    }
  }
});

test("complete LLM configuration is selected without changing values", () => {
  const config = loadConfig({
    PORT: "3100",
    CORS_ORIGIN: " http://localhost:4173 ",
    LLM_API_KEY: " key ",
    LLM_BASE_URL: " https://llm.example.test/v1 ",
    LLM_MODEL: " catalogue-model ",
  });

  assert.deepEqual(config, {
    port: 3100,
    corsOrigin: "http://localhost:4173",
    llm: {
      status: "configured",
      apiKey: "key",
      baseUrl: "https://llm.example.test/v1",
      model: "catalogue-model",
    },
  });
});

test("analysis states keep suggestions and metrics consistent", () => {
  const suggestion: CategorySuggestion = {
    suggestedCategory: ALLOWED_CATEGORIES[0],
    confidence: 0.94,
    reason: "The product is an athletic shoe.",
  };

  const success: ProductAnalysis = {
    productId: "prod_success",
    status: "REVIEW",
    issues: [],
    llm: { status: "SUCCESS", suggestion },
    metrics: { processingMs: 1, llmUsed: true },
  };
  const failed: ProductAnalysis = {
    productId: "prod_failed",
    status: "REVIEW",
    issues: [],
    llm: { status: "FAILED" },
    metrics: { processingMs: 1, llmUsed: true },
  };
  const notUsed: ProductAnalysis = {
    productId: "prod_not_used",
    status: "PASS",
    issues: [],
    llm: { status: "NOT_USED" },
    metrics: { processingMs: 1, llmUsed: false },
  };

  assert.equal(success.llm.status, "SUCCESS");
  assert.equal(failed.metrics.llmUsed, true);
  assert.equal(notUsed.metrics.llmUsed, false);

  if (false) {
    const missingSuggestion: ProductAnalysis = {
      productId: "prod_invalid_success",
      status: "REVIEW",
      issues: [],
      // @ts-expect-error SUCCESS requires a suggestion.
      llm: {
        status: "SUCCESS",
      },
      metrics: { processingMs: 1, llmUsed: true },
    };
    const failedWithSuggestion: ProductAnalysis = {
      productId: "prod_invalid_failed",
      status: "REVIEW",
      issues: [],
      llm: {
        status: "FAILED",
        // @ts-expect-error FAILED cannot contain a suggestion.
        suggestion,
      },
      metrics: { processingMs: 1, llmUsed: true },
    };
    // @ts-expect-error NOT_USED must report that the LLM was not used.
    const notUsedWithCall: ProductAnalysis = {
      productId: "prod_invalid_not_used",
      status: "PASS",
      issues: [],
      llm: { status: "NOT_USED" },
      metrics: {
        processingMs: 1,
        llmUsed: true,
      },
    };

    void missingSuggestion;
    void failedWithSuggestion;
    void notUsedWithCall;
  }
});

test("review suggestions use the validated category type", () => {
  const review: ReviewRecord = {
    productId: "prod_review",
    title: "Velocity Runner X",
    issues: [],
    suggestedCategory: ALLOWED_CATEGORIES[0],
    confidence: 0.94,
    reason: "The product is an athletic shoe.",
    status: "PENDING",
    createdAt: new Date(0).toISOString(),
  };

  assert.equal(review.suggestedCategory, ALLOWED_CATEGORIES[0]);

  if (false) {
    const invalidReview: ReviewRecord = {
      ...review,
      // @ts-expect-error Review suggestions must use the allow-list.
      suggestedCategory: "Untrusted > Category",
    };

    void invalidReview;
  }
});

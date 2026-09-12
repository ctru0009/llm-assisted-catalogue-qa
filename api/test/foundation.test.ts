import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config";
import { ALLOWED_CATEGORIES } from "../src/llm/categories";
import { CategorySuggestionSchema } from "../src/llm/schemas";
import { ProductSchema } from "../src/types/product";

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

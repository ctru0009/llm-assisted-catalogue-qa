import assert from "node:assert/strict";
import test from "node:test";

import { composeProvider } from "../src/composition";
import { loadConfig } from "../src/config";
import { OpenAICompatibleProvider } from "../src/llm/openai-compatible";
import { UnavailableProvider } from "../src/llm/unavailable-provider";
import type { LLMProvider } from "../src/llm/provider";
import type { Product } from "../src/types/product";
import { analyseProduct } from "../src/services/analyse-product";

const weakProduct: Product = {
  id: "prod_weak",
  title: "Runner",
  sku: "RUN-1",
  price: 10,
  inventory: 1,
  category: "Other",
  description: "A shoe.",
  images: ["https://example.test/runner.jpg"],
};

const complete = {
  LLM_API_KEY: "key",
  LLM_BASE_URL: "https://llm.example.test/v1",
  LLM_MODEL: "model",
};

for (const key of Object.keys(complete) as Array<keyof typeof complete>) {
  test(`missing ${key} composes an unavailable provider without transport`, async () => {
    const env = { ...complete };
    delete env[key];
    const provider = composeProvider(loadConfig(env));
    let calls = 0;
    const instrumented: LLMProvider = {
      suggestCategory: async (input) => {
        calls += 1;
        return provider.suggestCategory(input);
      },
    };

    const result = await analyseProduct(weakProduct, instrumented);

    assert.ok(provider instanceof UnavailableProvider);
    assert.equal(result.status, "REVIEW");
    assert.deepEqual(result.llm, { status: "FAILED" });
    assert.equal(calls, 1);
  });
}

for (const key of Object.keys(complete) as Array<keyof typeof complete>) {
  test(`blank ${key} composes an unavailable provider`, () => {
    const provider = composeProvider(loadConfig({ ...complete, [key]: " \t" }));
    assert.ok(provider instanceof UnavailableProvider);
    assert.equal(provider instanceof OpenAICompatibleProvider, false);
  });
}

test("complete configuration composes the OpenAI-compatible provider", () => {
  assert.ok(composeProvider(loadConfig(complete)) instanceof OpenAICompatibleProvider);
});

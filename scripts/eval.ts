import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ALLOWED_CATEGORIES } from "../api/src/llm/categories";
import { OpenAICompatibleProvider } from "../api/src/llm/openai-compatible";
import type { LLMProvider } from "../api/src/llm/provider";
import { analyseProduct } from "../api/src/services/analyse-product";
import { createReviewStore } from "../api/src/store/review-store";
import type { Product } from "../api/src/types/product";

type ShopifyFixture = {
  id: number | string;
  title: string;
  body_html: string;
  vendor: string;
  product_type: string;
  variants: Array<{
    sku: string;
    price: string;
    compare_at_price?: string;
    inventory_quantity: number;
  }>;
  images: Array<{ src: string }>;
};

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const expectedStatuses: Record<string, Product["id"] extends string ? "PASS" | "REVIEW" | "BLOCK" : never> = {
  "01-valid-running-shoe.json": "PASS",
  "02-valid-shirt.json": "PASS",
  "03-missing-sku.json": "BLOCK",
  "04-negative-price.json": "BLOCK",
  "05-invalid-discount.json": "BLOCK",
  "06-missing-title.json": "BLOCK",
  "07-zero-inventory.json": "REVIEW",
  "08-no-images.json": "REVIEW",
  "09-missing-description.json": "REVIEW",
  "10-uncategorised-running-shoe.json": "REVIEW",
  "11-malformed-llm-response.json": "REVIEW",
  "12-prompt-injection.json": "REVIEW",
};

function mapShopifyProduct(payload: ShopifyFixture): Product {
  const variant = payload.variants[0];
  assert.ok(variant, "fixture must have a first variant");
  return {
    id: String(payload.id),
    title: payload.title,
    sku: variant.sku,
    price: Number(variant.price),
    ...(variant.compare_at_price === undefined || variant.compare_at_price === ""
      ? {}
      : { compareAtPrice: Number(variant.compare_at_price) }),
    inventory: variant.inventory_quantity,
    category: payload.product_type,
    vendorCategory: payload.vendor,
    description: payload.body_html,
    images: payload.images.map((image) => image.src),
  };
}

function deterministicSuggestionProvider(category: Product["category"]): {
  provider: LLMProvider;
  calls: () => number;
} {
  let calls = 0;
  return {
    provider: {
    async suggestCategory() {
      calls += 1;
      return {
        suggestedCategory: category === "Other"
          ? ALLOWED_CATEGORIES[0]
          : ALLOWED_CATEGORIES[1],
        confidence: 0.9,
        reason: "Deterministic evaluation suggestion.",
      };
    },
    },
    calls: () => calls,
  };
}

function malformedProvider(): { provider: LLMProvider; calls: () => number; errors: () => number } {
  let calls = 0;
  let errors = 0;
  const provider = new OpenAICompatibleProvider({
    apiKey: "eval-only",
    baseUrl: "https://eval.invalid/v1",
    model: "deterministic-eval-model",
    client: {
      chat: {
        completions: {
          async create() {
            calls += 1;
            errors += 1;
            return { choices: [{ message: { content: "not-json" } }] };
          },
        },
      },
    },
  });
  return { provider, calls: () => calls, errors: () => errors };
}

async function main(): Promise<void> {
  const failures: string[] = [];
  const check = (label: string, assertion: () => void) => {
    try {
      assertion();
    } catch (error) {
      failures.push(`${label}: ${error instanceof Error ? error.message : "check failed"}`);
    }
  };

const fixtureNames = readdirSync(fixtureDirectory)
  .filter((name) => name.endsWith(".json"))
  .sort();
const store = createReviewStore();
let totalLatency = 0;
let providerCalls = 0;
let providerErrors = 0;
let malformedHandlingPass = false;

for (const name of fixtureNames) {
  const payload = JSON.parse(readFileSync(join(fixtureDirectory, name), "utf8")) as ShopifyFixture;
  const product = mapShopifyProduct(payload);
  const mappedVariant = payload.variants[0];
  check(`${name} Shopify mapping`, () => {
    assert.equal(product.id, String(payload.id));
    assert.equal(product.title, payload.title);
    assert.equal(product.sku, mappedVariant.sku);
    assert.equal(product.price, Number(mappedVariant.price));
    assert.equal(product.inventory, mappedVariant.inventory_quantity);
    assert.equal(product.vendorCategory, payload.vendor);
    assert.equal(product.description, payload.body_html);
    assert.deepEqual(product.images, payload.images.map((image) => image.src));
    assert.equal(product.category, payload.product_type);
  });

  const malformed = name === "11-malformed-llm-response.json" ? malformedProvider() : undefined;
  const deterministic = malformed === undefined
    ? deterministicSuggestionProvider(product.category)
    : undefined;
  const provider = malformed?.provider ?? deterministic?.provider;
  assert.ok(provider);
  const started = performance.now();
  const analysis = await analyseProduct(product, provider);
  totalLatency += performance.now() - started;
  providerCalls += malformed?.calls() ?? deterministic?.calls() ?? 0;
  providerErrors += malformed?.errors() ?? 0;
  store.recordAnalysis(product, analysis);

  check(`${name} status`, () => assert.equal(analysis.status, expectedStatuses[name]));
  if (name === "11-malformed-llm-response.json") {
    malformedHandlingPass = analysis.llm.status === "FAILED" && (malformed?.calls() ?? 0) === 2;
  }
}

check("fixture count", () => assert.equal(fixtureNames.length, 12));
check("summary", () => assert.deepEqual(store.getSummary(), { PASS: 2, REVIEW: 6, BLOCK: 4 }));
check("malformed-output handling", () => assert.equal(malformedHandlingPass, true));

const injectionPayload = JSON.parse(
  readFileSync(join(fixtureDirectory, "12-prompt-injection.json"), "utf8"),
) as ShopifyFixture;
const injectionProduct = mapShopifyProduct(injectionPayload);
const protectedSnapshot = {
  price: injectionProduct.price,
  compareAtPrice: injectionProduct.compareAtPrice,
  inventory: injectionProduct.inventory,
  sku: injectionProduct.sku,
  title: injectionProduct.title,
  publication: undefined,
};

const approveStore = createReviewStore();
const injectionProvider = deterministicSuggestionProvider(injectionProduct.category);
const injectionAnalysis = await analyseProduct(
  injectionProduct,
  injectionProvider.provider,
);
approveStore.recordAnalysis(injectionProduct, injectionAnalysis);
approveStore.decide(injectionProduct.id, "approve");
check("prompt injection approve isolation", () => {
  const after = approveStore.getLatestProduct(injectionProduct.id);
  assert.equal(after?.category, ALLOWED_CATEGORIES[0]);
  assert.equal(after?.price, protectedSnapshot.price);
  assert.equal(after?.compareAtPrice, protectedSnapshot.compareAtPrice);
  assert.equal(after?.inventory, protectedSnapshot.inventory);
  assert.equal(after?.sku, protectedSnapshot.sku);
  assert.equal(after?.title, protectedSnapshot.title);
  assert.equal("publication" in (after ?? {}), false);
});

const rejectStore = createReviewStore();
rejectStore.recordAnalysis(injectionProduct, injectionAnalysis);
rejectStore.decide(injectionProduct.id, "reject");
check("prompt injection reject isolation", () => {
  assert.deepEqual(rejectStore.getLatestProduct(injectionProduct.id), injectionProduct);
});

const deterministicStore = createReviewStore();
const deterministicProduct = mapShopifyProduct(
  JSON.parse(readFileSync(join(fixtureDirectory, "07-zero-inventory.json"), "utf8")) as ShopifyFixture,
);
const deterministicAnalysis = await analyseProduct(
  deterministicProduct,
  deterministicSuggestionProvider(deterministicProduct.category).provider,
);
deterministicStore.recordAnalysis(deterministicProduct, deterministicAnalysis);
deterministicStore.decide(deterministicProduct.id, "approve");
check("deterministic-only approval isolation", () => {
  assert.deepEqual(deterministicStore.getLatestProduct(deterministicProduct.id), deterministicProduct);
});

const unsafeStateMutations = failures.filter((failure) => failure.includes("isolation")).length;
console.log("LLM-assisted catalogue QA evaluation");
console.log(`Fixtures:                    ${fixtureNames.length}`);
console.log(`Deterministic expectations:  ${fixtureNames.length - failures.filter((failure) => /status$/.test(failure)).length}/${fixtureNames.length}`);
console.log(`LLM schema failure handling: ${malformedHandlingPass ? "PASS" : "FAIL"}`);
console.log(`Prompt injection isolation:  ${unsafeStateMutations === 0 ? "PASS" : "FAIL"}`);
console.log(`Unsafe state mutations:      ${unsafeStateMutations}`);
console.log(`Average processing latency:  ${(totalLatency / Math.max(fixtureNames.length, 1)).toFixed(2)} ms`);
console.log(`LLM calls:                   ${providerCalls}`);
console.log(`Errors:                      ${providerErrors}`);

  if (failures.length > 0) {
    console.error("Evaluation failures:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  }
}

void main();

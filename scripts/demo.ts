import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

type Status = "PASS" | "REVIEW" | "BLOCK";
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
type ExpectedFixture = { status: Status; issueCodes: string[] };

const fixtureDirectory = join(dirname(__filename), "..", "fixtures");
const expectedFixtures: Record<string, ExpectedFixture> = {
  "01-valid-running-shoe.json": { status: "PASS", issueCodes: [] },
  "02-valid-shirt.json": { status: "PASS", issueCodes: [] },
  "03-missing-sku.json": { status: "BLOCK", issueCodes: ["MISSING_SKU"] },
  "04-negative-price.json": { status: "BLOCK", issueCodes: ["INVALID_PRICE"] },
  "05-invalid-discount.json": { status: "BLOCK", issueCodes: ["INVALID_DISCOUNT"] },
  "06-missing-title.json": { status: "BLOCK", issueCodes: ["MISSING_TITLE"] },
  "07-zero-inventory.json": { status: "REVIEW", issueCodes: ["ZERO_INVENTORY"] },
  "08-no-images.json": { status: "REVIEW", issueCodes: ["MISSING_IMAGES"] },
  "09-missing-description.json": { status: "REVIEW", issueCodes: ["MISSING_DESCRIPTION"] },
  "10-uncategorised-running-shoe.json": { status: "REVIEW", issueCodes: [] },
  "11-malformed-llm-response.json": { status: "REVIEW", issueCodes: [] },
  "12-prompt-injection.json": { status: "REVIEW", issueCodes: [] },
};

function readFixture(name: string): ShopifyFixture {
  return JSON.parse(readFileSync(join(fixtureDirectory, name), "utf8")) as ShopifyFixture;
}

function expectedMappedProduct(payload: ShopifyFixture): Record<string, unknown> {
  const variant = payload.variants[0];
  assert.ok(variant, "fixture must contain a first variant");
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

function parseResponse(body: string, fixtureName: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`${fixtureName}: webhook did not return JSON: ${body.slice(0, 300)}`);
  }
  const response = Array.isArray(parsed) ? parsed[0] : parsed;
  assert.ok(response && typeof response === "object" && !Array.isArray(response), `${fixtureName}: webhook response must be an object`);
  return response as Record<string, unknown>;
}

async function main(): Promise<void> {
  const webhookUrl = process.env.N8N_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    throw new Error(
      "N8N_WEBHOOK_URL is required. Import and activate n8n/catalogue-qa-workflow.json, start the local API and n8n, then run: N8N_WEBHOOK_URL=http://127.0.0.1:5678/webhook/catalogue-qa npx tsx scripts/demo.ts",
    );
  }

  const fixtureNames = readdirSync(fixtureDirectory).filter((name) => name.endsWith(".json")).sort();
  assert.equal(fixtureNames.length, 12, "demo requires exactly 12 fixture payloads");
  const counts: Record<Status, number> = { PASS: 0, REVIEW: 0, BLOCK: 0 };
  const failures: string[] = [];

  for (const fixtureName of fixtureNames) {
    const payload = readFixture(fixtureName);
    const expected = expectedFixtures[fixtureName];
    assert.ok(expected, `${fixtureName}: missing expected result`);
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const responseBody = await response.text();
    if (!response.ok) {
      throw new Error(`${fixtureName}: webhook returned HTTP ${response.status}: ${responseBody.slice(0, 300)}`);
    }

    try {
      const result = parseResponse(responseBody, fixtureName);
      const issueCodes = Array.isArray(result.issueCodes) ? result.issueCodes : [];
      const expectedLabel = `${expected.status} (no-op)`;
      assert.equal(result.status, expected.status, `${fixtureName}: unexpected analysis status`);
      assert.deepEqual(issueCodes, expected.issueCodes, `${fixtureName}: unexpected issue codes`);
      assert.equal(result.outcome, expected.status, `${fixtureName}: unexpected terminal outcome`);
      assert.equal(result.outcomeLabel, expectedLabel, `${fixtureName}: unexpected terminal outcome label`);
      assert.deepEqual(result.mappedProduct, expectedMappedProduct(payload), `${fixtureName}: Shopify-to-internal mapping changed`);
      counts[expected.status] += 1;
      console.log(`${fixtureName}: ${expected.status} — ${expectedLabel}`);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : `${fixtureName}: assertion failed`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Demo assertions failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }
  assert.deepEqual(counts, { PASS: 2, REVIEW: 6, BLOCK: 4 });
  console.log(`Demo complete: PASS ${counts.PASS} / REVIEW ${counts.REVIEW} / BLOCK ${counts.BLOCK}`);
}

void main().catch((error: unknown) => {
  console.error(`Demo failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

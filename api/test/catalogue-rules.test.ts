import assert from "node:assert/strict";
import test from "node:test";

import type { Product } from "../src/types/product";
import { evaluateRules } from "../src/rules/evaluate-rules";

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

test("blank SKU blocks", () => {
  const result = evaluateRules(validProduct({ sku: " \t" }));

  assert.deepEqual(result.issues.map((issue) => issue.code), ["MISSING_SKU"]);
  assert.equal(result.issues[0]?.severity, "critical");
});

test("blank title blocks", () => {
  const result = evaluateRules(validProduct({ title: "\n" }));

  assert.deepEqual(result.issues.map((issue) => issue.code), ["MISSING_TITLE"]);
  assert.equal(result.issues[0]?.severity, "critical");
});

test("non-positive price blocks", () => {
  const result = evaluateRules(validProduct({ price: 0 }));

  assert.deepEqual(result.issues.map((issue) => issue.code), ["INVALID_PRICE"]);
  assert.equal(result.issues[0]?.severity, "critical");
});

test("compare-at price at or below price blocks", () => {
  const result = evaluateRules(validProduct({ compareAtPrice: 129 }));

  assert.deepEqual(result.issues.map((issue) => issue.code), ["INVALID_DISCOUNT"]);
  assert.equal(result.issues[0]?.severity, "critical");
});

test("non-positive inventory, blank description, and missing images are review issues", () => {
  const result = evaluateRules(
    validProduct({ inventory: -1, description: "  ", images: [] }),
  );

  assert.deepEqual(result.issues.map((issue) => issue.code), [
    "ZERO_INVENTORY",
    "MISSING_DESCRIPTION",
    "MISSING_IMAGES",
  ]);
  assert.deepEqual(result.issues.map((issue) => issue.severity), [
    "medium",
    "medium",
    "medium",
  ]);
});

test("all deterministic issues are collected and weak category is not an issue", () => {
  const result = evaluateRules(
    validProduct({
      sku: "",
      title: "",
      price: -1,
      compareAtPrice: -2,
      inventory: 0,
      description: "",
      images: [],
      category: "Other",
    }),
  );

  assert.deepEqual(result.issues.map((issue) => issue.code), [
    "MISSING_SKU",
    "MISSING_TITLE",
    "INVALID_PRICE",
    "INVALID_DISCOUNT",
    "ZERO_INVENTORY",
    "MISSING_DESCRIPTION",
    "MISSING_IMAGES",
  ]);
  assert.equal(result.needsClassification, true);
});

test("missing, Other, and Uncategorised categories trigger classification", () => {
  for (const category of [undefined, "Other", "Uncategorised"]) {
    const result = evaluateRules(validProduct({ category }));

    assert.equal(result.needsClassification, true, String(category));
    assert.deepEqual(result.issues, []);
  }
});

test("a non-weak category does not trigger classification", () => {
  const result = evaluateRules(validProduct({ category: "Vendor > Novelty" }));

  assert.equal(result.needsClassification, false);
  assert.deepEqual(result.issues, []);
});

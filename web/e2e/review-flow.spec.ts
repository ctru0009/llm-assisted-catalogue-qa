import { expect, test, type APIRequestContext } from "@playwright/test";
import type { FastifyInstance } from "fastify";

import { API_BASE_URL, startTestApi } from "./harness";

type TestProduct = {
  id: string;
  title: string;
  sku: string;
  price: number;
  inventory: number;
  category?: string;
  vendorCategory?: string;
  description?: string;
  images: string[];
};

const validCategory = "Apparel & Accessories > Shoes > Sneakers";
const suggestedCategory = "Apparel & Accessories > Shoes > Athletic Shoes";
const suggestionReason =
  "The title and supplier category indicate the most appropriate catalogue category.";

let api: FastifyInstance;
let apiRequest: APIRequestContext;

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ playwright }) => {
  api = await startTestApi();
  apiRequest = await playwright.request.newContext({ baseURL: API_BASE_URL });
});

test.afterEach(async () => {
  await apiRequest.dispose();
  await api.close();
});

function product(overrides: Partial<TestProduct>): TestProduct {
  return {
    id: "product-default",
    title: "Northline Runner",
    sku: "NL-001",
    price: 129,
    inventory: 8,
    category: validCategory,
    vendorCategory: "mens footwear / running",
    description: "A lightweight road running shoe.",
    images: ["https://example.test/northline-runner.jpg"],
    ...overrides,
  };
}

async function seed(productToAnalyse: TestProduct) {
  const response = await apiRequest.post("/analyse-product", {
    data: { product: productToAnalyse },
  });

  expect(response.ok()).toBeTruthy();
  return response.json();
}

test("renders real summary, pending count, and deterministic issues", async ({ page }) => {
  await seed(product({ id: "product-pass", title: "Atlas Sneaker" }));
  await seed(product({
    id: "product-inventory",
    title: "Field Training Shoe",
    inventory: 0,
  }));
  await seed(product({
    id: "product-blocked",
    title: "Harbour Shirt",
    price: 0,
    category: "Apparel & Accessories > Clothing > Clothing Tops > T-Shirts",
  }));

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Analysis outcomes" })).toBeVisible();
  await expect(page.locator(".metric-pass .metric-value")).toHaveText("1");
  await expect(page.locator(".metric-review .metric-value")).toHaveText("1");
  await expect(page.locator(".metric-block .metric-value")).toHaveText("1");
  await expect(page.getByRole("heading", { name: "Pending reviews 1" })).toBeVisible();
  await expect(page.getByText("ZERO_INVENTORY", { exact: true })).toBeVisible();
  await expect(page.getByText("Product has no available inventory.", { exact: true })).toBeVisible();
});

test("approving a real category suggestion removes it but keeps summary counts", async ({ page }) => {
  await seed(product({
    id: "product-category",
    title: "Northline Runner Pro",
    category: "Other",
  }));

  await page.goto("/");

  await expect(page.getByText(suggestedCategory, { exact: true })).toBeVisible();
  await expect(page.getByText("94%", { exact: true })).toBeVisible();
  await expect(page.getByText(suggestionReason, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Approve suggestion" }).click();

  await expect(page.getByText(
    `Northline Runner Pro approved. Category applied: ${suggestedCategory}.`,
    { exact: true },
  )).toBeVisible();
  await expect(page.locator(".metric-review .metric-value")).toHaveText("1");
  await expect(page.getByRole("heading", { name: "Pending reviews 0" })).toBeVisible();
  await expect(page.locator(".action-notice")).toBeFocused();
});

test("rejects a real review and shows a recoverable API failure", async ({ page }) => {
  await seed(product({
    id: "product-reject",
    title: "Coastal Training Shoe",
    category: "Other",
  }));

  await page.goto("/");
  await page.getByRole("button", { name: "Reject" }).click();

  await expect(page.getByText(
    "Coastal Training Shoe rejected and removed from the pending queue.",
    { exact: true },
  )).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pending reviews 0" })).toBeVisible();

  await api.close();
  await page.reload();

  await expect(page.getByRole("heading", { name: "Review queue unavailable" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

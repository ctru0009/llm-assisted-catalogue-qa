import type { CatalogueIssue, Product } from "../types/product";

export type CatalogueRule = (product: Product) => CatalogueIssue | null;

const issue = (
  code: string,
  severity: CatalogueIssue["severity"],
  message: string,
): CatalogueIssue => ({ code, severity, message });

export const missingSkuRule: CatalogueRule = (product) =>
  product.sku.trim().length === 0
    ? issue("MISSING_SKU", "critical", "Product SKU is missing.")
    : null;

export const missingTitleRule: CatalogueRule = (product) =>
  product.title.trim().length === 0
    ? issue("MISSING_TITLE", "critical", "Product title is missing.")
    : null;

export const invalidPriceRule: CatalogueRule = (product) =>
  product.price <= 0
    ? issue("INVALID_PRICE", "critical", "Product price must be greater than zero.")
    : null;

export const invalidDiscountRule: CatalogueRule = (product) =>
  product.compareAtPrice !== undefined && product.compareAtPrice <= product.price
    ? issue(
        "INVALID_DISCOUNT",
        "critical",
        "Compare-at price must be greater than sale price.",
      )
    : null;

export const zeroInventoryRule: CatalogueRule = (product) =>
  product.inventory <= 0
    ? issue("ZERO_INVENTORY", "medium", "Product has no available inventory.")
    : null;

export const missingDescriptionRule: CatalogueRule = (product) =>
  product.description?.trim().length
    ? null
    : issue("MISSING_DESCRIPTION", "medium", "Product description is missing.");

export const missingImagesRule: CatalogueRule = (product) =>
  product.images.length === 0
    ? issue("MISSING_IMAGES", "medium", "Product images are missing.")
    : null;

export const catalogueRules: readonly CatalogueRule[] = [
  missingSkuRule,
  missingTitleRule,
  invalidPriceRule,
  invalidDiscountRule,
  zeroInventoryRule,
  missingDescriptionRule,
  missingImagesRule,
];

export const isWeakCategory = (category?: string): boolean => {
  const normalizedCategory = category?.trim();

  return (
    normalizedCategory === undefined ||
    normalizedCategory.length === 0 ||
    normalizedCategory === "Other" ||
    normalizedCategory === "Uncategorised"
  );
};

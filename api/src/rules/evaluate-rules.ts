import type { CatalogueIssue, Product } from "../types/product";
import { catalogueRules, isWeakCategory } from "./catalogue-rules";

export type RuleEvaluation = {
  issues: CatalogueIssue[];
  needsClassification: boolean;
};

export const evaluateRules = (product: Product): RuleEvaluation => ({
  issues: catalogueRules.flatMap((rule) => {
    const result = rule(product);
    return result === null ? [] : [result];
  }),
  needsClassification: isWeakCategory(product.category),
});

export { catalogueRules, isWeakCategory };

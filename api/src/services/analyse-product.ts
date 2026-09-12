import { CategorySuggestionSchema } from "../llm/schemas";
import type { LLMProvider } from "../llm/provider";
import { evaluateRules } from "../rules/evaluate-rules";
import type { CatalogueIssue, Product, ProductAnalysis } from "../types/product";

const isBlockingIssue = (issue: CatalogueIssue): boolean =>
  issue.severity === "critical" || issue.severity === "high";

const hasReviewIssue = (issues: CatalogueIssue[]): boolean =>
  issues.some((issue) => !isBlockingIssue(issue));

const metrics = <Used extends boolean>(startedAt: number, llmUsed: Used) => ({
  processingMs: Math.max(0, Date.now() - startedAt),
  llmUsed,
});

export const analyseProduct = async (
  product: Product,
  provider: LLMProvider,
): Promise<ProductAnalysis> => {
  const startedAt = Date.now();
  const { issues, needsClassification } = evaluateRules(product);
  const blocking = issues.some(isBlockingIssue);

  if (blocking) {
    return {
      productId: product.id,
      status: "BLOCK",
      issues,
      llm: { status: "NOT_USED" },
      metrics: metrics(startedAt, false),
    };
  }

  if (!needsClassification) {
    return {
      productId: product.id,
      status: hasReviewIssue(issues) ? "REVIEW" : "PASS",
      issues,
      llm: { status: "NOT_USED" },
      metrics: metrics(startedAt, false),
    };
  }

  try {
    const providerResult = await provider.suggestCategory({
      title: product.title,
      description: product.description,
      vendorCategory: product.vendorCategory,
      currentCategory: product.category,
    });

    if (
      typeof providerResult === "object" &&
      providerResult !== null &&
      "status" in providerResult &&
      providerResult.status === "FAILED"
    ) {
      if (providerResult.transportAttempted) {
        return {
          productId: product.id,
          status: "REVIEW",
          issues,
          llm: { status: "FAILED" },
          metrics: metrics(startedAt, true),
        };
      }

      return {
        productId: product.id,
        status: "REVIEW",
        issues,
        llm: { status: "FAILED" },
        metrics: metrics(startedAt, false),
      } as unknown as ProductAnalysis;
    }

    const suggestion = CategorySuggestionSchema.safeParse(providerResult);
    if (!suggestion.success) {
      return {
        productId: product.id,
        status: "REVIEW",
        issues,
        llm: { status: "FAILED" },
        metrics: metrics(startedAt, true),
      };
    }

    return {
      productId: product.id,
      status: "REVIEW",
      issues,
      llm: { status: "SUCCESS", suggestion: suggestion.data },
      metrics: metrics(startedAt, true),
    };
  } catch {
    return {
      productId: product.id,
      status: "REVIEW",
      issues,
      llm: { status: "FAILED" },
      metrics: metrics(startedAt, true),
    };
  }
};

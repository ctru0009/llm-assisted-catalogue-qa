import type { AllowedCategory } from "../llm/categories";
import type { Product, ProductAnalysis, ReviewRecord } from "../types/product";

export type ReviewSummary = {
  PASS: number;
  REVIEW: number;
  BLOCK: number;
};

export type DecisionResult =
  | {
      productId: string;
      decision: "approve" | "reject";
      status: "APPROVED" | "REJECTED";
      appliedCategory?: AllowedCategory;
    }
  | { kind: "NOT_FOUND" };

export type ReviewStore = {
  recordAnalysis(product: Product, analysis: ProductAnalysis): void;
  getLatestProduct(productId: string): Product | undefined;
  getLatestAnalysis(productId: string): ProductAnalysis | undefined;
  getReview(productId: string): ReviewRecord | undefined;
  listPendingReviews(): ReviewRecord[];
  getSummary(): ReviewSummary;
  decide(productId: string, decision: "approve" | "reject"): DecisionResult;
};

const clone = <T>(value: T): T => structuredClone(value);

export function createReviewStore(): ReviewStore {
  const latestProducts = new Map<string, Product>();
  const latestAnalyses = new Map<string, ProductAnalysis>();
  const reviews = new Map<string, ReviewRecord>();

  return {
    recordAnalysis(product, analysis) {
      latestProducts.set(product.id, clone(product));
      latestAnalyses.set(product.id, clone(analysis));

      if (analysis.status === "REVIEW") {
        const suggestion = analysis.llm.status === "SUCCESS" ? analysis.llm.suggestion : undefined;
        reviews.set(product.id, {
          productId: product.id,
          title: product.title,
          issues: clone(analysis.issues),
          ...(product.category === undefined ? {} : { originalCategory: product.category }),
          ...(suggestion === undefined
            ? {}
            : {
                suggestedCategory: suggestion.suggestedCategory,
                confidence: suggestion.confidence,
                reason: suggestion.reason,
              }),
          status: "PENDING",
          createdAt: new Date().toISOString(),
        });
      } else {
        reviews.delete(product.id);
      }
    },

    getLatestProduct(productId) {
      const product = latestProducts.get(productId);
      return product === undefined ? undefined : clone(product);
    },

    getLatestAnalysis(productId) {
      const analysis = latestAnalyses.get(productId);
      return analysis === undefined ? undefined : clone(analysis);
    },

    getReview(productId) {
      const review = reviews.get(productId);
      return review === undefined ? undefined : clone(review);
    },

    listPendingReviews() {
      return [...reviews.values()]
        .filter((review) => review.status === "PENDING")
        .map((review) => clone(review));
    },

    getSummary() {
      const summary: ReviewSummary = { PASS: 0, REVIEW: 0, BLOCK: 0 };
      for (const analysis of latestAnalyses.values()) summary[analysis.status] += 1;
      return summary;
    },

    decide(productId, decision) {
      const review = reviews.get(productId);
      const product = latestProducts.get(productId);
      if (review === undefined || product === undefined) return { kind: "NOT_FOUND" };

      if (review.status !== "PENDING") {
        return decisionResult(review);
      }

      const now = new Date().toISOString();
      const status = decision === "approve" ? "APPROVED" : "REJECTED";
      review.status = status;
      review.decidedAt = now;

      if (decision === "approve" && review.suggestedCategory !== undefined) {
        product.category = review.suggestedCategory;
      }

      return decisionResult(review);
    },
  };
}

function decisionResult(review: ReviewRecord): Exclude<DecisionResult, { kind: "NOT_FOUND" }> {
  const decision = review.status === "APPROVED" ? "approve" : "reject";
  const status = review.status === "APPROVED" ? "APPROVED" : "REJECTED";
  return {
    productId: review.productId,
    decision,
    status,
    ...(status === "APPROVED" && review.suggestedCategory !== undefined
      ? { appliedCategory: review.suggestedCategory }
      : {}),
  };
}

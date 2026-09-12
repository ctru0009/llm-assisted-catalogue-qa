export type ReviewStatus = "PASS" | "REVIEW" | "BLOCK" | "PENDING";

export type IssueSeverity = "critical" | "high" | "medium" | "low";

export type CatalogueIssue = {
  code: string;
  severity: IssueSeverity;
  message: string;
};

export type ReviewItem = {
  productId: string;
  status: ReviewStatus;
  title: string;
  issues: CatalogueIssue[];
  suggestedCategory?: string;
  confidence?: number;
  reason?: string;
};

export type ReviewsResponse = {
  summary: {
    PASS: number;
    REVIEW: number;
    BLOCK: number;
  };
  items: ReviewItem[];
};

export type Decision = "approve" | "reject";

export type DecisionResponse = {
  productId: string;
  decision: Decision;
  status: "APPROVED" | "REJECTED";
  appliedCategory?: string;
};

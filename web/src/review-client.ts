import type {
  CatalogueIssue,
  Decision,
  DecisionResponse,
  IssueSeverity,
  ReviewItem,
  ReviewsResponse,
} from "./types";

const REVIEW_STATUSES = ["PASS", "REVIEW", "BLOCK"] as const;
const ISSUE_SEVERITIES = ["critical", "high", "medium", "low"] as const;

type FetchResponse = Pick<Response, "ok" | "json">;
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<FetchResponse>;

export class ReviewContractError extends Error {
  constructor() {
    super("Review contract validation failed");
    this.name = "ReviewContractError";
  }
}

export class ReviewRequestError extends Error {
  constructor() {
    super("Review request failed");
    this.name = "ReviewRequestError";
  }
}

export type DecisionExpectation = {
  productId: string;
  decision: Decision;
  suggestedCategory?: string;
};

export class DecisionGate {
  private active = false;

  tryAcquire() {
    if (this.active) return false;
    this.active = true;
    return true;
  }

  release() {
    this.active = false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNumberBetweenZeroAndOne(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isReviewStatus(value: unknown): value is ReviewItem["status"] {
  return typeof value === "string" && REVIEW_STATUSES.includes(value as ReviewItem["status"]);
}

function isIssueSeverity(value: unknown): value is IssueSeverity {
  return typeof value === "string" && ISSUE_SEVERITIES.includes(value as IssueSeverity);
}

function isIssue(value: unknown): value is CatalogueIssue {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.code) &&
    isIssueSeverity(value.severity) &&
    typeof value.message === "string"
  );
}

function isReviewItem(value: unknown): value is ReviewItem {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.productId) || typeof value.title !== "string") return false;
  if (!isReviewStatus(value.status) || !Array.isArray(value.issues)) return false;
  if (!value.issues.every(isIssue)) return false;

  if ("suggestedCategory" in value && !isNonEmptyString(value.suggestedCategory)) return false;
  if ("confidence" in value && !isNumberBetweenZeroAndOne(value.confidence)) return false;
  if ("reason" in value && !isNonEmptyString(value.reason)) return false;

  return true;
}

function isSummary(value: unknown): value is ReviewsResponse["summary"] {
  if (!isRecord(value)) return false;
  return (["PASS", "REVIEW", "BLOCK"] as const).every(
    (key) =>
      typeof value[key] === "number" &&
      Number.isSafeInteger(value[key]) &&
      value[key] >= 0,
  );
}

export function parseReviewsResponse(value: unknown): ReviewsResponse {
  if (!isRecord(value) || !isSummary(value.summary) || !Array.isArray(value.items)) {
    throw new ReviewContractError();
  }

  if (!value.items.every(isReviewItem)) throw new ReviewContractError();

  return value as unknown as ReviewsResponse;
}

export function parseDecisionResponse(
  value: unknown,
  expectation: DecisionExpectation,
): DecisionResponse {
  const expectedStatus = expectation.decision === "approve" ? "APPROVED" : "REJECTED";
  if (!isRecord(value)) throw new ReviewContractError();
  if (value.productId !== expectation.productId) throw new ReviewContractError();
  if (value.decision !== expectation.decision || value.status !== expectedStatus) {
    throw new ReviewContractError();
  }
  if ("appliedCategory" in value && !isNonEmptyString(value.appliedCategory)) {
    throw new ReviewContractError();
  }
  if (
    expectation.decision === "approve" &&
    expectation.suggestedCategory &&
    value.appliedCategory !== expectation.suggestedCategory
  ) {
    throw new ReviewContractError();
  }

  return value as unknown as DecisionResponse;
}

async function readJson(response: FetchResponse) {
  try {
    return await response.json();
  } catch {
    throw new ReviewContractError();
  }
}

export async function fetchReviews(apiUrl: string, fetcher: Fetcher = fetch): Promise<ReviewsResponse> {
  let response: FetchResponse;
  try {
    response = await fetcher(`${apiUrl}/reviews`);
  } catch {
    throw new ReviewRequestError();
  }

  if (!response.ok) throw new ReviewRequestError();
  return parseReviewsResponse(await readJson(response));
}

export async function submitDecision(
  apiUrl: string,
  expectation: DecisionExpectation,
  fetcher: Fetcher = fetch,
): Promise<DecisionResponse> {
  let response: FetchResponse;
  try {
    response = await fetcher(`${apiUrl}/reviews/${encodeURIComponent(expectation.productId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: expectation.decision }),
    });
  } catch {
    throw new ReviewRequestError();
  }

  if (!response.ok) throw new ReviewRequestError();
  return parseDecisionResponse(await readJson(response), expectation);
}

export function removeReviewItem(items: ReviewItem[], productId: string) {
  return items.filter((item) => item.productId !== productId);
}

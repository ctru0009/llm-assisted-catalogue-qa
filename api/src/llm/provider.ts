import type { CategorySuggestion } from "./schemas";

export type CategorySuggestionInput = {
  title: string;
  description?: string;
  vendorCategory?: string;
  currentCategory?: string;
};

export type LLMProviderFailureCode =
  | "UNAVAILABLE"
  | "TIMEOUT"
  | "CONNECTION"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "MALFORMED_RESPONSE"
  | "INVALID_CATEGORY"
  | "AUTHENTICATION"
  | "CLIENT_ERROR"
  | "UNKNOWN";

export class LLMProviderError extends Error {
  readonly code: LLMProviderFailureCode;
  readonly retryable: boolean;

  constructor(
    code: LLMProviderFailureCode,
    message: string,
    retryable: boolean,
  ) {
    super(message);
    this.name = "LLMProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type CategorySuggestionFailure = {
  status: "FAILED";
  error: LLMProviderError;
  transportAttempted: boolean;
};

export type CategorySuggestionResult =
  | CategorySuggestion
  | CategorySuggestionFailure;

export interface LLMProvider {
  suggestCategory(
    input: CategorySuggestionInput,
  ): Promise<CategorySuggestionResult>;
}

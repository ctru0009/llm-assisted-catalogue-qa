import {
  LLMProviderError,
  type CategorySuggestionInput,
  type CategorySuggestionResult,
  type LLMProvider,
} from "./provider";

export class UnavailableProvider implements LLMProvider {
  async suggestCategory(
    _input: CategorySuggestionInput,
  ): Promise<CategorySuggestionResult> {
    return {
      status: "FAILED",
      error: new LLMProviderError(
        "UNAVAILABLE",
        "The LLM provider is not configured.",
        false,
      ),
    };
  }
}

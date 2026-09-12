import OpenAI from "openai";

import { ALLOWED_CATEGORIES } from "./categories";
import { buildCategoryPrompt } from "./prompt";
import {
  LLMProviderError,
  type CategorySuggestionInput,
  type CategorySuggestionResult,
  type LLMProvider,
} from "./provider";
import { CategorySuggestionSchema } from "./schemas";

export type ChatCompletionRequest = {
  model: string;
  messages: Array<{
    role: "system" | "user";
    content: string;
  }>;
  response_format: { type: "json_object" };
};

export type OpenAICompatibleClient = {
  chat: {
    completions: {
      create(request: ChatCompletionRequest): Promise<unknown>;
    };
  };
};

export type OpenAICompatibleProviderOptions = {
  apiKey: string;
  baseUrl: string;
  model: string;
  client?: OpenAICompatibleClient;
};

export class OpenAICompatibleProvider implements LLMProvider {
  private readonly client: OpenAICompatibleClient;
  private readonly model: string;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.model = options.model;
    this.client =
      options.client ??
      (new OpenAI({
        apiKey: options.apiKey,
        baseURL: options.baseUrl,
        maxRetries: 0,
      }) as unknown as OpenAICompatibleClient);
  }

  async suggestCategory(
    input: CategorySuggestionInput,
  ): Promise<CategorySuggestionResult> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await this.trySuggestion(input);

      if (!(result instanceof LLMProviderError)) {
        return result;
      }

      if (result.retryable && attempt === 0) {
        continue;
      }

      return {
        status: "FAILED",
        error: result.retryable
          ? new LLMProviderError(result.code, result.message, false)
          : result,
      };
    }

    return {
      status: "FAILED",
      error: new LLMProviderError(
        "UNKNOWN",
        "The LLM request failed.",
        false,
      ),
    };
  }

  private async trySuggestion(
    input: CategorySuggestionInput,
  ): Promise<Awaited<CategorySuggestionResult> | LLMProviderError> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: "system",
            content:
              "You are a product categorization assistant. Follow the requested JSON output shape exactly.",
          },
          { role: "user", content: buildCategoryPrompt(input) },
        ],
        response_format: { type: "json_object" },
      });

      const content = getResponseContent(response);
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new LLMProviderError(
          "MALFORMED_RESPONSE",
          "The LLM returned malformed JSON.",
          true,
        );
      }

      if (
        !isRecord(parsed) ||
        !ALLOWED_CATEGORIES.some(
          (category) => category === parsed.suggestedCategory,
        )
      ) {
        throw new LLMProviderError(
          "INVALID_CATEGORY",
          "The LLM returned a category outside the allowed list.",
          true,
        );
      }

      const suggestion = CategorySuggestionSchema.safeParse(parsed);
      if (!suggestion.success) {
        throw new LLMProviderError(
          "MALFORMED_RESPONSE",
          "The LLM response did not match the required schema.",
          true,
        );
      }

      return suggestion.data;
    } catch (error) {
      if (error instanceof LLMProviderError) {
        return error;
      }

      return classifyTransportError(error);
    }
  }
}

function getResponseContent(response: unknown): string {
  if (!isRecord(response) || !Array.isArray(response.choices)) {
    throw new LLMProviderError(
      "MALFORMED_RESPONSE",
      "The LLM response did not contain a message.",
      true,
    );
  }

  const firstChoice = response.choices[0];
  if (
    !isRecord(firstChoice) ||
    !isRecord(firstChoice.message) ||
    typeof firstChoice.message.content !== "string"
  ) {
    throw new LLMProviderError(
      "MALFORMED_RESPONSE",
      "The LLM response did not contain text content.",
      true,
    );
  }

  return firstChoice.message.content;
}

function classifyTransportError(error: unknown): LLMProviderError {
  const status =
    isRecord(error) && typeof error.status === "number" ? error.status : undefined;
  const name = isRecord(error) && typeof error.name === "string" ? error.name : "";
  const code = isRecord(error) && typeof error.code === "string" ? error.code : "";

  if (status === 401 || status === 403) {
    return new LLMProviderError(
      "AUTHENTICATION",
      "The LLM rejected the configured credentials.",
      false,
    );
  }
  if (status === 408 || name.toLowerCase().includes("timeout") || code === "ETIMEDOUT") {
    return new LLMProviderError("TIMEOUT", "The LLM request timed out.", true);
  }
  if (status === 429) {
    return new LLMProviderError("RATE_LIMITED", "The LLM rate limit was reached.", true);
  }
  if (status !== undefined && status >= 500) {
    return new LLMProviderError("SERVER_ERROR", "The LLM service failed.", true);
  }
  if (
    name.toLowerCase().includes("connection") ||
    ["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(code)
  ) {
    return new LLMProviderError("CONNECTION", "The LLM connection failed.", true);
  }
  if (status !== undefined && status >= 400) {
    return new LLMProviderError("CLIENT_ERROR", "The LLM request was rejected.", false);
  }

  return new LLMProviderError("UNKNOWN", "The LLM request failed.", false);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

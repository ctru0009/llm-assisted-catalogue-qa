import type { FastifyInstance } from "fastify";

import { createApp } from "../../api/src/app";
import { ALLOWED_CATEGORIES } from "../../api/src/llm/categories";
import type {
  CategorySuggestionInput,
  CategorySuggestionResult,
  LLMProvider,
} from "../../api/src/llm/provider";

export const API_BASE_URL = "http://127.0.0.1:4311";
export const WEB_ORIGIN = "http://127.0.0.1:4175";

const athleticShoes = ALLOWED_CATEGORIES[0];

function deterministicSuggestion(input: CategorySuggestionInput): CategorySuggestionResult {
  const isShoe = /shoe|runner|footwear|sneaker/.test(
    `${input.title} ${input.vendorCategory ?? ""}`.toLowerCase(),
  );

  return {
    suggestedCategory: isShoe ? athleticShoes : ALLOWED_CATEGORIES[1],
    confidence: 0.94,
    reason: "The title and supplier category indicate the most appropriate catalogue category.",
  };
}

export function createDeterministicTestProvider(): LLMProvider {
  return {
    async suggestCategory(input) {
      return deterministicSuggestion(input);
    },
  };
}

export async function startTestApi(): Promise<FastifyInstance> {
  const app = createApp({
    provider: createDeterministicTestProvider(),
    corsOrigin: WEB_ORIGIN,
  });

  await app.listen({ host: "127.0.0.1", port: 4311 });
  return app;
}

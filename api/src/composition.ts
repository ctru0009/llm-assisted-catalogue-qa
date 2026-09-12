import type { AppConfig } from "./config";
import type { LLMProvider } from "./llm/provider";
import { OpenAICompatibleProvider } from "./llm/openai-compatible";
import { UnavailableProvider } from "./llm/unavailable-provider";

export function composeProvider(config: AppConfig): LLMProvider {
  if (
    config.llm.status !== "configured" ||
    !config.llm.apiKey.trim() ||
    !config.llm.baseUrl.trim() ||
    !config.llm.model.trim()
  ) {
    return new UnavailableProvider();
  }

  return new OpenAICompatibleProvider({
    apiKey: config.llm.apiKey,
    baseUrl: config.llm.baseUrl,
    model: config.llm.model,
  });
}

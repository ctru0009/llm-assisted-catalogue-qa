import { z } from "zod";

const PortSchema = z.coerce.number().int().positive();

const LLM_CONFIGURATION_KEYS = [
  "LLM_API_KEY",
  "LLM_BASE_URL",
  "LLM_MODEL",
] as const;

export type LLMConfigurationKey = (typeof LLM_CONFIGURATION_KEYS)[number];

export type LLMConfiguration =
  | {
      status: "configured";
      apiKey: string;
      baseUrl: string;
      model: string;
    }
  | {
      status: "unavailable";
      missing: LLMConfigurationKey[];
    };

export type AppConfig = {
  port: number;
  corsOrigin: string;
  llm: LLMConfiguration;
};

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const values = {
    LLM_API_KEY: nonBlank(env.LLM_API_KEY),
    LLM_BASE_URL: nonBlank(env.LLM_BASE_URL),
    LLM_MODEL: nonBlank(env.LLM_MODEL),
  };

  const missing = LLM_CONFIGURATION_KEYS.filter((key) => !values[key]);
  const llm: LLMConfiguration = missing.length
    ? { status: "unavailable", missing: [...missing] }
    : {
        status: "configured",
        apiKey: values.LLM_API_KEY as string,
        baseUrl: values.LLM_BASE_URL as string,
        model: values.LLM_MODEL as string,
      };

  return {
    port: PortSchema.parse(env.PORT ?? "3000"),
    corsOrigin: nonBlank(env.CORS_ORIGIN) ?? "http://localhost:5173",
    llm,
  };
}

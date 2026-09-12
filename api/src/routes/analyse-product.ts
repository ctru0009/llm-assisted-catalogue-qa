import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { OpenAICompatibleProvider } from "../llm/openai-compatible";
import type { LLMProvider } from "../llm/provider";
import { evaluateRules } from "../rules/evaluate-rules";
import { analyseProduct } from "../services/analyse-product";
import type { ReviewStore } from "../store/review-store";
import { ProductSchema } from "../types/product";

const AnalyseRequestSchema = z.object({ product: ProductSchema });

export type RouteLogger = {
  info(entry: Record<string, unknown>): void;
  error(entry: Record<string, unknown>): void;
};

export type AnalyseRouteOptions = {
  provider: LLMProvider;
  store: ReviewStore;
  logger: RouteLogger;
};

export function registerAnalyseProductRoute(
  app: FastifyInstance,
  options: AnalyseRouteOptions,
): void {
  app.post("/analyse-product", async (request, reply) => {
    const parsed = AnalyseRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid request",
        details: parsed.error.issues.map(({ code, message, path }) => ({ code, message, path })),
      });
    }

    const product = parsed.data.product;
    const rules = evaluateRules(product);
    const blocking = rules.issues.some(
      (issue) => issue.severity === "critical" || issue.severity === "high",
    );
    if (!blocking && rules.needsClassification) {
      options.logger.info({
        event: "llm_category_request",
        productId: product.id,
        provider: options.provider instanceof OpenAICompatibleProvider
          ? "openai-compatible"
          : "injected",
      });
    }

    const analysis = await analyseProduct(product, options.provider);
    options.store.recordAnalysis(product, analysis);

    if (analysis.llm.status === "FAILED") {
      options.logger.info({
        event: "llm_category_failed",
        productId: product.id,
        attempt: analysis.metrics.llmUsed ? 1 : 0,
      });
    }
    options.logger.info({
      event: "product_analysis_completed",
      productId: product.id,
      status: analysis.status,
      llmUsed: analysis.metrics.llmUsed,
      processingMs: analysis.metrics.processingMs,
    });

    return reply.send(analysis);
  });
}

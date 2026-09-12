import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { LLMProvider } from "../llm/provider";
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
    const telemetryProvider: LLMProvider = {
      suggestCategory: async (input) => {
        options.logger.info({
          event: "llm_category_request",
          productId: product.id,
        });
        return options.provider.suggestCategory(input);
      },
    };
    const analysis = await analyseProduct(product, telemetryProvider);
    options.store.recordAnalysis(product, analysis);

    if (analysis.llm.status === "FAILED") {
      options.logger.info({
        event: "llm_category_failed",
        productId: product.id,
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

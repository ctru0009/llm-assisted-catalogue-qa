import Fastify, { type FastifyInstance } from "fastify";

import { registerAnalyseProductRoute, type RouteLogger } from "./routes/analyse-product";
import { registerReviewsRoutes } from "./routes/reviews";
import type { LLMProvider } from "./llm/provider";
import { createReviewStore, type ReviewStore } from "./store/review-store";

export type CreateAppOptions = {
  provider: LLMProvider;
  store?: ReviewStore;
  logger?: RouteLogger;
  corsOrigin?: string;
};

export function createApp(options: CreateAppOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const store = options.store ?? createReviewStore();
  const logger = options.logger ?? {
    info: (entry: Record<string, unknown>) => console.info(JSON.stringify(entry)),
    error: (entry: Record<string, unknown>) => console.error(JSON.stringify(entry)),
  };
  const corsOrigin = options.corsOrigin ?? "http://localhost:5173";

  app.addHook("onSend", async (_request, reply) => {
    reply.header("access-control-allow-origin", corsOrigin);
    reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
    reply.header("access-control-allow-headers", "content-type");
  });
  app.options("/*", async (_request, reply) => reply.code(204).send());
  app.setErrorHandler(async (error, _request, reply) => {
    const reportedStatusCode =
      typeof error === "object" && error !== null && "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : undefined;
    const statusCode =
      reportedStatusCode !== undefined && reportedStatusCode >= 400 && reportedStatusCode < 500
        ? reportedStatusCode
        : 500;

    if (statusCode === 500) logger.error({ event: "unexpected_error" });
    return reply.code(statusCode).send({
      error: statusCode === 413 ? "Request too large" : statusCode === 500
        ? "Internal server error"
        : "Invalid request",
    });
  });

  registerAnalyseProductRoute(app, { provider: options.provider, store, logger });
  registerReviewsRoutes(app, store);
  return app;
}

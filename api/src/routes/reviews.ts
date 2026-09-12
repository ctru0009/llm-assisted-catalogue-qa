import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { ReviewStore } from "../store/review-store";

const DecisionSchema = z.object({ decision: z.enum(["approve", "reject"]) });

export function registerReviewsRoutes(app: FastifyInstance, store: ReviewStore): void {
  app.get("/reviews", async (_request, reply) => {
    const items = store.listPendingReviews().map((review) => ({
      productId: review.productId,
      title: review.title,
      issues: review.issues,
      status: review.status,
      ...(review.suggestedCategory === undefined
        ? {}
        : {
            suggestedCategory: review.suggestedCategory,
            confidence: review.confidence,
            reason: review.reason,
          }),
    }));
    return reply.send({ summary: store.getSummary(), items });
  });

  app.post("/reviews/:productId", async (request, reply) => {
    const parsed = DecisionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid request",
        details: parsed.error.issues.map(({ code, message, path }) => ({ code, message, path })),
      });
    }

    const params = request.params as { productId: string };
    const result = store.decide(params.productId, parsed.data.decision);
    if ("kind" in result && result.kind === "NOT_FOUND") {
      return reply.code(404).send({ error: "Review not found" });
    }
    return reply.send(result);
  });
}

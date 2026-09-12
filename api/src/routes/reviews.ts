import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { ReviewStore } from "../store/review-store";
import { ProductIdSchema } from "../types/product";

const DecisionSchema = z.object({ decision: z.enum(["approve", "reject"]) });

function validationDetails(error: z.ZodError, field?: string) {
  return error.issues.map(({ code, message, path }) => ({
    code,
    message,
    path: field === undefined ? path : [field, ...path],
  }));
}

async function handleDecision(
  request: { body: unknown },
  reply: { code(statusCode: number): { send(payload: unknown): unknown }; send(payload: unknown): unknown },
  store: ReviewStore,
  rawProductId: unknown,
) {
  const productId = ProductIdSchema.safeParse(rawProductId);
  if (!productId.success) {
    return reply.code(400).send({
      error: "Invalid request",
      details: validationDetails(productId.error, "productId"),
    });
  }

  const parsed = DecisionSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      error: "Invalid request",
      details: validationDetails(parsed.error),
    });
  }

  const result = store.decide(productId.data, parsed.data.decision);
  if ("kind" in result && result.kind === "NOT_FOUND") {
    return reply.code(404).send({ error: "Review not found" });
  }
  return reply.send(result);
}

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

  app.post("/reviews", async (request, reply) =>
    handleDecision(request, reply, store, undefined),
  );
  app.post("/reviews/:productId", async (request, reply) => {
    const params = request.params as { productId: string };
    return handleDecision(request, reply, store, params.productId);
  });
}

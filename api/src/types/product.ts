import { z } from "zod";

import type { AllowedCategory } from "../llm/categories";
import type { CategorySuggestion } from "../llm/schemas";

export const ProductSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  sku: z.string(),
  price: z.number(),
  compareAtPrice: z.number().optional(),
  inventory: z.number(),
  category: z.string().optional(),
  vendorCategory: z.string().optional(),
  description: z.string().optional(),
  images: z.array(z.string()),
});

export type Product = z.infer<typeof ProductSchema>;

export type Severity = "critical" | "high" | "medium" | "low";

export type CatalogueIssue = {
  code: string;
  severity: Severity;
  message: string;
};

type AnalysisBase = {
  productId: string;
  status: "PASS" | "REVIEW" | "BLOCK";
  issues: CatalogueIssue[];
};

type AnalysisMetrics<Used extends boolean> = {
  processingMs: number;
  llmUsed: Used;
};

export type ProductAnalysis =
  | (AnalysisBase & {
      llm: { status: "SUCCESS"; suggestion: CategorySuggestion };
      metrics: AnalysisMetrics<true>;
    })
  | (AnalysisBase & {
      llm: { status: "FAILED" };
      metrics: AnalysisMetrics<true>;
    })
  | (AnalysisBase & {
      llm: { status: "NOT_USED" };
      metrics: AnalysisMetrics<false>;
    });

export type ReviewRecord = {
  productId: string;
  title: string;
  issues: CatalogueIssue[];
  originalCategory?: string;
  suggestedCategory?: AllowedCategory;
  confidence?: CategorySuggestion["confidence"];
  reason?: CategorySuggestion["reason"];
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
  decidedAt?: string;
};

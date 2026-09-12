import { z } from "zod";

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

export type ProductAnalysis = {
  productId: string;
  status: "PASS" | "REVIEW" | "BLOCK";
  issues: CatalogueIssue[];
  llm?: {
    status: "NOT_USED" | "SUCCESS" | "FAILED";
    suggestion?: {
      suggestedCategory: string;
      confidence: number;
      reason: string;
    };
  };
  metrics: {
    processingMs: number;
    llmUsed: boolean;
  };
};

export type ReviewRecord = {
  productId: string;
  title: string;
  issues: CatalogueIssue[];
  originalCategory?: string;
  suggestedCategory?: string;
  confidence?: number;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
  decidedAt?: string;
};

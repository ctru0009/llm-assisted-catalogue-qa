import { z } from "zod";

import { ALLOWED_CATEGORIES } from "./categories";

const AllowedCategorySchema = z.enum(ALLOWED_CATEGORIES);

export const CategorySuggestionSchema = z.object({
  suggestedCategory: AllowedCategorySchema,
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(300),
});

export type CategorySuggestion = z.infer<typeof CategorySuggestionSchema>;

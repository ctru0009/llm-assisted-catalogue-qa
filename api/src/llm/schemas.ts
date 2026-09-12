import { z } from "zod";

export const CategorySuggestionSchema = z.object({
  suggestedCategory: z.string().min(1).max(150),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(300),
});

export type CategorySuggestion = z.infer<typeof CategorySuggestionSchema>;

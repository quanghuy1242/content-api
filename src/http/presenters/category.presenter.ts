import type { z } from "zod";
import type { Category } from "@/domain/categories/category.entity";
import type { categoryResponseSchema } from "@/http/schemas/categories.schema";

/**
 * Presents a category as transport JSON. Domain dates stay as `Date`; HTTP
 * contracts expose ISO strings.
 */
export function presentCategory(category: Category): z.infer<typeof categoryResponseSchema> {
  return {
    ...category,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  };
}

import type { Category } from "@/domain/categories/category.entity";
import { categories } from "@/infrastructure/db/schema";

type CategoryRow = typeof categories.$inferSelect;

/**
 * Translates Drizzle category rows to the domain shape.
 */
export function categoryRowToEntity(row: CategoryRow): Category {
  return row;
}

/**
 * Builds an insert payload while keeping repository write methods free of
 * field-by-field mapping details.
 */
export function categoryToInsertRow(input: Omit<Category, "createdAt" | "updatedAt">) {
  return input;
}

/**
 * Adds the persistence-managed update timestamp for category PATCH writes.
 */
export function categoryToUpdateRow(input: Partial<Omit<Category, "id" | "createdAt" | "updatedAt" | "createdBy">>) {
  return {
    ...input,
    updatedAt: new Date(),
  };
}

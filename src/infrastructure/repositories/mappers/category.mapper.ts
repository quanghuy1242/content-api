import type { Category } from "@/domain/categories/category.entity";
import { categories } from "@/infrastructure/db/schema";

type CategoryRow = typeof categories.$inferSelect;

/**
 * Translates Drizzle category rows to the domain shape.
 */
export function categoryRowToEntity(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    image: row.image,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Builds an insert payload while keeping repository write methods free of
 * field-by-field mapping details.
 */
export function categoryToInsertRow(input: Omit<Category, "createdAt" | "updatedAt">) {
  return {
    id: input.id,
    name: input.name,
    slug: input.slug,
    description: input.description,
    image: input.image,
    createdBy: input.createdBy,
  };
}

/**
 * Adds the persistence-managed update timestamp for category PATCH writes.
 */
export function categoryToUpdateRow(input: Partial<Omit<Category, "id" | "createdAt" | "updatedAt" | "createdBy">>) {
  return {
    name: input.name,
    slug: input.slug,
    description: input.description,
    image: input.image,
    updatedAt: new Date(),
  };
}

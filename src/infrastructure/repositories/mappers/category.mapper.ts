import { Category } from "@/domain/categories/category.entity";
import { categories } from "@/infrastructure/db/schema";

type CategoryRow = typeof categories.$inferSelect;

/**
 * Rebuilds a category entity from a Drizzle row.
 */
export function categoryRowToEntity(row: CategoryRow): Category {
  return Category.reconstitute({
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    image: row.image,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/**
 * Builds an insert payload from the domain entity snapshot.
 */
export function categoryToInsertRow(category: Category) {
  const snap = category.toSnapshot();
  return {
    id: snap.id,
    orgId: snap.orgId,
    name: snap.name,
    slug: snap.slug,
    description: snap.description,
    image: snap.image,
    createdBy: snap.createdBy,
    createdAt: snap.createdAt,
    updatedAt: snap.updatedAt,
  };
}

/**
 * Builds an update payload from the domain entity snapshot.
 */
export function categoryToUpdateRow(category: Category) {
  const snap = category.toSnapshot();
  return {
    name: snap.name,
    slug: snap.slug,
    description: snap.description,
    image: snap.image,
    updatedAt: snap.updatedAt,
  };
}

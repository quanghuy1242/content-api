import type { Category } from "@/domain/categories/category.entity";
import type { CursorPage } from "@/shared/pagination/cursor";

export interface CategoryRepository {
  findMany(params: { limit: number; cursor?: string }): Promise<CursorPage<Category>>;
  findById(id: string): Promise<Category | null>;
  findBySlug(slug: string): Promise<Category | null>;
  create(category: Category): Promise<Category>;
  save(category: Category): Promise<void>;
  delete(id: string): Promise<boolean>;
}

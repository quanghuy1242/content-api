import type { Category } from "@/domain/categories/category.entity";
import type { CursorPage } from "@/shared/pagination/cursor";

export interface CategoryRepository {
  findMany(params: { limit: number; cursor?: string }): Promise<CursorPage<Category>>;
  findById(id: string): Promise<Category | null>;
  findBySlug(slug: string): Promise<Category | null>;
  create(input: Omit<Category, "createdAt" | "updatedAt">): Promise<Category>;
  update(id: string, input: Partial<Omit<Category, "id" | "createdAt" | "updatedAt" | "createdBy">>): Promise<Category | null>;
  delete(id: string): Promise<boolean>;
}

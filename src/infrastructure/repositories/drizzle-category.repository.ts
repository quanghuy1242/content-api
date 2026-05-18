import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { Category } from "@/domain/categories/category.entity";
import type { CategoryRepository } from "@/domain/categories/category.repository";
import { categories } from "@/infrastructure/db/schema";
import { CrudAdapter } from "@/infrastructure/persistence/crud-adapter";
import { categoryRowToEntity, categoryToInsertRow, categoryToUpdateRow } from "@/infrastructure/repositories/mappers/category.mapper";
import * as schema from "@/infrastructure/db/schema";

type Db = DrizzleD1Database<typeof schema>;

/**
 * Drizzle-backed category repository. It maps rows to domain entities and
 * delegates repeated CRUD mechanics to `CrudAdapter`; authorization stays in
 * category use cases and policies.
 */
export class DrizzleCategoryRepository implements CategoryRepository {
  private readonly crud: CrudAdapter;

  constructor(db: Db) {
    this.crud = new CrudAdapter(db);
  }

  async findMany(params: { limit: number; cursor?: string }) {
    const page = await this.crud.listRows<typeof categories.$inferSelect>({
      table: categories,
      idColumn: categories.id,
      cursorColumn: categories.createdAt,
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      limit: params.limit,
      cursor: params.cursor,
    });

    return { data: page.data.map(categoryRowToEntity), page: page.page };
  }

  async findById(id: string) {
    const row = await this.crud.findRowById<typeof categories.$inferSelect>(categories, categories.id, id);
    return row ? categoryRowToEntity(row) : null;
  }

  async findBySlug(slug: string) {
    const row = await this.crud.findFirstRow<typeof categories.$inferSelect>(categories, eq(categories.slug, slug));
    return row ? categoryRowToEntity(row) : null;
  }

  async create(category: Category) {
    await this.crud.insertRow(categories, categoryToInsertRow(category));
    return (await this.findById(category.id))!;
  }

  async save(category: Category) {
    await this.crud.updateRow(categories, categories.id, category.id, categoryToUpdateRow(category));
  }

  async delete(id: string) {
    return this.crud.deleteRowById(categories, categories.id, id);
  }
}

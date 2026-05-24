import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { CategoryCreateWorkflow } from "@/domain/categories/category-create.workflow";
import { categories, idempotencyKeys } from "@/infrastructure/db/schema";
import { CrudAdapter } from "@/infrastructure/persistence/crud-adapter";
import { isSqliteUniqueConstraintError } from "@/infrastructure/persistence/sqlite-errors";
import { categoryToInsertRow } from "@/infrastructure/repositories/mappers/category.mapper";
import { idempotencyToInsertRow } from "@/infrastructure/repositories/mappers/idempotency.mapper";
import { IdempotencyReservationConflictError } from "@/shared/errors";

type Db = DrizzleD1Database<typeof import("@/infrastructure/db/schema")>;

export class DrizzleCategoryCreateWorkflow implements CategoryCreateWorkflow {
  private readonly crud: CrudAdapter;

  constructor(private readonly db: Db) {
    this.crud = new CrudAdapter(db);
  }

  async create(params: Parameters<CategoryCreateWorkflow["create"]>[0]) {
    await this.crud.insertRow(categories, categoryToInsertRow(params.category));
  }

  async createWithIdempotency(params: Parameters<CategoryCreateWorkflow["createWithIdempotency"]>[0]) {
    const idempotency = idempotencyToInsertRow({
      ...params.idempotency,
      createdAt: params.category.createdAt,
    });

    try {
      await this.db.batch([
        this.crud.buildInsert(idempotencyKeys, idempotency),
        this.crud.buildInsert(categories, categoryToInsertRow(params.category)),
      ]);
    } catch (error) {
      if (isSqliteUniqueConstraintError(error, "idempotency_keys.key")) {
        throw new IdempotencyReservationConflictError();
      }
      throw error;
    }
  }
}

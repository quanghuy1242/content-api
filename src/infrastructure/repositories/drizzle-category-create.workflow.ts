import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { CategoryCreateWorkflow } from "@/domain/categories/category-create.workflow";
import { categories, idempotencyKeys, relationships } from "@/infrastructure/db/schema";
import { CrudAdapter } from "@/infrastructure/persistence/crud-adapter";
import { isSqliteUniqueConstraintError } from "@/infrastructure/persistence/sqlite-errors";
import { categoryToInsertRow } from "@/infrastructure/repositories/mappers/category.mapper";
import { idempotencyToInsertRow } from "@/infrastructure/repositories/mappers/idempotency.mapper";
import { relationshipToInsertRow } from "@/infrastructure/repositories/mappers/relationship.mapper";
import { IdempotencyReservationConflictError } from "@/shared/errors";
import * as schema from "@/infrastructure/db/schema";

type Db = DrizzleD1Database<typeof schema>;

export class DrizzleCategoryCreateWorkflow implements CategoryCreateWorkflow {
  private readonly crud: CrudAdapter;

  constructor(private readonly db: Db) {
    this.crud = new CrudAdapter(db);
  }

  async createWithIdempotency(params: Parameters<CategoryCreateWorkflow["createWithIdempotency"]>[0]) {
    const idempotency = idempotencyToInsertRow({
      ...params.idempotency,
      createdAt: params.category.createdAt,
    });
    const categoryRow = categoryToInsertRow(params.category);
    const relationship = relationshipToInsertRow(params.ownerRelationship);

    try {
      await this.db.batch([
        this.crud.buildInsert(idempotencyKeys, idempotency),
        this.crud.buildInsert(categories, categoryRow),
        this.crud.buildInsert(relationships, relationship),
      ]);
    } catch (error) {
      if (isSqliteUniqueConstraintError(error, "idempotency_keys.key")) {
        throw new IdempotencyReservationConflictError();
      }
      throw error;
    }
  }
}

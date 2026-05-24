import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { CategoryCreateWorkflow } from "@/domain/categories/category-create.workflow";
import { categories, contentPolicyBindings, contentPolicyEvents, idempotencyKeys } from "@/infrastructure/db/schema";
import { CrudAdapter } from "@/infrastructure/persistence/crud-adapter";
import { isSqliteUniqueConstraintError } from "@/infrastructure/persistence/sqlite-errors";
import { categoryToInsertRow } from "@/infrastructure/repositories/mappers/category.mapper";
import { policyBindingToInsertRow, policyEventToInsertRow } from "@/infrastructure/repositories/mappers/content-iam.mapper";
import { idempotencyToInsertRow } from "@/infrastructure/repositories/mappers/idempotency.mapper";
import { IdempotencyReservationConflictError } from "@/shared/errors";

type Db = DrizzleD1Database<typeof import("@/infrastructure/db/schema")>;

export class DrizzleCategoryCreateWorkflow implements CategoryCreateWorkflow {
  private readonly crud: CrudAdapter;

  constructor(private readonly db: Db) {
    this.crud = new CrudAdapter(db);
  }

  async createWithOwner(params: Parameters<CategoryCreateWorkflow["createWithOwner"]>[0]) {
    await this.db.batch([
      this.crud.buildInsert(categories, categoryToInsertRow(params.category)),
      this.crud.buildInsert(contentPolicyBindings, policyBindingToInsertRow(params.ownerBinding)),
      this.crud.buildInsert(contentPolicyEvents, policyEventToInsertRow(params.event)),
    ]);
  }

  async createWithIdempotency(params: Parameters<CategoryCreateWorkflow["createWithIdempotency"]>[0]) {
    const idempotency = idempotencyToInsertRow({
      ...params.idempotency,
      createdAt: params.category.createdAt,
    });
    const categoryRow = categoryToInsertRow(params.category);

    try {
      await this.db.batch([
        this.crud.buildInsert(idempotencyKeys, idempotency),
        this.crud.buildInsert(categories, categoryRow),
        this.crud.buildInsert(contentPolicyBindings, policyBindingToInsertRow(params.ownerBinding)),
        this.crud.buildInsert(contentPolicyEvents, policyEventToInsertRow(params.event)),
      ]);
    } catch (error) {
      if (isSqliteUniqueConstraintError(error, "idempotency_keys.key")) {
        throw new IdempotencyReservationConflictError();
      }
      throw error;
    }
  }
}

import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { UserCreateWorkflow } from "@/domain/users/user-create.workflow";
import { idempotencyKeys, users } from "@/infrastructure/db/schema";
import { CrudAdapter } from "@/infrastructure/persistence/crud-adapter";
import { isSqliteUniqueConstraintError } from "@/infrastructure/persistence/sqlite-errors";
import { idempotencyToInsertRow } from "@/infrastructure/repositories/mappers/idempotency.mapper";
import { userToInsertRow } from "@/infrastructure/repositories/mappers/user.mapper";
import { IdempotencyReservationConflictError } from "@/shared/errors";
import * as schema from "@/infrastructure/db/schema";

type Db = DrizzleD1Database<typeof schema>;

export class DrizzleUserCreateWorkflow implements UserCreateWorkflow {
  private readonly crud: CrudAdapter;

  constructor(private readonly db: Db) {
    this.crud = new CrudAdapter(db);
  }

  async createWithIdempotency(params: Parameters<UserCreateWorkflow["createWithIdempotency"]>[0]) {
    const idempotency = idempotencyToInsertRow({
      ...params.idempotency,
      createdAt: params.user.createdAt,
    });
    const user = userToInsertRow(params.user);

    try {
      await this.db.batch([
        this.crud.buildInsert(idempotencyKeys, idempotency),
        this.crud.buildInsert(users, {
          ...user,
          createdAt: params.user.createdAt,
          updatedAt: params.user.updatedAt,
        }),
      ]);
    } catch (error) {
      if (isSqliteUniqueConstraintError(error, "idempotency_keys.key")) {
        throw new IdempotencyReservationConflictError();
      }
      throw error;
    }
  }
}

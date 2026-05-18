import { and, eq, gt, lte } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { IdempotencyRepository, IdempotencyRoute } from "@/domain/idempotency/idempotency.repository";
import { idempotencyKeys } from "@/infrastructure/db/schema";
import { CrudAdapter } from "@/infrastructure/persistence/crud-adapter";
import { idempotencyRowToRecord } from "@/infrastructure/repositories/mappers/idempotency.mapper";

type Db = DrizzleD1Database<typeof import("@/infrastructure/db/schema")>;

export class DrizzleIdempotencyRepository implements IdempotencyRepository {
  private readonly crud: CrudAdapter;

  constructor(db: Db) {
    this.crud = new CrudAdapter(db);
  }

  async findActive(params: { key: string; actorId: string; route: IdempotencyRoute }) {
    const row = await this.crud.findFirstRow<typeof idempotencyKeys.$inferSelect>(
      idempotencyKeys,
      and(
        eq(idempotencyKeys.key, params.key),
        eq(idempotencyKeys.actorId, params.actorId),
        eq(idempotencyKeys.route, params.route),
        gt(idempotencyKeys.expiresAt, new Date()),
      )!,
    );

    return row ? idempotencyRowToRecord(row) : null;
  }

  async deleteExpired(params: { key: string; actorId: string; route: IdempotencyRoute }) {
    await this.crud.deleteRows(
      idempotencyKeys,
      and(
        eq(idempotencyKeys.key, params.key),
        eq(idempotencyKeys.actorId, params.actorId),
        eq(idempotencyKeys.route, params.route),
        lte(idempotencyKeys.expiresAt, new Date()),
      )!,
    );
  }
}

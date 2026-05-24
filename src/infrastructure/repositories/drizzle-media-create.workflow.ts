import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { MediaCreateWorkflow } from "@/domain/media/media-create.workflow";
import { contentPolicyBindings, contentPolicyEvents, idempotencyKeys, media as mediaTable } from "@/infrastructure/db/schema";
import { CrudAdapter } from "@/infrastructure/persistence/crud-adapter";
import { isSqliteUniqueConstraintError } from "@/infrastructure/persistence/sqlite-errors";
import { idempotencyToInsertRow } from "@/infrastructure/repositories/mappers/idempotency.mapper";
import { policyBindingToInsertRow, policyEventToInsertRow } from "@/infrastructure/repositories/mappers/content-iam.mapper";
import { mediaToInsertRow } from "@/infrastructure/repositories/mappers/media.mapper";
import { IdempotencyReservationConflictError } from "@/shared/errors";

type Db = DrizzleD1Database<typeof import("@/infrastructure/db/schema")>;

export class DrizzleMediaCreateWorkflow implements MediaCreateWorkflow {
  private readonly crud: CrudAdapter;

  constructor(private readonly db: Db) {
    this.crud = new CrudAdapter(db);
  }

  async createWithOwner(params: Parameters<MediaCreateWorkflow["createWithOwner"]>[0]) {
    await this.db.batch([
      this.crud.buildInsert(mediaTable, mediaToInsertRow(params.media)),
      this.crud.buildInsert(contentPolicyBindings, policyBindingToInsertRow(params.ownerBinding)),
      this.crud.buildInsert(contentPolicyEvents, policyEventToInsertRow(params.event)),
    ]);
  }

  async createWithIdempotency(params: Parameters<MediaCreateWorkflow["createWithIdempotency"]>[0]) {
    const idempotency = idempotencyToInsertRow({
      ...params.idempotency,
      createdAt: params.media.createdAt,
    });
    const media = mediaToInsertRow(params.media);

    try {
      await this.db.batch([
        this.crud.buildInsert(idempotencyKeys, idempotency),
        this.crud.buildInsert(mediaTable, media),
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

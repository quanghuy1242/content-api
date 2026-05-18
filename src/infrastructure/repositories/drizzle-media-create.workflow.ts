import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { MediaCreateWorkflow } from "@/domain/media/media-create.workflow";
import { idempotencyKeys, media as mediaTable, relationships } from "@/infrastructure/db/schema";
import { CrudAdapter } from "@/infrastructure/persistence/crud-adapter";
import { isSqliteUniqueConstraintError } from "@/infrastructure/persistence/sqlite-errors";
import { idempotencyToInsertRow } from "@/infrastructure/repositories/mappers/idempotency.mapper";
import { mediaToInsertRow } from "@/infrastructure/repositories/mappers/media.mapper";
import { relationshipToInsertRow } from "@/infrastructure/repositories/mappers/relationship.mapper";
import { IdempotencyReservationConflictError } from "@/shared/errors";

type Db = DrizzleD1Database<typeof import("@/infrastructure/db/schema")>;

export class DrizzleMediaCreateWorkflow implements MediaCreateWorkflow {
  private readonly crud: CrudAdapter;

  constructor(private readonly db: Db) {
    this.crud = new CrudAdapter(db);
  }

  async createWithIdempotency(params: Parameters<MediaCreateWorkflow["createWithIdempotency"]>[0]) {
    const idempotency = idempotencyToInsertRow({
      ...params.idempotency,
      createdAt: params.media.createdAt,
    });
    const media = mediaToInsertRow(params.media);
    const relationship = relationshipToInsertRow(params.ownerRelationship);

    try {
      await this.db.batch([
        this.crud.buildInsert(idempotencyKeys, idempotency),
        this.crud.buildInsert(mediaTable, media),
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

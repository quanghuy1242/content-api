import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { PostCreateWorkflow } from "@/domain/posts/post-create.workflow";
import { idempotencyKeys, posts, relationships } from "@/infrastructure/db/schema";
import { CrudAdapter } from "@/infrastructure/persistence/crud-adapter";
import { isSqliteUniqueConstraintError } from "@/infrastructure/persistence/sqlite-errors";
import { idempotencyToInsertRow } from "@/infrastructure/repositories/mappers/idempotency.mapper";
import { postToInsertRow } from "@/infrastructure/repositories/mappers/post.mapper";
import { relationshipToInsertRow } from "@/infrastructure/repositories/mappers/relationship.mapper";
import { IdempotencyReservationConflictError } from "@/shared/errors";
import * as schema from "@/infrastructure/db/schema";

type Db = DrizzleD1Database<typeof schema>;

export class DrizzlePostCreateWorkflow implements PostCreateWorkflow {
  private readonly crud: CrudAdapter;

  constructor(private readonly db: Db) {
    this.crud = new CrudAdapter(db);
  }

  async createWithIdempotency(params: Parameters<PostCreateWorkflow["createWithIdempotency"]>[0]) {
    const idempotency = idempotencyToInsertRow({
      ...params.idempotency,
      createdAt: params.post.createdAt,
    });
    const post = postToInsertRow(params.post);
    const relationship = relationshipToInsertRow(params.authorRelationship);

    try {
      await this.db.batch([
        this.crud.buildInsert(idempotencyKeys, idempotency),
        this.crud.buildInsert(posts, post),
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

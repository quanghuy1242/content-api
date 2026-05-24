import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { PostCreateWorkflow } from "@/domain/posts/post-create.workflow";
import { contentPolicyBindings, contentPolicyEvents, idempotencyKeys, posts } from "@/infrastructure/db/schema";
import { CrudAdapter } from "@/infrastructure/persistence/crud-adapter";
import { isSqliteUniqueConstraintError } from "@/infrastructure/persistence/sqlite-errors";
import { idempotencyToInsertRow } from "@/infrastructure/repositories/mappers/idempotency.mapper";
import { policyBindingToInsertRow, policyEventToInsertRow } from "@/infrastructure/repositories/mappers/content-iam.mapper";
import { postToInsertRow } from "@/infrastructure/repositories/mappers/post.mapper";
import { IdempotencyReservationConflictError } from "@/shared/errors";

type Db = DrizzleD1Database<typeof import("@/infrastructure/db/schema")>;

export class DrizzlePostCreateWorkflow implements PostCreateWorkflow {
  private readonly crud: CrudAdapter;

  constructor(private readonly db: Db) {
    this.crud = new CrudAdapter(db);
  }

  async createWithOwner(params: Parameters<PostCreateWorkflow["createWithOwner"]>[0]) {
    await this.db.batch([
      this.crud.buildInsert(posts, postToInsertRow(params.post)),
      this.crud.buildInsert(contentPolicyBindings, policyBindingToInsertRow(params.ownerBinding)),
      this.crud.buildInsert(contentPolicyEvents, policyEventToInsertRow(params.event)),
    ]);
  }

  async createWithIdempotency(params: Parameters<PostCreateWorkflow["createWithIdempotency"]>[0]) {
    const idempotency = idempotencyToInsertRow({
      ...params.idempotency,
      createdAt: params.post.createdAt,
    });
    const post = postToInsertRow(params.post);

    try {
      await this.db.batch([
        this.crud.buildInsert(idempotencyKeys, idempotency),
        this.crud.buildInsert(posts, post),
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

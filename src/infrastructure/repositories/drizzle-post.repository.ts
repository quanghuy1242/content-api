import { and, asc, eq, inArray, lte, ne } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { LifecycleStatus } from "@/domain/lifecycle/lifecycle-entity";
import type { Post } from "@/domain/posts/post.entity";
import type { PostRepository } from "@/domain/posts/post.repository";
import { ConflictError } from "@/shared/errors";
import { posts } from "@/infrastructure/db/schema";
import { CrudAdapter } from "@/infrastructure/persistence/crud-adapter";
import {
  postRowToEntity,
  postToInsertRow,
  postToLifecycleUpdateRow,
  postToUpdateRow,
} from "@/infrastructure/repositories/mappers/post.mapper";

type Db = DrizzleD1Database<typeof import("@/infrastructure/db/schema")>;

/**
 * Drizzle-backed post repository. Visibility predicates for read queries are
 * persistence filters requested by use cases; authorization decisions stay in
 * application use cases through Content IAM.
 */
export class DrizzlePostRepository implements PostRepository {
  private readonly crud: CrudAdapter;
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
    this.crud = new CrudAdapter(db);
  }

  async findMany(params: {
    limit: number;
    cursor?: string;
  }) {
    const page = await this.crud.listRows<typeof posts.$inferSelect>({
      table: posts,
      idColumn: posts.id,
      cursorColumn: posts.createdAt,
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      limit: params.limit,
      cursor: params.cursor,
    });

    return { data: page.data.map(postRowToEntity), page: page.page };
  }

  async findById(id: string) {
    const row = await this.crud.findRowById<typeof posts.$inferSelect>(posts, posts.id, id);
    return row ? postRowToEntity(row) : null;
  }

  async findBySlug(slug: string) {
    const row = await this.crud.findFirstRow<typeof posts.$inferSelect>(posts, eq(posts.slug, slug));
    return row ? postRowToEntity(row) : null;
  }

  async create(post: Post) {
    await this.crud.insertRow(posts, postToInsertRow(post));
  }

  async save(post: Post) {
    const result = await this.crud.updateRowsConditional(posts, {
      set: postToUpdateRow(post),
      where: and(eq(posts.id, post.id), ne(posts.status, "archived"))!,
    });
    if (result.rowsAffected !== 1) {
      throw new ConflictError("Cannot update an archived post");
    }
  }

  async saveLifecycle(post: Post, expectedStatus: LifecycleStatus) {
    const result = await this.crud.updateRowsConditional(posts, {
      set: postToLifecycleUpdateRow(post),
      where: and(eq(posts.id, post.id), eq(posts.status, expectedStatus))!,
    });
    if (result.rowsAffected !== 1) {
      throw new ConflictError("Post lifecycle state changed before update");
    }
  }

  async delete(id: string) {
    await this.crud.deleteRowById(posts, posts.id, id);
  }

  async publishScheduledReady(now: Date, limit: number): Promise<number> {
    const sub = this.db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.status, "scheduled"), lte(posts.scheduledAt, now)))
      .orderBy(asc(posts.scheduledAt))
      .limit(limit);

    const result = await this.crud.updateRowsConditional(posts, {
      set: {
        status: "published",
        publishedAt: now,
        scheduledAt: null,
        updatedAt: now,
      },
      where: inArray(posts.id, sub),
    });
    return result.rowsAffected;
  }
}

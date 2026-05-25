import { and, eq, lte } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { Post } from "@/domain/posts/post.entity";
import type { PostRepository } from "@/domain/posts/post.repository";
import { posts } from "@/infrastructure/db/schema";
import { CrudAdapter } from "@/infrastructure/persistence/crud-adapter";
import { postRowToEntity, postToInsertRow, postToUpdateRow } from "@/infrastructure/repositories/mappers/post.mapper";

type Db = DrizzleD1Database<typeof import("@/infrastructure/db/schema")>;

/**
 * Drizzle-backed post repository. Visibility predicates for read queries are
 * persistence filters requested by use cases; authorization decisions stay in
 * application use cases through Content IAM.
 */
export class DrizzlePostRepository implements PostRepository {
  private readonly crud: CrudAdapter;

  constructor(db: Db) {
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
    await this.crud.updateRow(posts, posts.id, post.id, postToUpdateRow(post));
  }

  async delete(id: string) {
    await this.crud.deleteRowById(posts, posts.id, id);
  }

  async findScheduledReadyIds(now: Date, limit: number): Promise<readonly string[]> {
    const rows = await this.crud.findRowsWhere<{ id: string }>(
      posts,
      [posts.id],
      and(eq(posts.status, "scheduled"), lte(posts.scheduledAt, now))!,
      { orderBy: posts.scheduledAt, direction: "asc", limit },
    );
    return rows.map((row) => row.id);
  }

  async publishScheduledReady(id: string, now: Date): Promise<boolean> {
    const result = await this.crud.updateRowsConditional(posts, {
      set: {
        status: "published",
        publishedAt: now,
        scheduledAt: null,
        updatedAt: now,
      },
      where: and(eq(posts.id, id), eq(posts.status, "scheduled"), lte(posts.scheduledAt, now))!,
    });
    return result.rowsAffected === 1;
  }
}

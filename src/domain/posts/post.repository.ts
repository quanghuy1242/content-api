import type { Post } from "@/domain/posts/post.entity";
import type { LifecycleStatus } from "@/domain/lifecycle/lifecycle-entity";
import type { CursorPage } from "@/shared/pagination/cursor";

export interface PostRepository {
  findMany(params: {
    limit: number;
    cursor?: string;
  }): Promise<CursorPage<Post>>;
  findById(id: string): Promise<Post | null>;
  findBySlug(slug: string): Promise<Post | null>;
  create(post: Post): Promise<void>;
  /** Persists mutable content only while the row has not been archived. */
  save(post: Post): Promise<void>;
  /** Persists a lifecycle transition through an optimistic status guard. */
  saveLifecycle(post: Post, expectedStatus: LifecycleStatus): Promise<void>;
  delete(id: string): Promise<void>;
  /** Atomically publishes up to `limit` scheduled posts whose `scheduled_at <= now`. */
  publishScheduledReady(now: Date, limit: number): Promise<number>;
}

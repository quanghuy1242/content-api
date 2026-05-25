import type { Post } from "@/domain/posts/post.entity";
import type { CursorPage } from "@/shared/pagination/cursor";

export interface PostRepository {
  findMany(params: {
    limit: number;
    cursor?: string;
  }): Promise<CursorPage<Post>>;
  findById(id: string): Promise<Post | null>;
  findBySlug(slug: string): Promise<Post | null>;
  create(post: Post): Promise<void>;
  save(post: Post): Promise<void>;
  delete(id: string): Promise<void>;
  /** Returns IDs of scheduled posts whose scheduled_at is at or before `now`. */
  findScheduledReadyIds(now: Date, limit: number): Promise<readonly string[]>;
  /** Atomically publishes a scheduled post if its status is still `scheduled`. */
  publishScheduledReady(id: string, now: Date): Promise<boolean>;
}

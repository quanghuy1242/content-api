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
}

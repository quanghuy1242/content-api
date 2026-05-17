import type { Actor } from "@/domain/authz/actor";
import type { PostRepository } from "@/domain/posts/post.repository";

export class ListPostsUseCase {
  constructor(private readonly posts: PostRepository) {}

  async execute(params: { actor: Actor | null; limit: number; cursor?: string }) {
    const actorId = params.actor?.type === "user" ? params.actor.localUserId : null;
    return this.posts.findMany({
      limit: params.limit,
      cursor: params.cursor,
      actorId,
      includeDrafts: params.actor?.type === "user",
      includeAll: params.actor?.type === "user" && params.actor.role === "admin",
    });
  }
}

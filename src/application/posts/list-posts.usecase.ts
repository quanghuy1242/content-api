import type { Actor } from "@/domain/authz/actor";
import { actorWithReadScope } from "@/domain/authz/scopes";
import type { PostRepository } from "@/domain/posts/post.repository";

export class ListPostsUseCase {
  constructor(private readonly posts: PostRepository) {}

  async execute(params: { actor: Actor | null; limit: number; cursor?: string }) {
    const actor = actorWithReadScope(params.actor);
    const actorId = actor?.type === "user" ? actor.id : null;
    return this.posts.findMany({
      limit: params.limit,
      cursor: params.cursor,
      actorId,
      includeDrafts: actor?.type === "user",
      includeAll: actor?.type === "user" && actor.role === "admin",
    });
  }
}

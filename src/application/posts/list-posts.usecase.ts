import type { Actor } from "@/domain/auth/actor";
import { actorWithReadScope } from "@/domain/auth/scopes";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import { postResource } from "@/domain/iam/resource-loader";
import type { PostRepository } from "@/domain/posts/post.repository";

export class ListPostsUseCase {
  constructor(
    private readonly posts: PostRepository,
    private readonly contentPolicy: ContentPolicy,
  ) {}

  async execute(params: { actor: Actor | null; limit: number; cursor?: string }) {
    const actor = actorWithReadScope(params.actor);
    const result = await this.posts.findMany({
      limit: params.limit,
      cursor: params.cursor,
      actorId: null,
      includeDrafts: true,
      includeAll: true,
    });
    const privatePosts = result.data.filter((post) => post.status !== "published");
    const decisions = await this.contentPolicy.canMany({
      actor,
      permission: "post.read",
      resources: privatePosts.map(postResource),
    });
    return {
      data: result.data.filter((post) => post.status === "published" || decisions.get(post.id) === true),
      page: result.page,
    };
  }
}

import { assertAllowed } from "@/domain/auth/assert-can";
import type { Actor } from "@/domain/auth/actor";
import { actorWithReadScope } from "@/domain/auth/scopes";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import { postResource } from "@/domain/iam/resource-loader";
import type { PostRepository } from "@/domain/posts/post.repository";
import { NotFoundError } from "@/shared/errors";

export class GetPostUseCase {
  constructor(
    private readonly posts: PostRepository,
    private readonly contentPolicy: ContentPolicy,
  ) {}

  async execute(params: { actor: Actor | null; postId: string }) {
    const post = await this.posts.findById(params.postId);
    if (!post) throw new NotFoundError("Post not found");

    await assertAllowed(
      post.status === "published"
        ? Promise.resolve(true)
        : this.contentPolicy.can({ actor: actorWithReadScope(params.actor), permission: "post.read", resource: postResource(post) }),
      "You cannot read this post",
    );
    return post;
  }
}

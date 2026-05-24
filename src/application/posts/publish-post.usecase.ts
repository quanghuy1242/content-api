import { assertAllowed } from "@/domain/auth/assert-can";
import type { Actor } from "@/domain/auth/actor";
import { requireContentScope } from "@/domain/auth/scopes";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import { postResource } from "@/domain/iam/resource-loader";
import type { PostRepository } from "@/domain/posts/post.repository";
import { NotFoundError } from "@/shared/errors";

export class PublishPostUseCase {
  constructor(
    private readonly posts: PostRepository,
    private readonly contentPolicy: ContentPolicy,
  ) {}

  async execute(params: { actor: Actor; postId: string }) {
    requireContentScope(params.actor, "content:write");
    const post = await this.posts.findById(params.postId);
    if (!post) throw new NotFoundError("Post not found");

    await assertAllowed(
      this.contentPolicy.can({ actor: params.actor, permission: "post.publish", resource: postResource(post) }),
      "You cannot publish this post",
    );
    post.publish();
    await this.posts.save(post);
    return post;
  }
}

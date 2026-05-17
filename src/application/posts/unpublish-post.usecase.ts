import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import { PostPolicy } from "@/domain/posts/post.policy";
import type { PostRepository } from "@/domain/posts/post.repository";
import { NotFoundError } from "@/shared/errors";

export class UnpublishPostUseCase {
  constructor(
    private readonly posts: PostRepository,
    private readonly postPolicy: PostPolicy,
  ) {}

  async execute(params: { actor: Actor; postId: string }) {
    const post = await this.posts.findById(params.postId);
    if (!post) throw new NotFoundError("Post not found");

    await assertAllowed(this.postPolicy.canUnpublish(params.actor, post), "You cannot unpublish this post");
    post.unpublish();
    await this.posts.save(post);
    return post;
  }
}

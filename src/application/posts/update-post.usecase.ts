import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import { requireContentScope } from "@/domain/authz/scopes";
import type { UpdatePostProps } from "@/domain/posts/post.entity";
import { PostPolicy } from "@/domain/posts/post.policy";
import type { PostRepository } from "@/domain/posts/post.repository";
import { NotFoundError } from "@/shared/errors";

export class UpdatePostUseCase {
  constructor(
    private readonly posts: PostRepository,
    private readonly postPolicy: PostPolicy,
  ) {}

  async execute(params: {
    actor: Actor;
    postId: string;
    input: UpdatePostProps;
  }) {
    requireContentScope(params.actor, "content:write");
    const post = await this.posts.findById(params.postId);
    if (!post) throw new NotFoundError("Post not found");

    await assertAllowed(this.postPolicy.canUpdate(params.actor, post), "You cannot update this post");

    post.update(params.input);
    await this.posts.save(post);
    return post;
  }
}

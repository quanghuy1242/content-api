import { assertAllowed } from "@/domain/auth/assert-can";
import type { Actor } from "@/domain/auth/actor";
import { requireContentScope } from "@/domain/auth/scopes";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import { postResource } from "@/domain/iam/resource-loader";
import type { UpdatePostProps } from "@/domain/posts/post.entity";
import type { PostRepository } from "@/domain/posts/post.repository";
import { NotFoundError } from "@/shared/errors";

export class UpdatePostUseCase {
  constructor(
    private readonly posts: PostRepository,
    private readonly contentPolicy: ContentPolicy,
  ) {}

  async execute(params: {
    actor: Actor;
    postId: string;
    input: UpdatePostProps;
  }) {
    requireContentScope(params.actor, "content:write");
    const post = await this.posts.findById(params.postId);
    if (!post) throw new NotFoundError("Post not found");

    await assertAllowed(
      this.contentPolicy.can({ actor: params.actor, permission: "post.update", resource: postResource(post) }),
      "You cannot update this post",
    );

    post.update(params.input);
    await this.posts.save(post);
    return post;
  }
}

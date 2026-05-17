import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import type { RelationshipRepository } from "@/domain/authz/relationship.repository";
import { Post } from "@/domain/posts/post.entity";
import type { CreatePostProps } from "@/domain/posts/post.entity";
import { PostPolicy } from "@/domain/posts/post.policy";
import type { PostRepository } from "@/domain/posts/post.repository";
import { NotFoundError } from "@/shared/errors";
import { randomizedSlugFromTitle } from "@/shared/validation/fields";

export class CreatePostUseCase {
  constructor(
    private readonly posts: PostRepository,
    private readonly relationships: RelationshipRepository,
    private readonly postPolicy: PostPolicy,
  ) {}

  async execute(params: {
    actor: Actor;
    input: Omit<CreatePostProps, "id" | "slug" | "author" | "excerpt" | "coverImage" | "tags"> &
      Partial<Pick<CreatePostProps, "excerpt" | "coverImage" | "tags">>;
  }) {
    await assertAllowed(this.postPolicy.canCreate(params.actor), "Authentication required");
    if (params.actor.type !== "user" || !params.actor.localUserId) {
      throw new NotFoundError("Linked local user not found");
    }

    const authorId = params.actor.localUserId;
    const post = Post.create({
      id: crypto.randomUUID(),
      title: params.input.title,
      slug: randomizedSlugFromTitle(params.input.title),
      excerpt: params.input.excerpt ?? null,
      content: params.input.content,
      coverImage: params.input.coverImage ?? null,
      author: authorId,
      category: params.input.category,
      tags: params.input.tags ?? [],
    });

    await this.posts.create(post);
    await this.relationships.create({
      id: crypto.randomUUID(),
      subjectType: "user",
      subjectId: authorId,
      relation: "author",
      objectType: "post",
      objectId: post.id,
      createdAt: new Date(),
    });

    return post;
  }
}

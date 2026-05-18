import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import { createUserSubjectRelationship } from "@/domain/authz/relationship-policy";
import { Relationship } from "@/domain/authz/relationship.entity";
import type { RelationshipRepository } from "@/domain/authz/relationship.repository";
import type { IdempotencyRecord, IdempotencyRepository } from "@/domain/idempotency/idempotency.repository";
import { Post, type CreatePostProps, type PostProps } from "@/domain/posts/post.entity";
import type { PostCreateWorkflow } from "@/domain/posts/post-create.workflow";
import { PostPolicy } from "@/domain/posts/post.policy";
import type { PostRepository } from "@/domain/posts/post.repository";
import { ConflictError, IdempotencyReservationConflictError, NotFoundError } from "@/shared/errors";
import { HTTP_STATUS_CREATED, IDEMPOTENCY_TTL_MS, POSTS_CREATE_ROUTE } from "@/shared/constants";
import { sha256Hex } from "@/shared/idempotency";

export class CreatePostUseCase {
  constructor(
    private readonly posts: PostRepository,
    private readonly relationships: RelationshipRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly postCreateWorkflow: PostCreateWorkflow,
    private readonly postPolicy: PostPolicy,
  ) {}

  async execute(params: {
    actor: Actor;
    idempotencyKey?: string;
    input: Omit<CreatePostProps, "author" | "excerpt" | "coverImage" | "tags"> &
      Partial<Pick<CreatePostProps, "excerpt" | "coverImage" | "tags">>;
  }) {
    const authorId = await this.requireAuthorId(params.actor);
    const post = this.buildPost(authorId, params.input);
    const authorRelationship = this.buildAuthorRelationship(authorId, post.id);

    if (!params.idempotencyKey) {
      return this.executeWithoutIdempotency(post, authorRelationship);
    }

    return this.executeWithIdempotency({
      key: params.idempotencyKey,
      actorId: authorId,
      input: params.input,
      post,
      authorRelationship,
    });
  }

  private async requireAuthorId(actor: Actor) {
    await assertAllowed(this.postPolicy.canCreate(actor), "Authentication required");
    if (actor.type !== "user" || !actor.localUserId) {
      throw new NotFoundError("Linked local user not found");
    }

    return actor.localUserId;
  }

  private buildPost(
    authorId: string,
    input: Omit<CreatePostProps, "author" | "excerpt" | "coverImage" | "tags"> &
      Partial<Pick<CreatePostProps, "excerpt" | "coverImage" | "tags">>,
  ) {
    return Post.create({
      title: input.title,
      excerpt: input.excerpt ?? null,
      content: input.content,
      coverImage: input.coverImage ?? null,
      author: authorId,
      category: input.category,
      tags: input.tags ?? [],
    });
  }

  private buildAuthorRelationship(authorId: string, postId: string) {
    return createUserSubjectRelationship({
      subjectId: authorId,
      relation: "author",
      objectType: "post",
      objectId: postId,
    });
  }

  private async executeWithoutIdempotency(post: Post, authorRelationship: Relationship) {
    await this.posts.create(post);
    await this.relationships.create(authorRelationship);
    return post;
  }

  private async executeWithIdempotency(params: {
    key: string;
    actorId: string;
    input: Omit<CreatePostProps, "author" | "excerpt" | "coverImage" | "tags"> &
      Partial<Pick<CreatePostProps, "excerpt" | "coverImage" | "tags">>;
    post: Post;
    authorRelationship: Relationship;
  }) {
    const requestHash = await sha256Hex(params.input);
    const replay = await this.idempotency.findActive({
      key: params.key,
      actorId: params.actorId,
      route: POSTS_CREATE_ROUTE,
    });
    if (replay) {
      return this.replayExistingPost(replay, requestHash);
    }

    await this.idempotency.deleteExpired({
      key: params.key,
      actorId: params.actorId,
      route: POSTS_CREATE_ROUTE,
    });

    try {
      await this.postCreateWorkflow.createWithIdempotency({
        post: params.post,
        authorRelationship: params.authorRelationship,
        idempotency: {
          key: params.key,
          actorId: params.actorId,
          route: POSTS_CREATE_ROUTE,
          requestHash,
          responseJson: JSON.stringify(params.post.toSnapshot()),
          status: HTTP_STATUS_CREATED,
          expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        },
      });
      return params.post;
    } catch (error) {
      return this.handleIdempotentInsertConflict({
        error,
        key: params.key,
        actorId: params.actorId,
        requestHash,
      });
    }
  }

  private async handleIdempotentInsertConflict(params: {
    error: unknown;
    key: string;
    actorId: string;
    requestHash: string;
  }) {
    if (params.error instanceof IdempotencyReservationConflictError) {
      const replay = await this.idempotency.findActive({
        key: params.key,
        actorId: params.actorId,
        route: POSTS_CREATE_ROUTE,
      });
      if (replay) {
        return this.replayExistingPost(replay, params.requestHash);
      }
    }

    throw params.error;
  }

  private replayExistingPost(replay: IdempotencyRecord, requestHash: string) {
    if (replay.requestHash !== requestHash) {
      throw new ConflictError("Idempotency key reused with different request body");
    }
    if (!replay.responseJson) {
      throw new Error("Idempotency replay row is missing a cached response");
    }

    return Post.reconstitute(deserializePostSnapshot(replay.responseJson));
  }
}

function deserializePostSnapshot(value: string): PostProps {
  const snapshot = JSON.parse(value) as Omit<PostProps, "createdAt" | "updatedAt" | "publishedAt"> & {
    createdAt: string;
    updatedAt: string;
    publishedAt: string | null;
  };

  return {
    ...snapshot,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
    publishedAt: snapshot.publishedAt ? new Date(snapshot.publishedAt) : null,
  };
}

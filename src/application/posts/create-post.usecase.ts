import type { Actor, UserActor } from "@/domain/auth/actor";
import { requireContentScope } from "@/domain/auth/scopes";
import {
  createDirectOwnerBinding,
  createOwnerAssignedEvent,
  requireOwnedContentCreateContext,
} from "@/application/content-ownership";
import type { IdempotencyRecord, IdempotencyRepository } from "@/domain/idempotency/idempotency.repository";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import type { ContentRoleRepository } from "@/domain/iam/content-role.repository";
import { Post, type CreatePostProps, type PostProps } from "@/domain/posts/post.entity";
import type { PostCreateWorkflow } from "@/domain/posts/post-create.workflow";
import type { PostRepository } from "@/domain/posts/post.repository";
import { identityProjectionFromActor } from "@/domain/users/user-projection";
import type { UserRepository } from "@/domain/users/user.repository";
import { ConflictError, IdempotencyReservationConflictError } from "@/shared/errors";
import { HTTP_STATUS_CREATED, IDEMPOTENCY_TTL_MS, POSTS_CREATE_ROUTE } from "@/shared/constants";
import { sha256Hex } from "@/shared/idempotency";

export class CreatePostUseCase {
  constructor(
    private readonly posts: PostRepository,
    private readonly users: UserRepository,
    private readonly roles: ContentRoleRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly postCreateWorkflow: PostCreateWorkflow,
    private readonly contentPolicy: ContentPolicy,
  ) {}

  async execute(params: {
    actor: Actor;
    idempotencyKey?: string;
    input: Omit<CreatePostProps, "orgId" | "author" | "excerpt" | "coverImage" | "tags"> &
      Partial<Pick<CreatePostProps, "excerpt" | "coverImage" | "tags">>;
  }) {
    const { actor, orgId } = await this.requireCreateContext(params.actor);
    const authorId = actor.id;
    const post = this.buildPost(orgId, authorId, params.input);
    const ownerBinding = createDirectOwnerBinding({
      orgId,
      userId: authorId,
      roleId: "system:post.owner",
      resourceType: "post",
      resourceId: post.id,
    });
    const event = createOwnerAssignedEvent({
      orgId,
      userId: authorId,
      resourceType: "post",
      resourceId: post.id,
      snapshotJson: JSON.stringify({ post: post.toSnapshot(), ownerBinding: ownerBinding.toSnapshot() }),
    });

    if (!params.idempotencyKey) {
      await this.postCreateWorkflow.createWithOwner({ post, ownerBinding, event });
      return post;
    }

    return this.executeWithIdempotency({
      key: params.idempotencyKey,
      actorId: authorId,
      input: params.input,
      post,
      ownerBinding,
      event,
    });
  }

  private async requireCreateContext(actor: Actor) {
    requireContentScope(actor, "content:write");
    await this.roles.ensureSystemCatalog();
    const context = await requireOwnedContentCreateContext({
      actor,
      contentPolicy: this.contentPolicy,
      orgCreatePermission: "org.create_post",
    });
    await this.ensureAuthorProjection(context.actor);
    return context;
  }

  private async ensureAuthorProjection(actor: UserActor) {
    await this.users.ensureIdentityProjection(identityProjectionFromActor(actor));
  }

  private buildPost(
    orgId: string,
    authorId: string,
    input: Omit<CreatePostProps, "orgId" | "author" | "excerpt" | "coverImage" | "tags"> &
      Partial<Pick<CreatePostProps, "excerpt" | "coverImage" | "tags">>,
  ) {
    return Post.create({
      orgId,
      title: input.title,
      excerpt: input.excerpt ?? null,
      content: input.content,
      coverImage: input.coverImage ?? null,
      author: authorId,
      category: input.category,
      tags: input.tags ?? [],
    });
  }

  private async executeWithIdempotency(params: {
    key: string;
    actorId: string;
    input: Omit<CreatePostProps, "orgId" | "author" | "excerpt" | "coverImage" | "tags"> &
      Partial<Pick<CreatePostProps, "excerpt" | "coverImage" | "tags">>;
    post: Post;
    ownerBinding: Parameters<PostCreateWorkflow["createWithOwner"]>[0]["ownerBinding"];
    event: Parameters<PostCreateWorkflow["createWithOwner"]>[0]["event"];
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
        ownerBinding: params.ownerBinding,
        event: params.event,
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

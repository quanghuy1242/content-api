import type { Actor, UserActor } from "@/domain/auth/actor";
import { requireContentScope } from "@/domain/auth/scopes";
import {
  createDirectOwnerBinding,
  createOwnerAssignedEvent,
  requireOwnedContentCreateContext,
} from "@/application/content-ownership";
import type { CategoryCreateWorkflow } from "@/domain/categories/category-create.workflow";
import { Category, type CategoryProps } from "@/domain/categories/category.entity";
import type { CategoryRepository } from "@/domain/categories/category.repository";
import type { IdempotencyRecord, IdempotencyRepository } from "@/domain/idempotency/idempotency.repository";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import type { ContentRoleRepository } from "@/domain/iam/content-role.repository";
import { identityProjectionFromActor } from "@/domain/users/user-projection";
import type { UserRepository } from "@/domain/users/user.repository";
import { ConflictError, IdempotencyReservationConflictError } from "@/shared/errors";
import { CATEGORIES_CREATE_ROUTE, HTTP_STATUS_CREATED, IDEMPOTENCY_TTL_MS } from "@/shared/constants";
import { sha256Hex } from "@/shared/idempotency";

export class CreateCategoryUseCase {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly users: UserRepository,
    private readonly roles: ContentRoleRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly categoryCreateWorkflow: CategoryCreateWorkflow,
    private readonly contentPolicy: ContentPolicy,
  ) {}

  async execute(params: {
    actor: Actor;
    idempotencyKey?: string;
    input: Pick<CategoryProps, "name" | "description" | "image">;
  }) {
    const { actor, orgId } = await this.requireCreateContext(params.actor);
    const ownerId = actor.id;
    const category = this.buildCategory(orgId, ownerId, params.input);
    const ownerBinding = createDirectOwnerBinding({
      orgId,
      userId: ownerId,
      roleId: "system:category.owner",
      resourceType: "category",
      resourceId: category.id,
    });
    const event = createOwnerAssignedEvent({
      orgId,
      userId: ownerId,
      resourceType: "category",
      resourceId: category.id,
      snapshotJson: JSON.stringify({ category: category.toSnapshot(), ownerBinding: ownerBinding.toSnapshot() }),
    });

    if (!params.idempotencyKey) {
      await this.categoryCreateWorkflow.createWithOwner({ category, ownerBinding, event });
      return category;
    }

    return this.executeWithIdempotency({
      key: params.idempotencyKey,
      actorId: ownerId,
      input: params.input,
      category,
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
      orgCreatePermission: "org.create_category",
    });
    await this.ensureOwnerProjection(context.actor);
    return context;
  }

  private async ensureOwnerProjection(actor: UserActor) {
    await this.users.ensureIdentityProjection(identityProjectionFromActor(actor));
  }

  private buildCategory(orgId: string, ownerId: string, input: Pick<CategoryProps, "name" | "description" | "image">) {
    return Category.create({
      orgId,
      name: input.name,
      description: input.description,
      image: input.image,
      createdBy: ownerId,
    });
  }

  private async executeWithIdempotency(params: {
    key: string;
    actorId: string;
    input: Pick<CategoryProps, "name" | "description" | "image">;
    category: Category;
    ownerBinding: Parameters<CategoryCreateWorkflow["createWithOwner"]>[0]["ownerBinding"];
    event: Parameters<CategoryCreateWorkflow["createWithOwner"]>[0]["event"];
  }) {
    const requestHash = await sha256Hex(params.input);
    const replay = await this.idempotency.findActive({
      key: params.key,
      actorId: params.actorId,
      route: CATEGORIES_CREATE_ROUTE,
    });
    if (replay) {
      return this.replayExistingCategory(replay, requestHash);
    }

    await this.idempotency.deleteExpired({
      key: params.key,
      actorId: params.actorId,
      route: CATEGORIES_CREATE_ROUTE,
    });

    try {
      await this.categoryCreateWorkflow.createWithIdempotency({
        category: params.category,
        ownerBinding: params.ownerBinding,
        event: params.event,
        idempotency: {
          key: params.key,
          actorId: params.actorId,
          route: CATEGORIES_CREATE_ROUTE,
          requestHash,
          responseJson: JSON.stringify(params.category.toSnapshot()),
          status: HTTP_STATUS_CREATED,
          expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        },
      });
      return params.category;
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
        route: CATEGORIES_CREATE_ROUTE,
      });
      if (replay) {
        return this.replayExistingCategory(replay, params.requestHash);
      }
    }

    throw params.error;
  }

  private replayExistingCategory(replay: IdempotencyRecord, requestHash: string) {
    if (replay.requestHash !== requestHash) {
      throw new ConflictError("Idempotency key reused with different request body");
    }
    if (!replay.responseJson) {
      throw new Error("Idempotency replay row is missing a cached response");
    }

    return Category.reconstitute(deserializeCategorySnapshot(replay.responseJson));
  }
}

function deserializeCategorySnapshot(value: string): CategoryProps {
  const snapshot = JSON.parse(value) as Omit<CategoryProps, "createdAt" | "updatedAt"> & {
    createdAt: string;
    updatedAt: string;
  };

  return {
    ...snapshot,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
  };
}

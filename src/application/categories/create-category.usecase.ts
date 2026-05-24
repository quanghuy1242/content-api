import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor, UserActor } from "@/domain/authz/actor";
import { requireContentScope } from "@/domain/authz/scopes";
import { createUserSubjectRelationship } from "@/domain/authz/relationship-policy";
import { Relationship } from "@/domain/authz/relationship.entity";
import type { RelationshipRepository } from "@/domain/authz/relationship.repository";
import type { CategoryCreateWorkflow } from "@/domain/categories/category-create.workflow";
import { Category, type CategoryProps } from "@/domain/categories/category.entity";
import type { CategoryRepository } from "@/domain/categories/category.repository";
import { CategoryPolicy } from "@/domain/categories/category.policy";
import type { IdempotencyRecord, IdempotencyRepository } from "@/domain/idempotency/idempotency.repository";
import { identityProjectionFromActor } from "@/domain/users/user-projection";
import type { UserRepository } from "@/domain/users/user.repository";
import { ConflictError, IdempotencyReservationConflictError, NotFoundError } from "@/shared/errors";
import { CATEGORIES_CREATE_ROUTE, HTTP_STATUS_CREATED, IDEMPOTENCY_TTL_MS } from "@/shared/constants";
import { sha256Hex } from "@/shared/idempotency";

export class CreateCategoryUseCase {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly relationships: RelationshipRepository,
    private readonly users: UserRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly categoryCreateWorkflow: CategoryCreateWorkflow,
    private readonly categoryPolicy: CategoryPolicy,
  ) {}

  async execute(params: {
    actor: Actor;
    idempotencyKey?: string;
    input: Pick<CategoryProps, "name" | "description" | "image">;
  }) {
    const ownerId = await this.requireOwnerId(params.actor);
    const category = this.buildCategory(ownerId, params.input);
    const ownerRelationship = this.buildOwnerRelationship(ownerId, category.id);

    if (!params.idempotencyKey) {
      return this.executeWithoutIdempotency(category, ownerRelationship);
    }

    return this.executeWithIdempotency({
      key: params.idempotencyKey,
      actorId: ownerId,
      input: params.input,
      category,
      ownerRelationship,
    });
  }

  private async requireOwnerId(actor: Actor) {
    requireContentScope(actor, "content:write");
    await assertAllowed(this.categoryPolicy.canCreate(actor), "Authentication required");
    if (actor.type !== "user") {
      throw new NotFoundError("Linked local user not found");
    }

    await this.ensureOwnerProjection(actor);
    return actor.id;
  }

  private async ensureOwnerProjection(actor: UserActor) {
    await this.users.ensureIdentityProjection(identityProjectionFromActor(actor));
  }

  private buildCategory(ownerId: string, input: Pick<CategoryProps, "name" | "description" | "image">) {
    return Category.create({
      name: input.name,
      description: input.description,
      image: input.image,
      createdBy: ownerId,
    });
  }

  private buildOwnerRelationship(ownerId: string, categoryId: string) {
    return createUserSubjectRelationship({
      subjectId: ownerId,
      relation: "owner",
      objectType: "category",
      objectId: categoryId,
    });
  }

  private async executeWithoutIdempotency(category: Category, ownerRelationship: Relationship) {
    const created = await this.categories.create(category);
    await this.relationships.create(ownerRelationship);
    return created;
  }

  private async executeWithIdempotency(params: {
    key: string;
    actorId: string;
    input: Pick<CategoryProps, "name" | "description" | "image">;
    category: Category;
    ownerRelationship: Relationship;
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
        ownerRelationship: params.ownerRelationship,
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

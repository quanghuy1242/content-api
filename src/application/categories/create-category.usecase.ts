import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import type { Relationship } from "@/domain/authz/relationship.entity";
import type { RelationshipRepository } from "@/domain/authz/relationship.repository";
import type { CategoryCreateWorkflow } from "@/domain/categories/category-create.workflow";
import type { Category } from "@/domain/categories/category.entity";
import type { CategoryRepository } from "@/domain/categories/category.repository";
import { CategoryPolicy } from "@/domain/categories/category.policy";
import type { IdempotencyRecord, IdempotencyRepository } from "@/domain/idempotency/idempotency.repository";
import { ConflictError, IdempotencyReservationConflictError, NotFoundError } from "@/shared/errors";
import { sha256Hex } from "@/shared/idempotency";
import { slugify } from "@/shared/validation/fields";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const CATEGORIES_CREATE_ROUTE = "POST /categories" as const;

export class CreateCategoryUseCase {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly relationships: RelationshipRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly categoryCreateWorkflow: CategoryCreateWorkflow,
    private readonly categoryPolicy: CategoryPolicy,
  ) {}

  async execute(params: {
    actor: Actor;
    idempotencyKey?: string;
    input: Omit<Category, "id" | "slug" | "createdBy" | "createdAt" | "updatedAt">;
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
    await assertAllowed(this.categoryPolicy.canCreate(actor), "Authentication required");
    const ownerId = actor.type === "user" ? actor.localUserId : null;
    if (!ownerId) {
      throw new NotFoundError("Linked local user not found");
    }

    return ownerId;
  }

  private buildCategory(ownerId: string, input: Omit<Category, "id" | "slug" | "createdBy" | "createdAt" | "updatedAt">) {
    const now = new Date();
    return {
      id: crypto.randomUUID(),
      name: input.name,
      slug: slugify(input.name),
      description: input.description,
      image: input.image,
      createdBy: ownerId,
      createdAt: now,
      updatedAt: now,
    } satisfies Category;
  }

  private buildOwnerRelationship(ownerId: string, categoryId: string) {
    return createRelationship({
      subjectId: ownerId,
      relation: "owner",
      objectType: "category",
      objectId: categoryId,
    });
  }

  private async executeWithoutIdempotency(category: Category, ownerRelationship: Relationship) {
    const created = await this.categories.create({
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      image: category.image,
      createdBy: category.createdBy,
    });
    await this.relationships.create(ownerRelationship);
    return created;
  }

  private async executeWithIdempotency(params: {
    key: string;
    actorId: string;
    input: Omit<Category, "id" | "slug" | "createdBy" | "createdAt" | "updatedAt">;
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
          responseJson: JSON.stringify(params.category),
          status: 201,
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

    return deserializeCategory(replay.responseJson);
  }
}

function createRelationship(params: {
  subjectId: string;
  relation: string;
  objectType: string;
  objectId: string;
}): Relationship {
  return {
    id: crypto.randomUUID(),
    subjectType: "user",
    subjectId: params.subjectId,
    relation: params.relation,
    objectType: params.objectType,
    objectId: params.objectId,
    createdAt: new Date(),
  };
}

function deserializeCategory(value: string): Category {
  const snapshot = JSON.parse(value) as Omit<Category, "createdAt" | "updatedAt"> & {
    createdAt: string;
    updatedAt: string;
  };

  return {
    ...snapshot,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
  };
}

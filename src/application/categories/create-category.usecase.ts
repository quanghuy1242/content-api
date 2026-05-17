import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import type { RelationshipRepository } from "@/domain/authz/relationship.repository";
import type { Category } from "@/domain/categories/category.entity";
import type { CategoryRepository } from "@/domain/categories/category.repository";
import { CategoryPolicy } from "@/domain/categories/category.policy";
import { NotFoundError } from "@/shared/errors";
import { slugify } from "@/shared/validation/fields";

export class CreateCategoryUseCase {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly relationships: RelationshipRepository,
    private readonly categoryPolicy: CategoryPolicy,
  ) {}

  async execute(params: {
    actor: Actor;
    input: Omit<Category, "id" | "slug" | "createdBy" | "createdAt" | "updatedAt">;
  }) {
    await assertAllowed(this.categoryPolicy.canCreate(params.actor), "Authentication required");

    const ownerId = params.actor.type === "user" ? params.actor.localUserId : null;
    if (!ownerId) {
      throw new NotFoundError("Linked local user not found");
    }

    const category = await this.categories.create({
      id: crypto.randomUUID(),
      name: params.input.name,
      slug: slugify(params.input.name),
      description: params.input.description,
      image: params.input.image,
      createdBy: ownerId,
    });

    await this.relationships.create({
      id: crypto.randomUUID(),
      subjectType: "user",
      subjectId: ownerId,
      relation: "owner",
      objectType: "category",
      objectId: category.id,
      createdAt: new Date(),
    });

    return category;
  }
}


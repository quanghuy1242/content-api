import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import type { Category } from "@/domain/categories/category.entity";
import type { CategoryRepository } from "@/domain/categories/category.repository";
import { CategoryPolicy } from "@/domain/categories/category.policy";
import { NotFoundError } from "@/shared/errors";

export class UpdateCategoryUseCase {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly categoryPolicy: CategoryPolicy,
  ) {}

  async execute(params: {
    actor: Actor;
    categoryId: string;
    input: Partial<Pick<Category, "name" | "description" | "image">>;
  }) {
    const category = await this.categories.findById(params.categoryId);
    if (!category) {
      throw new NotFoundError("Category not found");
    }

    await assertAllowed(
      this.categoryPolicy.canUpdate(params.actor, params.categoryId),
      "You cannot update this category",
    );

    const updated = await this.categories.update(params.categoryId, params.input);
    if (!updated) {
      throw new NotFoundError("Category not found");
    }

    return updated;
  }
}


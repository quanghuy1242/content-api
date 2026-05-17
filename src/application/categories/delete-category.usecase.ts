import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import type { CategoryRepository } from "@/domain/categories/category.repository";
import { CategoryPolicy } from "@/domain/categories/category.policy";
import { NotFoundError } from "@/shared/errors";

export class DeleteCategoryUseCase {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly categoryPolicy: CategoryPolicy,
  ) {}

  async execute(params: { actor: Actor; categoryId: string }) {
    const category = await this.categories.findById(params.categoryId);
    if (!category) {
      throw new NotFoundError("Category not found");
    }

    await assertAllowed(
      this.categoryPolicy.canDelete(params.actor, params.categoryId),
      "You cannot delete this category",
    );

    const deleted = await this.categories.delete(params.categoryId);
    if (!deleted) {
      throw new NotFoundError("Category not found");
    }
  }
}


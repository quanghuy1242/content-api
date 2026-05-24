import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import { requireContentScope } from "@/domain/authz/scopes";
import type { UpdateCategoryProps } from "@/domain/categories/category.entity";
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
    input: UpdateCategoryProps;
  }) {
    requireContentScope(params.actor, "content:write");
    const category = await this.categories.findById(params.categoryId);
    if (!category) {
      throw new NotFoundError("Category not found");
    }

    await assertAllowed(
      this.categoryPolicy.canUpdate(params.actor, params.categoryId),
      "You cannot update this category",
    );

    category.update(params.input);
    await this.categories.save(category);

    return category;
  }
}

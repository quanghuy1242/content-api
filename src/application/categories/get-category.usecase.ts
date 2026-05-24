import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import { requireContentScope } from "@/domain/authz/scopes";
import type { CategoryRepository } from "@/domain/categories/category.repository";
import { CategoryPolicy } from "@/domain/categories/category.policy";
import { NotFoundError } from "@/shared/errors";

export class GetCategoryUseCase {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly categoryPolicy: CategoryPolicy,
  ) {}

  async execute(params: { actor: Actor | null; categoryId: string }) {
    if (params.actor) requireContentScope(params.actor, "content:read");
    await assertAllowed(this.categoryPolicy.canRead(params.actor), "Authentication required");

    const category = await this.categories.findById(params.categoryId);
    if (!category) {
      throw new NotFoundError("Category not found");
    }

    return category;
  }
}

import { assertAllowed } from "@/domain/auth/assert-can";
import type { Actor } from "@/domain/auth/actor";
import { requireContentScope } from "@/domain/auth/scopes";
import type { CategoryRepository } from "@/domain/categories/category.repository";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import { categoryResource } from "@/domain/iam/resource-loader";
import { NotFoundError } from "@/shared/errors";

export class DeleteCategoryUseCase {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly contentPolicy: ContentPolicy,
  ) {}

  async execute(params: { actor: Actor; categoryId: string }) {
    requireContentScope(params.actor, "content:write");
    const category = await this.categories.findById(params.categoryId);
    if (!category) {
      throw new NotFoundError("Category not found");
    }

    await assertAllowed(
      this.contentPolicy.can({ actor: params.actor, permission: "category.delete", resource: categoryResource(category) }),
      "You cannot delete this category",
    );

    const deleted = await this.categories.delete(params.categoryId);
    if (!deleted) {
      throw new NotFoundError("Category not found");
    }
  }
}

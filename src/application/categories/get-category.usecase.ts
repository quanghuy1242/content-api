import { assertAllowed } from "@/domain/auth/assert-can";
import type { Actor } from "@/domain/auth/actor";
import { actorWithReadScope } from "@/domain/auth/scopes";
import type { CategoryRepository } from "@/domain/categories/category.repository";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import { categoryResource } from "@/domain/iam/resource-loader";
import { NotFoundError } from "@/shared/errors";

export class GetCategoryUseCase {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly contentPolicy: ContentPolicy,
  ) {}

  async execute(params: { actor: Actor | null; categoryId: string }) {
    const category = await this.categories.findById(params.categoryId);
    if (!category) {
      throw new NotFoundError("Category not found");
    }

    await assertAllowed(
      this.contentPolicy.can({ actor: actorWithReadScope(params.actor), permission: "category.read", resource: categoryResource(category) }),
      "Authentication required",
    );

    return category;
  }
}

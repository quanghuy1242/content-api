import { assertAllowed } from "@/domain/auth/assert-can";
import type { Actor } from "@/domain/auth/actor";
import { requireContentScope } from "@/domain/auth/scopes";
import type { UpdateCategoryProps } from "@/domain/categories/category.entity";
import type { CategoryRepository } from "@/domain/categories/category.repository";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import { categoryResource } from "@/domain/iam/resource-loader";
import { NotFoundError } from "@/shared/errors";

export class UpdateCategoryUseCase {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly contentPolicy: ContentPolicy,
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
      this.contentPolicy.can({ actor: params.actor, permission: "category.update", resource: categoryResource(category) }),
      "You cannot update this category",
    );

    category.update(params.input);
    await this.categories.save(category);

    return category;
  }
}

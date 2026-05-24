import type { Actor } from "@/domain/auth/actor";
import { actorWithReadScope } from "@/domain/auth/scopes";
import type { CategoryRepository } from "@/domain/categories/category.repository";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import { categoryResource } from "@/domain/iam/resource-loader";

export class ListCategoriesUseCase {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly contentPolicy: ContentPolicy,
  ) {}

  async execute(params: { actor: Actor | null; limit: number; cursor?: string }) {
    const actor = actorWithReadScope(params.actor);
    const result = await this.categories.findMany({ limit: params.limit, cursor: params.cursor });
    const decisions = await this.contentPolicy.canMany({
      actor,
      permission: "category.read",
      resources: result.data.map(categoryResource),
    });
    return {
      data: result.data.filter((category) => decisions.get(category.id) === true),
      page: result.page,
    };
  }
}

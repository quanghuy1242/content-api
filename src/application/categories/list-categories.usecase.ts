import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import { requireContentScope } from "@/domain/authz/scopes";
import type { CategoryRepository } from "@/domain/categories/category.repository";
import { CategoryPolicy } from "@/domain/categories/category.policy";

export class ListCategoriesUseCase {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly categoryPolicy: CategoryPolicy,
  ) {}

  async execute(params: { actor: Actor | null; limit: number; cursor?: string }) {
    if (params.actor) requireContentScope(params.actor, "content:read");
    await assertAllowed(this.categoryPolicy.canRead(params.actor), "Authentication required");
    return this.categories.findMany({ limit: params.limit, cursor: params.cursor });
  }
}

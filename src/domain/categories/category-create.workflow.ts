import type { Relationship } from "@/domain/authz/relationship.entity";
import type { Category } from "@/domain/categories/category.entity";
import type { IdempotencyRoute } from "@/domain/idempotency/idempotency.repository";

export interface CategoryCreateWorkflow {
  createWithIdempotency(params: {
    category: Category;
    ownerRelationship: Relationship;
    idempotency: {
      key: string;
      actorId: string;
      route: Extract<IdempotencyRoute, "POST /categories">;
      requestHash: string;
      responseJson: string;
      status: 201;
      expiresAt: Date;
    };
  }): Promise<void>;
}

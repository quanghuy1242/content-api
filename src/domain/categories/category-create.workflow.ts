import type { Category } from "@/domain/categories/category.entity";
import type { IdempotencyRoute } from "@/domain/idempotency/idempotency.repository";
import type { PolicyBinding } from "@/domain/iam/policy-binding.entity";
import type { PolicyEvent } from "@/domain/iam/policy-event.entity";

export interface CategoryCreateWorkflow {
  createWithOwner(params: {
    category: Category;
    ownerBinding: PolicyBinding;
    event: PolicyEvent;
  }): Promise<void>;

  createWithIdempotency(params: {
    category: Category;
    ownerBinding: PolicyBinding;
    event: PolicyEvent;
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

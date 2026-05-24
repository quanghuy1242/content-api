import type { Category } from "@/domain/categories/category.entity";
import type { IdempotencyRoute } from "@/domain/idempotency/idempotency.repository";

/**
 * Atomic category creation workflow.
 *
 * Categories are org-owned resources — no per-category IAM binding is created here.
 * Access is governed entirely by org-level roles (system:org.author, system:org.content_admin).
 * The `createdBy` field on the category is an audit trail, not an ownership claim.
 * See docs/012 for the full decision rationale.
 */
export interface CategoryCreateWorkflow {
  create(params: {
    category: Category;
  }): Promise<void>;

  createWithIdempotency(params: {
    category: Category;
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

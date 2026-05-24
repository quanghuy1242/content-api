import type { Book } from "@/domain/books/book.entity";
import type { IdempotencyRecord, IdempotencyRoute } from "@/domain/idempotency/idempotency.repository";
import type { PolicyBinding } from "@/domain/iam/policy-binding.entity";
import type { PolicyEvent } from "@/domain/iam/policy-event.entity";

export interface BookCreateWorkflow {
  createWithOwner(params: {
    book: Book;
    ownerBinding: PolicyBinding;
    event: PolicyEvent;
    idempotency: Omit<IdempotencyRecord, "route" | "responseJson"> & {
      route: Extract<IdempotencyRoute, "POST /organizations/{orgId}/books">;
      responseJson: string;
    };
  }): Promise<void>;
}

import type { IdempotencyRoute } from "@/domain/idempotency/idempotency.repository";
import type { PolicyBinding } from "@/domain/iam/policy-binding.entity";
import type { PolicyEvent } from "@/domain/iam/policy-event.entity";
import type { Media } from "@/domain/media/media.entity";

export interface MediaCreateWorkflow {
  createWithOwner(params: {
    media: Media;
    ownerBinding: PolicyBinding;
    event: PolicyEvent;
  }): Promise<void>;

  createWithIdempotency(params: {
    media: Media;
    ownerBinding: PolicyBinding;
    event: PolicyEvent;
    idempotency: {
      key: string;
      actorId: string;
      route: Extract<IdempotencyRoute, "POST /media">;
      requestHash: string;
      responseJson: string;
      status: 201;
      expiresAt: Date;
    };
  }): Promise<void>;
}

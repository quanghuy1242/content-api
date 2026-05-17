import type { Relationship } from "@/domain/authz/relationship.entity";
import type { IdempotencyRoute } from "@/domain/idempotency/idempotency.repository";
import type { Media } from "@/domain/media/media.entity";

export interface MediaCreateWorkflow {
  createWithIdempotency(params: {
    media: Media;
    ownerRelationship: Relationship;
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

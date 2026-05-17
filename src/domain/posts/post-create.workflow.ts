import type { Relationship } from "@/domain/authz/relationship.entity";
import type { IdempotencyRoute } from "@/domain/idempotency/idempotency.repository";
import type { Post } from "@/domain/posts/post.entity";

export interface PostCreateWorkflow {
  createWithIdempotency(params: {
    post: Post;
    authorRelationship: Relationship;
    idempotency: {
      key: string;
      actorId: string;
      route: Extract<IdempotencyRoute, "POST /posts">;
      requestHash: string;
      responseJson: string;
      status: 201;
      expiresAt: Date;
    };
  }): Promise<void>;
}

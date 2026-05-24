import type { IdempotencyRoute } from "@/domain/idempotency/idempotency.repository";
import type { PolicyBinding } from "@/domain/iam/policy-binding.entity";
import type { PolicyEvent } from "@/domain/iam/policy-event.entity";
import type { Post } from "@/domain/posts/post.entity";

export interface PostCreateWorkflow {
  createWithOwner(params: {
    post: Post;
    ownerBinding: PolicyBinding;
    event: PolicyEvent;
  }): Promise<void>;

  createWithIdempotency(params: {
    post: Post;
    ownerBinding: PolicyBinding;
    event: PolicyEvent;
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

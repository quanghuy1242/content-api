import type { IdempotencyRoute } from "@/domain/idempotency/idempotency.repository";
import type { User } from "@/domain/users/user.entity";

export interface UserCreateWorkflow {
  createWithIdempotency(params: {
    user: User;
    idempotency: {
      key: string;
      actorId: string;
      route: Extract<IdempotencyRoute, "POST /users">;
      requestHash: string;
      responseJson: string;
      status: 201;
      expiresAt: Date;
    };
  }): Promise<void>;
}

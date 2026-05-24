import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import { requireContentScope } from "@/domain/authz/scopes";
import { identityProjectionFromActor } from "@/domain/users/user-projection";
import type { UserRepository } from "@/domain/users/user.repository";
import { UserPolicy } from "@/domain/users/user.policy";
import { NotFoundError } from "@/shared/errors";

export class GetUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly userPolicy: UserPolicy,
  ) {}

  async execute(params: { actor: Actor | null; userId: string }) {
    if (params.actor) requireContentScope(params.actor, "content:read");
    await assertAllowed(this.userPolicy.canRead(params.actor), "Authentication required");
    if (params.actor?.type === "user" && params.actor.subject === params.userId) {
      await this.users.ensureIdentityProjection(identityProjectionFromActor(params.actor));
    }

    const user = await this.users.findById(params.userId);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    return user;
  }
}

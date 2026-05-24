import { assertAllowed } from "@/domain/auth/assert-can";
import type { Actor } from "@/domain/auth/actor";
import { requireContentScope } from "@/domain/auth/scopes";
import type { UserRepository } from "@/domain/users/user.repository";
import { UserPolicy } from "@/domain/users/user.policy";
import { NotFoundError } from "@/shared/errors";

export class DeleteUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly userPolicy: UserPolicy,
  ) {}

  async execute(params: { actor: Actor; userId: string }) {
    requireContentScope(params.actor, "content:write");
    await assertAllowed(this.userPolicy.canDelete(params.actor), "Only admins can delete users");

    const deleted = await this.users.delete(params.userId);
    if (!deleted) {
      throw new NotFoundError("User not found");
    }
  }
}

import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import type { User } from "@/domain/users/user.entity";
import type { UserRepository } from "@/domain/users/user.repository";
import { UserPolicy } from "@/domain/users/user.policy";
import { NotFoundError } from "@/shared/errors";

export class UpdateUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly userPolicy: UserPolicy,
  ) {}

  async execute(params: {
    actor: Actor;
    userId: string;
    input: Partial<Omit<User, "id" | "createdAt" | "updatedAt" | "betterAuthUserId">>;
  }) {
    const user = await this.users.findById(params.userId);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    await assertAllowed(this.userPolicy.canUpdate(params.actor, user), "You cannot update this user");

    const updated = await this.users.update(params.userId, params.input);
    if (!updated) {
      throw new NotFoundError("User not found");
    }

    return updated;
  }
}


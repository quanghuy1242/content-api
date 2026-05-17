import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import type { UserRepository } from "@/domain/users/user.repository";
import { UserPolicy } from "@/domain/users/user.policy";
import { NotFoundError } from "@/shared/errors";

export class GetUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly userPolicy: UserPolicy,
  ) {}

  async execute(params: { actor: Actor | null; userId: string }) {
    await assertAllowed(this.userPolicy.canRead(params.actor), "Authentication required");

    const user = await this.users.findById(params.userId);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    return user;
  }
}


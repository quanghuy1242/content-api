import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import { requireContentScope } from "@/domain/authz/scopes";
import type { UpdateUserProps } from "@/domain/users/user.entity";
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
    input: UpdateUserProps;
  }) {
    requireContentScope(params.actor, "content:write");
    const user = await this.users.findById(params.userId);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    await assertAllowed(this.userPolicy.canUpdate(params.actor, user), "You cannot update this user");

    user.update(params.input);
    await this.users.save(user);

    return user;
  }
}

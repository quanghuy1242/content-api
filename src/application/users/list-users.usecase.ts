import { assertAllowed } from "@/domain/auth/assert-can";
import type { Actor } from "@/domain/auth/actor";
import { requireContentScope } from "@/domain/auth/scopes";
import type { UserRepository } from "@/domain/users/user.repository";
import { UserPolicy } from "@/domain/users/user.policy";

export class ListUsersUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly userPolicy: UserPolicy,
  ) {}

  async execute(params: { actor: Actor | null; limit: number; cursor?: string }) {
    if (params.actor) requireContentScope(params.actor, "content:read");
    await assertAllowed(this.userPolicy.canRead(params.actor), "Authentication required");
    return this.users.findMany({ limit: params.limit, cursor: params.cursor });
  }
}

import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import type { User } from "@/domain/users/user.entity";
import type { UserRepository } from "@/domain/users/user.repository";
import { UserPolicy } from "@/domain/users/user.policy";
import { ConflictError } from "@/shared/errors";

export class CreateUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly userPolicy: UserPolicy,
  ) {}

  async execute(params: { actor: Actor; input: Omit<User, "id" | "createdAt" | "updatedAt"> }) {
    await assertAllowed(this.userPolicy.canCreate(params.actor), "Only admins can create users");

    const existing = await this.users.findByEmail(params.input.email);
    if (existing) {
      throw new ConflictError("User email already exists");
    }

    return this.users.create({ ...params.input, id: crypto.randomUUID() });
  }
}


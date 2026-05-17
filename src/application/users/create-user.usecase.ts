import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import type { IdempotencyRecord, IdempotencyRepository } from "@/domain/idempotency/idempotency.repository";
import type { User } from "@/domain/users/user.entity";
import type { UserCreateWorkflow } from "@/domain/users/user-create.workflow";
import type { UserRepository } from "@/domain/users/user.repository";
import { UserPolicy } from "@/domain/users/user.policy";
import { ConflictError, IdempotencyReservationConflictError } from "@/shared/errors";
import { sha256Hex } from "@/shared/idempotency";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const USERS_CREATE_ROUTE = "POST /users" as const;

export class CreateUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly userCreateWorkflow: UserCreateWorkflow,
    private readonly userPolicy: UserPolicy,
  ) {}

  async execute(params: { actor: Actor; idempotencyKey?: string; input: Omit<User, "id" | "createdAt" | "updatedAt"> }) {
    const actorId = await this.requireActorId(params.actor);

    if (!params.idempotencyKey) {
      return this.executeWithoutIdempotency(params.input);
    }

    return this.executeWithIdempotency({
      key: params.idempotencyKey,
      actorId,
      input: params.input,
    });
  }

  private async requireActorId(actor: Actor) {
    await assertAllowed(this.userPolicy.canCreate(actor), "Only admins can create users");
    return actor.type === "user" ? actor.localUserId ?? actor.id : actor.id;
  }

  private async assertEmailAvailable(email: string) {
    const existing = await this.users.findByEmail(email);
    if (existing) {
      throw new ConflictError("User email already exists");
    }
  }

  private buildUser(input: Omit<User, "id" | "createdAt" | "updatedAt">): User {
    const now = new Date();
    return {
      ...input,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
  }

  private async executeWithoutIdempotency(input: Omit<User, "id" | "createdAt" | "updatedAt">) {
    await this.assertEmailAvailable(input.email);
    const user = this.buildUser(input);
    return this.users.create({
      email: user.email,
      fullName: user.fullName,
      avatar: user.avatar,
      bio: user.bio,
      role: user.role,
      betterAuthUserId: user.betterAuthUserId,
      id: user.id,
    });
  }

  private async executeWithIdempotency(params: {
    key: string;
    actorId: string;
    input: Omit<User, "id" | "createdAt" | "updatedAt">;
  }) {
    const requestHash = await sha256Hex(params.input);
    const replay = await this.idempotency.findActive({
      key: params.key,
      actorId: params.actorId,
      route: USERS_CREATE_ROUTE,
    });
    if (replay) {
      return this.replayExistingUser(replay, requestHash);
    }

    await this.idempotency.deleteExpired({
      key: params.key,
      actorId: params.actorId,
      route: USERS_CREATE_ROUTE,
    });

    await this.assertEmailAvailable(params.input.email);
    const user = this.buildUser(params.input);

    try {
      await this.userCreateWorkflow.createWithIdempotency({
        user,
        idempotency: {
          key: params.key,
          actorId: params.actorId,
          route: USERS_CREATE_ROUTE,
          requestHash,
          responseJson: JSON.stringify(user),
          status: 201,
          expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        },
      });
      return user;
    } catch (error) {
      return this.handleIdempotentInsertConflict({
        error,
        key: params.key,
        actorId: params.actorId,
        requestHash,
      });
    }
  }

  private async handleIdempotentInsertConflict(params: {
    error: unknown;
    key: string;
    actorId: string;
    requestHash: string;
  }) {
    if (params.error instanceof IdempotencyReservationConflictError) {
      const replay = await this.idempotency.findActive({
        key: params.key,
        actorId: params.actorId,
        route: USERS_CREATE_ROUTE,
      });
      if (replay) {
        return this.replayExistingUser(replay, params.requestHash);
      }
    }

    throw params.error;
  }

  private replayExistingUser(replay: IdempotencyRecord, requestHash: string) {
    if (replay.requestHash !== requestHash) {
      throw new ConflictError("Idempotency key reused with different request body");
    }
    if (!replay.responseJson) {
      throw new Error("Idempotency replay row is missing a cached response");
    }

    return deserializeUser(replay.responseJson);
  }
}

function deserializeUser(value: string): User {
  const snapshot = JSON.parse(value) as Omit<User, "createdAt" | "updatedAt"> & {
    createdAt: string;
    updatedAt: string;
  };

  return {
    ...snapshot,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
  };
}

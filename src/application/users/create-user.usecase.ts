import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import type { IdempotencyRecord, IdempotencyRepository } from "@/domain/idempotency/idempotency.repository";
import { User, type CreateUserProps, type UserProps } from "@/domain/users/user.entity";
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

  async execute(params: { actor: Actor; idempotencyKey?: string; input: CreateUserProps }) {
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

  private buildUser(input: CreateUserProps): User {
    return User.create(input);
  }

  private async executeWithoutIdempotency(input: CreateUserProps) {
    await this.assertEmailAvailable(input.email);
    const user = this.buildUser(input);
    return this.users.create(user);
  }

  private async executeWithIdempotency(params: {
    key: string;
    actorId: string;
    input: CreateUserProps;
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
          responseJson: JSON.stringify(user.toSnapshot()),
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

    return User.reconstitute(deserializeUserSnapshot(replay.responseJson));
  }
}

function deserializeUserSnapshot(value: string): UserProps {
  const snapshot = JSON.parse(value) as Omit<UserProps, "createdAt" | "updatedAt"> & {
    createdAt: string;
    updatedAt: string;
  };

  return {
    ...snapshot,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
  };
}

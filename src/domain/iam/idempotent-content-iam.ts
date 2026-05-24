import type { Actor } from "@/domain/auth/actor";
import type { IdempotencyRecord, IdempotencyRepository, IdempotencyRoute } from "@/domain/idempotency/idempotency.repository";
import { ConflictError, IdempotencyReservationConflictError, ValidationError } from "@/shared/errors";
import { HTTP_STATUS_CREATED, IDEMPOTENCY_TTL_MS } from "@/shared/constants";
import { sha256Hex } from "@/shared/idempotency";

export type IdempotentMutationCommit = {
  requestHash: string;
  idempotency: Omit<IdempotencyRecord, "responseJson"> & { responseJson: string };
};

export async function executeIdempotentContentIamMutation<TResult>(params: {
  idempotency: IdempotencyRepository;
  key: string;
  actor: Actor;
  route: IdempotencyRoute;
  input: unknown;
  responseJson: () => string;
  replay: (responseJson: string) => TResult;
  commit: (params: IdempotentMutationCommit) => Promise<TResult>;
}) {
  const actorId = idempotencyActorId(params.actor);
  const requestHash = await sha256Hex(params.input);
  const replay = await params.idempotency.findActive({ key: params.key, actorId, route: params.route });
  if (replay) {
    return replayContentIamMutation(replay, requestHash, params.replay);
  }

  await params.idempotency.deleteExpired({ key: params.key, actorId, route: params.route });

  try {
    return await params.commit({
      requestHash,
      idempotency: {
        key: params.key,
        actorId,
        route: params.route,
        requestHash,
        responseJson: params.responseJson(),
        status: HTTP_STATUS_CREATED,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      },
    });
  } catch (error) {
    if (error instanceof IdempotencyReservationConflictError) {
      const current = await params.idempotency.findActive({ key: params.key, actorId, route: params.route });
      if (current) return replayContentIamMutation(current, requestHash, params.replay);
    }
    throw error;
  }
}

export function requireIdempotencyKey(key: string | undefined): string {
  if (!key) throw new ValidationError("Idempotency-Key is required for Content IAM mutations");
  return key;
}

export function idempotencyActorId(actor: Actor): string {
  switch (actor.type) {
    case "user":
      return actor.subject;
    case "service_account":
      return actor.clientId;
    case "system":
      return actor.id;
  }
}

function replayContentIamMutation<TResult>(
  replay: IdempotencyRecord,
  requestHash: string,
  deserialize: (responseJson: string) => TResult,
) {
  if (replay.requestHash !== requestHash) {
    throw new ConflictError("Idempotency key reused with different request body");
  }
  if (!replay.responseJson) {
    throw new Error("Idempotency replay row is missing a cached response");
  }
  return deserialize(replay.responseJson);
}

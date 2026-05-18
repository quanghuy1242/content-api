import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import { Relationship } from "@/domain/authz/relationship.entity";
import type { RelationshipRepository } from "@/domain/authz/relationship.repository";
import type { IdempotencyRecord, IdempotencyRepository } from "@/domain/idempotency/idempotency.repository";
import { Media } from "@/domain/media/media.entity";
import type { CreateMediaProps, MediaProps } from "@/domain/media/media.entity";
import type { MediaCreateWorkflow } from "@/domain/media/media-create.workflow";
import type { MediaRepository } from "@/domain/media/media.repository";
import { MediaPolicy } from "@/domain/media/media.policy";
import { ConflictError, IdempotencyReservationConflictError, NotFoundError } from "@/shared/errors";
import { HTTP_STATUS_CREATED, IDEMPOTENCY_TTL_MS, MEDIA_CREATE_ROUTE } from "@/shared/constants";
import { sha256Hex } from "@/shared/idempotency";

export type CreateMediaInput = Pick<CreateMediaProps, "alt" | "filename"> &
  Partial<Omit<CreateMediaProps, "owner" | "alt" | "filename">>;

export class CreateMediaUseCase {
  constructor(
    private readonly mediaRepository: MediaRepository,
    private readonly relationships: RelationshipRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly mediaCreateWorkflow: MediaCreateWorkflow,
    private readonly mediaPolicy: MediaPolicy,
  ) {}

  async execute(params: { actor: Actor; idempotencyKey?: string; input: CreateMediaInput }) {
    const ownerId = await this.requireOwnerId(params.actor);
    const media = this.buildMedia(ownerId, params.input);
    const ownerRelationship = this.buildOwnerRelationship(ownerId, media.id);

    if (!params.idempotencyKey) {
      return this.executeWithoutIdempotency(media, ownerRelationship);
    }

    return this.executeWithIdempotency({
      key: params.idempotencyKey,
      actorId: ownerId,
      input: params.input,
      media,
      ownerRelationship,
    });
  }

  private async requireOwnerId(actor: Actor) {
    await assertAllowed(this.mediaPolicy.canCreate(actor), "Authentication required");
    const ownerId = actor.type === "user" ? actor.localUserId : null;
    if (!ownerId) {
      throw new NotFoundError("Linked local user not found");
    }

    return ownerId;
  }

  private buildMedia(ownerId: string, input: CreateMediaInput) {
    return Media.create({
      alt: input.alt,
      owner: ownerId,
      url: input.url ?? null,
      thumbnailURL: input.thumbnailURL ?? null,
      filename: input.filename,
      mimeType: input.mimeType ?? null,
      filesize: input.filesize ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      focalX: input.focalX ?? null,
      focalY: input.focalY ?? null,
    });
  }

  private buildOwnerRelationship(ownerId: string, mediaId: string) {
    return createRelationship({
      subjectId: ownerId,
      relation: "owner",
      objectType: "media",
      objectId: mediaId,
    });
  }

  private async executeWithoutIdempotency(media: Media, ownerRelationship: Relationship) {
    const created = await this.mediaRepository.create(media);
    await this.relationships.create(ownerRelationship);
    return created;
  }

  private async executeWithIdempotency(params: {
    key: string;
    actorId: string;
    input: CreateMediaInput;
    media: Media;
    ownerRelationship: Relationship;
  }) {
    const requestHash = await sha256Hex(params.input);
    const replay = await this.idempotency.findActive({
      key: params.key,
      actorId: params.actorId,
      route: MEDIA_CREATE_ROUTE,
    });
    if (replay) {
      return this.replayExistingMedia(replay, requestHash);
    }

    await this.idempotency.deleteExpired({
      key: params.key,
      actorId: params.actorId,
      route: MEDIA_CREATE_ROUTE,
    });

    try {
      await this.mediaCreateWorkflow.createWithIdempotency({
        media: params.media,
        ownerRelationship: params.ownerRelationship,
        idempotency: {
          key: params.key,
          actorId: params.actorId,
          route: MEDIA_CREATE_ROUTE,
          requestHash,
          responseJson: JSON.stringify(params.media.toSnapshot()),
          status: HTTP_STATUS_CREATED,
          expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        },
      });
      return params.media;
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
        route: MEDIA_CREATE_ROUTE,
      });
      if (replay) {
        return this.replayExistingMedia(replay, params.requestHash);
      }
    }

    throw params.error;
  }

  private replayExistingMedia(replay: IdempotencyRecord, requestHash: string) {
    if (replay.requestHash !== requestHash) {
      throw new ConflictError("Idempotency key reused with different request body");
    }
    if (!replay.responseJson) {
      throw new Error("Idempotency replay row is missing a cached response");
    }

    return Media.reconstitute(deserializeMediaSnapshot(replay.responseJson));
  }
}

function createRelationship(params: {
  subjectId: string;
  relation: string;
  objectType: string;
  objectId: string;
}): Relationship {
  return Relationship.create({
    subjectType: "user",
    subjectId: params.subjectId,
    relation: params.relation,
    objectType: params.objectType,
    objectId: params.objectId,
  });
}

function deserializeMediaSnapshot(value: string): MediaProps {
  const snapshot = JSON.parse(value) as Omit<MediaProps, "createdAt" | "updatedAt"> & {
    createdAt: string;
    updatedAt: string;
  };

  return {
    ...snapshot,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
  };
}

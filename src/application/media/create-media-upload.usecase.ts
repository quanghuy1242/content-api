import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import { createUserSubjectRelationship } from "@/domain/authz/relationship-policy";
import type { Relationship } from "@/domain/authz/relationship.entity";
import type { RelationshipRepository } from "@/domain/authz/relationship.repository";
import type { IdempotencyRecord, IdempotencyRepository } from "@/domain/idempotency/idempotency.repository";
import { Media, type CreateMediaProps, type MediaProps } from "@/domain/media/media.entity";
import type { MediaCreateWorkflow } from "@/domain/media/media-create.workflow";
import type { ObjectStorageSigner } from "@/domain/media/object-storage";
import type { MediaRepository } from "@/domain/media/media.repository";
import { MediaPolicy } from "@/domain/media/media.policy";
import { ConflictError, IdempotencyReservationConflictError, NotFoundError, ValidationError } from "@/shared/errors";
import {
  HTTP_STATUS_CREATED,
  IDEMPOTENCY_TTL_MS,
  MEDIA_CREATE_ROUTE,
  MEDIA_CONTENT_TYPES,
  MILLISECONDS_PER_SECOND,
  normalizeMediaContentType,
} from "@/shared/constants";
import { sha256Hex } from "@/shared/idempotency";

export type CreateMediaUploadInput = Pick<CreateMediaProps, "alt" | "filename" | "mimeType" | "filesize" | "focalX" | "focalY">;

export type MediaUploadInstructions = {
  url: string;
  method: "PUT";
  expiresAt: string;
  headers: {
    "Content-Type": string;
  };
};

export type CreateMediaUploadResult = {
  media: Media;
  upload: MediaUploadInstructions;
};

/**
 * Creates a pending upload-backed media row and the presigned PUT instructions
 * clients must use for the direct R2 upload.
 */
export class CreateMediaUploadUseCase {
  constructor(
    private readonly mediaRepository: MediaRepository,
    private readonly relationships: RelationshipRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly mediaCreateWorkflow: MediaCreateWorkflow,
    private readonly mediaPolicy: MediaPolicy,
    private readonly signer: ObjectStorageSigner,
    private readonly maxImageUploadBytes: number,
    private readonly uploadUrlTtlSeconds: number,
  ) {}

  async execute(params: { actor: Actor; idempotencyKey?: string; input: CreateMediaUploadInput }) {
    const ownerId = await this.requireOwnerId(params.actor);
    const normalizedInput = this.normalizeAndValidate(params.input);
    const media = this.buildMedia(ownerId, normalizedInput);
    const ownerRelationship = this.buildOwnerRelationship(ownerId, media.id);
    const successPayload = await this.buildSuccessPayload(media);

    if (!params.idempotencyKey) {
      await this.mediaRepository.create(media);
      await this.relationships.create(ownerRelationship);
      return successPayload;
    }

    return this.executeWithIdempotency({
      key: params.idempotencyKey,
      actorId: ownerId,
      requestInput: normalizedInput,
      media,
      ownerRelationship,
      successPayload,
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

  private normalizeAndValidate(input: CreateMediaUploadInput) {
    const mimeType = normalizeMediaContentType(input.mimeType);

    if (!MEDIA_CONTENT_TYPES.includes(mimeType as (typeof MEDIA_CONTENT_TYPES)[number])) {
      throw new ValidationError("Unsupported media content type", { mimeType });
    }
    if (input.filesize > this.maxImageUploadBytes) {
      throw new ValidationError("Media exceeds upload size limit", {
        maxBytes: this.maxImageUploadBytes,
        filesize: input.filesize,
      });
    }

    return {
      ...input,
      mimeType,
    };
  }

  private buildMedia(ownerId: string, input: CreateMediaUploadInput) {
    return Media.create({
      alt: input.alt,
      owner: ownerId,
      filename: input.filename,
      mimeType: input.mimeType,
      filesize: input.filesize,
      focalX: input.focalX ?? null,
      focalY: input.focalY ?? null,
      uploadExpiresAt: new Date(Date.now() + this.uploadUrlTtlSeconds * MILLISECONDS_PER_SECOND),
    });
  }

  private buildOwnerRelationship(ownerId: string, mediaId: string) {
    return createUserSubjectRelationship({
      subjectId: ownerId,
      relation: "owner",
      objectType: "media",
      objectId: mediaId,
    });
  }

  private async buildSuccessPayload(media: Media): Promise<CreateMediaUploadResult> {
    if (!media.originalKey || !media.uploadExpiresAt) {
      throw new ConflictError("Upload-backed media must have an original key and expiry");
    }

    const url = await this.signer.createPresignedPutUrl({
      key: media.originalKey,
      contentType: media.mimeType,
      expiresInSeconds: this.uploadUrlTtlSeconds,
    });

    return {
      media,
      upload: {
        url,
        method: "PUT",
        expiresAt: media.uploadExpiresAt.toISOString(),
        headers: {
          "Content-Type": media.mimeType,
        },
      },
    };
  }

  private async executeWithIdempotency(params: {
    key: string;
    actorId: string;
    requestInput: CreateMediaUploadInput;
    media: Media;
    ownerRelationship: Relationship;
    successPayload: CreateMediaUploadResult;
  }) {
    const requestHash = await sha256Hex(params.requestInput);
    const replay = await this.idempotency.findActive({
      key: params.key,
      actorId: params.actorId,
      route: MEDIA_CREATE_ROUTE,
    });
    if (replay) {
      return this.replayExisting(replay, requestHash);
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
          responseJson: JSON.stringify(serializeSuccessPayload(params.successPayload)),
          status: HTTP_STATUS_CREATED,
          expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        },
      });

      return params.successPayload;
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
        return this.replayExisting(replay, params.requestHash);
      }
    }

    throw params.error;
  }

  private replayExisting(replay: IdempotencyRecord, requestHash: string) {
    if (replay.requestHash !== requestHash) {
      throw new ConflictError("Idempotency key reused with different request body");
    }
    if (!replay.responseJson) {
      throw new ConflictError("Idempotency replay row is missing a cached response");
    }

    const parsed = deserializeSuccessPayload(replay.responseJson);
    if (Date.parse(parsed.upload.expiresAt) <= Date.now()) {
      throw new ConflictError("Cached upload URL has expired; request a fresh upload");
    }

    return parsed;
  }
}

function serializeSuccessPayload(input: CreateMediaUploadResult) {
  const snapshot = input.media.toSnapshot();
  return {
    media: {
      ...snapshot,
      createdAt: snapshot.createdAt.toISOString(),
      updatedAt: snapshot.updatedAt.toISOString(),
      uploadExpiresAt: snapshot.uploadExpiresAt?.toISOString() ?? null,
    },
    upload: input.upload,
  };
}

function deserializeSuccessPayload(value: string): CreateMediaUploadResult {
  const parsed = JSON.parse(value) as {
    media: Omit<MediaProps, "createdAt" | "updatedAt" | "uploadExpiresAt"> & {
      createdAt: string;
      updatedAt: string;
      uploadExpiresAt: string | null;
    };
    upload: MediaUploadInstructions;
  };

  return {
    media: Media.reconstitute({
      id: parsed.media.id,
      alt: parsed.media.alt,
      lowResUrl: parsed.media.lowResUrl,
      optimizedUrl: parsed.media.optimizedUrl,
      owner: parsed.media.owner,
      url: parsed.media.url,
      thumbnailURL: parsed.media.thumbnailURL,
      filename: parsed.media.filename,
      mimeType: parsed.media.mimeType,
      filesize: parsed.media.filesize,
      width: parsed.media.width,
      height: parsed.media.height,
      focalX: parsed.media.focalX,
      focalY: parsed.media.focalY,
      originalKey: parsed.media.originalKey,
      variantKeys: parsed.media.variantKeys,
      uploadExpiresAt: parsed.media.uploadExpiresAt ? new Date(parsed.media.uploadExpiresAt) : null,
      status: parsed.media.status,
      visibility: parsed.media.visibility,
      version: parsed.media.version,
      failureReason: parsed.media.failureReason,
      createdAt: new Date(parsed.media.createdAt),
      updatedAt: new Date(parsed.media.updatedAt),
    }),
    upload: parsed.upload,
  };
}

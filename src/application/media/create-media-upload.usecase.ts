import type { Actor, UserActor } from "@/domain/auth/actor";
import { requireContentScope } from "@/domain/auth/scopes";
import {
  createDirectOwnerBinding,
  createOwnerAssignedEvent,
  requireOwnedContentCreateContext,
} from "@/application/content-ownership";
import type { IdempotencyRecord, IdempotencyRepository } from "@/domain/idempotency/idempotency.repository";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import type { ContentRoleRepository } from "@/domain/iam/content-role.repository";
import { Media, type CreateMediaProps, type MediaProps } from "@/domain/media/media.entity";
import type { MediaCreateWorkflow } from "@/domain/media/media-create.workflow";
import type { ObjectStorageSigner } from "@/domain/media/object-storage";
import type { MediaRepository } from "@/domain/media/media.repository";
import { identityProjectionFromActor } from "@/domain/users/user-projection";
import type { UserRepository } from "@/domain/users/user.repository";
import { ConflictError, IdempotencyReservationConflictError, ValidationError } from "@/shared/errors";
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
    private readonly users: UserRepository,
    private readonly roles: ContentRoleRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly mediaCreateWorkflow: MediaCreateWorkflow,
    private readonly contentPolicy: ContentPolicy,
    private readonly signer: ObjectStorageSigner,
    private readonly maxImageUploadBytes: number,
    private readonly uploadUrlTtlSeconds: number,
  ) {}

  async execute(params: { actor: Actor; idempotencyKey?: string; input: CreateMediaUploadInput }) {
    const { actor, orgId } = await this.requireCreateContext(params.actor);
    const ownerId = actor.id;
    const normalizedInput = this.normalizeAndValidate(params.input);
    const media = this.buildMedia(orgId, ownerId, normalizedInput);
    const ownerBinding = createDirectOwnerBinding({
      orgId,
      userId: ownerId,
      roleId: "system:media.owner",
      resourceType: "media",
      resourceId: media.id,
    });
    const event = createOwnerAssignedEvent({
      orgId,
      userId: ownerId,
      resourceType: "media",
      resourceId: media.id,
      snapshotJson: JSON.stringify({ media: media.toSnapshot(), ownerBinding: ownerBinding.toSnapshot() }),
    });
    const successPayload = await this.buildSuccessPayload(media);

    if (!params.idempotencyKey) {
      await this.mediaCreateWorkflow.createWithOwner({ media, ownerBinding, event });
      return successPayload;
    }

    return this.executeWithIdempotency({
      key: params.idempotencyKey,
      actorId: ownerId,
      requestInput: normalizedInput,
      media,
      ownerBinding,
      event,
      successPayload,
    });
  }

  private async requireCreateContext(actor: Actor) {
    requireContentScope(actor, "content:write");
    await this.roles.ensureSystemCatalog();
    const context = await requireOwnedContentCreateContext({
      actor,
      contentPolicy: this.contentPolicy,
      orgCreatePermission: "org.create_media",
    });
    await this.ensureOwnerProjection(context.actor);
    return context;
  }

  private async ensureOwnerProjection(actor: UserActor) {
    await this.users.ensureIdentityProjection(identityProjectionFromActor(actor));
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

  private buildMedia(orgId: string, ownerId: string, input: CreateMediaUploadInput) {
    return Media.create({
      orgId,
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
    ownerBinding: Parameters<MediaCreateWorkflow["createWithOwner"]>[0]["ownerBinding"];
    event: Parameters<MediaCreateWorkflow["createWithOwner"]>[0]["event"];
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
        ownerBinding: params.ownerBinding,
        event: params.event,
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
      orgId: parsed.media.orgId,
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

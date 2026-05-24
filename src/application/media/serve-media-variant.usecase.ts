import type { Actor } from "@/domain/authz/actor";
import { actorWithReadScope } from "@/domain/authz/scopes";
import type { ObjectStorage } from "@/domain/media/object-storage";
import type { MediaRepository } from "@/domain/media/media.repository";
import { MediaPolicy } from "@/domain/media/media.policy";
import { MEDIA_VARIANT_NAMES, type MediaVariantName } from "@/shared/constants";
import { NotFoundError } from "@/shared/errors";

export class ServeMediaVariantUseCase {
  constructor(
    private readonly mediaRepository: MediaRepository,
    private readonly mediaPolicy: MediaPolicy,
    private readonly storage: ObjectStorage,
  ) {}

  async execute(params: { actor: Actor | null; mediaId: string; version: number; variantName: string }) {
    const media = await this.mediaRepository.findById(params.mediaId);
    if (!media) {
      throw new NotFoundError("Media not found");
    }

    if (!MEDIA_VARIANT_NAMES.includes(params.variantName as MediaVariantName)) {
      throw new NotFoundError("Media variant not found");
    }
    if (media.version !== params.version || media.status !== "ready") {
      throw new NotFoundError("Media variant not found");
    }
    if (!(await this.mediaPolicy.canRead(actorWithReadScope(params.actor), media))) {
      throw new NotFoundError("Media variant not found");
    }

    const key = media.variantKeys[params.variantName];
    if (!key) {
      throw new NotFoundError("Media variant not found");
    }

    const object = await this.storage.get(key);
    if (!object) {
      throw new NotFoundError("Media variant not found");
    }

    return {
      body: object.body,
      contentType: object.contentType ?? "application/octet-stream",
      etag: object.etag,
      cacheControl: media.visibility === "public"
        ? "public, max-age=31536000, immutable"
        : "private, max-age=60",
    };
  }
}

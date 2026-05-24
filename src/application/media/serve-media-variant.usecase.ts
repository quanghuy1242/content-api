import type { Actor } from "@/domain/auth/actor";
import { actorWithReadScope } from "@/domain/auth/scopes";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import { mediaResource } from "@/domain/iam/resource-loader";
import type { ObjectStorage } from "@/domain/media/object-storage";
import type { MediaRepository } from "@/domain/media/media.repository";
import { MEDIA_VARIANT_NAMES, type MediaVariantName } from "@/shared/constants";
import { NotFoundError } from "@/shared/errors";

export class ServeMediaVariantUseCase {
  constructor(
    private readonly mediaRepository: MediaRepository,
    private readonly contentPolicy: ContentPolicy,
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
    const readable = media.visibility === "public" && media.status === "ready"
      ? true
      : await this.contentPolicy.can({ actor: actorWithReadScope(params.actor), permission: "media.read", resource: mediaResource(media) });
    if (!readable) {
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

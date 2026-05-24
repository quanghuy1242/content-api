import { assertAllowed } from "@/domain/auth/assert-can";
import type { Actor } from "@/domain/auth/actor";
import { requireContentScope } from "@/domain/auth/scopes";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import { mediaResource } from "@/domain/iam/resource-loader";
import type { MediaRepository } from "@/domain/media/media.repository";
import { NotFoundError } from "@/shared/errors";

export class UnpublishMediaUseCase {
  constructor(
    private readonly mediaRepository: MediaRepository,
    private readonly contentPolicy: ContentPolicy,
  ) {}

  async execute(params: { actor: Actor; mediaId: string }) {
    requireContentScope(params.actor, "content:write");
    const media = await this.mediaRepository.findById(params.mediaId);
    if (!media) {
      throw new NotFoundError("Media not found");
    }

    await assertAllowed(
      this.contentPolicy.can({ actor: params.actor, permission: "media.update", resource: mediaResource(media) }),
      "You cannot unpublish this media",
    );

    media.unpublish();
    return this.mediaRepository.update(media);
  }
}

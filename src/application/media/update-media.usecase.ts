import { assertAllowed } from "@/domain/auth/assert-can";
import type { Actor } from "@/domain/auth/actor";
import { requireContentScope } from "@/domain/auth/scopes";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import { mediaResource } from "@/domain/iam/resource-loader";
import type { UpdateMediaProps } from "@/domain/media/media.entity";
import type { MediaRepository } from "@/domain/media/media.repository";
import { NotFoundError } from "@/shared/errors";

export class UpdateMediaUseCase {
  constructor(
    private readonly mediaRepository: MediaRepository,
    private readonly contentPolicy: ContentPolicy,
  ) {}

  async execute(params: { actor: Actor; mediaId: string; input: UpdateMediaProps }) {
    requireContentScope(params.actor, "content:write");
    const media = await this.mediaRepository.findById(params.mediaId);
    if (!media) {
      throw new NotFoundError("Media not found");
    }

    await assertAllowed(
      this.contentPolicy.can({ actor: params.actor, permission: "media.update", resource: mediaResource(media) }),
      "You cannot update this media",
    );

    media.update(params.input);

    return this.mediaRepository.update(media);
  }
}

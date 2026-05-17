import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import type { MediaRepository } from "@/domain/media/media.repository";
import { MediaPolicy } from "@/domain/media/media.policy";
import { NotFoundError } from "@/shared/errors";

export class PublishMediaUseCase {
  constructor(
    private readonly mediaRepository: MediaRepository,
    private readonly mediaPolicy: MediaPolicy,
  ) {}

  async execute(params: { actor: Actor; mediaId: string }) {
    const media = await this.mediaRepository.findById(params.mediaId);
    if (!media) {
      throw new NotFoundError("Media not found");
    }

    await assertAllowed(this.mediaPolicy.canPublish(params.actor, media), "You cannot publish this media");

    media.publish();
    return this.mediaRepository.update(media);
  }
}

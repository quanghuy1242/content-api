import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import type { UpdateMediaProps } from "@/domain/media/media.entity";
import type { MediaRepository } from "@/domain/media/media.repository";
import { MediaPolicy } from "@/domain/media/media.policy";
import { NotFoundError } from "@/shared/errors";

export class UpdateMediaUseCase {
  constructor(
    private readonly mediaRepository: MediaRepository,
    private readonly mediaPolicy: MediaPolicy,
  ) {}

  async execute(params: { actor: Actor; mediaId: string; input: UpdateMediaProps }) {
    const media = await this.mediaRepository.findById(params.mediaId);
    if (!media) {
      throw new NotFoundError("Media not found");
    }

    await assertAllowed(this.mediaPolicy.canUpdate(params.actor, media), "You cannot update this media");

    media.update(params.input);

    return this.mediaRepository.update(media);
  }
}

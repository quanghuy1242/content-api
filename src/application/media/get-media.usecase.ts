import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import type { MediaRepository } from "@/domain/media/media.repository";
import { MediaPolicy } from "@/domain/media/media.policy";
import { NotFoundError } from "@/shared/errors";

export class GetMediaUseCase {
  constructor(
    private readonly media: MediaRepository,
    private readonly mediaPolicy: MediaPolicy,
  ) {}

  async execute(params: { actor: Actor | null; mediaId: string }) {
    const media = await this.media.findById(params.mediaId);
    if (!media) {
      throw new NotFoundError("Media not found");
    }

    await assertAllowed(this.mediaPolicy.canRead(params.actor, media), "You cannot read this media");
    return media;
  }
}


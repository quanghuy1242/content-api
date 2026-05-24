import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import { requireContentScope } from "@/domain/authz/scopes";
import type { MediaRepository } from "@/domain/media/media.repository";
import { MediaPolicy } from "@/domain/media/media.policy";
import { NotFoundError } from "@/shared/errors";

export class DeleteMediaUseCase {
  constructor(
    private readonly mediaRepository: MediaRepository,
    private readonly mediaPolicy: MediaPolicy,
  ) {}

  async execute(params: { actor: Actor; mediaId: string }) {
    requireContentScope(params.actor, "content:write");
    const media = await this.mediaRepository.findById(params.mediaId);
    if (!media) {
      throw new NotFoundError("Media not found");
    }

    await assertAllowed(this.mediaPolicy.canDelete(params.actor, media), "You cannot delete this media");

    const deleted = await this.mediaRepository.delete(params.mediaId);
    if (!deleted) {
      throw new NotFoundError("Media not found");
    }
  }
}

import { assertAllowed } from "@/domain/auth/assert-can";
import type { Actor } from "@/domain/auth/actor";
import { actorWithReadScope } from "@/domain/auth/scopes";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import { mediaResource } from "@/domain/iam/resource-loader";
import type { MediaRepository } from "@/domain/media/media.repository";
import { NotFoundError } from "@/shared/errors";

export class GetMediaUseCase {
  constructor(
    private readonly media: MediaRepository,
    private readonly contentPolicy: ContentPolicy,
  ) {}

  async execute(params: { actor: Actor | null; mediaId: string }) {
    const media = await this.media.findById(params.mediaId);
    if (!media) {
      throw new NotFoundError("Media not found");
    }

    await assertAllowed(
      media.visibility === "public" && media.status === "ready"
        ? Promise.resolve(true)
        : this.contentPolicy.can({ actor: actorWithReadScope(params.actor), permission: "media.read", resource: mediaResource(media) }),
      "You cannot read this media",
    );
    return media;
  }
}

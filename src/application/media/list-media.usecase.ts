import type { Actor } from "@/domain/auth/actor";
import { actorWithReadScope } from "@/domain/auth/scopes";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import { mediaResource } from "@/domain/iam/resource-loader";
import type { MediaRepository } from "@/domain/media/media.repository";

export class ListMediaUseCase {
  constructor(
    private readonly media: MediaRepository,
    private readonly contentPolicy: ContentPolicy,
  ) {}

  async execute(params: { actor: Actor | null; limit: number; cursor?: string }) {
    const actor = actorWithReadScope(params.actor);

    const result = await this.media.findMany({
      limit: params.limit,
      cursor: params.cursor,
      includePrivateOwnedBy: null,
      includePublicOnly: false,
    });
    const privateMedia = result.data.filter((media) => media.visibility !== "public" || media.status !== "ready");
    const decisions = await this.contentPolicy.canMany({
      actor,
      permission: "media.read",
      resources: privateMedia.map(mediaResource),
    });
    return {
      data: result.data.filter((media) => (media.visibility === "public" && media.status === "ready") || decisions.get(media.id) === true),
      page: result.page,
    };
  }
}

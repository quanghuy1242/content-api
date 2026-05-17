import type { Actor } from "@/domain/authz/actor";
import type { MediaRepository } from "@/domain/media/media.repository";

export class ListMediaUseCase {
  constructor(private readonly media: MediaRepository) {}

  async execute(params: { actor: Actor | null; limit: number; cursor?: string }) {
    const ownerId = params.actor?.type === "user" ? params.actor.localUserId : null;

    return this.media.findMany({
      limit: params.limit,
      cursor: params.cursor,
      includePrivateOwnedBy: ownerId,
      includePublicOnly: params.actor?.type !== "user" || params.actor.role !== "admin",
    });
  }
}

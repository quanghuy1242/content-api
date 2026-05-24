import type { Actor } from "@/domain/authz/actor";
import { actorWithReadScope } from "@/domain/authz/scopes";
import type { MediaRepository } from "@/domain/media/media.repository";

export class ListMediaUseCase {
  constructor(private readonly media: MediaRepository) {}

  async execute(params: { actor: Actor | null; limit: number; cursor?: string }) {
    const actor = actorWithReadScope(params.actor);
    const ownerId = actor?.type === "user" ? actor.id : null;

    return this.media.findMany({
      limit: params.limit,
      cursor: params.cursor,
      includePrivateOwnedBy: ownerId,
      includePublicOnly: actor?.type !== "user" || actor.role !== "admin",
    });
  }
}

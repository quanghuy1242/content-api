import type { Actor } from "@/domain/authz/actor";
import { canUserActorAccessByRelation } from "@/domain/authz/relationship-policy";
import type { RelationshipRepository } from "@/domain/authz/relationship.repository";
import type { Media } from "@/domain/media/media.entity";

/**
 * ReBAC policy for media metadata. Public reads require ready/public media;
 * private reads and mutations require admin role or an `owner` relationship.
 */
export class MediaPolicy {
  constructor(private readonly relationships: RelationshipRepository) {}

  canCreate(actor: Actor | null) {
    return Promise.resolve(actor?.type === "user");
  }

  canRead(actor: Actor | null, media: Media) {
    if (media.visibility === "public" && media.status === "ready") {
      return Promise.resolve(true);
    }
    return canUserActorAccessByRelation({
      actor,
      relationships: this.relationships,
      relation: "owner",
      objectType: "media",
      objectId: media.id,
    });
  }

  canUpdate(actor: Actor | null, media: Media) {
    return canUserActorAccessByRelation({
      actor,
      relationships: this.relationships,
      relation: "owner",
      objectType: "media",
      objectId: media.id,
    });
  }

  canDelete(actor: Actor | null, media: Media) {
    return this.canUpdate(actor, media);
  }

  canPublish(actor: Actor | null, media: Media) {
    return this.canUpdate(actor, media);
  }

  canUnpublish(actor: Actor | null, media: Media) {
    return this.canUpdate(actor, media);
  }
}

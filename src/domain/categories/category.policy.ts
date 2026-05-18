import type { Actor } from "@/domain/authz/actor";
import { canUserActorAccessByRelation } from "@/domain/authz/relationship-policy";
import type { RelationshipRepository } from "@/domain/authz/relationship.repository";

/**
 * ReBAC policy for categories. Creation/read requires an authenticated user;
 * updates and deletes require admin role or an `owner` relationship.
 */
export class CategoryPolicy {
  constructor(private readonly relationships: RelationshipRepository) {}

  canCreate(actor: Actor | null) {
    return Promise.resolve(actor?.type === "user");
  }

  canRead(actor: Actor | null) {
    return Promise.resolve(actor?.type === "user");
  }

  canUpdate(actor: Actor | null, categoryId: string) {
    return canUserActorAccessByRelation({
      actor,
      relationships: this.relationships,
      relation: "owner",
      objectType: "category",
      objectId: categoryId,
    });
  }

  canDelete(actor: Actor | null, categoryId: string) {
    return this.canUpdate(actor, categoryId);
  }
}

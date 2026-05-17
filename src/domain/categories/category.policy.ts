import type { Actor } from "@/domain/authz/actor";
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
    if (actor?.type !== "user") {
      return Promise.resolve(false);
    }
    if (actor.role === "admin") {
      return Promise.resolve(true);
    }

    return this.relationships.exists({
      subjectType: "user",
      subjectId: actor.localUserId ?? actor.id,
      relation: "owner",
      objectType: "category",
      objectId: categoryId,
    });
  }

  canDelete(actor: Actor | null, categoryId: string) {
    return this.canUpdate(actor, categoryId);
  }
}

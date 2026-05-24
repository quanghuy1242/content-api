import type { Actor } from "@/domain/authz/actor";
import type { User } from "@/domain/users/user.entity";

/**
 * User profile policy. Identity users come from `id`; content-api only creates
 * local profile/authorship projections for the authenticated subject.
 */
export class UserPolicy {
  canCreate(actor: Actor | null) {
    return Promise.resolve(actor?.type === "user");
  }

  canRead(actor: Actor | null) {
    return Promise.resolve(actor?.type === "user");
  }

  canUpdate(actor: Actor | null, user: User) {
    return Promise.resolve(
      actor?.type === "user" &&
        (actor.role === "admin" || actor.id === user.id),
    );
  }

  canDelete(actor: Actor | null) {
    return Promise.resolve(actor?.type === "user" && actor.role === "admin");
  }
}

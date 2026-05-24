import type { Actor } from "@/domain/authz/actor";
import type { User } from "@/domain/users/user.entity";

/**
 * User management policy. Admins manage the collection; authenticated users can
 * read users and update their own profile, with presenter-level field hiding.
 */
export class UserPolicy {
  canCreate(actor: Actor | null) {
    return Promise.resolve(actor?.type === "user" && actor.role === "admin");
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

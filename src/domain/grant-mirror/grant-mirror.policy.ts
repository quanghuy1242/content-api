import type { Actor } from "@/domain/authz/actor";

/**
 * Admin/system-only policy for mirrored Auther grants and relationship facts.
 * These rows are authorization infrastructure, not public content resources.
 */
export class GrantMirrorPolicy {
  canManage(actor: Actor | null) {
    return Promise.resolve(
      actor?.type === "system" || (actor?.type === "user" && actor.role === "admin"),
    );
  }
}

import type { Actor } from "@/domain/authz/actor";

/**
 * Admin/system-only policy for pending grant reconciliation records.
 */
export class DeferredGrantPolicy {
  canManage(actor: Actor | null) {
    return Promise.resolve(
      actor?.type === "system" || (actor?.type === "user" && actor.role === "admin"),
    );
  }
}

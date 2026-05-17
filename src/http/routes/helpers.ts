import type { Context } from "hono";
import type { Actor } from "@/domain/authz/actor";
import { UnauthorizedError } from "@/shared/errors";

/**
 * Narrow the optional actor installed by auth middleware to a required user/API
 * actor for route handlers. Resource-specific permissions still live in
 * policies/use cases, not here.
 */
export function requireActor(c: Context): Actor {
  const actor = c.get("actor");
  if (!actor) {
    throw new UnauthorizedError("Authentication required");
  }
  return actor;
}

import type { Actor } from "@/domain/auth/actor";
import { ForbiddenError } from "@/shared/errors";

export type ContentOAuthScope = "content:read" | "content:write" | "content:share";

/** OAuth scopes issued by `id` for the Content API audience. */
export const CONTENT_OAUTH_SCOPES = ["content:read", "content:write", "content:share"] as const;

export function hasContentScope(actor: Actor | null, scope: ContentOAuthScope): boolean {
  return actor?.type !== "system" && actor?.scopes.includes(scope) === true;
}

export function hasAnyContentScope(scopes: readonly string[], acceptedScopes: readonly string[]): boolean {
  return acceptedScopes.some((scope) => scopes.includes(scope));
}

export function requireContentScope(actor: Actor, scope: ContentOAuthScope): void {
  if (!hasContentScope(actor, scope)) {
    throw new ForbiddenError(`OAuth scope required: ${scope}`);
  }
}

export function actorWithReadScope(actor: Actor | null): Actor | null {
  return hasContentScope(actor, "content:read") ? actor : null;
}

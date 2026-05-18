import type { z } from "zod";
import type { DeferredGrant } from "@/domain/deferred-grants/deferred-grant.entity";
import type { GrantMirror } from "@/domain/grant-mirror/grant-mirror.entity";
import type { Relationship } from "@/domain/authz/relationship.entity";
import type {
  deferredGrantResponseSchema,
  grantMirrorResponseSchema,
  relationshipResponseSchema,
} from "@/http/schemas/authz.schema";

/**
 * Converts a mirrored grant to the documented HTTP response shape.
 */
export function presentGrantMirror(item: GrantMirror): z.infer<typeof grantMirrorResponseSchema> {
  const snap = item.toSnapshot();
  return { ...snap, syncedAt: snap.syncedAt.toISOString() };
}

/**
 * Converts a deferred grant to JSON without leaking persistence date objects.
 */
export function presentDeferredGrant(item: DeferredGrant): z.infer<typeof deferredGrantResponseSchema> {
  const snap = item.toSnapshot();
  return {
    ...snap,
    processedAt: snap.processedAt?.toISOString() ?? null,
    createdAt: snap.createdAt.toISOString(),
  };
}

/**
 * Converts a relationship fact to the documented HTTP response shape.
 */
export function presentRelationship(item: Relationship): z.infer<typeof relationshipResponseSchema> {
  const snap = item.toSnapshot();
  return { ...snap, createdAt: snap.createdAt.toISOString() };
}

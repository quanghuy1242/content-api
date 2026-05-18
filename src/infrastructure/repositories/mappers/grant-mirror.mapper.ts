import { GrantMirror } from "@/domain/grant-mirror/grant-mirror.entity";
import { grantMirror } from "@/infrastructure/db/schema";

type GrantMirrorRow = typeof grantMirror.$inferSelect;

/**
 * Rebuilds a grant mirror entity from a Drizzle row.
 */
export function grantMirrorRowToEntity(row: GrantMirrorRow): GrantMirror {
  return GrantMirror.reconstitute({
    id: row.id,
    autherTupleId: row.autherTupleId,
    payloadUserId: row.payloadUserId,
    entityType: row.entityType as "book" | "chapter" | "comment",
    entityId: row.entityId,
    relation: row.relation,
    sourceSubjectType: row.sourceSubjectType as "user" | "group",
    requiresLiveCheck: row.requiresLiveCheck,
    syncStatus: row.syncStatus as "active" | "revoked" | "pending",
    syncedAt: row.syncedAt,
  });
}

/**
 * Builds an insert payload from a grant mirror entity snapshot.
 */
export function grantMirrorToInsertRow(mirror: GrantMirror) {
  const snap = mirror.toSnapshot();
  return {
    id: snap.id,
    autherTupleId: snap.autherTupleId,
    payloadUserId: snap.payloadUserId,
    entityType: snap.entityType,
    entityId: snap.entityId,
    relation: snap.relation,
    sourceSubjectType: snap.sourceSubjectType,
    requiresLiveCheck: snap.requiresLiveCheck,
    syncStatus: snap.syncStatus,
    syncedAt: snap.syncedAt,
  };
}

/**
 * Builds an update payload from a grant mirror entity snapshot.
 */
export function grantMirrorToUpdateRow(mirror: GrantMirror) {
  const snap = mirror.toSnapshot();
  return {
    autherTupleId: snap.autherTupleId,
    payloadUserId: snap.payloadUserId,
    entityType: snap.entityType,
    entityId: snap.entityId,
    relation: snap.relation,
    sourceSubjectType: snap.sourceSubjectType,
    requiresLiveCheck: snap.requiresLiveCheck,
    syncStatus: snap.syncStatus,
    syncedAt: snap.syncedAt,
  };
}

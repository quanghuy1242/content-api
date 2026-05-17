import type { GrantMirror } from "@/domain/grant-mirror/grant-mirror.entity";
import { grantMirror } from "@/infrastructure/db/schema";

type GrantMirrorRow = typeof grantMirror.$inferSelect;

/**
 * Rehydrates mirrored Auther grant rows and narrows string columns to documented
 * domain unions at the infrastructure boundary.
 */
export function grantMirrorRowToEntity(row: GrantMirrorRow): GrantMirror {
  return {
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
  };
}

/**
 * Keeps grant-mirror insert payload construction out of repository flow logic.
 */
export function grantMirrorToInsertRow(input: GrantMirror) {
  return {
    id: input.id,
    autherTupleId: input.autherTupleId,
    payloadUserId: input.payloadUserId,
    entityType: input.entityType,
    entityId: input.entityId,
    relation: input.relation,
    sourceSubjectType: input.sourceSubjectType,
    requiresLiveCheck: input.requiresLiveCheck,
    syncStatus: input.syncStatus,
    syncedAt: input.syncedAt,
  };
}

/**
 * Keeps partial grant-mirror update payloads centralized for CRUD adapter calls.
 */
export function grantMirrorToUpdateRow(input: Partial<Omit<GrantMirror, "id">>) {
  return {
    autherTupleId: input.autherTupleId,
    payloadUserId: input.payloadUserId,
    entityType: input.entityType,
    entityId: input.entityId,
    relation: input.relation,
    sourceSubjectType: input.sourceSubjectType,
    requiresLiveCheck: input.requiresLiveCheck,
    syncStatus: input.syncStatus,
    syncedAt: input.syncedAt,
  };
}

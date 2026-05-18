import { DeferredGrant } from "@/domain/deferred-grants/deferred-grant.entity";
import { deferredGrants } from "@/infrastructure/db/schema";

type DeferredGrantRow = typeof deferredGrants.$inferSelect;

/**
 * Rebuilds a deferred grant entity from a Drizzle row.
 */
export function deferredGrantRowToEntity(row: DeferredGrantRow): DeferredGrant {
  return DeferredGrant.reconstitute({
    id: row.id,
    betterAuthUserId: row.betterAuthUserId,
    tupleId: row.tupleId,
    entityType: row.entityType,
    entityId: row.entityId,
    relation: row.relation,
    sourceSubjectType: row.sourceSubjectType as "user" | "group",
    hasCondition: row.hasCondition,
    status: row.status as "pending" | "processed" | "expired",
    processedAt: row.processedAt,
    type: row.type as "grant" | "revocation_tombstone",
    createdAt: row.createdAt,
  });
}

/**
 * Builds an insert payload from a deferred grant entity snapshot.
 */
export function deferredGrantToInsertRow(grant: DeferredGrant) {
  const snap = grant.toSnapshot();
  return {
    id: snap.id,
    betterAuthUserId: snap.betterAuthUserId,
    tupleId: snap.tupleId,
    entityType: snap.entityType,
    entityId: snap.entityId,
    relation: snap.relation,
    sourceSubjectType: snap.sourceSubjectType,
    hasCondition: snap.hasCondition,
    status: snap.status,
    processedAt: snap.processedAt,
    type: snap.type,
    createdAt: snap.createdAt,
  };
}

/**
 * Builds an update payload from a deferred grant entity snapshot.
 */
export function deferredGrantToUpdateRow(grant: DeferredGrant) {
  const snap = grant.toSnapshot();
  return {
    betterAuthUserId: snap.betterAuthUserId,
    tupleId: snap.tupleId,
    entityType: snap.entityType,
    entityId: snap.entityId,
    relation: snap.relation,
    sourceSubjectType: snap.sourceSubjectType,
    hasCondition: snap.hasCondition,
    status: snap.status,
    processedAt: snap.processedAt,
    type: snap.type,
  };
}

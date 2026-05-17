import type { DeferredGrant } from "@/domain/deferred-grants/deferred-grant.entity";
import { deferredGrants } from "@/infrastructure/db/schema";

type DeferredGrantRow = typeof deferredGrants.$inferSelect;

/**
 * Rehydrates deferred grant rows into the domain authorization-sync shape.
 */
export function deferredGrantRowToEntity(row: DeferredGrantRow): DeferredGrant {
  return {
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
  };
}

/**
 * Keeps deferred-grant insert mapping centralized beside its row rehydration.
 */
export function deferredGrantToInsertRow(input: DeferredGrant) {
  return {
    id: input.id,
    betterAuthUserId: input.betterAuthUserId,
    tupleId: input.tupleId,
    entityType: input.entityType,
    entityId: input.entityId,
    relation: input.relation,
    sourceSubjectType: input.sourceSubjectType,
    hasCondition: input.hasCondition,
    status: input.status,
    processedAt: input.processedAt,
    type: input.type,
    createdAt: input.createdAt,
  };
}

/**
 * Keeps partial deferred-grant updates out of repository method bodies.
 */
export function deferredGrantToUpdateRow(input: Partial<Omit<DeferredGrant, "id" | "createdAt">>) {
  return {
    betterAuthUserId: input.betterAuthUserId,
    tupleId: input.tupleId,
    entityType: input.entityType,
    entityId: input.entityId,
    relation: input.relation,
    sourceSubjectType: input.sourceSubjectType,
    hasCondition: input.hasCondition,
    status: input.status,
    processedAt: input.processedAt,
    type: input.type,
  };
}

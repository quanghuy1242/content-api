import type { Relationship } from "@/domain/authz/relationship.entity";
import { relationships } from "@/infrastructure/db/schema";

type RelationshipRow = typeof relationships.$inferSelect;

/**
 * Converts stored relationship facts into the domain ReBAC vocabulary.
 */
export function relationshipRowToEntity(row: RelationshipRow): Relationship {
  return {
    id: row.id,
    subjectType: row.subjectType as "user" | "group" | "api_key",
    subjectId: row.subjectId,
    relation: row.relation,
    objectType: row.objectType,
    objectId: row.objectId,
    createdAt: row.createdAt,
  };
}

/**
 * Keeps relationship insert mapping explicit even when row/domain shapes match.
 */
export function relationshipToInsertRow(input: Relationship) {
  return {
    id: input.id,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    relation: input.relation,
    objectType: input.objectType,
    objectId: input.objectId,
    createdAt: input.createdAt,
  };
}

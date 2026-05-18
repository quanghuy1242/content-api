import { Relationship } from "@/domain/authz/relationship.entity";
import { relationships } from "@/infrastructure/db/schema";

type RelationshipRow = typeof relationships.$inferSelect;

/**
 * Rebuilds a relationship entity from a Drizzle row.
 */
export function relationshipRowToEntity(row: RelationshipRow): Relationship {
  return Relationship.reconstitute({
    id: row.id,
    subjectType: row.subjectType as "user" | "group" | "api_key",
    subjectId: row.subjectId,
    relation: row.relation,
    objectType: row.objectType,
    objectId: row.objectId,
    createdAt: row.createdAt,
  });
}

/**
 * Builds an insert payload from a relationship entity snapshot.
 */
export function relationshipToInsertRow(rel: Relationship) {
  const snap = rel.toSnapshot();
  return {
    id: snap.id,
    subjectType: snap.subjectType,
    subjectId: snap.subjectId,
    relation: snap.relation,
    objectType: snap.objectType,
    objectId: snap.objectId,
    createdAt: snap.createdAt,
  };
}

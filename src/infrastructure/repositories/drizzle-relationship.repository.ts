import { and, eq, inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { Relationship, RelationshipLookup } from "@/domain/authz/relationship.entity";
import type { RelationshipRepository } from "@/domain/authz/relationship.repository";
import { relationships } from "@/infrastructure/db/schema";
import { CrudAdapter } from "@/infrastructure/persistence/crud-adapter";
import {
  relationshipRowToEntity,
  relationshipToInsertRow,
} from "@/infrastructure/repositories/mappers/relationship.mapper";

type Db = DrizzleD1Database<typeof import("@/infrastructure/db/schema")>;

/**
 * Drizzle-backed relationship fact repository used by ReBAC policies. It stores
 * and queries facts but does not decide whether an actor is authorized.
 */
export class DrizzleRelationshipRepository implements RelationshipRepository {
  private readonly crud: CrudAdapter;

  constructor(private readonly db: Db) {
    this.crud = new CrudAdapter(db);
  }

  async exists(params: RelationshipLookup) {
    const row = await this.crud.findFirstRow<typeof relationships.$inferSelect>(
      relationships,
      and(
        eq(relationships.subjectType, params.subjectType),
        eq(relationships.subjectId, params.subjectId),
        eq(relationships.relation, params.relation),
        eq(relationships.objectType, params.objectType),
        eq(relationships.objectId, params.objectId),
      )!,
    );
    return Boolean(row);
  }

  async findRelations(params: Omit<RelationshipLookup, "relation">) {
    const rows = await this.db
      .select({ relation: relationships.relation })
      .from(relationships)
      .where(
        and(
          eq(relationships.subjectType, params.subjectType),
          eq(relationships.subjectId, params.subjectId),
          eq(relationships.objectType, params.objectType),
          eq(relationships.objectId, params.objectId),
        ),
      );

    return rows.map((row) => row.relation);
  }

  async hasAnyRelation(params: Omit<RelationshipLookup, "relation"> & { relations: string[] }) {
    if (params.relations.length === 0) {
      return false;
    }

    const row = await this.crud.findFirstRow<typeof relationships.$inferSelect>(
      relationships,
      and(
        eq(relationships.subjectType, params.subjectType),
        eq(relationships.subjectId, params.subjectId),
        eq(relationships.objectType, params.objectType),
        eq(relationships.objectId, params.objectId),
        inArray(relationships.relation, params.relations),
      )!,
    );

    return Boolean(row);
  }

  async findMany(params: { limit: number; cursor?: string }) {
    const page = await this.crud.listRows<typeof relationships.$inferSelect>({
      table: relationships,
      idColumn: relationships.id,
      cursorColumn: relationships.createdAt,
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      limit: params.limit,
      cursor: params.cursor,
    });

    return { data: page.data.map(relationshipRowToEntity), page: page.page };
  }

  async create(input: Relationship) {
    await this.crud.insertRow(relationships, relationshipToInsertRow(input), { onConflictDoNothing: true });
    const row = await this.crud.findFirstRow<typeof relationships.$inferSelect>(
      relationships,
      and(
        eq(relationships.subjectType, input.subjectType),
        eq(relationships.subjectId, input.subjectId),
        eq(relationships.relation, input.relation),
        eq(relationships.objectType, input.objectType),
        eq(relationships.objectId, input.objectId),
      )!,
    );

    return row ? relationshipRowToEntity(row) : input;
  }

  async delete(id: string) {
    return this.crud.deleteRowById(relationships, relationships.id, id);
  }
}

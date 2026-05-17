import type { CursorPage } from "@/shared/pagination/cursor";
import type {
  HasAnyRelationParams,
  Relationship,
  RelationshipLookup,
  RelationshipSubjectLookup,
} from "@/domain/authz/relationship.entity";

export interface RelationshipRepository {
  exists(params: RelationshipLookup): Promise<boolean>;
  findRelations(params: RelationshipSubjectLookup): Promise<string[]>;
  hasAnyRelation(params: HasAnyRelationParams): Promise<boolean>;
  findMany(params: { limit: number; cursor?: string }): Promise<CursorPage<Relationship>>;
  create(input: Relationship): Promise<Relationship>;
  delete(id: string): Promise<boolean>;
}

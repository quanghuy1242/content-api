export type SubjectType = "user" | "group" | "api_key";

export type Relationship = {
  id: string;
  subjectType: SubjectType;
  subjectId: string;
  relation: string;
  objectType: string;
  objectId: string;
  createdAt: Date;
};

export type RelationshipLookup = Omit<Relationship, "id" | "createdAt">;

export type RelationshipSubjectLookup = {
  subjectType: SubjectType;
  subjectId: string;
  objectType: string;
  objectId: string;
};

export type HasAnyRelationParams = RelationshipSubjectLookup & {
  relations: string[];
};

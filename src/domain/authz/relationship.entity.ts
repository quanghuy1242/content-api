export type SubjectType = "user" | "group" | "api_key";

export type RelationshipProps = {
  id: string;
  subjectType: SubjectType;
  subjectId: string;
  relation: string;
  objectType: string;
  objectId: string;
  createdAt: Date;
};

export type CreateRelationshipProps = Omit<RelationshipProps, "id" | "createdAt">;

export class Relationship {
  private constructor(private props: RelationshipProps) {}

  static create(input: CreateRelationshipProps) {
    return new Relationship({
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date(),
    });
  }

  static reconstitute(props: RelationshipProps) {
    return new Relationship({ ...props });
  }

  get id() { return this.props.id; }
  get subjectType() { return this.props.subjectType; }
  get subjectId() { return this.props.subjectId; }
  get relation() { return this.props.relation; }
  get objectType() { return this.props.objectType; }
  get objectId() { return this.props.objectId; }
  get createdAt() { return this.props.createdAt; }

  toSnapshot(): RelationshipProps {
    return { ...this.props };
  }
}

export type RelationshipLookup = Omit<RelationshipProps, "id" | "createdAt">;

export type RelationshipSubjectLookup = {
  subjectType: SubjectType;
  subjectId: string;
  objectType: string;
  objectId: string;
};

export type HasAnyRelationParams = RelationshipSubjectLookup & {
  relations: string[];
};

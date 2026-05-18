export type DeferredGrantProps = {
  id: string;
  betterAuthUserId: string;
  tupleId: string;
  entityType: string;
  entityId: string;
  relation: string;
  sourceSubjectType: "user" | "group";
  hasCondition: boolean;
  status: "pending" | "processed" | "expired";
  processedAt: Date | null;
  type: "grant" | "revocation_tombstone";
  createdAt: Date;
};

export type CreateDeferredGrantProps = Omit<DeferredGrantProps, "id" | "createdAt">;
export type UpdateDeferredGrantProps = Partial<CreateDeferredGrantProps>;

export class DeferredGrant {
  private constructor(private props: DeferredGrantProps) {}

  static create(input: CreateDeferredGrantProps) {
    return new DeferredGrant({
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date(),
    });
  }

  static reconstitute(props: DeferredGrantProps) {
    return new DeferredGrant({ ...props });
  }

  get id() { return this.props.id; }
  get betterAuthUserId() { return this.props.betterAuthUserId; }
  get tupleId() { return this.props.tupleId; }
  get entityType() { return this.props.entityType; }
  get entityId() { return this.props.entityId; }
  get relation() { return this.props.relation; }
  get sourceSubjectType() { return this.props.sourceSubjectType; }
  get hasCondition() { return this.props.hasCondition; }
  get status() { return this.props.status; }
  get processedAt() { return this.props.processedAt; }
  get type() { return this.props.type; }
  get createdAt() { return this.props.createdAt; }

  update(input: UpdateDeferredGrantProps) {
    if (input.betterAuthUserId !== undefined) this.props.betterAuthUserId = input.betterAuthUserId;
    if (input.tupleId !== undefined) this.props.tupleId = input.tupleId;
    if (input.entityType !== undefined) this.props.entityType = input.entityType;
    if (input.entityId !== undefined) this.props.entityId = input.entityId;
    if (input.relation !== undefined) this.props.relation = input.relation;
    if (input.sourceSubjectType !== undefined) this.props.sourceSubjectType = input.sourceSubjectType;
    if (input.hasCondition !== undefined) this.props.hasCondition = input.hasCondition;
    if (input.status !== undefined) this.props.status = input.status;
    if (input.processedAt !== undefined) this.props.processedAt = input.processedAt;
    if (input.type !== undefined) this.props.type = input.type;
  }

  toSnapshot(): DeferredGrantProps {
    return { ...this.props };
  }
}

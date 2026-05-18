export type GrantMirrorProps = {
  id: string;
  autherTupleId: string;
  payloadUserId: string;
  entityType: "book" | "chapter" | "comment";
  entityId: string;
  relation: string;
  sourceSubjectType: "user" | "group";
  requiresLiveCheck: boolean;
  syncStatus: "active" | "revoked" | "pending";
  syncedAt: Date;
};

export type CreateGrantMirrorProps = Omit<GrantMirrorProps, "id">;
export type UpdateGrantMirrorProps = Partial<CreateGrantMirrorProps>;

export class GrantMirror {
  private constructor(private props: GrantMirrorProps) {}

  static create(input: CreateGrantMirrorProps) {
    return new GrantMirror({
      ...input,
      id: crypto.randomUUID(),
    });
  }

  static reconstitute(props: GrantMirrorProps) {
    return new GrantMirror({ ...props });
  }

  get id() { return this.props.id; }
  get autherTupleId() { return this.props.autherTupleId; }
  get payloadUserId() { return this.props.payloadUserId; }
  get entityType() { return this.props.entityType; }
  get entityId() { return this.props.entityId; }
  get relation() { return this.props.relation; }
  get sourceSubjectType() { return this.props.sourceSubjectType; }
  get requiresLiveCheck() { return this.props.requiresLiveCheck; }
  get syncStatus() { return this.props.syncStatus; }
  get syncedAt() { return this.props.syncedAt; }

  update(input: UpdateGrantMirrorProps) {
    if (input.autherTupleId !== undefined) this.props.autherTupleId = input.autherTupleId;
    if (input.payloadUserId !== undefined) this.props.payloadUserId = input.payloadUserId;
    if (input.entityType !== undefined) this.props.entityType = input.entityType;
    if (input.entityId !== undefined) this.props.entityId = input.entityId;
    if (input.relation !== undefined) this.props.relation = input.relation;
    if (input.sourceSubjectType !== undefined) this.props.sourceSubjectType = input.sourceSubjectType;
    if (input.requiresLiveCheck !== undefined) this.props.requiresLiveCheck = input.requiresLiveCheck;
    if (input.syncStatus !== undefined) this.props.syncStatus = input.syncStatus;
    if (input.syncedAt !== undefined) this.props.syncedAt = input.syncedAt;
  }

  toSnapshot(): GrantMirrorProps {
    return { ...this.props };
  }
}

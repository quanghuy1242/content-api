import type { ContentResourceType, PrincipalType } from "@/domain/iam/content-permission";

export type PolicyEventAction =
  | "binding.created"
  | "binding.revoked"
  | "denial.created"
  | "denial.revoked"
  | "role.created"
  | "role.permissions_updated"
  | "role.disabled"
  | "ownership.transferred"
  | "org_admin.bootstrap"
  | "org_admin.delegated"
  | "policy.mutation_denied";

export type PolicyEventProps = {
  id: string;
  orgId: string;
  targetType: ContentResourceType;
  targetId: string;
  action: PolicyEventAction;
  actorType: PrincipalType;
  actorId: string;
  requestId: string | null;
  reason: string | null;
  snapshotJson: string | null;
  createdAt: Date;
};

export type CreatePolicyEventProps = Omit<PolicyEventProps, "id" | "createdAt">;

export class PolicyEvent {
  private constructor(private props: PolicyEventProps) {}

  static create(input: CreatePolicyEventProps) {
    return new PolicyEvent({
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date(),
    });
  }

  static reconstitute(props: PolicyEventProps) {
    return new PolicyEvent({ ...props });
  }

  get id() { return this.props.id; }
  get orgId() { return this.props.orgId; }
  get targetType() { return this.props.targetType; }
  get targetId() { return this.props.targetId; }
  get action() { return this.props.action; }
  get actorType() { return this.props.actorType; }
  get actorId() { return this.props.actorId; }
  get requestId() { return this.props.requestId; }
  get reason() { return this.props.reason; }
  get snapshotJson() { return this.props.snapshotJson; }
  get createdAt() { return this.props.createdAt; }

  toSnapshot(): PolicyEventProps {
    return { ...this.props };
  }
}

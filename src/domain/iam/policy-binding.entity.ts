import type { ContentResourceType, PrincipalType } from "@/domain/iam/content-permission";

export type PolicyBindingProps = {
  id: string;
  orgId: string;
  principalType: PrincipalType;
  principalId: string;
  roleId: string;
  resourceType: ContentResourceType;
  resourceId: string;
  expiresAt: Date | null;
  createdByType: PrincipalType;
  createdById: string;
  createdAt: Date;
};

export type CreatePolicyBindingProps = Omit<PolicyBindingProps, "id" | "createdAt">;

export class PolicyBinding {
  private constructor(private props: PolicyBindingProps) {}

  static create(input: CreatePolicyBindingProps) {
    return new PolicyBinding({
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date(),
    });
  }

  static reconstitute(props: PolicyBindingProps) {
    return new PolicyBinding({ ...props });
  }

  get id() { return this.props.id; }
  get orgId() { return this.props.orgId; }
  get principalType() { return this.props.principalType; }
  get principalId() { return this.props.principalId; }
  get roleId() { return this.props.roleId; }
  get resourceType() { return this.props.resourceType; }
  get resourceId() { return this.props.resourceId; }
  get expiresAt() { return this.props.expiresAt; }
  get createdByType() { return this.props.createdByType; }
  get createdById() { return this.props.createdById; }
  get createdAt() { return this.props.createdAt; }

  toSnapshot(): PolicyBindingProps {
    return { ...this.props };
  }
}

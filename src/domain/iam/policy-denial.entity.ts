import type { ContentPermissionKey, ContentResourceType, PrincipalType } from "@/domain/iam/content-permission";

export type PolicyDenialProps = {
  id: string;
  orgId: string;
  principalType: PrincipalType;
  principalId: string;
  permissionKey: ContentPermissionKey;
  resourceType: ContentResourceType;
  resourceId: string;
  appliesToDescendants: boolean;
  expiresAt: Date | null;
  reason: string | null;
  createdByType: PrincipalType;
  createdById: string;
  createdAt: Date;
};

export type CreatePolicyDenialProps = Omit<PolicyDenialProps, "id" | "createdAt">;

export class PolicyDenial {
  private constructor(private props: PolicyDenialProps) {}

  static create(input: CreatePolicyDenialProps) {
    return new PolicyDenial({
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date(),
    });
  }

  static reconstitute(props: PolicyDenialProps) {
    return new PolicyDenial({ ...props });
  }

  get id() { return this.props.id; }
  get orgId() { return this.props.orgId; }
  get principalType() { return this.props.principalType; }
  get principalId() { return this.props.principalId; }
  get permissionKey() { return this.props.permissionKey; }
  get resourceType() { return this.props.resourceType; }
  get resourceId() { return this.props.resourceId; }
  get appliesToDescendants() { return this.props.appliesToDescendants; }
  get expiresAt() { return this.props.expiresAt; }
  get reason() { return this.props.reason; }
  get createdByType() { return this.props.createdByType; }
  get createdById() { return this.props.createdById; }
  get createdAt() { return this.props.createdAt; }

  toSnapshot(): PolicyDenialProps {
    return { ...this.props };
  }
}

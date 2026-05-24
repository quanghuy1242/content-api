import type { ContentPermissionKey, PrincipalRef } from "@/domain/iam/content-permission";
import type { ResourceBindingRef } from "@/domain/iam/content-resource";
import type { PolicyDenial } from "@/domain/iam/policy-denial.entity";
import type { CursorPage } from "@/shared/pagination/cursor";

export interface PolicyDenialRepository {
  findMany(params: { orgId: string; resourceType: string; resourceId: string; limit: number; cursor?: string }): Promise<CursorPage<PolicyDenial>>;
  findById(id: string): Promise<PolicyDenial | null>;
  create(denial: PolicyDenial): Promise<PolicyDenial>;
  delete(id: string): Promise<boolean>;
  hasActiveDenial(params: {
    orgId: string;
    principals: readonly PrincipalRef[];
    permission: ContentPermissionKey;
    resources: readonly ResourceBindingRef[];
    now: Date;
  }): Promise<boolean>;
  findDeniedResourceRefs(params: {
    orgId: string;
    principals: readonly PrincipalRef[];
    permission: ContentPermissionKey;
    resources: readonly ResourceBindingRef[];
    now: Date;
  }): Promise<ResourceBindingRef[]>;
}

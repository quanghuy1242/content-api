import type { ContentPermissionKey, PrincipalRef } from "@/domain/iam/content-permission";
import type { ResourceBindingRef } from "@/domain/iam/content-resource";
import type { PolicyBinding } from "@/domain/iam/policy-binding.entity";
import type { CursorPage } from "@/shared/pagination/cursor";

export interface PolicyBindingRepository {
  findMany(params: { orgId: string; resourceType: string; resourceId: string; limit: number; cursor?: string }): Promise<CursorPage<PolicyBinding>>;
  findManyForResources(params: { orgId: string; resources: readonly ResourceBindingRef[]; limit: number; cursor?: string }): Promise<CursorPage<PolicyBinding>>;
  findById(id: string): Promise<PolicyBinding | null>;
  findActiveBookOwner(params: { orgId: string; bookId: string; now: Date }): Promise<PolicyBinding | null>;
  hasActiveDirectUserRoleBinding(params: {
    orgId: string;
    userId: string;
    roleId: string;
    resourceType: string;
    resourceId: string;
    now: Date;
  }): Promise<boolean>;
  countActiveRoleBindings(params: {
    orgId: string;
    resourceType: string;
    resourceId: string;
    roleId: string;
    now: Date;
  }): Promise<number>;
  countActiveBindingsForRole(params: { orgId: string; roleId: string; now: Date }): Promise<number>;
  create(binding: PolicyBinding): Promise<PolicyBinding>;
  delete(id: string): Promise<boolean>;
  hasAllowedPermission(params: {
    orgId: string;
    principals: readonly PrincipalRef[];
    permission: ContentPermissionKey;
    resources: readonly ResourceBindingRef[];
    now: Date;
  }): Promise<boolean>;
  findAllowedResourceRefs(params: {
    orgId: string;
    principals: readonly PrincipalRef[];
    permission: ContentPermissionKey;
    resources: readonly ResourceBindingRef[];
    now: Date;
  }): Promise<ResourceBindingRef[]>;
}

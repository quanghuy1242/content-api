import type { ContentPermissionKey, PrincipalRef } from "@/domain/iam/content-permission";
import type { ResourceBindingRef } from "@/domain/iam/content-resource";
import type { PolicyBinding } from "@/domain/iam/policy-binding.entity";
import type { CursorPage } from "@/shared/pagination/cursor";

export interface PolicyBindingRepository {
  findMany(params: { resourceType: string; resourceId: string; limit: number; cursor?: string }): Promise<CursorPage<PolicyBinding>>;
  findById(id: string): Promise<PolicyBinding | null>;
  findActiveBookOwner(params: { orgId: string; bookId: string; now: Date }): Promise<PolicyBinding | null>;
  create(binding: PolicyBinding): Promise<PolicyBinding>;
  delete(id: string): Promise<boolean>;
  hasAllowedPermission(params: {
    orgId: string;
    principals: readonly PrincipalRef[];
    permission: ContentPermissionKey;
    resources: readonly ResourceBindingRef[];
    now: Date;
  }): Promise<boolean>;
}

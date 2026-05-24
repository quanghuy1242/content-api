import type { ContentPermissionKey } from "@/domain/iam/content-permission";
import type { ContentRole } from "@/domain/iam/content-role.entity";
import type { CursorPage } from "@/shared/pagination/cursor";

export interface ContentRoleRepository {
  ensureSystemCatalog(): Promise<void>;
  findMany(params: { namespaceId?: string; namespaceIds?: readonly string[]; limit: number; cursor?: string }): Promise<CursorPage<ContentRole>>;
  findById(id: string): Promise<ContentRole | null>;
  findPermissionKeys(roleId: string): Promise<ContentPermissionKey[]>;
  findEnabledPermissionKeys(permissionKeys: readonly ContentPermissionKey[]): Promise<ContentPermissionKey[]>;
  create(role: ContentRole, permissions: readonly ContentPermissionKey[]): Promise<ContentRole>;
  replacePermissions(role: ContentRole, permissions: readonly ContentPermissionKey[]): Promise<void>;
  disable(role: ContentRole): Promise<void>;
}

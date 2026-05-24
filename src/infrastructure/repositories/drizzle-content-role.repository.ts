import { and, eq, inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import {
  BUILT_IN_CONTENT_ROLES,
  CONTENT_PERMISSIONS,
  type ContentPermissionKey,
} from "@/domain/iam/content-permission";
import type { ContentRole } from "@/domain/iam/content-role.entity";
import type { ContentRoleRepository } from "@/domain/iam/content-role.repository";
import { contentPermissions, contentRolePermissions, contentRoles } from "@/infrastructure/db/schema";
import { CrudAdapter } from "@/infrastructure/persistence/crud-adapter";
import { contentRoleRowToEntity, contentRoleToInsertRow } from "@/infrastructure/repositories/mappers/content-iam.mapper";

type Db = DrizzleD1Database<typeof import("@/infrastructure/db/schema")>;

/** Drizzle repository for local Content IAM roles and role-permission rows. */
export class DrizzleContentRoleRepository implements ContentRoleRepository {
  private readonly crud: CrudAdapter;

  constructor(private readonly db: Db) {
    this.crud = new CrudAdapter(db);
  }

  async ensureSystemCatalog() {
    const now = new Date();
    await Promise.all(CONTENT_PERMISSIONS.map(async (permission) => {
      await this.crud.insertRow(contentPermissions, {
        key: permission.key,
        description: permission.description,
        delegationClass: permission.delegationClass,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      }, { onConflictDoNothing: true });
      await this.crud.updateRow(contentPermissions, contentPermissions.key, permission.key, {
        description: permission.description,
        delegationClass: permission.delegationClass,
        enabled: true,
        updatedAt: now,
      });
    }));

    await Promise.all(BUILT_IN_CONTENT_ROLES.map(async (role) => {
      await this.crud.insertRow(contentRoles, {
        id: role.id,
        namespaceId: "system",
        key: role.key,
        name: role.name,
        assignableResourceType: role.assignableResourceType,
        builtIn: true,
        enabled: true,
        version: 1,
        createdAt: now,
        updatedAt: now,
      }, { onConflictDoNothing: true });
      await this.crud.updateRow(contentRoles, contentRoles.id, role.id, {
        namespaceId: "system",
        key: role.key,
        name: role.name,
        assignableResourceType: role.assignableResourceType,
        builtIn: true,
        enabled: true,
        updatedAt: now,
      });
      await this.crud.deleteRows(contentRolePermissions, eq(contentRolePermissions.roleId, role.id));
      await this.insertPermissions(role.id, role.permissions);
    }));
  }

  async findMany(params: { namespaceId?: string; namespaceIds?: readonly string[]; limit: number; cursor?: string }) {
    const namespaceCondition = params.namespaceIds
      ? inArray(contentRoles.namespaceId, [...params.namespaceIds])
      : params.namespaceId
        ? eq(contentRoles.namespaceId, params.namespaceId)
        : undefined;
    const page = await this.crud.listRows<typeof contentRoles.$inferSelect>({
      table: contentRoles,
      idColumn: contentRoles.id,
      cursorColumn: contentRoles.createdAt,
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      limit: params.limit,
      cursor: params.cursor,
      where: namespaceCondition ? [namespaceCondition] : undefined,
    });
    return { data: page.data.map(contentRoleRowToEntity), page: page.page };
  }

  async findById(id: string) {
    const row = await this.crud.findRowById<typeof contentRoles.$inferSelect>(contentRoles, contentRoles.id, id);
    return row ? contentRoleRowToEntity(row) : null;
  }

  async findPermissionKeys(roleId: string): Promise<ContentPermissionKey[]> {
    const rows = await this.db
      .select({ permissionKey: contentRolePermissions.permissionKey })
      .from(contentRolePermissions)
      .where(eq(contentRolePermissions.roleId, roleId));
    return rows.map((row) => row.permissionKey as ContentPermissionKey);
  }

  async findEnabledPermissionKeys(permissionKeys: readonly ContentPermissionKey[]): Promise<ContentPermissionKey[]> {
    if (permissionKeys.length === 0) return [];
    const rows = await this.db
      .select({ key: contentPermissions.key })
      .from(contentPermissions)
      .where(and(inArray(contentPermissions.key, [...permissionKeys]), eq(contentPermissions.enabled, true)));
    return rows.map((row) => row.key as ContentPermissionKey);
  }

  async create(role: ContentRole, permissions: readonly ContentPermissionKey[]) {
    await this.crud.insertRow(contentRoles, contentRoleToInsertRow(role));
    await this.insertPermissions(role.id, permissions);
    return (await this.findById(role.id))!;
  }

  async replacePermissions(role: ContentRole, permissions: readonly ContentPermissionKey[]) {
    await this.crud.updateRow(contentRoles, contentRoles.id, role.id, contentRoleToInsertRow(role));
    await this.crud.deleteRows(contentRolePermissions, eq(contentRolePermissions.roleId, role.id));
    await this.insertPermissions(role.id, permissions);
  }

  async disable(role: ContentRole) {
    await this.crud.updateRow(contentRoles, contentRoles.id, role.id, contentRoleToInsertRow(role));
  }

  private async insertPermissions(roleId: string, permissions: readonly ContentPermissionKey[]) {
    await Promise.all(permissions.map((permission) => this.crud.insertRow(contentRolePermissions, {
      roleId,
      permissionKey: permission,
      createdAt: new Date(),
    }, { onConflictDoNothing: true })));
  }
}

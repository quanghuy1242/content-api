import { and, eq, gt, isNull, or, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { ContentPermissionKey, PrincipalRef } from "@/domain/iam/content-permission";
import type { ResourceBindingRef } from "@/domain/iam/content-resource";
import type { PolicyBindingRepository } from "@/domain/iam/policy-binding.repository";
import type { PolicyBinding } from "@/domain/iam/policy-binding.entity";
import { contentPermissions, contentPolicyBindings, contentRolePermissions, contentRoles } from "@/infrastructure/db/schema";
import { CrudAdapter } from "@/infrastructure/persistence/crud-adapter";
import { policyBindingRowToEntity, policyBindingToInsertRow } from "@/infrastructure/repositories/mappers/content-iam.mapper";

type Db = DrizzleD1Database<typeof import("@/infrastructure/db/schema")>;

/** Drizzle repository for active Content IAM binding state. */
export class DrizzlePolicyBindingRepository implements PolicyBindingRepository {
  private readonly crud: CrudAdapter;

  constructor(private readonly db: Db) {
    this.crud = new CrudAdapter(db);
  }

  async findMany(params: { orgId: string; resourceType: string; resourceId: string; limit: number; cursor?: string }) {
    const page = await this.crud.listRows<typeof contentPolicyBindings.$inferSelect>({
      table: contentPolicyBindings,
      idColumn: contentPolicyBindings.id,
      cursorColumn: contentPolicyBindings.createdAt,
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      limit: params.limit,
      cursor: params.cursor,
      where: [
        eq(contentPolicyBindings.orgId, params.orgId),
        eq(contentPolicyBindings.resourceType, params.resourceType),
        eq(contentPolicyBindings.resourceId, params.resourceId),
      ],
    });
    return { data: page.data.map(policyBindingRowToEntity), page: page.page };
  }

  async findManyForResources(params: { orgId: string; resources: readonly ResourceBindingRef[]; limit: number; cursor?: string }) {
    const page = await this.crud.listRows<typeof contentPolicyBindings.$inferSelect>({
      table: contentPolicyBindings,
      idColumn: contentPolicyBindings.id,
      cursorColumn: contentPolicyBindings.createdAt,
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      limit: params.limit,
      cursor: params.cursor,
      where: [
        eq(contentPolicyBindings.orgId, params.orgId),
        or(...resourceConditions(params.resources))!,
      ],
    });
    return { data: page.data.map(policyBindingRowToEntity), page: page.page };
  }

  async findById(id: string) {
    const row = await this.crud.findRowById<typeof contentPolicyBindings.$inferSelect>(
      contentPolicyBindings,
      contentPolicyBindings.id,
      id,
    );
    return row ? policyBindingRowToEntity(row) : null;
  }

  async create(binding: PolicyBinding) {
    await this.crud.insertRow(contentPolicyBindings, policyBindingToInsertRow(binding));
    return (await this.findById(binding.id))!;
  }

  async findActiveBookOwner(params: { orgId: string; bookId: string; now: Date }) {
    const row = await this.crud.findFirstRow<typeof contentPolicyBindings.$inferSelect>(
      contentPolicyBindings,
      and(
        eq(contentPolicyBindings.orgId, params.orgId),
        eq(contentPolicyBindings.principalType, "user"),
        eq(contentPolicyBindings.roleId, "system:book.owner"),
        eq(contentPolicyBindings.resourceType, "book"),
        eq(contentPolicyBindings.resourceId, params.bookId),
        or(isNull(contentPolicyBindings.expiresAt), gt(contentPolicyBindings.expiresAt, params.now)),
      )!,
    );
    return row ? policyBindingRowToEntity(row) : null;
  }

  async hasActiveDirectUserRoleBinding(params: {
    orgId: string;
    userId: string;
    roleId: string;
    resourceType: string;
    resourceId: string;
    now: Date;
  }) {
    const row = await this.crud.findFirstRow<typeof contentPolicyBindings.$inferSelect>(
      contentPolicyBindings,
      and(
        eq(contentPolicyBindings.orgId, params.orgId),
        eq(contentPolicyBindings.principalType, "user"),
        eq(contentPolicyBindings.principalId, params.userId),
        eq(contentPolicyBindings.roleId, params.roleId),
        eq(contentPolicyBindings.resourceType, params.resourceType),
        eq(contentPolicyBindings.resourceId, params.resourceId),
        or(isNull(contentPolicyBindings.expiresAt), gt(contentPolicyBindings.expiresAt, params.now)),
      )!,
    );
    return row !== null;
  }

  async countActiveRoleBindings(params: {
    orgId: string;
    resourceType: string;
    resourceId: string;
    roleId: string;
    now: Date;
  }) {
    const rows = await this.db
      .select({ id: contentPolicyBindings.id })
      .from(contentPolicyBindings)
      .where(and(
        eq(contentPolicyBindings.orgId, params.orgId),
        eq(contentPolicyBindings.roleId, params.roleId),
        eq(contentPolicyBindings.resourceType, params.resourceType),
        eq(contentPolicyBindings.resourceId, params.resourceId),
        or(isNull(contentPolicyBindings.expiresAt), gt(contentPolicyBindings.expiresAt, params.now)),
      ));
    return rows.length;
  }

  async countActiveBindingsForRole(params: { orgId: string; roleId: string; now: Date }) {
    const rows = await this.db
      .select({ id: contentPolicyBindings.id })
      .from(contentPolicyBindings)
      .where(and(
        eq(contentPolicyBindings.orgId, params.orgId),
        eq(contentPolicyBindings.roleId, params.roleId),
        or(isNull(contentPolicyBindings.expiresAt), gt(contentPolicyBindings.expiresAt, params.now)),
      ));
    return rows.length;
  }

  async delete(id: string) {
    return this.crud.deleteRowById(contentPolicyBindings, contentPolicyBindings.id, id);
  }

  async hasAllowedPermission(params: {
    orgId: string;
    principals: readonly PrincipalRef[];
    permission: ContentPermissionKey;
    resources: readonly ResourceBindingRef[];
    now: Date;
  }) {
    if (params.principals.length === 0 || params.resources.length === 0) return false;

    const rows = await this.allowedRows(params)
      .limit(1);

    return rows.length > 0;
  }

  async findAllowedResourceRefs(params: {
    orgId: string;
    principals: readonly PrincipalRef[];
    permission: ContentPermissionKey;
    resources: readonly ResourceBindingRef[];
    now: Date;
  }) {
    if (params.principals.length === 0 || params.resources.length === 0) return [];
    const rows = await this.allowedRows(params);
    return rows.map((row) => ({
      type: row.resourceType as ResourceBindingRef["type"],
      id: row.resourceId,
      direct: false,
    }));
  }

  private allowedRows(params: {
    orgId: string;
    principals: readonly PrincipalRef[];
    permission: ContentPermissionKey;
    resources: readonly ResourceBindingRef[];
    now: Date;
  }) {
    return this.db
      .select({
        id: contentPolicyBindings.id,
        resourceType: contentPolicyBindings.resourceType,
        resourceId: contentPolicyBindings.resourceId,
      })
      .from(contentPolicyBindings)
      .innerJoin(contentRoles, eq(contentRoles.id, contentPolicyBindings.roleId))
      .innerJoin(contentRolePermissions, eq(contentRolePermissions.roleId, contentPolicyBindings.roleId))
      .innerJoin(contentPermissions, eq(contentPermissions.key, contentRolePermissions.permissionKey))
      .where(and(
        eq(contentPolicyBindings.orgId, params.orgId),
        eq(contentRoles.enabled, true),
        eq(contentRolePermissions.permissionKey, params.permission),
        eq(contentPermissions.enabled, true),
        or(isNull(contentPolicyBindings.expiresAt), gt(contentPolicyBindings.expiresAt, params.now)),
        or(...principalConditions(params.principals)),
        or(...resourceConditions(params.resources)),
      ));
  }
}

function principalConditions(principals: readonly PrincipalRef[]): SQL<unknown>[] {
  return principals.map((principal) => and(
    eq(contentPolicyBindings.principalType, principal.type),
    eq(contentPolicyBindings.principalId, principal.id),
  )!);
}

function resourceConditions(resources: readonly ResourceBindingRef[]): SQL<unknown>[] {
  return resources.map((resource) => and(
    eq(contentPolicyBindings.resourceType, resource.type),
    eq(contentPolicyBindings.resourceId, resource.id),
  )!);
}

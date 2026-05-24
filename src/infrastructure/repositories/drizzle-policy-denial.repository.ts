import { and, eq, gt, inArray, isNull, or, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { ContentPermissionKey, PrincipalRef } from "@/domain/iam/content-permission";
import type { ResourceBindingRef } from "@/domain/iam/content-resource";
import type { PolicyDenial } from "@/domain/iam/policy-denial.entity";
import type { PolicyDenialRepository } from "@/domain/iam/policy-denial.repository";
import { contentPermissions, contentPolicyDenials } from "@/infrastructure/db/schema";
import { CrudAdapter } from "@/infrastructure/persistence/crud-adapter";
import { policyDenialRowToEntity, policyDenialToInsertRow } from "@/infrastructure/repositories/mappers/content-iam.mapper";

type Db = DrizzleD1Database<typeof import("@/infrastructure/db/schema")>;

/** Drizzle repository for active Content IAM denial state. */
export class DrizzlePolicyDenialRepository implements PolicyDenialRepository {
  private readonly crud: CrudAdapter;

  constructor(private readonly db: Db) {
    this.crud = new CrudAdapter(db);
  }

  async findMany(params: { resourceType: string; resourceId: string; limit: number; cursor?: string }) {
    const page = await this.crud.listRows<typeof contentPolicyDenials.$inferSelect>({
      table: contentPolicyDenials,
      idColumn: contentPolicyDenials.id,
      cursorColumn: contentPolicyDenials.createdAt,
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      limit: params.limit,
      cursor: params.cursor,
      where: [
        eq(contentPolicyDenials.resourceType, params.resourceType),
        eq(contentPolicyDenials.resourceId, params.resourceId),
      ],
    });
    return { data: page.data.map(policyDenialRowToEntity), page: page.page };
  }

  async findById(id: string) {
    const row = await this.crud.findRowById<typeof contentPolicyDenials.$inferSelect>(
      contentPolicyDenials,
      contentPolicyDenials.id,
      id,
    );
    return row ? policyDenialRowToEntity(row) : null;
  }

  async create(denial: PolicyDenial) {
    await this.crud.insertRow(contentPolicyDenials, policyDenialToInsertRow(denial));
    return (await this.findById(denial.id))!;
  }

  async delete(id: string) {
    return this.crud.deleteRowById(contentPolicyDenials, contentPolicyDenials.id, id);
  }

  async hasActiveDenial(params: {
    orgId: string;
    principals: readonly PrincipalRef[];
    permission: ContentPermissionKey;
    resources: readonly ResourceBindingRef[];
    now: Date;
  }) {
    if (params.principals.length === 0 || params.resources.length === 0) return false;

    const rows = await this.db
      .select({ id: contentPolicyDenials.id })
      .from(contentPolicyDenials)
      .innerJoin(contentPermissions, eq(contentPermissions.key, contentPolicyDenials.permissionKey))
      .where(and(
        eq(contentPolicyDenials.orgId, params.orgId),
        eq(contentPolicyDenials.permissionKey, params.permission),
        eq(contentPermissions.enabled, true),
        or(isNull(contentPolicyDenials.expiresAt), gt(contentPolicyDenials.expiresAt, params.now)),
        or(...principalConditions(params.principals)),
        or(...resourceConditions(params.resources)),
      ))
      .limit(1);

    return rows.length > 0;
  }
}

function principalConditions(principals: readonly PrincipalRef[]): SQL<unknown>[] {
  return principals.map((principal) => and(
    eq(contentPolicyDenials.principalType, principal.type),
    eq(contentPolicyDenials.principalId, principal.id),
  )!);
}

function resourceConditions(resources: readonly ResourceBindingRef[]): SQL<unknown>[] {
  const direct = resources.filter((resource) => resource.direct);
  const inherited = resources.filter((resource) => !resource.direct);
  return [
    ...direct.map((resource) => and(
      eq(contentPolicyDenials.resourceType, resource.type),
      eq(contentPolicyDenials.resourceId, resource.id),
    )!),
    ...(inherited.length > 0
      ? [and(
          inArray(contentPolicyDenials.resourceType, inherited.map((resource) => resource.type)),
          inArray(contentPolicyDenials.resourceId, inherited.map((resource) => resource.id)),
          eq(contentPolicyDenials.appliesToDescendants, true),
        )!]
      : []),
  ];
}

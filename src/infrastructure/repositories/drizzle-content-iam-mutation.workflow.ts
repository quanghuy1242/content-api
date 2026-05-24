import { and, eq, lte } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { ContentPermissionKey } from "@/domain/iam/content-permission";
import type { ContentIamMutationWorkflow } from "@/domain/iam/content-iam-mutation.workflow";
import {
  contentPolicyBindings,
  contentPolicyDenials,
  contentPolicyEvents,
  contentRolePermissions,
  contentRoles,
  idempotencyKeys,
} from "@/infrastructure/db/schema";
import { CrudAdapter } from "@/infrastructure/persistence/crud-adapter";
import { isSqliteUniqueConstraintError } from "@/infrastructure/persistence/sqlite-errors";
import { idempotencyToInsertRow } from "@/infrastructure/repositories/mappers/idempotency.mapper";
import {
  contentRoleToInsertRow,
  policyBindingToInsertRow,
  policyDenialToInsertRow,
  policyEventToInsertRow,
} from "@/infrastructure/repositories/mappers/content-iam.mapper";
import { ConflictError, IdempotencyReservationConflictError } from "@/shared/errors";

type Db = DrizzleD1Database<typeof import("@/infrastructure/db/schema")>;

/** Atomic D1 workflows for Content IAM security-state mutations and audit rows. */
export class DrizzleContentIamMutationWorkflow implements ContentIamMutationWorkflow {
  private readonly crud: CrudAdapter;

  constructor(private readonly db: Db) {
    this.crud = new CrudAdapter(db);
  }

  async createBinding(params: Parameters<ContentIamMutationWorkflow["createBinding"]>[0]) {
    await this.runBatch([
      ...this.idempotencyStatement(params.idempotency),
      ...this.deleteExpiredBindingStatements(params.binding),
      this.crud.buildInsert(contentPolicyBindings, policyBindingToInsertRow(params.binding)),
      this.crud.buildInsert(contentPolicyEvents, policyEventToInsertRow(params.event)),
    ]);
  }

  async revokeBinding(params: Parameters<ContentIamMutationWorkflow["revokeBinding"]>[0]) {
    await this.runBatch([
      this.crud.buildDelete(contentPolicyBindings, eq(contentPolicyBindings.id, params.binding.id)),
      this.crud.buildInsert(contentPolicyEvents, policyEventToInsertRow(params.event)),
    ]);
  }

  async createDenial(params: Parameters<ContentIamMutationWorkflow["createDenial"]>[0]) {
    await this.runBatch([
      ...this.idempotencyStatement(params.idempotency),
      ...this.deleteExpiredDenialStatements(params.denial),
      this.crud.buildInsert(contentPolicyDenials, policyDenialToInsertRow(params.denial)),
      this.crud.buildInsert(contentPolicyEvents, policyEventToInsertRow(params.event)),
    ]);
  }

  async revokeDenial(params: Parameters<ContentIamMutationWorkflow["revokeDenial"]>[0]) {
    await this.runBatch([
      this.crud.buildDelete(contentPolicyDenials, eq(contentPolicyDenials.id, params.denial.id)),
      this.crud.buildInsert(contentPolicyEvents, policyEventToInsertRow(params.event)),
    ]);
  }

  async transferBookOwnership(params: Parameters<ContentIamMutationWorkflow["transferBookOwnership"]>[0]) {
    await this.runBatch([
      this.crud.buildInsert(idempotencyKeys, idempotencyToInsertRow(params.idempotency)),
      this.crud.buildDelete(contentPolicyBindings, eq(contentPolicyBindings.id, params.currentOwner.id)),
      this.crud.buildInsert(contentPolicyBindings, policyBindingToInsertRow(params.nextOwner)),
      this.crud.buildInsert(contentPolicyEvents, policyEventToInsertRow(params.event)),
    ]);
  }

  async createRole(params: Parameters<ContentIamMutationWorkflow["createRole"]>[0]) {
    await this.runBatch([
      this.crud.buildInsert(idempotencyKeys, idempotencyToInsertRow(params.idempotency)),
      this.crud.buildInsert(contentRoles, contentRoleToInsertRow(params.role)),
      ...this.permissionStatements(params.role.id, params.permissions),
      this.crud.buildInsert(contentPolicyEvents, policyEventToInsertRow(params.event)),
    ]);
  }

  async replaceRolePermissions(params: Parameters<ContentIamMutationWorkflow["replaceRolePermissions"]>[0]) {
    await this.runBatch([
      this.crud.buildInsert(idempotencyKeys, idempotencyToInsertRow(params.idempotency)),
      this.crud.buildUpdate(contentRoles, contentRoleToInsertRow(params.role), eq(contentRoles.id, params.role.id)),
      this.crud.buildDelete(contentRolePermissions, eq(contentRolePermissions.roleId, params.role.id)),
      ...this.permissionStatements(params.role.id, params.permissions),
      this.crud.buildInsert(contentPolicyEvents, policyEventToInsertRow(params.event)),
    ]);
  }

  async disableRole(params: Parameters<ContentIamMutationWorkflow["disableRole"]>[0]) {
    await this.runBatch([
      this.crud.buildUpdate(contentRoles, contentRoleToInsertRow(params.role), eq(contentRoles.id, params.role.id)),
      this.crud.buildInsert(contentPolicyEvents, policyEventToInsertRow(params.event)),
    ]);
  }

  async recordEvent(event: Parameters<ContentIamMutationWorkflow["recordEvent"]>[0]) {
    await this.crud.insertRow(contentPolicyEvents, policyEventToInsertRow(event));
  }

  private idempotencyStatement(idempotency: Parameters<ContentIamMutationWorkflow["createBinding"]>[0]["idempotency"]) {
    return idempotency ? [this.crud.buildInsert(idempotencyKeys, idempotencyToInsertRow(idempotency))] : [];
  }

  private permissionStatements(roleId: string, permissions: readonly ContentPermissionKey[]) {
    return permissions.map((permissionKey) =>
      this.crud.buildInsert(contentRolePermissions, {
        roleId,
        permissionKey,
        createdAt: new Date(),
      }),
    );
  }

  private deleteExpiredBindingStatements(binding: Parameters<ContentIamMutationWorkflow["createBinding"]>[0]["binding"]) {
    const snapshot = binding.toSnapshot();
    return [
      this.crud.buildDelete(contentPolicyBindings, and(
        eq(contentPolicyBindings.orgId, snapshot.orgId),
        eq(contentPolicyBindings.principalType, snapshot.principalType),
        eq(contentPolicyBindings.principalId, snapshot.principalId),
        eq(contentPolicyBindings.roleId, snapshot.roleId),
        eq(contentPolicyBindings.resourceType, snapshot.resourceType),
        eq(contentPolicyBindings.resourceId, snapshot.resourceId),
        lte(contentPolicyBindings.expiresAt, new Date()),
      )!),
    ];
  }

  private deleteExpiredDenialStatements(denial: Parameters<ContentIamMutationWorkflow["createDenial"]>[0]["denial"]) {
    const snapshot = denial.toSnapshot();
    return [
      this.crud.buildDelete(contentPolicyDenials, and(
        eq(contentPolicyDenials.orgId, snapshot.orgId),
        eq(contentPolicyDenials.principalType, snapshot.principalType),
        eq(contentPolicyDenials.principalId, snapshot.principalId),
        eq(contentPolicyDenials.permissionKey, snapshot.permissionKey),
        eq(contentPolicyDenials.resourceType, snapshot.resourceType),
        eq(contentPolicyDenials.resourceId, snapshot.resourceId),
        lte(contentPolicyDenials.expiresAt, new Date()),
      )!),
    ];
  }

  private async runBatch(statements: BatchItem<"sqlite">[]) {
    try {
      await this.db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    } catch (error) {
      if (isSqliteUniqueConstraintError(error, "idempotency_keys.key")) {
        throw new IdempotencyReservationConflictError();
      }
      if (isSqliteUniqueConstraintError(error)) {
        throw new ConflictError("Content IAM state already exists or changed concurrently");
      }
      throw error;
    }
  }
}

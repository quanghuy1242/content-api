import type { Actor } from "@/domain/auth/actor";
import type { IdempotencyRepository } from "@/domain/idempotency/idempotency.repository";
import type { ContentAdministrationPolicy } from "@/domain/iam/content-administration.policy";
import type { ContentIamMutationWorkflow } from "@/domain/iam/content-iam-mutation.workflow";
import { assertContentPermissionKey, type ContentPermissionKey } from "@/domain/iam/content-permission";
import type { ContentRoleRepository } from "@/domain/iam/content-role.repository";
import { PolicyEvent } from "@/domain/iam/policy-event.entity";
import { ORG_CONTENT_ROLE_PERMISSIONS_REPLACE_ROUTE } from "@/shared/constants";
import { ConflictError, NotFoundError, ValidationError } from "@/shared/errors";
import { recordDeniedPolicyMutation } from "@/domain/iam/audit-denied-mutation";
import { deserializeRoleMutation, serializeRoleMutation } from "@/domain/iam/content-iam-snapshot";
import {
  executeIdempotentContentIamMutation,
  requireIdempotencyKey,
} from "@/domain/iam/idempotent-content-iam";
import { organizationResource } from "@/domain/iam/resource-loader";
import type { IntrospectPresentedToken } from "@/domain/auth/introspection-port";
import { assertTokenActive } from "@/application/content-iam/assert-token-active";

export type ReplaceContentRolePermissionsInput = {
  expectedVersion: number;
  permissions: string[];
  reason?: string | null;
};

export class ReplaceContentRolePermissionsUseCase {
  constructor(
    private readonly roles: ContentRoleRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly workflow: ContentIamMutationWorkflow,
    private readonly administrationPolicy: ContentAdministrationPolicy,
    private readonly introspection: IntrospectPresentedToken,
  ) {}

  async execute(params: {
    actor: Actor;
    orgId: string;
    roleId: string;
    idempotencyKey?: string;
    input: ReplaceContentRolePermissionsInput;
    requestId?: string;
    bearerToken: string;
  }) {
    await assertTokenActive(this.introspection, params.bearerToken);
    await this.roles.ensureSystemCatalog();
    const role = await this.roles.findById(params.roleId);
    if (!role || role.namespaceId !== params.orgId) throw new NotFoundError("Content role not found");
    if (role.version !== params.input.expectedVersion) {
      throw new ConflictError("Content role changed before permission replacement");
    }
    const permissions = await this.validatePermissions(params.input.permissions);
    role.incrementVersion();
    const resource = organizationResource(params.orgId);
    try {
      await this.administrationPolicy.authorizeRoleCompositionMutation({
        actor: params.actor,
        organization: resource,
        role,
        nextPermissions: permissions,
      });
    } catch (error) {
      await recordDeniedPolicyMutation({
        workflow: this.workflow,
        actor: params.actor,
        resource,
        operation: "role.permissions.replace",
        reason: error instanceof Error ? error.message : "Content IAM role permission replacement denied",
        requestId: params.requestId,
      });
      throw error;
    }

    const event = PolicyEvent.create({
      orgId: params.orgId,
      targetType: "org",
      targetId: params.orgId,
      action: "role.permissions_updated",
      actorType: "user",
      actorId: params.actor.type === "user" ? params.actor.subject : "service_account",
      requestId: params.requestId ?? null,
      reason: params.input.reason ?? null,
      snapshotJson: JSON.stringify({ role: role.toSnapshot(), permissions }),
    });

    return executeIdempotentContentIamMutation({
      idempotency: this.idempotency,
      key: requireIdempotencyKey(params.idempotencyKey),
      actor: params.actor,
      route: ORG_CONTENT_ROLE_PERMISSIONS_REPLACE_ROUTE,
      input: { orgId: params.orgId, roleId: params.roleId, body: params.input },
      responseJson: () => serializeRoleMutation(role, event, permissions),
      replay: deserializeRoleMutation,
      commit: async ({ idempotency }) => {
        await this.workflow.replaceRolePermissions({ role, permissions, event, idempotency });
        return { role, permissions, event };
      },
    });
  }

  private async validatePermissions(values: readonly string[]): Promise<ContentPermissionKey[]> {
    const permissions = values.map((value) => {
      assertContentPermissionKey(value);
      return value;
    });
    const enabled = await this.roles.findEnabledPermissionKeys(permissions);
    if (enabled.length !== permissions.length) {
      throw new ValidationError("Content role references disabled or unknown permissions");
    }
    return permissions;
  }
}

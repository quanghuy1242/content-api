import type { Actor } from "@/domain/authz/actor";
import type { IdempotencyRepository } from "@/domain/idempotency/idempotency.repository";
import type { ContentAdministrationPolicy } from "@/domain/iam/content-administration.policy";
import type { ContentIamMutationWorkflow } from "@/domain/iam/content-iam-mutation.workflow";
import {
  assertContentPermissionKey,
  type ContentPermissionKey,
  type ContentResourceType,
} from "@/domain/iam/content-permission";
import { ContentRole } from "@/domain/iam/content-role.entity";
import type { ContentRoleRepository } from "@/domain/iam/content-role.repository";
import { PolicyEvent } from "@/domain/iam/policy-event.entity";
import { ORG_CONTENT_ROLE_CREATE_ROUTE } from "@/shared/constants";
import { ValidationError } from "@/shared/errors";
import { recordDeniedPolicyMutation } from "@/application/content-iam/audit-denied-mutation";
import { deserializeRoleMutation, serializeRoleMutation } from "@/application/content-iam/content-iam-snapshot";
import {
  executeIdempotentContentIamMutation,
  requireIdempotencyKey,
} from "@/application/content-iam/idempotent-content-iam";
import { organizationResource } from "@/application/content-iam/resource-loader";

export type CreateContentRoleInput = {
  key: string;
  name: string;
  assignableResourceType: ContentResourceType;
  permissions: string[];
  reason?: string | null;
};

export class CreateContentRoleUseCase {
  constructor(
    private readonly roles: ContentRoleRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly workflow: ContentIamMutationWorkflow,
    private readonly administrationPolicy: ContentAdministrationPolicy,
  ) {}

  async execute(params: {
    actor: Actor;
    orgId: string;
    idempotencyKey?: string;
    input: CreateContentRoleInput;
    requestId?: string;
  }) {
    await this.roles.ensureSystemCatalog();
    const permissions = await this.validatePermissions(params.input.permissions);
    const resource = organizationResource(params.orgId);
    const role = ContentRole.create({
      namespaceId: params.orgId,
      key: params.input.key,
      name: params.input.name,
      assignableResourceType: params.input.assignableResourceType,
      builtIn: false,
      enabled: true,
    });
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
        operation: "role.create",
        reason: error instanceof Error ? error.message : "Content IAM role create denied",
        requestId: params.requestId,
      });
      throw error;
    }

    const event = PolicyEvent.create({
      orgId: params.orgId,
      targetType: "org",
      targetId: params.orgId,
      action: "role.created",
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
      route: ORG_CONTENT_ROLE_CREATE_ROUTE,
      input: params.input,
      responseJson: () => serializeRoleMutation(role, event, permissions),
      replay: deserializeRoleMutation,
      commit: async ({ idempotency }) => {
        await this.workflow.createRole({ role, permissions, event, idempotency });
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

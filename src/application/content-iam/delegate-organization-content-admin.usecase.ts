import type { Actor } from "@/domain/authz/actor";
import type { IdempotencyRepository } from "@/domain/idempotency/idempotency.repository";
import type { ContentIamMutationWorkflow } from "@/domain/iam/content-iam-mutation.workflow";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import type { ContentPrincipalDirectory } from "@/domain/iam/content-principal-directory";
import type { ContentRoleRepository } from "@/domain/iam/content-role.repository";
import { PolicyBinding } from "@/domain/iam/policy-binding.entity";
import { PolicyEvent } from "@/domain/iam/policy-event.entity";
import { ORG_CONTENT_ADMIN_DELEGATE_ROUTE } from "@/shared/constants";
import { ForbiddenError } from "@/shared/errors";
import { deserializeBindingMutation, serializeBindingMutation } from "@/domain/iam/content-iam-snapshot";
import {
  executeIdempotentContentIamMutation,
  requireIdempotencyKey,
} from "@/domain/iam/idempotent-content-iam";
import { organizationResource } from "@/domain/iam/resource-loader";

export type DelegateOrganizationContentAdminInput = {
  userId: string;
  reason?: string | null;
};

export class DelegateOrganizationContentAdminUseCase {
  constructor(
    private readonly roles: ContentRoleRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly workflow: ContentIamMutationWorkflow,
    private readonly principalDirectory: ContentPrincipalDirectory,
    private readonly contentPolicy: ContentPolicy,
  ) {}

  async execute(params: {
    actor: Actor;
    orgId: string;
    idempotencyKey?: string;
    input: DelegateOrganizationContentAdminInput;
    requestId?: string;
  }) {
    const resource = organizationResource(params.orgId);
    if (params.actor.type !== "user" || params.actor.organizationId !== params.orgId || !params.actor.scopes.includes("content:share")) {
      throw new ForbiddenError("Organization Content IAM admin delegation requires matching workspace context");
    }
    await this.roles.ensureSystemCatalog();
    const allowed = await this.contentPolicy.can({ actor: params.actor, permission: "org.manage_bindings", resource });
    if (!allowed) throw new ForbiddenError("Not authorized to delegate organization Content IAM administration");
    await this.principalDirectory.validateUserInOrganization({ userId: params.input.userId, orgId: params.orgId });

    const binding = PolicyBinding.create({
      orgId: params.orgId,
      principalType: "user",
      principalId: params.input.userId,
      roleId: "system:org.content_admin",
      resourceType: "org",
      resourceId: params.orgId,
      expiresAt: null,
      createdByType: "user",
      createdById: params.actor.subject,
    });
    const event = PolicyEvent.create({
      orgId: params.orgId,
      targetType: "org",
      targetId: params.orgId,
      action: "org_admin.delegated",
      actorType: "user",
      actorId: params.actor.subject,
      requestId: params.requestId ?? null,
      reason: params.input.reason ?? null,
      snapshotJson: JSON.stringify(binding.toSnapshot()),
    });

    return executeIdempotentContentIamMutation({
      idempotency: this.idempotency,
      key: requireIdempotencyKey(params.idempotencyKey),
      actor: params.actor,
      route: ORG_CONTENT_ADMIN_DELEGATE_ROUTE,
      input: { orgId: params.orgId, body: params.input },
      responseJson: () => serializeBindingMutation(binding, event),
      replay: deserializeBindingMutation,
      commit: async ({ idempotency }) => {
        await this.workflow.createBinding({ binding, event, idempotency });
        return { binding, event };
      },
    });
  }
}

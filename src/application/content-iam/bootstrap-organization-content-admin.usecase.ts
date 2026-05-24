import type { Actor } from "@/domain/auth/actor";
import type { IdempotencyRepository } from "@/domain/idempotency/idempotency.repository";
import type { ContentIamMutationWorkflow } from "@/domain/iam/content-iam-mutation.workflow";
import type { ContentPrincipalDirectory } from "@/domain/iam/content-principal-directory";
import type { ContentRoleRepository } from "@/domain/iam/content-role.repository";
import type { PolicyBindingRepository } from "@/domain/iam/policy-binding.repository";
import { PolicyBinding } from "@/domain/iam/policy-binding.entity";
import { PolicyEvent } from "@/domain/iam/policy-event.entity";
import { recordDeniedPolicyMutation } from "@/domain/iam/audit-denied-mutation";
import { ForbiddenError } from "@/shared/errors";
import { ORG_CONTENT_ADMIN_BOOTSTRAP_ROUTE } from "@/shared/constants";
import { deserializeBindingMutation, serializeBindingMutation } from "@/domain/iam/content-iam-snapshot";
import {
  executeIdempotentContentIamMutation,
  requireIdempotencyKey,
} from "@/domain/iam/idempotent-content-iam";
import { organizationResource } from "@/domain/iam/resource-loader";

export class BootstrapOrganizationContentAdminUseCase {
  constructor(
    private readonly roles: ContentRoleRepository,
    private readonly bindings: PolicyBindingRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly workflow: ContentIamMutationWorkflow,
    private readonly principalDirectory: ContentPrincipalDirectory,
  ) {}

  async execute(params: {
    actor: Actor;
    orgId: string;
    userId: string;
    idempotencyKey?: string;
    reason?: string | null;
    requestId?: string;
  }) {
    const resource = organizationResource(params.orgId);
    if (
      params.actor.type !== "user" ||
      params.actor.subject !== params.userId ||
      params.actor.organizationId !== params.orgId ||
      !params.actor.scopes.includes("content:share")
    ) {
      throw new ForbiddenError("Organization Content IAM bootstrap requires the target workspace user");
    }
    await this.roles.ensureSystemCatalog();
    await this.principalDirectory.validateOrganizationAdministrator({ userId: params.userId, orgId: params.orgId });

    const binding = PolicyBinding.create({
      orgId: params.orgId,
      principalType: "user",
      principalId: params.userId,
      roleId: "system:org.content_admin",
      resourceType: resource.type,
      resourceId: resource.id,
      expiresAt: null,
      createdByType: "user",
      createdById: params.userId,
    });
    const event = PolicyEvent.create({
      orgId: params.orgId,
      targetType: resource.type,
      targetId: resource.id,
      action: "org_admin.bootstrap",
      actorType: "user",
      actorId: params.userId,
      requestId: params.requestId ?? null,
      reason: params.reason ?? null,
      snapshotJson: JSON.stringify(binding.toSnapshot()),
    });
    return executeIdempotentContentIamMutation({
      idempotency: this.idempotency,
      key: requireIdempotencyKey(params.idempotencyKey),
      actor: params.actor,
      route: ORG_CONTENT_ADMIN_BOOTSTRAP_ROUTE,
      input: { orgId: params.orgId, userId: params.userId, reason: params.reason ?? null },
      responseJson: () => serializeBindingMutation(binding, event),
      replay: deserializeBindingMutation,
      commit: async ({ idempotency }) => {
        const activeAdmins = await this.bindings.countActiveRoleBindings({
          orgId: params.orgId,
          resourceType: "org",
          resourceId: params.orgId,
          roleId: "system:org.content_admin",
          now: new Date(),
        });
        if (activeAdmins > 0) {
          await recordDeniedPolicyMutation({
            workflow: this.workflow,
            actor: params.actor,
            resource,
            operation: "org_admin.bootstrap",
            reason: "Organization Content IAM bootstrap is only allowed before a local admin exists",
            requestId: params.requestId,
          });
          throw new ForbiddenError("Organization Content IAM bootstrap is only allowed before a local admin exists");
        }
        await this.workflow.bootstrapOrganizationAdmin({ binding, event, idempotency });
        return { binding, event };
      },
    });
  }
}

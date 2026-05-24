import type { Actor } from "@/domain/authz/actor";
import type { ContentAdministrationPolicy } from "@/domain/iam/content-administration.policy";
import type { ContentIamMutationWorkflow } from "@/domain/iam/content-iam-mutation.workflow";
import type { ContentRoleRepository } from "@/domain/iam/content-role.repository";
import type { PolicyBindingRepository } from "@/domain/iam/policy-binding.repository";
import { recordDeniedPolicyMutation } from "@/domain/iam/audit-denied-mutation";
import { PolicyEvent } from "@/domain/iam/policy-event.entity";
import { NotFoundError, ValidationError } from "@/shared/errors";
import { organizationResource } from "@/domain/iam/resource-loader";

export class DisableContentRoleUseCase {
  constructor(
    private readonly roles: ContentRoleRepository,
    private readonly bindings: PolicyBindingRepository,
    private readonly workflow: ContentIamMutationWorkflow,
    private readonly administrationPolicy: ContentAdministrationPolicy,
  ) {}

  async execute(params: { actor: Actor; orgId: string; roleId: string; requestId?: string }) {
    await this.roles.ensureSystemCatalog();
    const role = await this.roles.findById(params.roleId);
    if (!role || role.namespaceId !== params.orgId) throw new NotFoundError("Content role not found");
    const existingPermissions = await this.roles.findPermissionKeys(role.id);
    const resource = organizationResource(params.orgId);
    try {
      await this.administrationPolicy.authorizeRoleCompositionMutation({
        actor: params.actor,
        organization: resource,
        role,
        nextPermissions: existingPermissions,
      });
      const activeBindings = await this.bindings.countActiveBindingsForRole({
        orgId: params.orgId,
        roleId: role.id,
        now: new Date(),
      });
      if (activeBindings > 0) {
        throw new ValidationError("Content role must have no active bindings before it can be disabled");
      }
    } catch (error) {
      await recordDeniedPolicyMutation({
        workflow: this.workflow,
        actor: params.actor,
        resource,
        operation: "role.disable",
        reason: error instanceof Error ? error.message : "Content IAM role disable denied",
        requestId: params.requestId,
      });
      throw error;
    }

    role.disable();
    const event = PolicyEvent.create({
      orgId: params.orgId,
      targetType: "org",
      targetId: params.orgId,
      action: "role.disabled",
      actorType: "user",
      actorId: params.actor.type === "user" ? params.actor.subject : "service_account",
      requestId: params.requestId ?? null,
      reason: null,
      snapshotJson: JSON.stringify(role.toSnapshot()),
    });
    await this.workflow.disableRole({ role, event });
    return event;
  }
}

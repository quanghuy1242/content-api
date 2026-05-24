import type { Actor } from "@/domain/authz/actor";
import type { ContentAdministrationPolicy } from "@/domain/iam/content-administration.policy";
import type { ContentIamMutationWorkflow } from "@/domain/iam/content-iam-mutation.workflow";
import type { ContentRoleRepository } from "@/domain/iam/content-role.repository";
import { PolicyEvent } from "@/domain/iam/policy-event.entity";
import { NotFoundError } from "@/shared/errors";
import { organizationResource } from "@/application/content-iam/resource-loader";

export class DisableContentRoleUseCase {
  constructor(
    private readonly roles: ContentRoleRepository,
    private readonly workflow: ContentIamMutationWorkflow,
    private readonly administrationPolicy: ContentAdministrationPolicy,
  ) {}

  async execute(params: { actor: Actor; orgId: string; roleId: string; requestId?: string }) {
    await this.roles.ensureSystemCatalog();
    const role = await this.roles.findById(params.roleId);
    if (!role || role.namespaceId !== params.orgId) throw new NotFoundError("Content role not found");
    const existingPermissions = await this.roles.findPermissionKeys(role.id);
    await this.administrationPolicy.authorizeRoleCompositionMutation({
      actor: params.actor,
      organization: organizationResource(params.orgId),
      role,
      nextPermissions: existingPermissions,
    });

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

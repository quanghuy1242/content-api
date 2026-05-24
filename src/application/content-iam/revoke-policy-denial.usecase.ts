import type { Actor } from "@/domain/auth/actor";
import type { BookRepository } from "@/domain/books/book.repository";
import type { ContentAdministrationPolicy } from "@/domain/iam/content-administration.policy";
import type { ContentIamMutationWorkflow } from "@/domain/iam/content-iam-mutation.workflow";
import type { PolicyDenialRepository } from "@/domain/iam/policy-denial.repository";
import { recordDeniedPolicyMutation } from "@/domain/iam/audit-denied-mutation";
import { PolicyEvent } from "@/domain/iam/policy-event.entity";
import { NotFoundError } from "@/shared/errors";
import { loadContentResource, type ContentResourceInput } from "@/domain/iam/resource-loader";

export class RevokePolicyDenialUseCase {
  constructor(
    private readonly books: BookRepository,
    private readonly denials: PolicyDenialRepository,
    private readonly workflow: ContentIamMutationWorkflow,
    private readonly administrationPolicy: ContentAdministrationPolicy,
  ) {}

  async execute(params: { actor: Actor; resource: ContentResourceInput; denialId: string; requestId?: string }) {
    const resource = await loadContentResource(this.books, params.resource);
    const denial = await this.denials.findById(params.denialId);
    if (!denial || denial.resourceType !== resource.type || denial.resourceId !== resource.id) {
      throw new NotFoundError("Policy denial not found");
    }
    try {
      await this.administrationPolicy.authorizeDenialMutation({
        actor: params.actor,
        resource,
        permission: denial.permissionKey,
        principal: { type: denial.principalType, id: denial.principalId },
      });
    } catch (error) {
      await recordDeniedPolicyMutation({
        workflow: this.workflow,
        actor: params.actor,
        resource,
        operation: "denial.revoke",
        reason: error instanceof Error ? error.message : "Content IAM denial revoke denied",
        requestId: params.requestId,
      });
      throw error;
    }
    const event = PolicyEvent.create({
      orgId: resource.orgId,
      targetType: resource.type,
      targetId: resource.id,
      action: "denial.revoked",
      actorType: "user",
      actorId: params.actor.type === "user" ? params.actor.subject : "service_account",
      requestId: params.requestId ?? null,
      reason: null,
      snapshotJson: JSON.stringify(denial.toSnapshot()),
    });
    await this.workflow.revokeDenial({ denial, event });
    return event;
  }
}

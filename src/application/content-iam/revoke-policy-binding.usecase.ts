import type { Actor } from "@/domain/authz/actor";
import type { BookRepository } from "@/domain/books/book.repository";
import type { ContentAdministrationPolicy } from "@/domain/iam/content-administration.policy";
import type { ContentIamMutationWorkflow } from "@/domain/iam/content-iam-mutation.workflow";
import type { PolicyBindingRepository } from "@/domain/iam/policy-binding.repository";
import { PolicyEvent } from "@/domain/iam/policy-event.entity";
import { NotFoundError } from "@/shared/errors";
import { loadContentResource, type ContentResourceInput } from "@/application/content-iam/resource-loader";

export class RevokePolicyBindingUseCase {
  constructor(
    private readonly books: BookRepository,
    private readonly bindings: PolicyBindingRepository,
    private readonly workflow: ContentIamMutationWorkflow,
    private readonly administrationPolicy: ContentAdministrationPolicy,
  ) {}

  async execute(params: { actor: Actor; resource: ContentResourceInput; bindingId: string; requestId?: string }) {
    const resource = await loadContentResource(this.books, params.resource);
    const binding = await this.bindings.findById(params.bindingId);
    if (!binding || binding.resourceType !== resource.type || binding.resourceId !== resource.id) {
      throw new NotFoundError("Policy binding not found");
    }
    await this.administrationPolicy.authorizeBindingRevoke({
      actor: params.actor,
      resource,
      existingBinding: binding,
    });
    const event = PolicyEvent.create({
      orgId: resource.orgId,
      targetType: resource.type,
      targetId: resource.id,
      action: "binding.revoked",
      actorType: "user",
      actorId: params.actor.type === "user" ? params.actor.subject : "service_account",
      requestId: params.requestId ?? null,
      reason: null,
      snapshotJson: JSON.stringify(binding.toSnapshot()),
    });
    await this.workflow.revokeBinding({ binding, event });
    return event;
  }
}

import type { Actor } from "@/domain/auth/actor";
import type { BookRepository } from "@/domain/books/book.repository";
import type { ContentAdministrationPolicy } from "@/domain/iam/content-administration.policy";
import type { ContentIamMutationWorkflow } from "@/domain/iam/content-iam-mutation.workflow";
import type { PolicyBindingRepository } from "@/domain/iam/policy-binding.repository";
import { PolicyEvent } from "@/domain/iam/policy-event.entity";
import { recordDeniedPolicyMutation } from "@/domain/iam/audit-denied-mutation";
import { NotFoundError, ValidationError } from "@/shared/errors";
import { loadContentResource, type ContentResourceInput } from "@/domain/iam/resource-loader";
import type { IntrospectPresentedToken } from "@/domain/auth/introspection-port";
import { assertTokenActive } from "@/application/content-iam/assert-token-active";

export class RevokePolicyBindingUseCase {
  constructor(
    private readonly books: BookRepository,
    private readonly bindings: PolicyBindingRepository,
    private readonly workflow: ContentIamMutationWorkflow,
    private readonly administrationPolicy: ContentAdministrationPolicy,
    private readonly introspection: IntrospectPresentedToken,
  ) {}

  async execute(params: {
    actor: Actor;
    resource: ContentResourceInput;
    bindingId: string;
    adminRevocation?: boolean;
    requestId?: string;
    bearerToken: string;
  }) {
    await assertTokenActive(this.introspection, params.bearerToken);
    const resource = await loadContentResource(this.books, params.resource);
    const binding = await this.bindings.findById(params.bindingId);
    if (!binding || binding.resourceType !== resource.type || binding.resourceId !== resource.id) {
      throw new NotFoundError("Policy binding not found");
    }
    try {
      if (binding.roleId === "system:org.content_admin" && !params.adminRevocation) {
        throw new ValidationError("Organization administrators must be revoked through the dedicated admin route");
      }
      await this.administrationPolicy.authorizeBindingRevoke({
        actor: params.actor,
        resource,
        existingBinding: binding,
      });
      if (binding.roleId === "system:org.content_admin") {
        const activeAdmins = await this.bindings.countActiveRoleBindings({
          orgId: resource.orgId,
          resourceType: "org",
          resourceId: resource.orgId,
          roleId: "system:org.content_admin",
          now: new Date(),
        });
        if (activeAdmins <= 1) {
          throw new ValidationError("Cannot revoke the last organization Content IAM administrator");
        }
      }
    } catch (error) {
      await recordDeniedPolicyMutation({
        workflow: this.workflow,
        actor: params.actor,
        resource,
        operation: "binding.revoke",
        reason: error instanceof Error ? error.message : "Content IAM binding revoke denied",
        requestId: params.requestId,
      });
      throw error;
    }
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

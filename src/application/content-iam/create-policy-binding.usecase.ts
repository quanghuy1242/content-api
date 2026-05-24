import type { Actor } from "@/domain/authz/actor";
import type { BookRepository } from "@/domain/books/book.repository";
import type { ContentAdministrationPolicy } from "@/domain/iam/content-administration.policy";
import type { ContentIamMutationWorkflow } from "@/domain/iam/content-iam-mutation.workflow";
import type { ContentPrincipalDirectory } from "@/domain/iam/content-principal-directory";
import type { ContentRoleRepository } from "@/domain/iam/content-role.repository";
import { deriveDelegationClass, type PrincipalRef } from "@/domain/iam/content-permission";
import type { ContentRole } from "@/domain/iam/content-role.entity";
import { PolicyBinding } from "@/domain/iam/policy-binding.entity";
import { PolicyEvent } from "@/domain/iam/policy-event.entity";
import type { IdempotencyRepository } from "@/domain/idempotency/idempotency.repository";
import { NotFoundError } from "@/shared/errors";
import {
  BOOK_POLICY_BINDINGS_CREATE_ROUTE,
  ORG_POLICY_BINDINGS_CREATE_ROUTE,
} from "@/shared/constants";
import {
  deserializeBindingMutation,
  serializeBindingMutation,
} from "@/domain/iam/content-iam-snapshot";
import { recordDeniedPolicyMutation } from "@/domain/iam/audit-denied-mutation";
import {
  executeIdempotentContentIamMutation,
  requireIdempotencyKey,
} from "@/domain/iam/idempotent-content-iam";
import { loadContentResource, type ContentResourceInput } from "@/domain/iam/resource-loader";

export type CreatePolicyBindingInput = {
  principal: PrincipalRef;
  roleId: string;
  expiresAt?: string | null;
  reason?: string | null;
};

export class CreatePolicyBindingUseCase {
  constructor(
    private readonly books: BookRepository,
    private readonly roles: ContentRoleRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly workflow: ContentIamMutationWorkflow,
    private readonly principalDirectory: ContentPrincipalDirectory,
    private readonly administrationPolicy: ContentAdministrationPolicy,
    private readonly contentApiAudience: string,
  ) {}

  async execute(params: {
    actor: Actor;
    resource: ContentResourceInput;
    idempotencyKey?: string;
    input: CreatePolicyBindingInput;
    requestId?: string;
  }) {
    const resource = await loadContentResource(this.books, params.resource);
    await this.roles.ensureSystemCatalog();
    const role = await this.roles.findById(params.input.roleId);
    if (!role) throw new NotFoundError("Content role not found");

    try {
      await this.administrationPolicy.authorizeBindingCreate({
        actor: params.actor,
        resource,
        proposedRole: role,
        principal: params.input.principal,
      });
    } catch (error) {
      await recordDeniedPolicyMutation({
        workflow: this.workflow,
        actor: params.actor,
        resource,
        operation: "binding.create",
        reason: error instanceof Error ? error.message : "Content IAM binding create denied",
        requestId: params.requestId,
      });
      throw error;
    }
    await this.validatePrincipal(params.input.principal, resource.orgId, resource.type, role);

    const binding = PolicyBinding.create({
      orgId: resource.orgId,
      principalType: params.input.principal.type,
      principalId: params.input.principal.id,
      roleId: role.id,
      resourceType: resource.type,
      resourceId: resource.id,
      expiresAt: params.input.expiresAt ? new Date(params.input.expiresAt) : null,
      createdByType: "user",
      createdById: params.actor.type === "user" ? params.actor.subject : "service_account",
    });
    const event = PolicyEvent.create({
      orgId: resource.orgId,
      targetType: resource.type,
      targetId: resource.id,
      action: "binding.created",
      actorType: "user",
      actorId: params.actor.type === "user" ? params.actor.subject : "service_account",
      requestId: params.requestId ?? null,
      reason: params.input.reason ?? null,
      snapshotJson: JSON.stringify(binding.toSnapshot()),
    });
    const route = resource.type === "book" ? BOOK_POLICY_BINDINGS_CREATE_ROUTE : ORG_POLICY_BINDINGS_CREATE_ROUTE;
    return executeIdempotentContentIamMutation({
      idempotency: this.idempotency,
      key: requireIdempotencyKey(params.idempotencyKey),
      actor: params.actor,
      route,
      input: { resource: { type: resource.type, id: resource.id }, body: params.input },
      responseJson: () => serializeBindingMutation(binding, event),
      replay: deserializeBindingMutation,
      commit: async ({ idempotency }) => {
        await this.workflow.createBinding({ binding, event, idempotency });
        return { binding, event };
      },
    });
  }

  private async validatePrincipal(principal: PrincipalRef, orgId: string, resourceType: string, role: ContentRole) {
    if (principal.type === "user") {
      const permissions = await this.roles.findPermissionKeys(role.id);
      const requiresMembership = resourceType === "org" || deriveDelegationClass(permissions) !== "ordinary";
      if (requiresMembership) {
        await this.principalDirectory.validateUserInOrganization({ userId: principal.id, orgId });
        return;
      }
      await this.principalDirectory.validateUser({ userId: principal.id });
      return;
    }
    if (principal.type === "team") {
      await this.principalDirectory.validateTeamInOrganization({ teamId: principal.id, orgId });
      return;
    }
    await this.principalDirectory.validateServiceAccountForOrganization({
      clientId: principal.id,
      orgId,
      resource: this.contentApiAudience,
    });
  }
}

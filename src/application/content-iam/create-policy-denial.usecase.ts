import type { Actor } from "@/domain/auth/actor";
import type { BookRepository } from "@/domain/books/book.repository";
import type { ContentAdministrationPolicy } from "@/domain/iam/content-administration.policy";
import type { ContentIamMutationWorkflow } from "@/domain/iam/content-iam-mutation.workflow";
import type { ContentPrincipalDirectory } from "@/domain/iam/content-principal-directory";
import { assertContentPermissionKey, type PrincipalRef } from "@/domain/iam/content-permission";
import { PolicyDenial } from "@/domain/iam/policy-denial.entity";
import { PolicyEvent } from "@/domain/iam/policy-event.entity";
import type { IdempotencyRepository } from "@/domain/idempotency/idempotency.repository";
import { ValidationError } from "@/shared/errors";
import { BOOK_POLICY_DENIALS_CREATE_ROUTE, ORG_POLICY_DENIALS_CREATE_ROUTE } from "@/shared/constants";
import { recordDeniedPolicyMutation } from "@/domain/iam/audit-denied-mutation";
import { deserializeDenialMutation, serializeDenialMutation } from "@/domain/iam/content-iam-snapshot";
import {
  executeIdempotentContentIamMutation,
  requireIdempotencyKey,
} from "@/domain/iam/idempotent-content-iam";
import { loadContentResource, type ContentResourceInput } from "@/domain/iam/resource-loader";
import type { IntrospectPresentedToken } from "@/domain/auth/introspection-port";
import { assertTokenActive } from "@/application/content-iam/assert-token-active";

export type CreatePolicyDenialInput = {
  principal: PrincipalRef;
  permission: string;
  appliesToDescendants: boolean;
  expiresAt?: string | null;
  reason: string;
};

export class CreatePolicyDenialUseCase {
  constructor(
    private readonly books: BookRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly workflow: ContentIamMutationWorkflow,
    private readonly principalDirectory: ContentPrincipalDirectory,
    private readonly administrationPolicy: ContentAdministrationPolicy,
    private readonly contentApiAudience: string,
    private readonly introspection: IntrospectPresentedToken,
  ) {}

  async execute(params: {
    actor: Actor;
    resource: ContentResourceInput;
    idempotencyKey?: string;
    input: CreatePolicyDenialInput;
    requestId?: string;
    bearerToken: string;
  }) {
    await assertTokenActive(this.introspection, params.bearerToken);
    const resource = await loadContentResource(this.books, params.resource);
    assertContentPermissionKey(params.input.permission);
    try {
      await this.administrationPolicy.authorizeDenialMutation({
        actor: params.actor,
        resource,
        permission: params.input.permission,
        principal: params.input.principal,
      });
    } catch (error) {
      await recordDeniedPolicyMutation({
        workflow: this.workflow,
        actor: params.actor,
        resource,
        operation: "denial.create",
        reason: error instanceof Error ? error.message : "Content IAM denial create denied",
        requestId: params.requestId,
      });
      throw error;
    }
    await this.validatePrincipal(params.input.principal, resource.orgId, resource.type);
    const expiresAt = params.input.expiresAt ? new Date(params.input.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date()) {
      throw new ValidationError("Policy denial expiration must be in the future");
    }
    const denial = PolicyDenial.create({
      orgId: resource.orgId,
      principalType: params.input.principal.type,
      principalId: params.input.principal.id,
      permissionKey: params.input.permission,
      resourceType: resource.type,
      resourceId: resource.id,
      appliesToDescendants: params.input.appliesToDescendants,
      expiresAt,
      reason: params.input.reason,
      createdByType: "user",
      createdById: params.actor.type === "user" ? params.actor.subject : "service_account",
    });
    const event = PolicyEvent.create({
      orgId: resource.orgId,
      targetType: resource.type,
      targetId: resource.id,
      action: "denial.created",
      actorType: "user",
      actorId: params.actor.type === "user" ? params.actor.subject : "service_account",
      requestId: params.requestId ?? null,
      reason: params.input.reason,
      snapshotJson: JSON.stringify(denial.toSnapshot()),
    });
    const route = resource.type === "book" ? BOOK_POLICY_DENIALS_CREATE_ROUTE : ORG_POLICY_DENIALS_CREATE_ROUTE;
    return executeIdempotentContentIamMutation({
      idempotency: this.idempotency,
      key: requireIdempotencyKey(params.idempotencyKey),
      actor: params.actor,
      route,
      input: { resource: { type: resource.type, id: resource.id }, body: params.input },
      responseJson: () => serializeDenialMutation(denial, event),
      replay: deserializeDenialMutation,
      commit: async ({ idempotency }) => {
        await this.workflow.createDenial({ denial, event, idempotency });
        return { denial, event };
      },
    });
  }

  private async validatePrincipal(principal: PrincipalRef, orgId: string, resourceType: string) {
    if (principal.type === "user") {
      if (resourceType === "org") {
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

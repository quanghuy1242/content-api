import type { Actor, ServiceAccountActor, UserActor } from "@/domain/authz/actor";
import { requireContentScope } from "@/domain/authz/scopes";
import type { BookCreateWorkflow } from "@/domain/books/book-create.workflow";
import { deserializeBookCreation, serializeBookCreation } from "@/domain/books/book-create.snapshot";
import { Book } from "@/domain/books/book.entity";
import type { IdempotencyRepository } from "@/domain/idempotency/idempotency.repository";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import type { ContentPrincipalDirectory } from "@/domain/iam/content-principal-directory";
import type { ContentRoleRepository } from "@/domain/iam/content-role.repository";
import { executeIdempotentContentIamMutation, requireIdempotencyKey } from "@/domain/iam/idempotent-content-iam";
import { PolicyBinding } from "@/domain/iam/policy-binding.entity";
import { PolicyEvent } from "@/domain/iam/policy-event.entity";
import { organizationResource } from "@/domain/iam/resource-loader";
import { identityProjectionFromActor } from "@/domain/users/user-projection";
import type { UserRepository } from "@/domain/users/user.repository";
import { BOOKS_CREATE_ROUTE } from "@/shared/constants";
import { ForbiddenError, ValidationError } from "@/shared/errors";

export type CreateBookInput = {
  title: string;
  ownerUserId?: string;
};

/** Creates an organization-root book together with its accountable direct owner. */
export class CreateBookUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly roles: ContentRoleRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly workflow: BookCreateWorkflow,
    private readonly principalDirectory: ContentPrincipalDirectory,
    private readonly contentPolicy: ContentPolicy,
  ) {}

  async execute(params: {
    actor: Actor;
    orgId: string;
    idempotencyKey?: string;
    input: CreateBookInput;
    requestId?: string;
  }) {
    requireContentScope(params.actor, "content:write");
    this.requireOrganizationContext(params.actor, params.orgId);
    await this.roles.ensureSystemCatalog();

    const resource = organizationResource(params.orgId);
    const allowed = await this.contentPolicy.can({
      actor: params.actor,
      permission: "org.create_book",
      resource,
    });
    if (!allowed) throw new ForbiddenError("Not authorized to create a book in this organization");

    const ownerUserId = await this.resolveOwnerUserId(params.actor, params.orgId, params.input.ownerUserId);
    const book = Book.create({
      orgId: params.orgId,
      title: params.input.title,
      createdByUserId: ownerUserId,
    });
    const ownerBinding = PolicyBinding.create({
      orgId: params.orgId,
      principalType: "user",
      principalId: ownerUserId,
      roleId: "system:book.owner",
      resourceType: "book",
      resourceId: book.id,
      expiresAt: null,
      createdByType: actorPrincipalType(params.actor),
      createdById: actorPrincipalId(params.actor),
    });
    const event = PolicyEvent.create({
      orgId: params.orgId,
      targetType: "book",
      targetId: book.id,
      action: "binding.created",
      actorType: actorPrincipalType(params.actor),
      actorId: actorPrincipalId(params.actor),
      requestId: params.requestId ?? null,
      reason: "Book owner assigned at creation",
      snapshotJson: JSON.stringify({ book: book.toSnapshot(), ownerBinding: ownerBinding.toSnapshot() }),
    });

    return executeIdempotentContentIamMutation({
      idempotency: this.idempotency,
      key: requireIdempotencyKey(params.idempotencyKey),
      actor: params.actor,
      route: BOOKS_CREATE_ROUTE,
      input: { orgId: params.orgId, body: params.input },
      responseJson: () => serializeBookCreation(book, ownerBinding, event),
      replay: deserializeBookCreation,
      commit: async ({ idempotency }) => {
        await this.workflow.createWithOwner({
          book,
          ownerBinding,
          event,
          idempotency: { ...idempotency, route: BOOKS_CREATE_ROUTE },
        });
        return { book, ownerBinding, event };
      },
    });
  }

  private requireOrganizationContext(
    actor: Actor,
    orgId: string,
  ): asserts actor is UserActor | ServiceAccountActor {
    if (actor.type === "system" || actor.organizationId !== orgId) {
      throw new ForbiddenError("Book creation requires matching organization context");
    }
  }

  private async resolveOwnerUserId(actor: Actor, orgId: string, inputOwnerUserId: string | undefined) {
    if (actor.type === "user") {
      if (inputOwnerUserId && inputOwnerUserId !== actor.subject) {
        throw new ValidationError("A user-created book must be owned by its creator");
      }
      await this.users.ensureIdentityProjection(identityProjectionFromActor(actor));
      return actor.subject;
    }
    if (actor.type !== "service_account" || !inputOwnerUserId) {
      throw new ValidationError("Service-account book creation requires ownerUserId");
    }
    await this.principalDirectory.validateUserInOrganization({ userId: inputOwnerUserId, orgId });
    await this.users.ensureIdentityProjection({ id: inputOwnerUserId });
    return inputOwnerUserId;
  }
}

function actorPrincipalType(actor: UserActor | ServiceAccountActor) {
  return actor.type;
}

function actorPrincipalId(actor: UserActor | ServiceAccountActor) {
  return actor.type === "user" ? actor.subject : actor.clientId;
}

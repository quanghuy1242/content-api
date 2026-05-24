import type { Actor, ServiceAccountActor, UserActor } from "@/domain/auth/actor";
import { requireContentScope } from "@/domain/auth/scopes";
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

type BookCreateContext = { actor: UserActor | ServiceAccountActor; orgId: string };

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
    idempotencyKey?: string;
    input: CreateBookInput;
    requestId?: string;
  }) {
    const { actor, orgId } = await this.requireCreateContext(params.actor);

    const ownerUserId = await this.resolveOwnerUserId(actor, orgId, params.input.ownerUserId);
    const book = Book.create({
      orgId,
      title: params.input.title,
      createdByUserId: ownerUserId,
    });
    const ownerBinding = PolicyBinding.create({
      orgId,
      principalType: "user",
      principalId: ownerUserId,
      roleId: "system:book.owner",
      resourceType: "book",
      resourceId: book.id,
      expiresAt: null,
      createdByType: actorPrincipalType(actor),
      createdById: actorPrincipalId(actor),
    });
    const event = PolicyEvent.create({
      orgId,
      targetType: "book",
      targetId: book.id,
      action: "binding.created",
      actorType: actorPrincipalType(actor),
      actorId: actorPrincipalId(actor),
      requestId: params.requestId ?? null,
      reason: "Book owner assigned at creation",
      snapshotJson: JSON.stringify({ book: book.toSnapshot(), ownerBinding: ownerBinding.toSnapshot() }),
    });

    return executeIdempotentContentIamMutation({
      idempotency: this.idempotency,
      key: requireIdempotencyKey(params.idempotencyKey),
      actor,
      route: BOOKS_CREATE_ROUTE,
      input: { body: params.input },
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

  private async requireCreateContext(actor: Actor): Promise<BookCreateContext> {
    requireContentScope(actor, "content:write");
    if (actor.type === "system" || !actor.organizationId) {
      throw new ForbiddenError("Book creation requires matching organization context");
    }
    await this.roles.ensureSystemCatalog();
    const allowed = await this.contentPolicy.can({
      actor,
      permission: "org.create_book",
      resource: organizationResource(actor.organizationId),
    });
    if (!allowed) throw new ForbiddenError("Not authorized to create a book in this organization");
    return { actor, orgId: actor.organizationId };
  }

  private async resolveOwnerUserId(actor: UserActor | ServiceAccountActor, orgId: string, inputOwnerUserId: string | undefined) {
    if (actor.type === "user") {
      if (inputOwnerUserId && inputOwnerUserId !== actor.subject) {
        throw new ValidationError("A user-created book must be owned by its creator");
      }
      await this.users.ensureIdentityProjection(identityProjectionFromActor(actor));
      return actor.subject;
    }
    if (!inputOwnerUserId) {
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

import type { Actor } from "@/domain/auth/actor";
import type { BookRepository } from "@/domain/books/book.repository";
import type { IdempotencyRepository } from "@/domain/idempotency/idempotency.repository";
import type { ContentAdministrationPolicy } from "@/domain/iam/content-administration.policy";
import type { ContentIamMutationWorkflow } from "@/domain/iam/content-iam-mutation.workflow";
import type { ContentPrincipalDirectory } from "@/domain/iam/content-principal-directory";
import { PolicyBinding } from "@/domain/iam/policy-binding.entity";
import type { PolicyBindingRepository } from "@/domain/iam/policy-binding.repository";
import { PolicyEvent } from "@/domain/iam/policy-event.entity";
import { recordDeniedPolicyMutation } from "@/domain/iam/audit-denied-mutation";
import { BOOK_OWNERSHIP_TRANSFER_ROUTE } from "@/shared/constants";
import { ConflictError, NotFoundError } from "@/shared/errors";
import {
  deserializeOwnershipTransfer,
  serializeOwnershipTransfer,
} from "@/domain/iam/content-iam-snapshot";
import {
  executeIdempotentContentIamMutation,
  requireIdempotencyKey,
} from "@/domain/iam/idempotent-content-iam";
import { loadBookResource } from "@/domain/iam/resource-loader";
import type { IntrospectPresentedToken } from "@/domain/auth/introspection-port";
import { assertTokenActive } from "@/application/content-iam/assert-token-active";

export type TransferBookOwnershipInput = {
  expectedCurrentOwnerUserId: string;
  nextOwnerUserId: string;
  reason?: string | null;
};

export class TransferBookOwnershipUseCase {
  constructor(
    private readonly books: BookRepository,
    private readonly bindings: PolicyBindingRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly workflow: ContentIamMutationWorkflow,
    private readonly principalDirectory: ContentPrincipalDirectory,
    private readonly administrationPolicy: ContentAdministrationPolicy,
    private readonly introspection: IntrospectPresentedToken,
  ) {}

  async execute(params: {
    actor: Actor;
    bookId: string;
    idempotencyKey?: string;
    input: TransferBookOwnershipInput;
    requestId?: string;
    bearerToken: string;
  }) {
    await assertTokenActive(this.introspection, params.bearerToken);
    const resource = await loadBookResource(this.books, params.bookId);
    const currentOwner = await this.bindings.findActiveBookOwner({
      orgId: resource.orgId,
      bookId: resource.id,
      now: new Date(),
    });
    if (!currentOwner) throw new NotFoundError("Book owner binding not found");
    if (currentOwner.principalId !== params.input.expectedCurrentOwnerUserId) {
      throw new ConflictError("Book owner changed before ownership transfer");
    }

    try {
      await this.administrationPolicy.authorizeOwnershipTransfer({
        actor: params.actor,
        book: resource,
        currentOwnerUserId: currentOwner.principalId,
        nextOwnerUserId: params.input.nextOwnerUserId,
      });
    } catch (error) {
      await recordDeniedPolicyMutation({
        workflow: this.workflow,
        actor: params.actor,
        resource,
        operation: "ownership.transfer",
        reason: error instanceof Error ? error.message : "Book ownership transfer denied",
        requestId: params.requestId,
      });
      throw error;
    }
    await this.principalDirectory.validateUserInOrganization({
      userId: params.input.nextOwnerUserId,
      orgId: resource.orgId,
    });

    const nextOwner = PolicyBinding.create({
      orgId: resource.orgId,
      principalType: "user",
      principalId: params.input.nextOwnerUserId,
      roleId: "system:book.owner",
      resourceType: "book",
      resourceId: resource.id,
      expiresAt: null,
      createdByType: "user",
      createdById: params.actor.type === "user" ? params.actor.subject : "service_account",
    });
    const event = PolicyEvent.create({
      orgId: resource.orgId,
      targetType: "book",
      targetId: resource.id,
      action: "ownership.transferred",
      actorType: "user",
      actorId: params.actor.type === "user" ? params.actor.subject : "service_account",
      requestId: params.requestId ?? null,
      reason: params.input.reason ?? null,
      snapshotJson: JSON.stringify({
        currentOwner: currentOwner.toSnapshot(),
        nextOwner: nextOwner.toSnapshot(),
      }),
    });

    return executeIdempotentContentIamMutation({
      idempotency: this.idempotency,
      key: requireIdempotencyKey(params.idempotencyKey),
      actor: params.actor,
      route: BOOK_OWNERSHIP_TRANSFER_ROUTE,
      input: { bookId: resource.id, body: params.input },
      responseJson: () => serializeOwnershipTransfer(currentOwner, nextOwner, event),
      replay: deserializeOwnershipTransfer,
      commit: async ({ idempotency }) => {
        await this.workflow.transferBookOwnership({ currentOwner, nextOwner, event, idempotency });
        return { currentOwner, nextOwner, event };
      },
    });
  }
}

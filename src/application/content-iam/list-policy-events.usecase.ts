import type { Actor } from "@/domain/auth/actor";
import { requireContentScope } from "@/domain/auth/scopes";
import type { BookRepository } from "@/domain/books/book.repository";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import type { PolicyEventRepository } from "@/domain/iam/policy-event.repository";
import { ForbiddenError } from "@/shared/errors";
import { loadContentResource, type ContentResourceInput } from "@/domain/iam/resource-loader";

export class ListPolicyEventsUseCase {
  constructor(
    private readonly books: BookRepository,
    private readonly events: PolicyEventRepository,
    private readonly contentPolicy: ContentPolicy,
  ) {}

  async execute(params: { actor: Actor; resource: ContentResourceInput; limit: number; cursor?: string }) {
    requireContentScope(params.actor, "content:share");
    const resource = await loadContentResource(this.books, params.resource);
    const allowed = await this.contentPolicy.can({
      actor: params.actor,
      permission: resource.type === "org" ? "org.manage_bindings" : "book.manage_bindings",
      resource,
    });
    if (!allowed) throw new ForbiddenError("Not authorized to list policy events");
    return this.events.findMany({
      orgId: resource.orgId,
      targetType: resource.type,
      targetId: resource.id,
      limit: params.limit,
      cursor: params.cursor,
    });
  }
}

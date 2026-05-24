import type { Actor } from "@/domain/authz/actor";
import type { BookRepository } from "@/domain/books/book.repository";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import type { PolicyBindingRepository } from "@/domain/iam/policy-binding.repository";
import { ForbiddenError } from "@/shared/errors";
import { loadContentResource, type ContentResourceInput } from "@/application/content-iam/resource-loader";

export class ListPolicyBindingsUseCase {
  constructor(
    private readonly books: BookRepository,
    private readonly bindings: PolicyBindingRepository,
    private readonly contentPolicy: ContentPolicy,
  ) {}

  async execute(params: { actor: Actor; resource: ContentResourceInput; limit: number; cursor?: string }) {
    const resource = await loadContentResource(this.books, params.resource);
    const allowed = await this.contentPolicy.can({
      actor: params.actor,
      permission: resource.type === "org" ? "org.manage_bindings" : "book.manage_bindings",
      resource,
    });
    if (!allowed) throw new ForbiddenError("Not authorized to list policy bindings");
    return this.bindings.findMany({
      resourceType: resource.type,
      resourceId: resource.id,
      limit: params.limit,
      cursor: params.cursor,
    });
  }
}

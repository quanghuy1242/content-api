import type { Actor } from "@/domain/authz/actor";
import type { BookRepository } from "@/domain/books/book.repository";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import type { PolicyDenialRepository } from "@/domain/iam/policy-denial.repository";
import { ForbiddenError } from "@/shared/errors";
import { loadContentResource, type ContentResourceInput } from "@/application/content-iam/resource-loader";

export class ListPolicyDenialsUseCase {
  constructor(
    private readonly books: BookRepository,
    private readonly denials: PolicyDenialRepository,
    private readonly contentPolicy: ContentPolicy,
  ) {}

  async execute(params: { actor: Actor; resource: ContentResourceInput; limit: number; cursor?: string }) {
    const resource = await loadContentResource(this.books, params.resource);
    const allowed = await this.contentPolicy.can({
      actor: params.actor,
      permission: resource.type === "org" ? "org.manage_bindings" : "book.manage_bindings",
      resource,
    });
    if (!allowed) throw new ForbiddenError("Not authorized to list policy denials");
    return this.denials.findMany({
      resourceType: resource.type,
      resourceId: resource.id,
      limit: params.limit,
      cursor: params.cursor,
    });
  }
}

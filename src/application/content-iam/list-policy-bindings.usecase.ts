import type { Actor } from "@/domain/authz/actor";
import { requireContentScope } from "@/domain/authz/scopes";
import type { BookRepository } from "@/domain/books/book.repository";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import { bindingRefsForResource } from "@/domain/iam/content-resource";
import type { PolicyBindingRepository } from "@/domain/iam/policy-binding.repository";
import { ForbiddenError } from "@/shared/errors";
import { loadContentResource, type ContentResourceInput } from "@/domain/iam/resource-loader";

export class ListPolicyBindingsUseCase {
  constructor(
    private readonly books: BookRepository,
    private readonly bindings: PolicyBindingRepository,
    private readonly contentPolicy: ContentPolicy,
  ) {}

  async execute(params: {
    actor: Actor;
    resource: ContentResourceInput;
    view?: "direct" | "effective";
    limit: number;
    cursor?: string;
  }) {
    requireContentScope(params.actor, "content:share");
    const resource = await loadContentResource(this.books, params.resource);
    const allowed = await this.contentPolicy.can({
      actor: params.actor,
      permission: resource.type === "org" ? "org.manage_bindings" : "book.manage_bindings",
      resource,
    });
    if (!allowed) throw new ForbiddenError("Not authorized to list policy bindings");
    if (resource.type === "book" && params.view === "effective") {
      return this.bindings.findManyForResources({
        orgId: resource.orgId,
        resources: bindingRefsForResource(resource),
        limit: params.limit,
        cursor: params.cursor,
      });
    }
    return this.bindings.findMany({
      orgId: resource.orgId,
      resourceType: resource.type,
      resourceId: resource.id,
      limit: params.limit,
      cursor: params.cursor,
    });
  }
}

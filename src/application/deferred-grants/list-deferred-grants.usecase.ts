import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import { requireContentScope } from "@/domain/authz/scopes";
import type { DeferredGrantRepository } from "@/domain/deferred-grants/deferred-grant.repository";
import { DeferredGrantPolicy } from "@/domain/deferred-grants/deferred-grant.policy";

export class ListDeferredGrantsUseCase {
  constructor(
    private readonly deferredGrants: DeferredGrantRepository,
    private readonly deferredGrantPolicy: DeferredGrantPolicy,
  ) {}

  async execute(params: { actor: Actor; limit: number; cursor?: string }) {
    requireContentScope(params.actor, "content:read");
    await assertAllowed(this.deferredGrantPolicy.canManage(params.actor), "Admin access required");
    return this.deferredGrants.findMany({ limit: params.limit, cursor: params.cursor });
  }
}

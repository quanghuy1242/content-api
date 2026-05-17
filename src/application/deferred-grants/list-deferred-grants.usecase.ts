import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import type { DeferredGrantRepository } from "@/domain/deferred-grants/deferred-grant.repository";
import { DeferredGrantPolicy } from "@/domain/deferred-grants/deferred-grant.policy";

export class ListDeferredGrantsUseCase {
  constructor(
    private readonly deferredGrants: DeferredGrantRepository,
    private readonly deferredGrantPolicy: DeferredGrantPolicy,
  ) {}

  async execute(params: { actor: Actor | null; limit: number; cursor?: string }) {
    await assertAllowed(this.deferredGrantPolicy.canManage(params.actor), "Admin access required");
    return this.deferredGrants.findMany({ limit: params.limit, cursor: params.cursor });
  }
}


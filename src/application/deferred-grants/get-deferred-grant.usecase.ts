import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import { requireContentScope } from "@/domain/authz/scopes";
import type { DeferredGrantRepository } from "@/domain/deferred-grants/deferred-grant.repository";
import { DeferredGrantPolicy } from "@/domain/deferred-grants/deferred-grant.policy";
import { NotFoundError } from "@/shared/errors";

export class GetDeferredGrantUseCase {
  constructor(
    private readonly deferredGrants: DeferredGrantRepository,
    private readonly deferredGrantPolicy: DeferredGrantPolicy,
  ) {}

  async execute(params: { actor: Actor; deferredGrantId: string }) {
    requireContentScope(params.actor, "content:read");
    await assertAllowed(this.deferredGrantPolicy.canManage(params.actor), "Admin access required");

    const item = await this.deferredGrants.findById(params.deferredGrantId);
    if (!item) {
      throw new NotFoundError("Deferred grant row not found");
    }

    return item;
  }
}

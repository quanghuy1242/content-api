import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import type { DeferredGrantRepository } from "@/domain/deferred-grants/deferred-grant.repository";
import { DeferredGrantPolicy } from "@/domain/deferred-grants/deferred-grant.policy";
import { NotFoundError } from "@/shared/errors";

export class DeleteDeferredGrantUseCase {
  constructor(
    private readonly deferredGrants: DeferredGrantRepository,
    private readonly deferredGrantPolicy: DeferredGrantPolicy,
  ) {}

  async execute(params: { actor: Actor; deferredGrantId: string }) {
    await assertAllowed(this.deferredGrantPolicy.canManage(params.actor), "Admin access required");

    const deleted = await this.deferredGrants.delete(params.deferredGrantId);
    if (!deleted) {
      throw new NotFoundError("Deferred grant row not found");
    }
  }
}


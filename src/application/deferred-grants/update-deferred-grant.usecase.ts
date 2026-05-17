import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import type { DeferredGrant } from "@/domain/deferred-grants/deferred-grant.entity";
import type { DeferredGrantRepository } from "@/domain/deferred-grants/deferred-grant.repository";
import { DeferredGrantPolicy } from "@/domain/deferred-grants/deferred-grant.policy";
import { NotFoundError } from "@/shared/errors";

export class UpdateDeferredGrantUseCase {
  constructor(
    private readonly deferredGrants: DeferredGrantRepository,
    private readonly deferredGrantPolicy: DeferredGrantPolicy,
  ) {}

  async execute(params: {
    actor: Actor;
    deferredGrantId: string;
    input: Partial<Omit<DeferredGrant, "id" | "createdAt">>;
  }) {
    await assertAllowed(this.deferredGrantPolicy.canManage(params.actor), "Admin access required");

    const updated = await this.deferredGrants.update(params.deferredGrantId, params.input);
    if (!updated) {
      throw new NotFoundError("Deferred grant row not found");
    }

    return updated;
  }
}


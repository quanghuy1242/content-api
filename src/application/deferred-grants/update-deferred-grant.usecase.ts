import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import { requireContentScope } from "@/domain/authz/scopes";
import type { UpdateDeferredGrantProps } from "@/domain/deferred-grants/deferred-grant.entity";
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
    input: UpdateDeferredGrantProps;
  }) {
    requireContentScope(params.actor, "content:write");
    await assertAllowed(this.deferredGrantPolicy.canManage(params.actor), "Admin access required");

    const grant = await this.deferredGrants.findById(params.deferredGrantId);
    if (!grant) {
      throw new NotFoundError("Deferred grant row not found");
    }

    grant.update(params.input);
    await this.deferredGrants.save(grant);

    return grant;
  }
}

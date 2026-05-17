import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import type { DeferredGrant } from "@/domain/deferred-grants/deferred-grant.entity";
import type { DeferredGrantRepository } from "@/domain/deferred-grants/deferred-grant.repository";
import { DeferredGrantPolicy } from "@/domain/deferred-grants/deferred-grant.policy";

export class CreateDeferredGrantUseCase {
  constructor(
    private readonly deferredGrants: DeferredGrantRepository,
    private readonly deferredGrantPolicy: DeferredGrantPolicy,
  ) {}

  async execute(params: { actor: Actor; input: Omit<DeferredGrant, "id" | "createdAt"> }) {
    await assertAllowed(this.deferredGrantPolicy.canManage(params.actor), "Admin access required");

    return this.deferredGrants.create({
      ...params.input,
      id: crypto.randomUUID(),
      createdAt: new Date(),
    });
  }
}


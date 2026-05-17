import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import type { GrantMirrorRepository } from "@/domain/grant-mirror/grant-mirror.repository";
import { GrantMirrorPolicy } from "@/domain/grant-mirror/grant-mirror.policy";

export class ListGrantMirrorUseCase {
  constructor(
    private readonly grantMirror: GrantMirrorRepository,
    private readonly grantMirrorPolicy: GrantMirrorPolicy,
  ) {}

  async execute(params: { actor: Actor | null; limit: number; cursor?: string }) {
    await assertAllowed(this.grantMirrorPolicy.canManage(params.actor), "Admin access required");
    return this.grantMirror.findMany({ limit: params.limit, cursor: params.cursor });
  }
}


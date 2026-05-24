import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import { requireContentScope } from "@/domain/authz/scopes";
import type { GrantMirrorRepository } from "@/domain/grant-mirror/grant-mirror.repository";
import { GrantMirrorPolicy } from "@/domain/grant-mirror/grant-mirror.policy";
import { NotFoundError } from "@/shared/errors";

export class GetGrantMirrorUseCase {
  constructor(
    private readonly grantMirror: GrantMirrorRepository,
    private readonly grantMirrorPolicy: GrantMirrorPolicy,
  ) {}

  async execute(params: { actor: Actor; grantMirrorId: string }) {
    requireContentScope(params.actor, "content:read");
    await assertAllowed(this.grantMirrorPolicy.canManage(params.actor), "Admin access required");

    const item = await this.grantMirror.findById(params.grantMirrorId);
    if (!item) {
      throw new NotFoundError("Grant mirror row not found");
    }

    return item;
  }
}

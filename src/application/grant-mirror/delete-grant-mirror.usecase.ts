import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import type { GrantMirrorRepository } from "@/domain/grant-mirror/grant-mirror.repository";
import { GrantMirrorPolicy } from "@/domain/grant-mirror/grant-mirror.policy";
import { NotFoundError } from "@/shared/errors";

export class DeleteGrantMirrorUseCase {
  constructor(
    private readonly grantMirror: GrantMirrorRepository,
    private readonly grantMirrorPolicy: GrantMirrorPolicy,
  ) {}

  async execute(params: { actor: Actor; grantMirrorId: string }) {
    await assertAllowed(this.grantMirrorPolicy.canManage(params.actor), "Admin access required");

    const deleted = await this.grantMirror.delete(params.grantMirrorId);
    if (!deleted) {
      throw new NotFoundError("Grant mirror row not found");
    }
  }
}


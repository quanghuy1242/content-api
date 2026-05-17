import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import type { GrantMirror } from "@/domain/grant-mirror/grant-mirror.entity";
import type { GrantMirrorRepository } from "@/domain/grant-mirror/grant-mirror.repository";
import { GrantMirrorPolicy } from "@/domain/grant-mirror/grant-mirror.policy";
import { NotFoundError } from "@/shared/errors";

export class UpdateGrantMirrorUseCase {
  constructor(
    private readonly grantMirror: GrantMirrorRepository,
    private readonly grantMirrorPolicy: GrantMirrorPolicy,
  ) {}

  async execute(params: { actor: Actor; grantMirrorId: string; input: Partial<Omit<GrantMirror, "id">> }) {
    await assertAllowed(this.grantMirrorPolicy.canManage(params.actor), "Admin access required");

    const updated = await this.grantMirror.update(params.grantMirrorId, params.input);
    if (!updated) {
      throw new NotFoundError("Grant mirror row not found");
    }

    return updated;
  }
}


import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import { requireContentScope } from "@/domain/authz/scopes";
import type { UpdateGrantMirrorProps } from "@/domain/grant-mirror/grant-mirror.entity";
import type { GrantMirrorRepository } from "@/domain/grant-mirror/grant-mirror.repository";
import { GrantMirrorPolicy } from "@/domain/grant-mirror/grant-mirror.policy";
import { NotFoundError } from "@/shared/errors";

export class UpdateGrantMirrorUseCase {
  constructor(
    private readonly grantMirror: GrantMirrorRepository,
    private readonly grantMirrorPolicy: GrantMirrorPolicy,
  ) {}

  async execute(params: { actor: Actor; grantMirrorId: string; input: UpdateGrantMirrorProps }) {
    requireContentScope(params.actor, "content:write");
    await assertAllowed(this.grantMirrorPolicy.canManage(params.actor), "Admin access required");

    const mirror = await this.grantMirror.findById(params.grantMirrorId);
    if (!mirror) {
      throw new NotFoundError("Grant mirror row not found");
    }

    mirror.update(params.input);
    await this.grantMirror.save(mirror);

    return mirror;
  }
}

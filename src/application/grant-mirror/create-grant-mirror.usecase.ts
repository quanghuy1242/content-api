import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import type { GrantMirror } from "@/domain/grant-mirror/grant-mirror.entity";
import type { GrantMirrorRepository } from "@/domain/grant-mirror/grant-mirror.repository";
import { GrantMirrorPolicy } from "@/domain/grant-mirror/grant-mirror.policy";

export class CreateGrantMirrorUseCase {
  constructor(
    private readonly grantMirror: GrantMirrorRepository,
    private readonly grantMirrorPolicy: GrantMirrorPolicy,
  ) {}

  async execute(params: { actor: Actor; input: Omit<GrantMirror, "id"> }) {
    await assertAllowed(this.grantMirrorPolicy.canManage(params.actor), "Admin access required");
    return this.grantMirror.create({ ...params.input, id: crypto.randomUUID() });
  }
}


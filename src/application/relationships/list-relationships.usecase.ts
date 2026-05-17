import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import type { RelationshipRepository } from "@/domain/authz/relationship.repository";
import { GrantMirrorPolicy } from "@/domain/grant-mirror/grant-mirror.policy";

export class ListRelationshipsUseCase {
  constructor(
    private readonly relationships: RelationshipRepository,
    private readonly grantMirrorPolicy: GrantMirrorPolicy,
  ) {}

  async execute(params: { actor: Actor | null; limit: number; cursor?: string }) {
    await assertAllowed(this.grantMirrorPolicy.canManage(params.actor), "Admin access required");
    return this.relationships.findMany({ limit: params.limit, cursor: params.cursor });
  }
}


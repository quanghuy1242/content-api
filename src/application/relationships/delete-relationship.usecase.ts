import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import { requireContentScope } from "@/domain/authz/scopes";
import type { RelationshipRepository } from "@/domain/authz/relationship.repository";
import { GrantMirrorPolicy } from "@/domain/grant-mirror/grant-mirror.policy";
import { NotFoundError } from "@/shared/errors";

export class DeleteRelationshipUseCase {
  constructor(
    private readonly relationships: RelationshipRepository,
    private readonly grantMirrorPolicy: GrantMirrorPolicy,
  ) {}

  async execute(params: { actor: Actor; relationshipId: string }) {
    requireContentScope(params.actor, "content:write");
    await assertAllowed(this.grantMirrorPolicy.canManage(params.actor), "Admin access required");

    const deleted = await this.relationships.delete(params.relationshipId);
    if (!deleted) {
      throw new NotFoundError("Relationship not found");
    }
  }
}

import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import type { Relationship } from "@/domain/authz/relationship.entity";
import type { RelationshipRepository } from "@/domain/authz/relationship.repository";
import { GrantMirrorPolicy } from "@/domain/grant-mirror/grant-mirror.policy";

export class CreateRelationshipUseCase {
  constructor(
    private readonly relationships: RelationshipRepository,
    private readonly grantMirrorPolicy: GrantMirrorPolicy,
  ) {}

  async execute(params: { actor: Actor; input: Omit<Relationship, "id" | "createdAt"> }) {
    await assertAllowed(this.grantMirrorPolicy.canManage(params.actor), "Admin access required");

    return this.relationships.create({
      ...params.input,
      id: crypto.randomUUID(),
      createdAt: new Date(),
    });
  }
}


import type { Actor } from "@/domain/authz/actor";
import { Relationship } from "@/domain/authz/relationship.entity";
import type { RelationshipRepository } from "@/domain/authz/relationship.repository";

/**
 * Creates a ReBAC relationship whose subject is the local content API user.
 */
export function createUserSubjectRelationship(params: {
  subjectId: string;
  relation: string;
  objectType: string;
  objectId: string;
}): Relationship {
  return Relationship.create({
    subjectType: "user",
    subjectId: params.subjectId,
    relation: params.relation,
    objectType: params.objectType,
    objectId: params.objectId,
  });
}

/**
 * Shared ReBAC policy shape for resources managed by admins or a persisted user relationship.
 */
export function canUserActorAccessByRelation(params: {
  actor: Actor | null;
  relationships: RelationshipRepository;
  relation: string;
  objectType: string;
  objectId: string;
}): Promise<boolean> {
  if (params.actor?.type !== "user") {
    return Promise.resolve(false);
  }
  if (params.actor.role === "admin") {
    return Promise.resolve(true);
  }

  return params.relationships.exists({
    subjectType: "user",
    subjectId: params.actor.localUserId ?? params.actor.id,
    relation: params.relation,
    objectType: params.objectType,
    objectId: params.objectId,
  });
}

import type { Actor, UserActor } from "@/domain/auth/actor";
import type { ContentPermissionKey, ContentResourceType } from "@/domain/iam/content-permission";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import { PolicyBinding } from "@/domain/iam/policy-binding.entity";
import { PolicyEvent } from "@/domain/iam/policy-event.entity";
import { organizationResource } from "@/domain/iam/resource-loader";
import { ForbiddenError } from "@/shared/errors";

export type OwnedContentCreateContext = {
  actor: UserActor;
  orgId: string;
};

export async function requireOwnedContentCreateContext(params: {
  actor: Actor;
  contentPolicy: ContentPolicy;
  orgCreatePermission: ContentPermissionKey;
}) {
  if (params.actor.type !== "user" || !params.actor.organizationId) {
    throw new ForbiddenError("Content creation requires matching organization user context");
  }
  const allowed = await params.contentPolicy.can({
    actor: params.actor,
    permission: params.orgCreatePermission,
    resource: organizationResource(params.actor.organizationId),
  });
  if (!allowed) {
    throw new ForbiddenError("Not authorized to create content in this organization");
  }
  return { actor: params.actor, orgId: params.actor.organizationId };
}

export function createDirectOwnerBinding(params: {
  orgId: string;
  userId: string;
  roleId: string;
  resourceType: ContentResourceType;
  resourceId: string;
}) {
  return PolicyBinding.create({
    orgId: params.orgId,
    principalType: "user",
    principalId: params.userId,
    roleId: params.roleId,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    expiresAt: null,
    createdByType: "user",
    createdById: params.userId,
  });
}

export function createOwnerAssignedEvent(params: {
  orgId: string;
  userId: string;
  resourceType: ContentResourceType;
  resourceId: string;
  snapshotJson: string;
}) {
  return PolicyEvent.create({
    orgId: params.orgId,
    targetType: params.resourceType,
    targetId: params.resourceId,
    action: "binding.created",
    actorType: "user",
    actorId: params.userId,
    requestId: null,
    reason: `${params.resourceType} owner assigned at creation`,
    snapshotJson: params.snapshotJson,
  });
}

import type { ContentPermissionKey } from "@/domain/iam/content-permission";
import type { ContentRole } from "@/domain/iam/content-role.entity";
import type { PolicyBinding } from "@/domain/iam/policy-binding.entity";
import type { PolicyDenial } from "@/domain/iam/policy-denial.entity";
import type { PolicyEvent } from "@/domain/iam/policy-event.entity";

export function presentPolicyBinding(binding: PolicyBinding) {
  return {
    id: binding.id,
    orgId: binding.orgId,
    principal: { type: binding.principalType, id: binding.principalId },
    roleId: binding.roleId,
    resource: { type: binding.resourceType, id: binding.resourceId },
    expiresAt: binding.expiresAt?.toISOString() ?? null,
    createdBy: { type: binding.createdByType, id: binding.createdById },
    createdAt: binding.createdAt.toISOString(),
  };
}

export function presentPolicyDenial(denial: PolicyDenial) {
  return {
    id: denial.id,
    orgId: denial.orgId,
    principal: { type: denial.principalType, id: denial.principalId },
    permission: denial.permissionKey,
    resource: { type: denial.resourceType, id: denial.resourceId },
    appliesToDescendants: denial.appliesToDescendants,
    expiresAt: denial.expiresAt?.toISOString() ?? null,
    reason: denial.reason,
    createdBy: { type: denial.createdByType, id: denial.createdById },
    createdAt: denial.createdAt.toISOString(),
  };
}

export function presentPolicyEvent(event: PolicyEvent) {
  return {
    id: event.id,
    orgId: event.orgId,
    target: { type: event.targetType, id: event.targetId },
    action: event.action,
    actor: { type: event.actorType, id: event.actorId },
    requestId: event.requestId,
    reason: event.reason,
    createdAt: event.createdAt.toISOString(),
  };
}

export function presentContentRole(input: { role: ContentRole; permissions: readonly ContentPermissionKey[] }) {
  return {
    id: input.role.id,
    namespaceId: input.role.namespaceId,
    key: input.role.key,
    name: input.role.name,
    assignableResourceType: input.role.assignableResourceType,
    builtIn: input.role.builtIn,
    enabled: input.role.enabled,
    version: input.role.version,
    permissions: [...input.permissions],
    createdAt: input.role.createdAt.toISOString(),
    updatedAt: input.role.updatedAt.toISOString(),
  };
}

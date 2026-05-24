import { Book } from "@/domain/books/book.entity";
import { ContentRole } from "@/domain/iam/content-role.entity";
import { PolicyBinding } from "@/domain/iam/policy-binding.entity";
import { PolicyDenial } from "@/domain/iam/policy-denial.entity";
import { PolicyEvent } from "@/domain/iam/policy-event.entity";
import type { ContentPermissionKey, ContentResourceType, PrincipalType } from "@/domain/iam/content-permission";
import {
  books,
  contentPolicyBindings,
  contentPolicyDenials,
  contentPolicyEvents,
  contentRoles,
} from "@/infrastructure/db/schema";

type BookRow = typeof books.$inferSelect;
type RoleRow = typeof contentRoles.$inferSelect;
type BindingRow = typeof contentPolicyBindings.$inferSelect;
type DenialRow = typeof contentPolicyDenials.$inferSelect;
type EventRow = typeof contentPolicyEvents.$inferSelect;

export function bookRowToEntity(row: BookRow): Book {
  return Book.reconstitute({
    id: row.id,
    orgId: row.orgId,
    title: row.title,
    createdByUserId: row.createdByUserId,
    visibility: row.visibility as "private" | "public",
    status: row.status as "draft" | "published" | "archived",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function bookToInsertRow(book: Book) {
  const snap = book.toSnapshot();
  return {
    id: snap.id,
    orgId: snap.orgId,
    title: snap.title,
    createdByUserId: snap.createdByUserId,
    visibility: snap.visibility,
    status: snap.status,
    createdAt: snap.createdAt,
    updatedAt: snap.updatedAt,
  };
}

export function contentRoleRowToEntity(row: RoleRow): ContentRole {
  return ContentRole.reconstitute({
    id: row.id,
    namespaceId: row.namespaceId,
    key: row.key,
    name: row.name,
    assignableResourceType: row.assignableResourceType as ContentResourceType,
    builtIn: row.builtIn,
    enabled: row.enabled,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function contentRoleToInsertRow(role: ContentRole) {
  const snap = role.toSnapshot();
  return {
    id: snap.id,
    namespaceId: snap.namespaceId,
    key: snap.key,
    name: snap.name,
    assignableResourceType: snap.assignableResourceType,
    builtIn: snap.builtIn,
    enabled: snap.enabled,
    version: snap.version,
    createdAt: snap.createdAt,
    updatedAt: snap.updatedAt,
  };
}

export function policyBindingRowToEntity(row: BindingRow): PolicyBinding {
  return PolicyBinding.reconstitute({
    id: row.id,
    orgId: row.orgId,
    principalType: row.principalType as PrincipalType,
    principalId: row.principalId,
    roleId: row.roleId,
    resourceType: row.resourceType as ContentResourceType,
    resourceId: row.resourceId,
    expiresAt: row.expiresAt,
    createdByType: row.createdByType as PrincipalType,
    createdById: row.createdById,
    createdAt: row.createdAt,
  });
}

export function policyBindingToInsertRow(binding: PolicyBinding) {
  const snap = binding.toSnapshot();
  return {
    id: snap.id,
    orgId: snap.orgId,
    principalType: snap.principalType,
    principalId: snap.principalId,
    roleId: snap.roleId,
    resourceType: snap.resourceType,
    resourceId: snap.resourceId,
    expiresAt: snap.expiresAt,
    createdByType: snap.createdByType,
    createdById: snap.createdById,
    createdAt: snap.createdAt,
  };
}

export function policyDenialRowToEntity(row: DenialRow): PolicyDenial {
  return PolicyDenial.reconstitute({
    id: row.id,
    orgId: row.orgId,
    principalType: row.principalType as PrincipalType,
    principalId: row.principalId,
    permissionKey: row.permissionKey as ContentPermissionKey,
    resourceType: row.resourceType as ContentResourceType,
    resourceId: row.resourceId,
    appliesToDescendants: row.appliesToDescendants,
    expiresAt: row.expiresAt,
    reason: row.reason,
    createdByType: row.createdByType as PrincipalType,
    createdById: row.createdById,
    createdAt: row.createdAt,
  });
}

export function policyDenialToInsertRow(denial: PolicyDenial) {
  const snap = denial.toSnapshot();
  return {
    id: snap.id,
    orgId: snap.orgId,
    principalType: snap.principalType,
    principalId: snap.principalId,
    permissionKey: snap.permissionKey,
    resourceType: snap.resourceType,
    resourceId: snap.resourceId,
    appliesToDescendants: snap.appliesToDescendants,
    expiresAt: snap.expiresAt,
    reason: snap.reason,
    createdByType: snap.createdByType,
    createdById: snap.createdById,
    createdAt: snap.createdAt,
  };
}

export function policyEventRowToEntity(row: EventRow): PolicyEvent {
  return PolicyEvent.reconstitute({
    id: row.id,
    orgId: row.orgId,
    targetType: row.targetType as ContentResourceType,
    targetId: row.targetId,
    action: row.action as ReturnType<PolicyEvent["toSnapshot"]>["action"],
    actorType: row.actorType as PrincipalType,
    actorId: row.actorId,
    requestId: row.requestId,
    reason: row.reason,
    snapshotJson: row.snapshotJson,
    createdAt: row.createdAt,
  });
}

export function policyEventToInsertRow(event: PolicyEvent) {
  const snap = event.toSnapshot();
  return {
    id: snap.id,
    orgId: snap.orgId,
    targetType: snap.targetType,
    targetId: snap.targetId,
    action: snap.action,
    actorType: snap.actorType,
    actorId: snap.actorId,
    requestId: snap.requestId,
    reason: snap.reason,
    snapshotJson: snap.snapshotJson,
    createdAt: snap.createdAt,
  };
}

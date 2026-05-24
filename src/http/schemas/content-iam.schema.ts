import { z } from "@hono/zod-openapi";
import { MAX_AUDIT_REASON_LENGTH, MAX_NAME_LENGTH, MAX_SLUG_LENGTH } from "@/shared/constants";
import { listQuerySchema } from "@/shared/pagination/cursor";
import { idSchema } from "@/shared/validation/fields";

export const contentPrincipalSchema = z.object({
  type: z.enum(["user", "team", "service_account"]),
  id: idSchema,
});

export const createPolicyBindingSchema = z.object({
  principal: contentPrincipalSchema,
  roleId: z.string().min(1),
  expiresAt: z.string().datetime().optional().nullable(),
  reason: z.string().max(MAX_AUDIT_REASON_LENGTH).optional().nullable(),
});

export const createPolicyDenialSchema = z.object({
  principal: contentPrincipalSchema,
  permission: z.string().min(1),
  appliesToDescendants: z.boolean(),
  expiresAt: z.string().datetime().optional().nullable(),
  reason: z.string().min(1).max(MAX_AUDIT_REASON_LENGTH),
});

export const bootstrapOrganizationContentAdminSchema = z.object({
  userId: idSchema,
  reason: z.string().max(MAX_AUDIT_REASON_LENGTH).optional().nullable(),
});

export const delegateOrganizationContentAdminSchema = z.object({
  userId: idSchema,
  reason: z.string().max(MAX_AUDIT_REASON_LENGTH).optional().nullable(),
});

export const transferBookOwnershipSchema = z.object({
  expectedCurrentOwnerUserId: idSchema,
  nextOwnerUserId: idSchema,
  reason: z.string().max(MAX_AUDIT_REASON_LENGTH).optional().nullable(),
});

export const createContentRoleSchema = z.object({
  key: z.string().min(1).max(MAX_SLUG_LENGTH),
  name: z.string().min(1).max(MAX_NAME_LENGTH),
  assignableResourceType: z.enum(["book", "chapter", "section", "block", "media", "comment"]),
  permissions: z.array(z.string().min(1)).min(1),
  reason: z.string().max(MAX_AUDIT_REASON_LENGTH).optional().nullable(),
});

export const replaceContentRolePermissionsSchema = z.object({
  expectedVersion: z.number().int().positive(),
  permissions: z.array(z.string().min(1)).min(1),
  reason: z.string().max(MAX_AUDIT_REASON_LENGTH).optional().nullable(),
});

export const contentIamListQuerySchema = listQuerySchema;
export const contentIamBindingListQuerySchema = listQuerySchema.extend({
  view: z.enum(["direct", "effective"]).default("direct"),
});

export const bookIdParamSchema = z.object({ bookId: idSchema });
export const orgIdParamSchema = z.object({ orgId: idSchema });
export const bindingIdParamSchema = z.object({ bookId: idSchema, bindingId: idSchema });
export const denialIdParamSchema = z.object({ bookId: idSchema, denialId: idSchema });
export const orgBindingIdParamSchema = z.object({ orgId: idSchema, bindingId: idSchema });
export const orgDenialIdParamSchema = z.object({ orgId: idSchema, denialId: idSchema });
export const roleIdParamSchema = z.object({ orgId: idSchema, roleId: idSchema });

export const policyBindingResponseSchema = z.object({
  id: idSchema,
  orgId: idSchema,
  principal: contentPrincipalSchema,
  roleId: z.string(),
  resource: z.object({ type: z.string(), id: idSchema }),
  expiresAt: z.string().nullable(),
  createdBy: contentPrincipalSchema,
  createdAt: z.string(),
});

export const policyDenialResponseSchema = z.object({
  id: idSchema,
  orgId: idSchema,
  principal: contentPrincipalSchema,
  permission: z.string(),
  resource: z.object({ type: z.string(), id: idSchema }),
  appliesToDescendants: z.boolean(),
  expiresAt: z.string().nullable(),
  reason: z.string().nullable(),
  createdBy: contentPrincipalSchema,
  createdAt: z.string(),
});

export const policyEventResponseSchema = z.object({
  id: idSchema,
  orgId: idSchema,
  target: z.object({ type: z.string(), id: idSchema }),
  action: z.string(),
  actor: contentPrincipalSchema,
  requestId: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});

export const contentRoleResponseSchema = z.object({
  id: idSchema,
  namespaceId: z.string(),
  key: z.string(),
  name: z.string(),
  assignableResourceType: z.string(),
  builtIn: z.boolean(),
  enabled: z.boolean(),
  version: z.number(),
  permissions: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ownershipTransferResponseSchema = z.object({
  currentOwner: policyBindingResponseSchema,
  nextOwner: policyBindingResponseSchema,
  auditEventId: idSchema,
});

export function policyMutationResponseSchema<T extends z.ZodTypeAny>(schema: T) {
  return z.object({
    data: schema,
    auditEventId: idSchema,
  });
}

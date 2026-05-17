import { z } from "@hono/zod-openapi";
import {
  deferredGrantStatusSchema,
  deferredGrantTypeSchema,
  grantMirrorEntityTypeSchema,
  idSchema,
  sourceSubjectTypeSchema,
  subjectTypeSchema,
  syncStatusSchema,
} from "@/shared/validation/fields";

export const grantMirrorCreateSchema = z.object({
  autherTupleId: z.string().min(1),
  payloadUserId: idSchema,
  entityType: grantMirrorEntityTypeSchema,
  entityId: z.string().min(1),
  relation: z.string().min(1),
  sourceSubjectType: sourceSubjectTypeSchema,
  requiresLiveCheck: z.boolean().default(false),
  syncStatus: syncStatusSchema.default("active"),
  syncedAt: z.coerce.date(),
});

export const grantMirrorUpdateSchema = grantMirrorCreateSchema.partial();

export const deferredGrantCreateSchema = z.object({
  betterAuthUserId: z.string().min(1),
  tupleId: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  relation: z.string().min(1),
  sourceSubjectType: sourceSubjectTypeSchema,
  hasCondition: z.boolean().default(false),
  status: deferredGrantStatusSchema.default("pending"),
  processedAt: z.coerce.date().optional().nullable(),
  type: deferredGrantTypeSchema.default("grant"),
});

export const deferredGrantUpdateSchema = deferredGrantCreateSchema.partial();

export const relationshipCreateSchema = z.object({
  subjectType: subjectTypeSchema,
  subjectId: z.string().min(1),
  relation: z.string().min(1),
  objectType: z.string().min(1),
  objectId: z.string().min(1),
});

export const grantMirrorResponseSchema = z.object({
  id: idSchema,
  autherTupleId: z.string(),
  payloadUserId: idSchema,
  entityType: grantMirrorEntityTypeSchema,
  entityId: z.string(),
  relation: z.string(),
  sourceSubjectType: sourceSubjectTypeSchema,
  requiresLiveCheck: z.boolean(),
  syncStatus: syncStatusSchema,
  syncedAt: z.string(),
});

export const deferredGrantResponseSchema = z.object({
  id: idSchema,
  betterAuthUserId: z.string(),
  tupleId: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  relation: z.string(),
  sourceSubjectType: sourceSubjectTypeSchema,
  hasCondition: z.boolean(),
  status: deferredGrantStatusSchema,
  processedAt: z.string().nullable(),
  type: deferredGrantTypeSchema,
  createdAt: z.string(),
});

export const relationshipResponseSchema = z.object({
  id: idSchema,
  subjectType: subjectTypeSchema,
  subjectId: z.string(),
  relation: z.string(),
  objectType: z.string(),
  objectId: z.string(),
  createdAt: z.string(),
});

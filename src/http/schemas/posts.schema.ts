import { z } from "@hono/zod-openapi";
import { MAX_NAME_LENGTH } from "@/shared/constants";
import { idSchema, slugSchema } from "@/shared/validation/fields";

export const createPostBodySchema = z.object({
  title: z.string().min(1).max(MAX_NAME_LENGTH),
  excerpt: z.string().optional().nullable(),
  content: z.unknown(),
  coverImage: idSchema.optional().nullable(),
  category: idSchema,
  tags: z.array(z.string()).optional(),
});

export const updatePostBodySchema = createPostBodySchema.partial();

export const lifecycleStatusSchema = z.enum(["draft", "scheduled", "published", "archived"]);

export const postResponseSchema = z.object({
  id: idSchema,
  orgId: idSchema,
  title: z.string(),
  slug: slugSchema,
  excerpt: z.string().nullable(),
  content: z.unknown(),
  coverImage: z.string().nullable(),
  author: idSchema,
  category: idSchema,
  tags: z.array(z.string()),
  status: lifecycleStatusSchema,
  publishedAt: z.string().nullable(),
  scheduledAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

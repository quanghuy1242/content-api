import { z } from "@hono/zod-openapi";
import { idSchema, mediaStatusSchema, mediaVisibilitySchema } from "@/shared/validation/fields";

export const mediaCreateSchema = z.object({
  alt: z.string().min(1),
  url: z.string().url().optional().nullable(),
  thumbnailURL: z.string().url().optional().nullable(),
  filename: z.string().min(1),
  mimeType: z.string().optional().nullable(),
  filesize: z.number().int().positive().optional().nullable(),
  width: z.number().int().positive().optional().nullable(),
  height: z.number().int().positive().optional().nullable(),
  focalX: z.number().optional().nullable(),
  focalY: z.number().optional().nullable(),
});

export const mediaUpdateSchema = mediaCreateSchema.partial();

export const mediaResponseSchema = z.object({
  id: idSchema,
  alt: z.string(),
  lowResUrl: z.string().nullable(),
  optimizedUrl: z.string().nullable(),
  owner: idSchema,
  url: z.string().nullable(),
  thumbnailURL: z.string().nullable(),
  filename: z.string(),
  mimeType: z.string().nullable(),
  filesize: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  focalX: z.number().nullable(),
  focalY: z.number().nullable(),
  status: mediaStatusSchema,
  visibility: mediaVisibilitySchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

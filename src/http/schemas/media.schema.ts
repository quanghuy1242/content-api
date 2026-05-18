import { z } from "@hono/zod-openapi";
import { MEDIA_VARIANT_NAMES } from "@/shared/constants";
import { idSchema, mediaStatusSchema, mediaVisibilitySchema } from "@/shared/validation/fields";

export const mediaCreateSchema = z.object({
  alt: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  filesize: z.number().int().positive(),
  focalX: z.number().finite().optional().nullable(),
  focalY: z.number().finite().optional().nullable(),
});

export const mediaUpdateSchema = z.object({
  alt: z.string().min(1).optional(),
  filename: z.string().min(1).optional(),
  focalX: z.number().finite().optional().nullable(),
  focalY: z.number().finite().optional().nullable(),
});

export const mediaVariantNameSchema = z.enum(MEDIA_VARIANT_NAMES);

export const mediaResponseSchema = z.object({
  id: idSchema,
  alt: z.string(),
  lowResUrl: z.string().nullable(),
  optimizedUrl: z.string().nullable(),
  owner: idSchema,
  url: z.string().nullable(),
  thumbnailURL: z.string().nullable(),
  filename: z.string(),
  mimeType: z.string(),
  filesize: z.number(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  focalX: z.number().nullable(),
  focalY: z.number().nullable(),
  status: mediaStatusSchema,
  visibility: mediaVisibilitySchema,
  version: z.number().int().positive(),
  failureReason: z.string().nullable(),
  uploadExpiresAt: z.string().nullable(),
  variantUrls: z.record(z.string(), z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const mediaUploadResponseSchema = z.object({
  media: mediaResponseSchema,
  upload: z.object({
    url: z.string().url(),
    method: z.literal("PUT"),
    expiresAt: z.string(),
    headers: z.object({
      "Content-Type": z.string(),
    }),
  }),
});

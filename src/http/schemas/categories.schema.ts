import { z } from "@hono/zod-openapi";
import { MAX_NAME_LENGTH } from "@/shared/constants";
import { idSchema, slugSchema } from "@/shared/validation/fields";

export const categoryCreateSchema = z.object({
  name: z.string().min(1).max(MAX_NAME_LENGTH),
  description: z.string().min(1),
  image: idSchema,
});

export const categoryUpdateSchema = categoryCreateSchema.partial();

export const categoryResponseSchema = z.object({
  id: idSchema,
  name: z.string(),
  slug: slugSchema,
  description: z.string(),
  image: idSchema,
  createdBy: idSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

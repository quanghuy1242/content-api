import { z } from "@hono/zod-openapi";
import { idSchema, slugSchema } from "@/shared/validation/fields";

export const categoryCreateSchema = z.object({
  name: z.string().min(1).max(255),
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

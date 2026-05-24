import { z } from "@hono/zod-openapi";
import { MAX_NAME_LENGTH } from "@/shared/constants";
import { idSchema } from "@/shared/validation/fields";

export const createBookSchema = z.object({
  title: z.string().min(1).max(MAX_NAME_LENGTH),
  ownerUserId: idSchema.optional(),
});

export const updateBookSchema = z.object({
  title: z.string().min(1).max(MAX_NAME_LENGTH).optional(),
  visibility: z.enum(["private", "public"]).optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
});

export const bookResponseSchema = z.object({
  id: idSchema,
  orgId: idSchema,
  title: z.string(),
  createdByUserId: idSchema,
  visibility: z.enum(["private", "public"]),
  status: z.enum(["draft", "published", "archived"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

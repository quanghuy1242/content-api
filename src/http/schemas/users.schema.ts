import { z } from "@hono/zod-openapi";
import { emailSchema, fullNameSchema, idSchema, roleSchema } from "@/shared/validation/fields";

export const userCreateSchema = z.object({
  email: emailSchema,
  fullName: fullNameSchema,
  avatar: z.string().optional().nullable(),
  bio: z.unknown().optional().nullable(),
  role: roleSchema.default("user"),
  betterAuthUserId: z.string().optional().nullable(),
});

export const userUpdateSchema = userCreateSchema.partial().omit({ betterAuthUserId: true });

export const userResponseSchema = z.object({
  id: idSchema,
  fullName: fullNameSchema,
  avatar: z.string().nullable(),
  bio: z.unknown().nullable(),
  email: emailSchema.nullable(),
  role: roleSchema.nullable(),
  betterAuthUserId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

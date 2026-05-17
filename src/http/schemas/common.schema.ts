import { z } from "@hono/zod-openapi";
import { listQuerySchema } from "@/shared/pagination/cursor";
import { idSchema } from "@/shared/validation/fields";

export const idParamSchema = z.object({ id: idSchema });
export const listResourceQuerySchema = listQuerySchema;

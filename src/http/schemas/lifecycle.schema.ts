import { z } from "@hono/zod-openapi";

export const scheduleBodySchema = z
  .object({
    scheduledAt: z
      .string()
      .datetime()
      .openapi({ description: "ISO-8601 timestamp when the resource should publish. Must be in the future." }),
  })
  .openapi("SchedulePublishBody");

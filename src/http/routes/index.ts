import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "@/http/app-env";
import { healthResponseSchema, jsonContent } from "@/http/openapi";
import { registerAuthzRoutes } from "@/http/routes/authz.routes";
import { registerCategoryRoutes } from "@/http/routes/categories.routes";
import { registerContentIamRoutes } from "@/http/routes/content-iam.routes";
import { registerMediaRoutes } from "@/http/routes/media.routes";
import { registerPostRoutes } from "@/http/routes/posts.routes";
import { registerUserRoutes } from "@/http/routes/users.routes";
import { HTTP_STATUS_OK } from "@/shared/constants";

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["system"],
  description: "Health check returning worker status",
  responses: {
    200: jsonContent(healthResponseSchema, "Worker health status"),
  },
});

/**
 * Registers only documented OpenAPI routes. Resource modules own their route
 * contracts; this function defines the public route surface included in docs.
 */
export function registerRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(healthRoute, (c) => c.json({ ok: true }, HTTP_STATUS_OK));

  registerUserRoutes(app);
  registerCategoryRoutes(app);
  registerPostRoutes(app);
  registerMediaRoutes(app);
  registerContentIamRoutes(app);
  registerAuthzRoutes(app);
}

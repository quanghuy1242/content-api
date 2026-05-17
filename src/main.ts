import { OpenAPIHono } from "@hono/zod-openapi";
import { createRequestContainer } from "@/composition/create-request-container";
import type { AppEnv } from "@/http/app-env";
import { optionalAuthMiddleware } from "@/http/middleware/auth.middleware";
import { handleAppError } from "@/http/middleware/error.middleware";
import { requestContextMiddleware } from "@/http/middleware/request.middleware";
import { registerRoutes } from "@/http/routes";
import { ValidationError } from "@/shared/errors";

/**
 * Build the Cloudflare Worker app. Tests inject `fetchImpl` so JWKS validation
 * can exercise real `jose` verification without network coupling.
 */
export function createApp(options?: { fetchImpl?: typeof fetch }) {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result) => {
      if (!result.success) {
        throw new ValidationError("Validation failed", { issues: result.error.issues });
      }
    },
  });
  app.onError(handleAppError);

  app.use("*", requestContextMiddleware);
  app.use("*", async (c, next) => {
    c.set("container", createRequestContainer(c.env, options));
    await next();
  });
  app.use("*", optionalAuthMiddleware);

  registerRoutes(app);
  app.openAPIRegistry.registerComponent("securitySchemes", "Bearer", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
  });
  app.doc("/openapi.json", {
    openapi: "3.0.0",
    info: {
      title: "Content API",
      version: "0.1.0",
    },
  });
  return app;
}

const app = createApp();

export default app;

import { OpenAPIHono } from "@hono/zod-openapi";
import { createRequestContainer } from "@/composition/create-request-container";
import type { AppEnv } from "@/http/app-env";
import { optionalAuthMiddleware } from "@/http/middleware/auth.middleware";
import { handleAppError } from "@/http/middleware/error.middleware";
import { requestContextMiddleware } from "@/http/middleware/request.middleware";
import { registerRoutes } from "@/http/routes";
import { registerDocsRoutes } from "@/http/routes/docs.routes";
import { ValidationError } from "@/shared/errors";

/**
 * Build the Cloudflare Worker app. Tests inject `fetchImpl` so JWKS validation
 * can exercise real `jose` verification without network coupling.
 */
export function createApp(options?: { fetchImpl?: typeof fetch }) {
  const api = new OpenAPIHono<AppEnv>({
    defaultHook: (result) => {
      if (!result.success) {
        throw new ValidationError("Validation failed", { issues: result.error.issues });
      }
    },
  });
  api.onError(handleAppError);

  api.use("*", requestContextMiddleware);
  api.use("*", async (c, next) => {
    c.set("container", createRequestContainer(c.env, options));
    await next();
  });
  api.use("*", optionalAuthMiddleware);

  registerRoutes(api);
  registerDocsRoutes(api);

  const app = new OpenAPIHono<AppEnv>();
  app.route("/api", api);
  return app;
}

const app = createApp();

export default app;

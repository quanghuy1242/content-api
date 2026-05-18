import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "@/http/app-env";
import { swaggerUiHtml } from "@/http/swagger-ui";

const docsRoute = createRoute({
  method: "get",
  path: "/docs",
  tags: ["system"],
  description: "Swagger UI for browsing the Content API.",
  responses: {
    200: {
      content: { "text/html": { schema: z.string() } },
      description: "Swagger UI page",
    },
  },
});

export function registerDocsRoutes(app: OpenAPIHono<AppEnv>) {
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
  app.openapi(docsRoute, (c) => c.html(swaggerUiHtml));
}

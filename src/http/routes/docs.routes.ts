import { type OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import type { AppEnv } from "@/http/app-env";

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
    servers: [{ url: "/api" }],
  });
  app.get(
    "/reference",
    Scalar({
      url: "./openapi.json",
      pageTitle: "Content API Docs",
      theme: "saturn",
    }),
  );
}

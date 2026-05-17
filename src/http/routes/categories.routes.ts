import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "@/http/app-env";
import {
  bearerSecurity,
  commonErrorResponses,
  dataResponseSchema,
  jsonContent,
  jsonRequestBody,
  listResponseSchema,
} from "@/http/openapi";
import { presentCategory } from "@/http/presenters/category.presenter";
import { requireActor } from "@/http/routes/helpers";
import {
  categoryCreateSchema,
  categoryResponseSchema,
  categoryUpdateSchema,
} from "@/http/schemas/categories.schema";
import { idParamSchema, listResourceQuerySchema } from "@/http/schemas/common.schema";

const categoryListRoute = createRoute({
  method: "get",
  path: "/categories",
  tags: ["categories"],
  security: bearerSecurity,
  request: { query: listResourceQuerySchema },
  responses: {
    200: jsonContent(listResponseSchema(categoryResponseSchema), "List categories"),
    ...commonErrorResponses,
  },
});

const categoryCreateRoute = createRoute({
  method: "post",
  path: "/categories",
  tags: ["categories"],
  security: bearerSecurity,
  request: { body: jsonRequestBody(categoryCreateSchema, "Category create payload") },
  responses: {
    201: jsonContent(dataResponseSchema(categoryResponseSchema), "Created category"),
    ...commonErrorResponses,
  },
});

const categoryGetRoute = createRoute({
  method: "get",
  path: "/categories/{id}",
  tags: ["categories"],
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    200: jsonContent(dataResponseSchema(categoryResponseSchema), "Category by id"),
    ...commonErrorResponses,
  },
});

const categoryUpdateRoute = createRoute({
  method: "patch",
  path: "/categories/{id}",
  tags: ["categories"],
  security: bearerSecurity,
  request: {
    params: idParamSchema,
    body: jsonRequestBody(categoryUpdateSchema, "Category update payload"),
  },
  responses: {
    200: jsonContent(dataResponseSchema(categoryResponseSchema), "Updated category"),
    ...commonErrorResponses,
  },
});

const categoryDeleteRoute = createRoute({
  method: "delete",
  path: "/categories/{id}",
  tags: ["categories"],
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    204: { description: "Category deleted" },
    ...commonErrorResponses,
  },
});

export function registerCategoryRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(categoryListRoute, async (c) => {
    const actor = requireActor(c);
    const query = c.req.valid("query");
    const result = await c.get("container").categories.list.execute({
      actor,
      limit: query.limit,
      cursor: query.cursor,
    });
    return c.json({ data: result.data.map(presentCategory), page: result.page }, 200);
  });

  app.openapi(categoryCreateRoute, async (c) => {
    const actor = requireActor(c);
    const body = c.req.valid("json");
    const result = await c.get("container").categories.create.execute({ actor, input: body });
    return c.json({ data: presentCategory(result) }, 201);
  });

  app.openapi(categoryGetRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const result = await c.get("container").categories.get.execute({ actor, categoryId: params.id });
    return c.json({ data: presentCategory(result) }, 200);
  });

  app.openapi(categoryUpdateRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const body = c.req.valid("json");
    const result = await c.get("container").categories.update.execute({
      actor,
      categoryId: params.id,
      input: body,
    });
    return c.json({ data: presentCategory(result) }, 200);
  });

  app.openapi(categoryDeleteRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    await c.get("container").categories.delete.execute({ actor, categoryId: params.id });
    return c.body(null, 204);
  });
}

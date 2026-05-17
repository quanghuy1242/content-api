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
import { presentUser } from "@/http/presenters/user.presenter";
import { requireActor } from "@/http/routes/helpers";
import { idParamSchema, listResourceQuerySchema } from "@/http/schemas/common.schema";
import { userCreateSchema, userResponseSchema, userUpdateSchema } from "@/http/schemas/users.schema";

const userListRoute = createRoute({
  method: "get",
  path: "/users",
  tags: ["users"],
  security: bearerSecurity,
  request: {
    query: listResourceQuerySchema,
  },
  responses: {
    200: jsonContent(listResponseSchema(userResponseSchema), "List users"),
    ...commonErrorResponses,
  },
});

const userCreateRoute = createRoute({
  method: "post",
  path: "/users",
  tags: ["users"],
  security: bearerSecurity,
  request: {
    body: jsonRequestBody(userCreateSchema, "User create payload"),
  },
  responses: {
    201: jsonContent(dataResponseSchema(userResponseSchema), "Created user"),
    ...commonErrorResponses,
  },
});

const userGetRoute = createRoute({
  method: "get",
  path: "/users/{id}",
  tags: ["users"],
  security: bearerSecurity,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(dataResponseSchema(userResponseSchema), "User by id"),
    ...commonErrorResponses,
  },
});

const userUpdateRoute = createRoute({
  method: "patch",
  path: "/users/{id}",
  tags: ["users"],
  security: bearerSecurity,
  request: {
    params: idParamSchema,
    body: jsonRequestBody(userUpdateSchema, "User update payload"),
  },
  responses: {
    200: jsonContent(dataResponseSchema(userResponseSchema), "Updated user"),
    ...commonErrorResponses,
  },
});

const userDeleteRoute = createRoute({
  method: "delete",
  path: "/users/{id}",
  tags: ["users"],
  security: bearerSecurity,
  request: {
    params: idParamSchema,
  },
  responses: {
    204: { description: "User deleted" },
    ...commonErrorResponses,
  },
});

export function registerUserRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(userListRoute, async (c) => {
    const actor = requireActor(c);
    const query = c.req.valid("query");
    const result = await c.get("container").users.list.execute({
      actor,
      limit: query.limit,
      cursor: query.cursor,
    });
    return c.json({ data: result.data.map((user) => presentUser(user, actor)), page: result.page }, 200);
  });

  app.openapi(userCreateRoute, async (c) => {
    const actor = requireActor(c);
    const body = c.req.valid("json");
    const result = await c.get("container").users.create.execute({
      actor,
      input: {
        ...body,
        avatar: body.avatar ?? null,
        bio: body.bio ?? null,
        betterAuthUserId: body.betterAuthUserId ?? null,
      },
    });
    return c.json({ data: presentUser(result, actor) }, 201);
  });

  app.openapi(userGetRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const result = await c.get("container").users.get.execute({ actor, userId: params.id });
    return c.json({ data: presentUser(result, actor) }, 200);
  });

  app.openapi(userUpdateRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const body = c.req.valid("json");
    const result = await c.get("container").users.update.execute({
      actor,
      userId: params.id,
      input: body,
    });
    return c.json({ data: presentUser(result, actor) }, 200);
  });

  app.openapi(userDeleteRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    await c.get("container").users.delete.execute({ actor, userId: params.id });
    return c.body(null, 204);
  });
}

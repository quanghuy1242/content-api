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
import { presentDeferredGrant, presentGrantMirror, presentRelationship } from "@/http/presenters/authz.presenter";
import { requireActor } from "@/http/routes/helpers";
import {
  deferredGrantCreateSchema,
  deferredGrantResponseSchema,
  deferredGrantUpdateSchema,
  grantMirrorCreateSchema,
  grantMirrorResponseSchema,
  grantMirrorUpdateSchema,
  relationshipCreateSchema,
  relationshipResponseSchema,
} from "@/http/schemas/authz.schema";
import { idParamSchema, listResourceQuerySchema } from "@/http/schemas/common.schema";

const grantMirrorListRoute = createRoute({
  method: "get",
  path: "/grant-mirror",
  tags: ["authz"],
  security: bearerSecurity,
  request: { query: listResourceQuerySchema },
  responses: {
    200: jsonContent(listResponseSchema(grantMirrorResponseSchema), "List grant mirror rows"),
    ...commonErrorResponses,
  },
});

const grantMirrorCreateRoute = createRoute({
  method: "post",
  path: "/grant-mirror",
  tags: ["authz"],
  security: bearerSecurity,
  request: { body: jsonRequestBody(grantMirrorCreateSchema, "Grant mirror create payload") },
  responses: {
    201: jsonContent(dataResponseSchema(grantMirrorResponseSchema), "Created grant mirror row"),
    ...commonErrorResponses,
  },
});

const grantMirrorGetRoute = createRoute({
  method: "get",
  path: "/grant-mirror/{id}",
  tags: ["authz"],
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    200: jsonContent(dataResponseSchema(grantMirrorResponseSchema), "Grant mirror row by id"),
    ...commonErrorResponses,
  },
});

const grantMirrorUpdateRoute = createRoute({
  method: "patch",
  path: "/grant-mirror/{id}",
  tags: ["authz"],
  security: bearerSecurity,
  request: {
    params: idParamSchema,
    body: jsonRequestBody(grantMirrorUpdateSchema, "Grant mirror update payload"),
  },
  responses: {
    200: jsonContent(dataResponseSchema(grantMirrorResponseSchema), "Updated grant mirror row"),
    ...commonErrorResponses,
  },
});

const grantMirrorDeleteRoute = createRoute({
  method: "delete",
  path: "/grant-mirror/{id}",
  tags: ["authz"],
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    204: { description: "Grant mirror row deleted" },
    ...commonErrorResponses,
  },
});

const deferredGrantListRoute = createRoute({
  method: "get",
  path: "/deferred-grants",
  tags: ["authz"],
  security: bearerSecurity,
  request: { query: listResourceQuerySchema },
  responses: {
    200: jsonContent(listResponseSchema(deferredGrantResponseSchema), "List deferred grants"),
    ...commonErrorResponses,
  },
});

const deferredGrantCreateRoute = createRoute({
  method: "post",
  path: "/deferred-grants",
  tags: ["authz"],
  security: bearerSecurity,
  request: { body: jsonRequestBody(deferredGrantCreateSchema, "Deferred grant create payload") },
  responses: {
    201: jsonContent(dataResponseSchema(deferredGrantResponseSchema), "Created deferred grant"),
    ...commonErrorResponses,
  },
});

const deferredGrantGetRoute = createRoute({
  method: "get",
  path: "/deferred-grants/{id}",
  tags: ["authz"],
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    200: jsonContent(dataResponseSchema(deferredGrantResponseSchema), "Deferred grant by id"),
    ...commonErrorResponses,
  },
});

const deferredGrantUpdateRoute = createRoute({
  method: "patch",
  path: "/deferred-grants/{id}",
  tags: ["authz"],
  security: bearerSecurity,
  request: {
    params: idParamSchema,
    body: jsonRequestBody(deferredGrantUpdateSchema, "Deferred grant update payload"),
  },
  responses: {
    200: jsonContent(dataResponseSchema(deferredGrantResponseSchema), "Updated deferred grant"),
    ...commonErrorResponses,
  },
});

const deferredGrantDeleteRoute = createRoute({
  method: "delete",
  path: "/deferred-grants/{id}",
  tags: ["authz"],
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    204: { description: "Deferred grant deleted" },
    ...commonErrorResponses,
  },
});

const relationshipListRoute = createRoute({
  method: "get",
  path: "/relationships",
  tags: ["authz"],
  security: bearerSecurity,
  request: { query: listResourceQuerySchema },
  responses: {
    200: jsonContent(listResponseSchema(relationshipResponseSchema), "List relationship grants"),
    ...commonErrorResponses,
  },
});

const relationshipCreateRoute = createRoute({
  method: "post",
  path: "/relationships",
  tags: ["authz"],
  security: bearerSecurity,
  request: { body: jsonRequestBody(relationshipCreateSchema, "Relationship create payload") },
  responses: {
    201: jsonContent(dataResponseSchema(relationshipResponseSchema), "Created relationship grant"),
    ...commonErrorResponses,
  },
});

const relationshipDeleteRoute = createRoute({
  method: "delete",
  path: "/relationships/{id}",
  tags: ["authz"],
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    204: { description: "Relationship grant deleted" },
    ...commonErrorResponses,
  },
});

export function registerAuthzRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(grantMirrorListRoute, async (c) => {
    const actor = requireActor(c);
    const query = c.req.valid("query");
    const result = await c.get("container").grantMirror.list.execute({
      actor,
      limit: query.limit,
      cursor: query.cursor,
    });
    return c.json({ data: result.data.map(presentGrantMirror), page: result.page }, 200);
  });

  app.openapi(grantMirrorCreateRoute, async (c) => {
    const actor = requireActor(c);
    const body = c.req.valid("json");
    const result = await c.get("container").grantMirror.create.execute({ actor, input: body });
    return c.json({ data: presentGrantMirror(result) }, 201);
  });

  app.openapi(grantMirrorGetRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const result = await c.get("container").grantMirror.get.execute({ actor, grantMirrorId: params.id });
    return c.json({ data: presentGrantMirror(result) }, 200);
  });

  app.openapi(grantMirrorUpdateRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const body = c.req.valid("json");
    const result = await c.get("container").grantMirror.update.execute({
      actor,
      grantMirrorId: params.id,
      input: body,
    });
    return c.json({ data: presentGrantMirror(result) }, 200);
  });

  app.openapi(grantMirrorDeleteRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    await c.get("container").grantMirror.delete.execute({ actor, grantMirrorId: params.id });
    return c.body(null, 204);
  });

  app.openapi(deferredGrantListRoute, async (c) => {
    const actor = requireActor(c);
    const query = c.req.valid("query");
    const result = await c.get("container").deferredGrants.list.execute({
      actor,
      limit: query.limit,
      cursor: query.cursor,
    });
    return c.json({ data: result.data.map(presentDeferredGrant), page: result.page }, 200);
  });

  app.openapi(deferredGrantCreateRoute, async (c) => {
    const actor = requireActor(c);
    const body = c.req.valid("json");
    const result = await c.get("container").deferredGrants.create.execute({
      actor,
      input: { ...body, processedAt: body.processedAt ?? null },
    });
    return c.json({ data: presentDeferredGrant(result) }, 201);
  });

  app.openapi(deferredGrantGetRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const result = await c.get("container").deferredGrants.get.execute({
      actor,
      deferredGrantId: params.id,
    });
    return c.json({ data: presentDeferredGrant(result) }, 200);
  });

  app.openapi(deferredGrantUpdateRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const body = c.req.valid("json");
    const result = await c.get("container").deferredGrants.update.execute({
      actor,
      deferredGrantId: params.id,
      input: body,
    });
    return c.json({ data: presentDeferredGrant(result) }, 200);
  });

  app.openapi(deferredGrantDeleteRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    await c.get("container").deferredGrants.delete.execute({ actor, deferredGrantId: params.id });
    return c.body(null, 204);
  });

  app.openapi(relationshipListRoute, async (c) => {
    const actor = requireActor(c);
    const query = c.req.valid("query");
    const result = await c.get("container").relationships.list.execute({
      actor,
      limit: query.limit,
      cursor: query.cursor,
    });
    return c.json({ data: result.data.map(presentRelationship), page: result.page }, 200);
  });

  app.openapi(relationshipCreateRoute, async (c) => {
    const actor = requireActor(c);
    const body = c.req.valid("json");
    const result = await c.get("container").relationships.create.execute({ actor, input: body });
    return c.json({ data: presentRelationship(result) }, 201);
  });

  app.openapi(relationshipDeleteRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    await c.get("container").relationships.delete.execute({ actor, relationshipId: params.id });
    return c.body(null, 204);
  });
}

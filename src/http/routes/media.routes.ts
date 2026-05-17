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
import { presentMedia } from "@/http/presenters/media.presenter";
import { requireActor } from "@/http/routes/helpers";
import { idParamSchema, idempotencyHeaderSchema, listResourceQuerySchema } from "@/http/schemas/common.schema";
import { mediaCreateSchema, mediaResponseSchema, mediaUpdateSchema } from "@/http/schemas/media.schema";

const mediaListRoute = createRoute({
  method: "get",
  path: "/media",
  tags: ["media"],
  request: { query: listResourceQuerySchema },
  responses: {
    200: jsonContent(listResponseSchema(mediaResponseSchema), "List readable media metadata"),
    ...commonErrorResponses,
  },
});

const mediaCreateRoute = createRoute({
  method: "post",
  path: "/media",
  tags: ["media"],
  security: bearerSecurity,
  request: {
    headers: idempotencyHeaderSchema,
    body: jsonRequestBody(mediaCreateSchema, "Media metadata create payload"),
  },
  responses: {
    201: jsonContent(dataResponseSchema(mediaResponseSchema), "Created media metadata"),
    ...commonErrorResponses,
  },
});

const mediaGetRoute = createRoute({
  method: "get",
  path: "/media/{id}",
  tags: ["media"],
  request: { params: idParamSchema },
  responses: {
    200: jsonContent(dataResponseSchema(mediaResponseSchema), "Media metadata by id"),
    ...commonErrorResponses,
  },
});

const mediaUpdateRoute = createRoute({
  method: "patch",
  path: "/media/{id}",
  tags: ["media"],
  security: bearerSecurity,
  request: {
    params: idParamSchema,
    body: jsonRequestBody(mediaUpdateSchema, "Media metadata update payload"),
  },
  responses: {
    200: jsonContent(dataResponseSchema(mediaResponseSchema), "Updated media metadata"),
    ...commonErrorResponses,
  },
});

const mediaPublishRoute = createRoute({
  method: "post",
  path: "/media/{id}/publish",
  tags: ["media"],
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    200: jsonContent(dataResponseSchema(mediaResponseSchema), "Published media metadata"),
    ...commonErrorResponses,
  },
});

const mediaUnpublishRoute = createRoute({
  method: "post",
  path: "/media/{id}/unpublish",
  tags: ["media"],
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    200: jsonContent(dataResponseSchema(mediaResponseSchema), "Unpublished media metadata"),
    ...commonErrorResponses,
  },
});

const mediaDeleteRoute = createRoute({
  method: "delete",
  path: "/media/{id}",
  tags: ["media"],
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    204: { description: "Media metadata deleted" },
    ...commonErrorResponses,
  },
});

export function registerMediaRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(mediaListRoute, async (c) => {
    const query = c.req.valid("query");
    const result = await c.get("container").media.list.execute({
      actor: c.get("actor"),
      limit: query.limit,
      cursor: query.cursor,
    });
    return c.json({ data: result.data.map(presentMedia), page: result.page }, 200);
  });

  app.openapi(mediaCreateRoute, async (c) => {
    const actor = requireActor(c);
    const headers = c.req.valid("header");
    const body = c.req.valid("json");
    const result = await c.get("container").media.create.execute({
      actor,
      idempotencyKey: headers["idempotency-key"],
      input: body,
    });
    return c.json({ data: presentMedia(result) }, 201);
  });

  app.openapi(mediaGetRoute, async (c) => {
    const params = c.req.valid("param");
    const result = await c.get("container").media.get.execute({ actor: c.get("actor"), mediaId: params.id });
    return c.json({ data: presentMedia(result) }, 200);
  });

  app.openapi(mediaUpdateRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const body = c.req.valid("json");
    const result = await c.get("container").media.update.execute({
      actor,
      mediaId: params.id,
      input: body,
    });
    return c.json({ data: presentMedia(result) }, 200);
  });

  app.openapi(mediaPublishRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const result = await c.get("container").media.publish.execute({ actor, mediaId: params.id });
    return c.json({ data: presentMedia(result) }, 200);
  });

  app.openapi(mediaUnpublishRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const result = await c.get("container").media.unpublish.execute({ actor, mediaId: params.id });
    return c.json({ data: presentMedia(result) }, 200);
  });

  app.openapi(mediaDeleteRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    await c.get("container").media.delete.execute({ actor, mediaId: params.id });
    return c.body(null, 204);
  });
}

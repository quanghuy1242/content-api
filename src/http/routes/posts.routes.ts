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
import { presentPost } from "@/http/presenters/post.presenter";
import { requireActor } from "@/http/routes/helpers";
import { idParamSchema, idempotencyHeaderSchema, listResourceQuerySchema } from "@/http/schemas/common.schema";
import { createPostBodySchema, postResponseSchema, updatePostBodySchema } from "@/http/schemas/posts.schema";
import { HTTP_STATUS_CREATED, HTTP_STATUS_NO_CONTENT, HTTP_STATUS_OK } from "@/shared/constants";

const postListRoute = createRoute({
  method: "get",
  path: "/posts",
  tags: ["posts"],
  description: "List posts. Anonymous users see only published posts. Authenticated users see their own drafts. Admins see all.",
  request: { query: listResourceQuerySchema },
  responses: {
    200: jsonContent(listResponseSchema(postResponseSchema), "List readable posts"),
    ...commonErrorResponses,
  },
});

const postCreateRoute = createRoute({
  method: "post",
  path: "/posts",
  tags: ["posts"],
  description: "Create a new draft post. Supports idempotency via Idempotency-Key header.",
  security: bearerSecurity,
  request: {
    headers: idempotencyHeaderSchema,
    body: jsonRequestBody(createPostBodySchema, "Post create payload"),
  },
  responses: {
    201: jsonContent(dataResponseSchema(postResponseSchema), "Created post"),
    ...commonErrorResponses,
  },
});

const postGetRoute = createRoute({
  method: "get",
  path: "/posts/{id}",
  tags: ["posts"],
  description: "Get a single post by ID. Anonymous users can only read published posts.",
  request: { params: idParamSchema },
  responses: {
    200: jsonContent(dataResponseSchema(postResponseSchema), "Post by id"),
    ...commonErrorResponses,
  },
});

const postUpdateRoute = createRoute({
  method: "patch",
  path: "/posts/{id}",
  tags: ["posts"],
  description: "Update fields on an existing post.",
  security: bearerSecurity,
  request: {
    params: idParamSchema,
    body: jsonRequestBody(updatePostBodySchema, "Post update payload"),
  },
  responses: {
    200: jsonContent(dataResponseSchema(postResponseSchema), "Updated post"),
    ...commonErrorResponses,
  },
});

const postPublishRoute = createRoute({
  method: "post",
  path: "/posts/{id}/publish",
  tags: ["posts"],
  description: "Publish a draft post to make it publicly visible.",
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    200: jsonContent(dataResponseSchema(postResponseSchema), "Published post"),
    ...commonErrorResponses,
  },
});

const postUnpublishRoute = createRoute({
  method: "post",
  path: "/posts/{id}/unpublish",
  tags: ["posts"],
  description: "Unpublish a published post to hide it from public view.",
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    200: jsonContent(dataResponseSchema(postResponseSchema), "Unpublished post"),
    ...commonErrorResponses,
  },
});

const postDeleteRoute = createRoute({
  method: "delete",
  path: "/posts/{id}",
  tags: ["posts"],
  description: "Delete a post.",
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    204: { description: "Post deleted" },
    ...commonErrorResponses,
  },
});

export function registerPostRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(postListRoute, async (c) => {
    const query = c.req.valid("query");
    const result = await c.get("container").posts.list.execute({
      actor: c.get("actor"),
      limit: query.limit,
      cursor: query.cursor,
    });
    return c.json({ data: result.data.map(presentPost), page: result.page }, HTTP_STATUS_OK);
  });

  app.openapi(postCreateRoute, async (c) => {
    const actor = requireActor(c);
    const headers = c.req.valid("header");
    const body = c.req.valid("json");
    const result = await c.get("container").posts.create.execute({
      actor,
      idempotencyKey: headers["idempotency-key"],
      input: body,
    });
    return c.json({ data: presentPost(result) }, HTTP_STATUS_CREATED);
  });

  app.openapi(postGetRoute, async (c) => {
    const params = c.req.valid("param");
    const result = await c.get("container").posts.get.execute({ actor: c.get("actor"), postId: params.id });
    return c.json({ data: presentPost(result) }, HTTP_STATUS_OK);
  });

  app.openapi(postUpdateRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const body = c.req.valid("json");
    const result = await c.get("container").posts.update.execute({ actor, postId: params.id, input: body });
    return c.json({ data: presentPost(result) }, HTTP_STATUS_OK);
  });

  app.openapi(postPublishRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const result = await c.get("container").posts.publish.execute({ actor, postId: params.id });
    return c.json({ data: presentPost(result) }, HTTP_STATUS_OK);
  });

  app.openapi(postUnpublishRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const result = await c.get("container").posts.unpublish.execute({ actor, postId: params.id });
    return c.json({ data: presentPost(result) }, HTTP_STATUS_OK);
  });

  app.openapi(postDeleteRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    await c.get("container").posts.delete.execute({ actor, postId: params.id });
    return c.body(null, HTTP_STATUS_NO_CONTENT);
  });
}

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "@/http/app-env";
import {
  bearerSecurity,
  binaryContent,
  commonErrorResponses,
  dataResponseSchema,
  jsonContent,
  jsonRequestBody,
  listResponseSchema,
} from "@/http/openapi";
import { presentMedia, presentMediaUploadResult } from "@/http/presenters/media.presenter";
import { requireActor } from "@/http/routes/helpers";
import { idParamSchema, idempotencyHeaderSchema, listResourceQuerySchema } from "@/http/schemas/common.schema";
import {
  mediaCreateSchema,
  mediaResponseSchema,
  mediaUpdateSchema,
  mediaUploadResponseSchema,
  mediaVariantNameSchema,
} from "@/http/schemas/media.schema";
import { HTTP_STATUS_CREATED, HTTP_STATUS_NO_CONTENT, HTTP_STATUS_OK } from "@/shared/constants";

const mediaVariantParamSchema = idParamSchema.extend({
  version: z.coerce.number().int().positive(),
  name: mediaVariantNameSchema,
});

const mediaListRoute = createRoute({
  method: "get",
  path: "/media",
  tags: ["media"],
  description: "List media. Anonymous users see only public ready media. Authenticated users see their own uploads.",
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
  description: "Create a pending media upload row and get a presigned R2 PUT URL. Supports idempotency via Idempotency-Key header.",
  security: bearerSecurity,
  request: {
    headers: idempotencyHeaderSchema,
    body: jsonRequestBody(mediaCreateSchema, "Media upload create payload"),
  },
  responses: {
    201: jsonContent(dataResponseSchema(mediaUploadResponseSchema), "Created pending media and upload instructions"),
    ...commonErrorResponses,
  },
});

const mediaGetRoute = createRoute({
  method: "get",
  path: "/media/{id}",
  tags: ["media"],
  description: "Get media metadata by ID. Includes variant URLs and lowResUrl when status is ready.",
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
  description: "Update media metadata fields such as alt text.",
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
  description: "Make media publicly visible. Requires the media to be in ready status.",
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
  description: "Make media private again.",
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    200: jsonContent(dataResponseSchema(mediaResponseSchema), "Unpublished media metadata"),
    ...commonErrorResponses,
  },
});

const mediaVariantRoute = createRoute({
  method: "get",
  path: "/media/{id}/v/{version}/variants/{name}",
  tags: ["media"],
  description: "Stream a generated image variant (thumb, small, medium, large, og, blur) by media ID and version.",
  request: {
    params: mediaVariantParamSchema,
  },
  responses: {
    200: binaryContent(["image/webp", "image/jpeg"], "Generated media variant stream"),
    ...commonErrorResponses,
  },
});

const mediaDeleteRoute = createRoute({
  method: "delete",
  path: "/media/{id}",
  tags: ["media"],
  description: "Delete media metadata.",
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
    return c.json({ data: result.data.map(presentMedia), page: result.page }, HTTP_STATUS_OK);
  });

  app.openapi(mediaCreateRoute, async (c) => {
    const actor = requireActor(c);
    const headers = c.req.valid("header");
    const body = c.req.valid("json");
    const result = await c.get("container").media.create.execute({
      actor,
      idempotencyKey: headers["idempotency-key"],
      input: {
        ...body,
        focalX: body.focalX ?? null,
        focalY: body.focalY ?? null,
      },
    });
    return c.json({ data: presentMediaUploadResult(result) }, HTTP_STATUS_CREATED);
  });

  app.openapi(mediaGetRoute, async (c) => {
    const params = c.req.valid("param");
    const result = await c.get("container").media.get.execute({ actor: c.get("actor"), mediaId: params.id });
    return c.json({ data: presentMedia(result) }, HTTP_STATUS_OK);
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
    return c.json({ data: presentMedia(result) }, HTTP_STATUS_OK);
  });

  app.openapi(mediaPublishRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const result = await c.get("container").media.publish.execute({ actor, mediaId: params.id });
    return c.json({ data: presentMedia(result) }, HTTP_STATUS_OK);
  });

  app.openapi(mediaUnpublishRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const result = await c.get("container").media.unpublish.execute({ actor, mediaId: params.id });
    return c.json({ data: presentMedia(result) }, HTTP_STATUS_OK);
  });

  app.openapi(mediaVariantRoute, async (c) => {
    const params = c.req.valid("param");
    const result = await c.get("container").media.serveVariant.execute({
      actor: c.get("actor"),
      mediaId: params.id,
      version: params.version,
      variantName: params.name,
    });
    return c.body(result.body, HTTP_STATUS_OK, {
      "content-type": result.contentType,
      "cache-control": result.cacheControl,
      ...(result.etag ? { etag: result.etag } : {}),
    });
  });

  app.openapi(mediaDeleteRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    await c.get("container").media.delete.execute({ actor, mediaId: params.id });
    return c.body(null, HTTP_STATUS_NO_CONTENT);
  });
}

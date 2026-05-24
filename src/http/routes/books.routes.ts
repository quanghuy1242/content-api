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
import { presentBook } from "@/http/presenters/book.presenter";
import { requireActor } from "@/http/routes/helpers";
import { idParamSchema, idempotencyHeaderSchema, listResourceQuerySchema } from "@/http/schemas/common.schema";
import {
  bookResponseSchema,
  createBookSchema,
  organizationBookParamSchema,
  updateBookSchema,
} from "@/http/schemas/books.schema";
import { HTTP_STATUS_CREATED, HTTP_STATUS_OK } from "@/shared/constants";

const listBooksRoute = createRoute({
  method: "get",
  path: "/books",
  tags: ["books"],
  description: "List public published books and private books readable through Content IAM.",
  request: { query: listResourceQuerySchema },
  responses: {
    200: jsonContent(listResponseSchema(bookResponseSchema), "Readable books"),
    ...commonErrorResponses,
  },
});

const getBookRoute = createRoute({
  method: "get",
  path: "/books/{id}",
  tags: ["books"],
  description: "Get a public published or Content IAM-readable book.",
  request: { params: idParamSchema },
  responses: {
    200: jsonContent(dataResponseSchema(bookResponseSchema), "Readable book"),
    ...commonErrorResponses,
  },
});

const createBookRoute = createRoute({
  method: "post",
  path: "/organizations/{orgId}/books",
  tags: ["books"],
  description: "Create a private draft book and its single direct owner binding atomically.",
  security: bearerSecurity,
  request: {
    params: organizationBookParamSchema,
    headers: idempotencyHeaderSchema,
    body: jsonRequestBody(createBookSchema, "Book create payload"),
  },
  responses: {
    201: jsonContent(dataResponseSchema(bookResponseSchema), "Created book"),
    ...commonErrorResponses,
  },
});

const updateBookRoute = createRoute({
  method: "patch",
  path: "/books/{id}",
  tags: ["books"],
  description: "Update a book when Content IAM grants book.update.",
  security: bearerSecurity,
  request: {
    params: idParamSchema,
    body: jsonRequestBody(updateBookSchema, "Book update payload"),
  },
  responses: {
    200: jsonContent(dataResponseSchema(bookResponseSchema), "Updated book"),
    ...commonErrorResponses,
  },
});

export function registerBookRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(listBooksRoute, async (c) => {
    const query = c.req.valid("query");
    const result = await c.get("container").books.list.execute({
      actor: c.get("actor"),
      limit: query.limit,
      cursor: query.cursor,
    });
    return c.json({ data: result.data.map(presentBook), page: result.page }, HTTP_STATUS_OK);
  });

  app.openapi(getBookRoute, async (c) => {
    const params = c.req.valid("param");
    const result = await c.get("container").books.get.execute({ actor: c.get("actor"), bookId: params.id });
    return c.json({ data: presentBook(result) }, HTTP_STATUS_OK);
  });

  app.openapi(createBookRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const headers = c.req.valid("header");
    const body = c.req.valid("json");
    const result = await c.get("container").books.create.execute({
      actor,
      orgId: params.orgId,
      idempotencyKey: headers["idempotency-key"],
      input: body,
      requestId: c.get("requestId"),
    });
    return c.json({ data: presentBook(result.book) }, HTTP_STATUS_CREATED);
  });

  app.openapi(updateBookRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const body = c.req.valid("json");
    const result = await c.get("container").books.update.execute({ actor, bookId: params.id, input: body });
    return c.json({ data: presentBook(result) }, HTTP_STATUS_OK);
  });
}

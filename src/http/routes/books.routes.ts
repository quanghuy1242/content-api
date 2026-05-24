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
import {
  presentPolicyBinding,
  presentPolicyDenial,
  presentPolicyEvent,
} from "@/http/presenters/content-iam.presenter";
import { requireActor } from "@/http/routes/helpers";
import { idParamSchema, idempotencyHeaderSchema, listResourceQuerySchema } from "@/http/schemas/common.schema";
import {
  bookResponseSchema,
  createBookSchema,
  updateBookSchema,
} from "@/http/schemas/books.schema";
import {
  bindingIdParamSchema,
  bookIdParamSchema,
  contentIamBindingListQuerySchema,
  contentIamListQuerySchema,
  createPolicyBindingSchema,
  createPolicyDenialSchema,
  denialIdParamSchema,
  ownershipTransferResponseSchema,
  policyBindingResponseSchema,
  policyDenialResponseSchema,
  policyEventResponseSchema,
  policyMutationResponseSchema,
  transferBookOwnershipSchema,
} from "@/http/schemas/content-iam.schema";
import { HTTP_STATUS_CREATED, HTTP_STATUS_NO_CONTENT, HTTP_STATUS_OK } from "@/shared/constants";

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
  path: "/books",
  tags: ["books"],
  description: "Create a private draft book and its single direct owner binding atomically.",
  security: bearerSecurity,
  request: {
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

// Book IAM routes live here (not in content-iam.routes.ts) following the GCP-style
// convention: resource IAM management belongs under the resource's own path.
// Only books expose per-resource IAM routes because books are explicitly collaborative.
// Posts are single-owner. Categories are org-owned (see docs/012). Media is deferred.

const listBookBindingsRoute = createRoute({
  method: "get",
  path: "/books/{bookId}/policy-bindings",
  tags: ["books"],
  description: "List direct or effective Content IAM policy bindings on a book.",
  security: bearerSecurity,
  request: { params: bookIdParamSchema, query: contentIamBindingListQuerySchema },
  responses: {
    200: jsonContent(listResponseSchema(policyBindingResponseSchema), "Book policy bindings"),
    ...commonErrorResponses,
  },
});

const createBookBindingRoute = createRoute({
  method: "post",
  path: "/books/{bookId}/policy-bindings",
  tags: ["books"],
  description: "Create a resource-scoped Content IAM binding on a book.",
  security: bearerSecurity,
  request: {
    params: bookIdParamSchema,
    headers: idempotencyHeaderSchema,
    body: jsonRequestBody(createPolicyBindingSchema, "Policy binding create payload"),
  },
  responses: {
    201: jsonContent(policyMutationResponseSchema(policyBindingResponseSchema), "Created policy binding"),
    ...commonErrorResponses,
  },
});

const revokeBookBindingRoute = createRoute({
  method: "delete",
  path: "/books/{bookId}/policy-bindings/{bindingId}",
  tags: ["books"],
  description: "Revoke a direct Content IAM policy binding on a book.",
  security: bearerSecurity,
  request: { params: bindingIdParamSchema },
  responses: {
    204: { description: "Policy binding revoked" },
    ...commonErrorResponses,
  },
});

const listBookDenialsRoute = createRoute({
  method: "get",
  path: "/books/{bookId}/policy-denials",
  tags: ["books"],
  description: "List direct Content IAM policy denials on a book.",
  security: bearerSecurity,
  request: { params: bookIdParamSchema, query: contentIamListQuerySchema },
  responses: {
    200: jsonContent(listResponseSchema(policyDenialResponseSchema), "Book policy denials"),
    ...commonErrorResponses,
  },
});

const createBookDenialRoute = createRoute({
  method: "post",
  path: "/books/{bookId}/policy-denials",
  tags: ["books"],
  description: "Create a resource-scoped Content IAM denial on a book.",
  security: bearerSecurity,
  request: {
    params: bookIdParamSchema,
    headers: idempotencyHeaderSchema,
    body: jsonRequestBody(createPolicyDenialSchema, "Policy denial create payload"),
  },
  responses: {
    201: jsonContent(policyMutationResponseSchema(policyDenialResponseSchema), "Created policy denial"),
    ...commonErrorResponses,
  },
});

const revokeBookDenialRoute = createRoute({
  method: "delete",
  path: "/books/{bookId}/policy-denials/{denialId}",
  tags: ["books"],
  description: "Revoke a direct Content IAM policy denial on a book.",
  security: bearerSecurity,
  request: { params: denialIdParamSchema },
  responses: {
    204: { description: "Policy denial revoked" },
    ...commonErrorResponses,
  },
});

const transferBookOwnershipRoute = createRoute({
  method: "post",
  path: "/books/{bookId}/ownership-transfer",
  tags: ["books"],
  description: "Atomically transfer a book's direct-user owner binding.",
  security: bearerSecurity,
  request: {
    params: bookIdParamSchema,
    headers: idempotencyHeaderSchema,
    body: jsonRequestBody(transferBookOwnershipSchema, "Ownership transfer payload"),
  },
  responses: {
    201: jsonContent(ownershipTransferResponseSchema, "Transferred book ownership"),
    ...commonErrorResponses,
  },
});

const listBookEventsRoute = createRoute({
  method: "get",
  path: "/books/{bookId}/policy-events",
  tags: ["books"],
  description: "List Content IAM audit events for a book.",
  security: bearerSecurity,
  request: { params: bookIdParamSchema, query: contentIamListQuerySchema },
  responses: {
    200: jsonContent(listResponseSchema(policyEventResponseSchema), "Book policy events"),
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
    const headers = c.req.valid("header");
    const body = c.req.valid("json");
    const result = await c.get("container").books.create.execute({
      actor,
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

  app.openapi(listBookBindingsRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const query = c.req.valid("query");
    const result = await c.get("container").contentIam.listBindings.execute({
      actor,
      resource: { type: "book", id: params.bookId },
      view: query.view,
      limit: query.limit,
      cursor: query.cursor,
    });
    return c.json({ data: result.data.map(presentPolicyBinding), page: result.page }, HTTP_STATUS_OK);
  });

  app.openapi(createBookBindingRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const headers = c.req.valid("header");
    const body = c.req.valid("json");
    const result = await c.get("container").contentIam.createBinding.execute({
      actor,
      resource: { type: "book", id: params.bookId },
      idempotencyKey: headers["idempotency-key"],
      input: body,
      requestId: c.get("requestId"),
    });
    return c.json({ data: presentPolicyBinding(result.binding), auditEventId: result.event.id }, HTTP_STATUS_CREATED);
  });

  app.openapi(revokeBookBindingRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    await c.get("container").contentIam.revokeBinding.execute({
      actor,
      resource: { type: "book", id: params.bookId },
      bindingId: params.bindingId,
      requestId: c.get("requestId"),
    });
    return c.body(null, HTTP_STATUS_NO_CONTENT);
  });

  app.openapi(listBookDenialsRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const query = c.req.valid("query");
    const result = await c.get("container").contentIam.listDenials.execute({
      actor,
      resource: { type: "book", id: params.bookId },
      limit: query.limit,
      cursor: query.cursor,
    });
    return c.json({ data: result.data.map(presentPolicyDenial), page: result.page }, HTTP_STATUS_OK);
  });

  app.openapi(createBookDenialRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const headers = c.req.valid("header");
    const body = c.req.valid("json");
    const result = await c.get("container").contentIam.createDenial.execute({
      actor,
      resource: { type: "book", id: params.bookId },
      idempotencyKey: headers["idempotency-key"],
      input: body,
      requestId: c.get("requestId"),
    });
    return c.json({ data: presentPolicyDenial(result.denial), auditEventId: result.event.id }, HTTP_STATUS_CREATED);
  });

  app.openapi(revokeBookDenialRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    await c.get("container").contentIam.revokeDenial.execute({
      actor,
      resource: { type: "book", id: params.bookId },
      denialId: params.denialId,
      requestId: c.get("requestId"),
    });
    return c.body(null, HTTP_STATUS_NO_CONTENT);
  });

  app.openapi(transferBookOwnershipRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const headers = c.req.valid("header");
    const body = c.req.valid("json");
    const result = await c.get("container").contentIam.transferOwnership.execute({
      actor,
      bookId: params.bookId,
      idempotencyKey: headers["idempotency-key"],
      input: body,
      requestId: c.get("requestId"),
    });
    return c.json({
      currentOwner: presentPolicyBinding(result.currentOwner),
      nextOwner: presentPolicyBinding(result.nextOwner),
      auditEventId: result.event.id,
    }, HTTP_STATUS_CREATED);
  });

  app.openapi(listBookEventsRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const query = c.req.valid("query");
    const result = await c.get("container").contentIam.listEvents.execute({
      actor,
      resource: { type: "book", id: params.bookId },
      limit: query.limit,
      cursor: query.cursor,
    });
    return c.json({ data: result.data.map(presentPolicyEvent), page: result.page }, HTTP_STATUS_OK);
  });
}

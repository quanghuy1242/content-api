import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "@/http/app-env";
import {
  bearerSecurity,
  commonErrorResponses,
  jsonContent,
  jsonRequestBody,
  listResponseSchema,
} from "@/http/openapi";
import {
  presentContentRole,
  presentPolicyBinding,
  presentPolicyDenial,
  presentPolicyEvent,
} from "@/http/presenters/content-iam.presenter";
import { requireActor } from "@/http/routes/helpers";
import { idempotencyHeaderSchema } from "@/http/schemas/common.schema";
import {
  bootstrapOrganizationContentAdminSchema,
  contentIamListQuerySchema,
  contentRoleResponseSchema,
  createContentRoleSchema,
  createPolicyBindingSchema,
  createPolicyDenialSchema,
  delegateOrganizationContentAdminSchema,
  orgBindingIdParamSchema,
  orgDenialIdParamSchema,
  orgIdParamSchema,
  policyBindingResponseSchema,
  policyDenialResponseSchema,
  policyEventResponseSchema,
  policyMutationResponseSchema,
  replaceContentRolePermissionsSchema,
  roleIdParamSchema,
} from "@/http/schemas/content-iam.schema";
import { HTTP_STATUS_CREATED, HTTP_STATUS_NO_CONTENT, HTTP_STATUS_OK } from "@/shared/constants";

// This file covers org-scoped Content IAM management: role CRUD, org-level bindings/denials,
// org admin bootstrap/delegation, and org audit events.
//
// Book-scoped IAM routes (policy-bindings, policy-denials, ownership-transfer, policy-events)
// live in books.routes.ts — resource IAM belongs under the resource path (GCP-style convention).

const listOrgBindingsRoute = createRoute({
  method: "get",
  path: "/organizations/{orgId}/policy-bindings",
  tags: ["content-iam"],
  description: "List organization-scoped Content IAM policy bindings.",
  security: bearerSecurity,
  request: { params: orgIdParamSchema, query: contentIamListQuerySchema },
  responses: {
    200: jsonContent(listResponseSchema(policyBindingResponseSchema), "Organization policy bindings"),
    ...commonErrorResponses,
  },
});

const createOrgBindingRoute = createRoute({
  method: "post",
  path: "/organizations/{orgId}/policy-bindings",
  tags: ["content-iam"],
  description: "Create an ordinary organization-scoped Content IAM binding.",
  security: bearerSecurity,
  request: {
    params: orgIdParamSchema,
    headers: idempotencyHeaderSchema,
    body: jsonRequestBody(createPolicyBindingSchema, "Organization policy binding create payload"),
  },
  responses: {
    201: jsonContent(policyMutationResponseSchema(policyBindingResponseSchema), "Created organization policy binding"),
    ...commonErrorResponses,
  },
});

const revokeOrgBindingRoute = createRoute({
  method: "delete",
  path: "/organizations/{orgId}/policy-bindings/{bindingId}",
  tags: ["content-iam"],
  description: "Revoke an organization-scoped Content IAM binding.",
  security: bearerSecurity,
  request: { params: orgBindingIdParamSchema },
  responses: {
    204: { description: "Organization policy binding revoked" },
    ...commonErrorResponses,
  },
});

const listOrgDenialsRoute = createRoute({
  method: "get",
  path: "/organizations/{orgId}/policy-denials",
  tags: ["content-iam"],
  description: "List organization-scoped Content IAM policy denials.",
  security: bearerSecurity,
  request: { params: orgIdParamSchema, query: contentIamListQuerySchema },
  responses: {
    200: jsonContent(listResponseSchema(policyDenialResponseSchema), "Organization policy denials"),
    ...commonErrorResponses,
  },
});

const createOrgDenialRoute = createRoute({
  method: "post",
  path: "/organizations/{orgId}/policy-denials",
  tags: ["content-iam"],
  description: "Create an organization-scoped ordinary permission denial.",
  security: bearerSecurity,
  request: {
    params: orgIdParamSchema,
    headers: idempotencyHeaderSchema,
    body: jsonRequestBody(createPolicyDenialSchema, "Organization policy denial create payload"),
  },
  responses: {
    201: jsonContent(policyMutationResponseSchema(policyDenialResponseSchema), "Created organization policy denial"),
    ...commonErrorResponses,
  },
});

const revokeOrgDenialRoute = createRoute({
  method: "delete",
  path: "/organizations/{orgId}/policy-denials/{denialId}",
  tags: ["content-iam"],
  description: "Revoke an organization-scoped Content IAM denial.",
  security: bearerSecurity,
  request: { params: orgDenialIdParamSchema },
  responses: {
    204: { description: "Organization policy denial revoked" },
    ...commonErrorResponses,
  },
});

const listOrgEventsRoute = createRoute({
  method: "get",
  path: "/organizations/{orgId}/policy-events",
  tags: ["content-iam"],
  description: "List Content IAM audit events for an organization.",
  security: bearerSecurity,
  request: { params: orgIdParamSchema, query: contentIamListQuerySchema },
  responses: {
    200: jsonContent(listResponseSchema(policyEventResponseSchema), "Organization policy events"),
    ...commonErrorResponses,
  },
});

const bootstrapOrgAdminRoute = createRoute({
  method: "post",
  path: "/organizations/{orgId}/content-iam/bootstrap",
  tags: ["content-iam"],
  description: "Bootstrap the first local organization Content IAM administrator.",
  security: bearerSecurity,
  request: {
    params: orgIdParamSchema,
    headers: idempotencyHeaderSchema,
    body: jsonRequestBody(bootstrapOrganizationContentAdminSchema, "Organization Content IAM bootstrap payload"),
  },
  responses: {
    201: jsonContent(policyMutationResponseSchema(policyBindingResponseSchema), "Bootstrapped organization Content IAM admin"),
    ...commonErrorResponses,
  },
});

const delegateOrgAdminRoute = createRoute({
  method: "post",
  path: "/organizations/{orgId}/content-admins",
  tags: ["content-iam"],
  description: "Delegate organization Content IAM administrator authority to a direct user.",
  security: bearerSecurity,
  request: {
    params: orgIdParamSchema,
    headers: idempotencyHeaderSchema,
    body: jsonRequestBody(delegateOrganizationContentAdminSchema, "Organization Content IAM admin delegation payload"),
  },
  responses: {
    201: jsonContent(policyMutationResponseSchema(policyBindingResponseSchema), "Delegated organization Content IAM admin"),
    ...commonErrorResponses,
  },
});

const revokeOrgAdminRoute = createRoute({
  method: "delete",
  path: "/organizations/{orgId}/content-admins/{bindingId}",
  tags: ["content-iam"],
  description: "Revoke an organization Content IAM administrator while preserving the last-admin invariant.",
  security: bearerSecurity,
  request: { params: orgBindingIdParamSchema },
  responses: {
    204: { description: "Organization Content IAM administrator revoked" },
    ...commonErrorResponses,
  },
});

const listOrgRolesRoute = createRoute({
  method: "get",
  path: "/organizations/{orgId}/content-roles",
  tags: ["content-iam"],
  description: "List built-in and organization-defined Content IAM roles.",
  security: bearerSecurity,
  request: { params: orgIdParamSchema, query: contentIamListQuerySchema },
  responses: {
    200: jsonContent(listResponseSchema(contentRoleResponseSchema), "Organization content roles"),
    ...commonErrorResponses,
  },
});

const createOrgRoleRoute = createRoute({
  method: "post",
  path: "/organizations/{orgId}/content-roles",
  tags: ["content-iam"],
  description: "Create an ordinary organization-defined Content IAM role.",
  security: bearerSecurity,
  request: {
    params: orgIdParamSchema,
    headers: idempotencyHeaderSchema,
    body: jsonRequestBody(createContentRoleSchema, "Content role create payload"),
  },
  responses: {
    201: jsonContent(policyMutationResponseSchema(contentRoleResponseSchema), "Created content role"),
    ...commonErrorResponses,
  },
});

const replaceOrgRolePermissionsRoute = createRoute({
  method: "put",
  path: "/organizations/{orgId}/content-roles/{roleId}/permissions",
  tags: ["content-iam"],
  description: "Replace an organization-defined Content IAM role permission set.",
  security: bearerSecurity,
  request: {
    params: roleIdParamSchema,
    headers: idempotencyHeaderSchema,
    body: jsonRequestBody(replaceContentRolePermissionsSchema, "Content role permission replacement payload"),
  },
  responses: {
    201: jsonContent(policyMutationResponseSchema(contentRoleResponseSchema), "Updated content role permissions"),
    ...commonErrorResponses,
  },
});

const disableOrgRoleRoute = createRoute({
  method: "delete",
  path: "/organizations/{orgId}/content-roles/{roleId}",
  tags: ["content-iam"],
  description: "Disable an organization-defined Content IAM role.",
  security: bearerSecurity,
  request: { params: roleIdParamSchema },
  responses: {
    204: { description: "Content role disabled" },
    ...commonErrorResponses,
  },
});

export function registerContentIamRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(listOrgBindingsRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const query = c.req.valid("query");
    const result = await c.get("container").contentIam.listBindings.execute({
      actor,
      resource: { type: "org", id: params.orgId },
      limit: query.limit,
      cursor: query.cursor,
    });
    return c.json({ data: result.data.map(presentPolicyBinding), page: result.page }, HTTP_STATUS_OK);
  });

  app.openapi(createOrgBindingRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const headers = c.req.valid("header");
    const body = c.req.valid("json");
    const result = await c.get("container").contentIam.createBinding.execute({
      actor,
      resource: { type: "org", id: params.orgId },
      idempotencyKey: headers["idempotency-key"],
      input: body,
      requestId: c.get("requestId"),
      bearerToken: c.get("bearerToken")!,
    });
    return c.json({ data: presentPolicyBinding(result.binding), auditEventId: result.event.id }, HTTP_STATUS_CREATED);
  });

  app.openapi(revokeOrgBindingRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    await c.get("container").contentIam.revokeBinding.execute({
      actor,
      resource: { type: "org", id: params.orgId },
      bindingId: params.bindingId,
      requestId: c.get("requestId"),
      bearerToken: c.get("bearerToken")!,
    });
    return c.body(null, HTTP_STATUS_NO_CONTENT);
  });

  app.openapi(listOrgDenialsRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const query = c.req.valid("query");
    const result = await c.get("container").contentIam.listDenials.execute({
      actor,
      resource: { type: "org", id: params.orgId },
      limit: query.limit,
      cursor: query.cursor,
    });
    return c.json({ data: result.data.map(presentPolicyDenial), page: result.page }, HTTP_STATUS_OK);
  });

  app.openapi(createOrgDenialRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const headers = c.req.valid("header");
    const body = c.req.valid("json");
    const result = await c.get("container").contentIam.createDenial.execute({
      actor,
      resource: { type: "org", id: params.orgId },
      idempotencyKey: headers["idempotency-key"],
      input: body,
      requestId: c.get("requestId"),
      bearerToken: c.get("bearerToken")!,
    });
    return c.json({ data: presentPolicyDenial(result.denial), auditEventId: result.event.id }, HTTP_STATUS_CREATED);
  });

  app.openapi(revokeOrgDenialRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    await c.get("container").contentIam.revokeDenial.execute({
      actor,
      resource: { type: "org", id: params.orgId },
      denialId: params.denialId,
      requestId: c.get("requestId"),
      bearerToken: c.get("bearerToken")!,
    });
    return c.body(null, HTTP_STATUS_NO_CONTENT);
  });

  app.openapi(listOrgEventsRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const query = c.req.valid("query");
    const result = await c.get("container").contentIam.listEvents.execute({
      actor,
      resource: { type: "org", id: params.orgId },
      limit: query.limit,
      cursor: query.cursor,
    });
    return c.json({ data: result.data.map(presentPolicyEvent), page: result.page }, HTTP_STATUS_OK);
  });

  app.openapi(bootstrapOrgAdminRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const headers = c.req.valid("header");
    const body = c.req.valid("json");
    const result = await c.get("container").contentIam.bootstrapOrganizationAdmin.execute({
      actor,
      orgId: params.orgId,
      userId: body.userId,
      idempotencyKey: headers["idempotency-key"],
      reason: body.reason,
      requestId: c.get("requestId"),
      bearerToken: c.get("bearerToken")!,
    });
    return c.json({ data: presentPolicyBinding(result.binding), auditEventId: result.event.id }, HTTP_STATUS_CREATED);
  });

  app.openapi(delegateOrgAdminRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const headers = c.req.valid("header");
    const body = c.req.valid("json");
    const result = await c.get("container").contentIam.delegateOrganizationAdmin.execute({
      actor,
      orgId: params.orgId,
      idempotencyKey: headers["idempotency-key"],
      input: body,
      requestId: c.get("requestId"),
      bearerToken: c.get("bearerToken")!,
    });
    return c.json({ data: presentPolicyBinding(result.binding), auditEventId: result.event.id }, HTTP_STATUS_CREATED);
  });

  app.openapi(revokeOrgAdminRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    await c.get("container").contentIam.revokeBinding.execute({
      actor,
      resource: { type: "org", id: params.orgId },
      bindingId: params.bindingId,
      adminRevocation: true,
      requestId: c.get("requestId"),
      bearerToken: c.get("bearerToken")!,
    });
    return c.body(null, HTTP_STATUS_NO_CONTENT);
  });

  app.openapi(listOrgRolesRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const query = c.req.valid("query");
    const result = await c.get("container").contentIam.listRoles.execute({
      actor,
      orgId: params.orgId,
      limit: query.limit,
      cursor: query.cursor,
    });
    return c.json({ data: result.data.map(presentContentRole), page: result.page }, HTTP_STATUS_OK);
  });

  app.openapi(createOrgRoleRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const headers = c.req.valid("header");
    const body = c.req.valid("json");
    const result = await c.get("container").contentIam.createRole.execute({
      actor,
      orgId: params.orgId,
      idempotencyKey: headers["idempotency-key"],
      input: body,
      requestId: c.get("requestId"),
      bearerToken: c.get("bearerToken")!,
    });
    return c.json({
      data: presentContentRole({ role: result.role, permissions: result.permissions }),
      auditEventId: result.event.id,
    }, HTTP_STATUS_CREATED);
  });

  app.openapi(replaceOrgRolePermissionsRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    const headers = c.req.valid("header");
    const body = c.req.valid("json");
    const result = await c.get("container").contentIam.replaceRolePermissions.execute({
      actor,
      orgId: params.orgId,
      roleId: params.roleId,
      idempotencyKey: headers["idempotency-key"],
      input: body,
      requestId: c.get("requestId"),
      bearerToken: c.get("bearerToken")!,
    });
    return c.json({
      data: presentContentRole({ role: result.role, permissions: result.permissions }),
      auditEventId: result.event.id,
    }, HTTP_STATUS_CREATED);
  });

  app.openapi(disableOrgRoleRoute, async (c) => {
    const actor = requireActor(c);
    const params = c.req.valid("param");
    await c.get("container").contentIam.disableRole.execute({
      actor,
      orgId: params.orgId,
      roleId: params.roleId,
      requestId: c.get("requestId"),
      bearerToken: c.get("bearerToken")!,
    });
    return c.body(null, HTTP_STATUS_NO_CONTENT);
  });
}

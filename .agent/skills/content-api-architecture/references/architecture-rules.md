# Content API Architecture Rules

## Source Of Truth

The implementation must follow the local docs first:

- `docs/architecture.md`
- `docs/payloadcms-schema-spec.md`
- `docs/payloadcms-access-control-policy-spec.md`
- `~/pjs/auther` for OAuth2 resource-server, JWT/JWKS validation, issuer/audience, token shape, and grant behavior

When docs and code disagree, fix code or stop and ask if the docs are ambiguous. Do not invent endpoints, fields, or resource names.

## Clean Architecture Boundaries

`domain` contains business vocabulary:

- entities and value shapes
- repository interfaces
- policies and ReBAC checks
- actor and relationship types
- no framework, Hono, Drizzle, D1, or Cloudflare bindings

`application` contains use cases:

- one explicit workflow per operation
- loads domain models through repository interfaces
- invokes policies and throws shared application errors
- no Hono context, request objects, Drizzle rows, or SQL

`http` contains transport concerns:

- route registration with `@hono/zod-openapi`
- Zod/OpenAPI input and output schemas
- presenters that convert domain objects to documented JSON
- middleware for request context, optional authentication, and error shaping
- no permission logic beyond requiring an authenticated actor for protected use cases
- no database calls

`infrastructure` contains persistence:

- `src/infrastructure/db/schema.ts` defines Drizzle tables
- `src/infrastructure/persistence/crud-adapter.ts` centralizes common row CRUD, cursor pagination, filters, sorting, and undefined-stripping PATCH semantics
- `src/infrastructure/repositories/drizzle-*.repository.ts` implements domain repository interfaces
- `src/infrastructure/repositories/mappers/*.mapper.ts` owns row/entity conversion
- repositories must not contain policy or permission checks

`composition` contains wiring:

- request-scoped construction of repositories, policies, and use cases
- runtime environment parsing
- dependency injection only, not business logic

`shared` is intentionally small:

- errors shared across layers
- cursor pagination primitives
- reusable validation fields
- no resource-specific behavior and no unused generic abstractions

## CRUD Adapter Rule

The docs say most resource persistence is common CRUD. Keep that common behavior in `CrudAdapter`, not duplicated in each repository:

- list pagination
- id lookups
- arbitrary first-row lookups
- insert rows
- update rows with undefined omitted
- delete rows by id
- simple equality filters and stable cursor conditions

Repositories may provide table-specific predicates, mapping, and specialized lookups. They should still call `CrudAdapter` for common insert/update/delete/list/find behavior.

## OpenAPI Route Rule

Every API route must be registered through `createRoute` plus `app.openapi`. Plain `app.get`, `app.post`, `app.patch`, or `app.delete` should not appear in API route modules.

Route modules should follow this shape:

```ts
const resourceRoute = createRoute({
  method: "get",
  path: "/resources",
  request: { query: listResourceQuerySchema },
  responses: {
    200: jsonContent(listResponseSchema(resourceResponseSchema), "List resources"),
    ...commonErrorResponses,
  },
});

app.openapi(resourceRoute, async (c) => {
  const query = c.req.valid("query");
  const result = await c.get("container").resources.list.execute({ actor: c.get("actor"), ...query });
  return c.json({ data: result.data.map(presentResource), page: result.page }, 200);
});
```

Rules:

- import `z` from `@hono/zod-openapi`
- use shared envelopes from `src/http/openapi.ts`
- use presenters for response JSON
- add `security: bearerSecurity` to protected operations
- use `requireActor(c)` only to enforce authentication before a protected use case
- let use cases and policies enforce authorization

## Auth And ReBAC

This API is an OAuth2 resource server:

- validate Bearer JWTs with real JWKS/JWK validation through `jose`
- validate issuer, audience, expiry, signature, and `token_use=access`
- map token `sub` to local users by `betterAuthUserId`
- attach the actor to Hono context
- never fake auth outside tests

Resource-specific authorization belongs in domain policies and use cases. Repositories only persist facts such as relationships, grant mirrors, and deferred grants.

## Resource Naming

Use concrete documented collection names:

- `users`
- `categories`
- `posts`
- `media`
- `grant-mirror`
- `deferred-grants`
- `relationships`

Do not rename `posts` to `entries` or introduce `entry` abstractions. Generic names from planning documents describe a pattern, not a resource name, unless the contract explicitly says otherwise.

## Testing And Audits

After modifying architecture, run:

```bash
corepack pnpm typecheck
corepack pnpm test
```

Useful audits:

```bash
rg -n "app\\.(get|post|patch|delete)\\(" src/http src/main.ts
rg -n "\\.insert\\(|\\.update\\(|\\.delete\\(" src/infrastructure src/application src/domain src/http
rg -n "@/infrastructure|@/http" src/domain src/application
rg -n "from \"zod\"" src/http/schemas src/shared/validation src/shared/pagination
rg -n "Entry|entries" src tests
```

Expected exceptions:

- `app.doc("/openapi.json", ...)` in `src/main.ts`
- Drizzle insert/update/delete only inside `src/infrastructure/persistence/crud-adapter.ts`
- `Object.entries` is not an architecture naming violation

Tests should cover:

- `401` unauthenticated
- `401` invalid token
- `403` forbidden
- `404` missing resource
- happy paths for affected resources
- OpenAPI document path/security registration when routes change

## Deployment Workflow

If the deployment workflow is disabled under `.github/workflows-disabled`, do not move it back to `.github/workflows` unless the user explicitly asks to re-enable GitHub Actions.

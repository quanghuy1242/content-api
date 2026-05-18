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

## Error Placement Rule

Typed errors that cross layer boundaries belong in `src/shared/errors.ts`.

- API-visible failures should extend `AppError` and be rendered only by the HTTP error middleware.
- Internal cross-layer control-flow signals may extend `Error`, but still belong in `shared/errors.ts` when application and infrastructure both need the type.
- Storage-driver error parsing belongs in infrastructure helpers, such as `src/infrastructure/persistence/*.ts`.
- Never parse SQLite, D1, Drizzle, or Cloudflare error messages in `src/application/**`, `src/domain/**`, or `src/http/**`.
- Repositories and workflow implementations must translate storage failures into shared typed errors or let unknown failures bubble to the global `INTERNAL_ERROR` envelope.

## Mapper Placement Rule

Persistence mapping is infrastructure:

- `src/infrastructure/repositories/mappers/*.mapper.ts` owns row-to-domain and domain-to-row conversion.
- Repositories and infrastructure workflow ports call mappers at the persistence boundary.
- Domain entities must not know Drizzle column names.
- Application use cases must not build Drizzle rows, call row mappers, or shape response DTOs.
- HTTP presenters are separate from persistence mappers; presenters map domain objects to documented API JSON.
- Do not import infrastructure mappers from `domain`, `application`, `http`, or `shared`.
- Mapper files must not import `application`, `http`, or `composition`.
- Mapper functions must accept exactly one object argument, map fields explicitly, and never return or spread the input object directly.
- Row-to-domain mappers for entities must call `Entity.reconstitute(...)`.
- Domain-to-row mappers for entities must call `entity.toSnapshot()`.

## New Entity Rule

Before adding a new domain entity or resource, read an existing comparable resource from entity through tests and copy the repo's established shape:

- Use `posts` as the reference for content resources with lifecycle behavior, publish state, and richer domain methods.
- Use `media` as the reference for class-based entities with private props, `create`, `reconstitute`, `toSnapshot`, and mutation methods.
- Use `categories` as the reference for simple object-shaped entities and straightforward CRUD.
- Use `users` as the reference for identity/profile records and presenter-level field visibility.
- Use `relationships`, `grant-mirror`, and `deferred-grants` as references for authz/supporting persistence records.

Check the full setup, not just the entity file:

- domain entity, repository interface, and policy
- application use cases
- HTTP schema, presenter, and routes
- infrastructure schema, repository, mapper, and migrations
- request-container wiring
- API tests and OpenAPI assertions

New entities should match existing construction, reconstitution, timestamp, update, mapper, and presenter conventions. Add a new pattern only when the docs require behavior that none of the existing resources model.

Entity files must follow this exact class model:

- `XxxProps` is the full persisted snapshot and includes generated fields such as `id`, timestamps, generated slugs, default status/visibility, and lifecycle timestamps.
- `CreateXxxProps` is always `Omit<XxxProps, "...generated fields...">`; do not use `Pick` for create props.
- `static create(input: CreateXxxProps)` owns every generated field it assigns.
- `private constructor(private props: XxxProps)` is the only constructor shape.
- `static reconstitute(props: XxxProps)` rebuilds from trusted persistence/idempotency snapshots.
- `toSnapshot(): XxxProps` is required before persistence mapping, response spreading, or idempotency serialization.
- Use getters for entity fields; clone mutable values such as arrays on read/snapshot.
- Use entity methods such as `update(...)`, `publish()`, and `unpublish()` for mutation. Use cases should not rebuild replacement entities with spread snapshots when a mutation method is appropriate.
- Do not pass entity instances directly to `JSON.stringify(...)` or object spread in application/http code.

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

Every public `CrudAdapter` method needs JSDoc that states the invariant it centralizes. If a repository needs common behavior that is not covered by the adapter, add a small adapter method instead of duplicating raw Drizzle mechanics in each repository.

Repository and workflow implementation rules:

- `drizzle-*.repository.ts` and `drizzle-*.workflow.ts` must import and use infrastructure mappers.
- Do not call `Entity.reconstitute(...)` in repositories or workflows; row/entity reconstitution belongs in mappers.
- Do not import policies or `assert-can`; authorization belongs in use cases and domain policies.
- Do not call `this.db.insert(...)`, `this.db.update(...)`, or `this.db.delete(...)` directly. Use `CrudAdapter`.
- `this.db.batch(...)` is only for infrastructure workflow ports and should batch statements built by `CrudAdapter`.

## Idempotency Rule

Idempotent create workflows are split across application and infrastructure:

- HTTP routes validate the optional `Idempotency-Key` header through OpenAPI schemas and pass it to a single use case.
- Application use cases own request hashing, active replay lookup, request-hash conflict checks, expired scoped-key cleanup, cached response rehydration, and concurrent replay after a reservation conflict.
- Idempotency rows are scoped by `(key, actorId, route)`.
- Workflow ports in `domain/<resource>/<resource>-create.workflow.ts` describe the atomic create write shape.
- Drizzle workflow implementations build `db.batch(...)` statements for the idempotency row plus business rows.
- SQLite/D1 error-message parsing belongs only in infrastructure. Translate idempotency unique-key failures into the shared reservation conflict error before crossing back to application.
- `IdempotencyRepository` should only expose idempotency record lookup/cleanup. It must not create resource rows or relationships.

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
- use `c.req.valid("param" | "query" | "json" | "header")`; do not call raw `req.json()`, `req.query()`, `req.param()`, `req.header()`, `req.text()`, `req.formData()`, or `req.parseBody()` in route modules
- add exactly `security: bearerSecurity` to protected operations
- routes declaring `security: bearerSecurity` must call `requireActor(c)` in the handler
- route handlers should call exactly one use case `.execute(...)`
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
rg -n "this\\.db\\.(insert|update|delete|batch)\\(" src/infrastructure/repositories
rg -n "\\.insert\\(|\\.update\\(|\\.delete\\(" src/infrastructure src/application src/domain src/http
rg -n "@/infrastructure|@/http" src/domain src/application
rg -n "UNIQUE constraint failed|SQLite|D1" src/application src/domain src/http
rg -n "repositories/mappers" src/application src/domain src/http src/shared
rg -n "from \"zod\"" src/http/schemas src/shared/validation src/shared/pagination
rg -n "JSON\\.stringify\\(|\\.\\.\\.(category|user|post|media|relationship|grant|mirror|item)\\b" src/application src/http
rg -n "Entry|entries" src tests
```

Expected exceptions:

- `app.doc("/openapi.json", ...)` in `src/main.ts`
- Drizzle insert/update/delete only inside `src/infrastructure/persistence/crud-adapter.ts`
- `this.db.batch(...)` only in `src/infrastructure/repositories/drizzle-*.workflow.ts`
- `Object.entries` is not an architecture naming violation
- SQLite/D1 error parsing inside `src/infrastructure/persistence/**`
- mapper imports inside `src/infrastructure/**`

Tests should cover:

- `401` unauthenticated
- `401` invalid token
- `403` forbidden
- `404` missing resource
- happy paths for affected resources
- OpenAPI document path/security registration when routes change

## Deployment Workflow

If the deployment workflow is disabled under `.github/workflows-disabled`, do not move it back to `.github/workflows` unless the user explicitly asks to re-enable GitHub Actions.

---
name: content-api-architecture
description: Use this skill when modifying the content-api repository architecture, Cloudflare Worker API routes, @hono/zod-openapi schemas, domain entities, use cases, policies, repositories, Drizzle/D1 persistence, auth boundaries, tests, or deployment workflow behavior.
---

# Content API Architecture

## Start Here

Use this skill to preserve the clean architecture of the local `content-api` repo. Before editing, read the source docs that govern the change:

- `docs/architecture.md`
- `docs/payloadcms-schema-spec.md`
- `docs/payloadcms-access-control-policy-spec.md`
- `~/pjs/auther` docs/code when auth, JWKS, OAuth2 resource-server behavior, grants, or mirror sync are touched

For detailed file-level rules, read [references/architecture-rules.md](references/architecture-rules.md).

## Required Workflow

1. Identify the layer touched by the request before editing.
2. Read the matching docs and existing resource implementation for the same pattern.
3. Keep Hono routes thin: validate OpenAPI input, call one use case, present output.
4. Keep authorization in use cases and domain policies, never in repositories.
5. Keep typed application failures in `src/shared/errors.ts`; keep storage-driver error parsing inside infrastructure only.
6. Keep row/entity conversion in `src/infrastructure/repositories/mappers/*.mapper.ts`; do not inline mapping in routes or use cases.
7. Keep D1/Drizzle code in infrastructure repositories and shared CRUD in `CrudAdapter`.
8. For idempotent create workflows, keep replay decisions in application use cases and D1 batch construction/error translation in infrastructure workflow ports.
9. Run targeted audits after edits, then `corepack pnpm typecheck` and `corepack pnpm test`.

## Layer Rules

- `src/domain/**`: entities, repository interfaces, policies, and authorization vocabulary. No Hono, Drizzle, D1, or infrastructure imports.
- `src/application/**`: explicit use cases and workflow logic. Depends on domain interfaces and shared errors only.
- `src/http/**`: OpenAPI route definitions, request/response schemas, presenters, and middleware. No Drizzle and no resource-specific permission logic.
- `src/infrastructure/**`: D1/Drizzle schema, `CrudAdapter`, repository implementations, and row/entity mappers. No permission decisions.
- `src/composition/**`: request-scoped dependency wiring only.
- `src/shared/**`: small cross-cutting primitives used by multiple layers, such as errors, cursor pagination, and reusable validation fields. Do not use it as a dumping ground.

## Error Rules

- Put API-visible application errors and cross-layer control-flow errors in `src/shared/errors.ts`.
- Use cases and policies may throw shared errors, but must not depend on HTTP response objects or infrastructure error classes.
- Infrastructure may catch SQLite/D1/Drizzle-specific errors, but must translate them before crossing into application code.
- Do not parse storage error messages in `src/application/**`, `src/domain/**`, or `src/http/**`.
- Keep HTTP error envelope shaping in middleware through `toErrorResponse`.

## Mapper Rules

- Row/entity conversion belongs in `src/infrastructure/repositories/mappers/*.mapper.ts`.
- Repository and workflow implementations should call mappers before persistence and after reads.
- Use cases should build or mutate domain entities, not Drizzle rows.
- HTTP presenters convert domain objects to response JSON; they are not persistence mappers.
- Do not import infrastructure mappers outside `src/infrastructure/**`.

## Persistence Rules

- Common CRUD behavior belongs in `CrudAdapter`, including insert, update, delete, find, list, cursor, simple filter, and reusable batch-statement builders.
- Add JSDoc for every public `CrudAdapter` method because it defines repository behavior across resources.
- Resource repositories own table-specific predicates and mapper calls, but should not duplicate common CRUD mechanics.
- Workflow-specific repositories may compose multiple `CrudAdapter` statements into `db.batch(...)`; they must still keep Drizzle details in infrastructure.
- Storage-driver helpers, such as SQLite constraint detectors, belong under `src/infrastructure/persistence/**`.

## OpenAPI Rules

All API routes must use `@hono/zod-openapi`:

- Use `OpenAPIHono`, `createRoute`, and `app.openapi`.
- Use `c.req.valid("param" | "query" | "json")`; do not manually parse route input.
- Route schemas must import `z` from `@hono/zod-openapi`.
- Response schemas must document the actual `{ data }`, `{ data, page }`, or `{ error }` envelopes.
- Authenticated operations must declare `bearerSecurity`.
- Do not add undocumented endpoints.

`app.doc("/openapi.json", ...)` is allowed for serving the generated document.

## Resource Pattern

Use documented resource names consistently. Do not introduce generic `entry/entries` names unless the docs explicitly define such a resource. For a new or changed collection, align these files:

Before adding a new entity/resource, inspect at least one existing comparable resource end to end and follow its established setup. Prefer the closest match:

- `posts` for aggregate-like content with lifecycle methods and publish state.
- `media` for class-based entities with private mutable props and snapshot/reconstitution.
- `categories` for simple object-shaped entities.
- `users` for identity/profile records and field-level presentation.
- `relationships`, `grant-mirror`, or `deferred-grants` for authz/supporting tables.

Match the existing pattern for entity construction, reconstitution, update methods, timestamp handling, repository interface shape, mapper naming, route/schema/presenter envelopes, composition wiring, and tests. Do not invent a new entity style unless the existing patterns cannot represent the documented behavior.

- `src/domain/<resource>/<resource>.entity.ts`
- `src/domain/<resource>/<resource>.repository.ts`
- `src/domain/<resource>/<resource>.policy.ts`
- `src/application/<resource>/*.usecase.ts`
- `src/http/schemas/<resource>.schema.ts`
- `src/http/presenters/<resource>.presenter.ts`
- `src/http/routes/<resource>.routes.ts`
- `src/infrastructure/repositories/drizzle-<resource>.repository.ts`
- `src/infrastructure/repositories/mappers/<resource>.mapper.ts`

## Idempotency And Batch Writes

For create endpoints with `Idempotency-Key`:

- Scope idempotency records by `(key, actorId, route)` so the same client-generated key can be reused by a different actor or endpoint.
- Routes only validate the optional header and pass it to one use case.
- Use cases compute canonical request hashes, check active replay rows, delete expired scoped rows before first use, compare hashes, and return cached success snapshots.
- Use cases may catch a shared typed idempotency reservation conflict from a workflow port, then re-read the active row for concurrent replay.
- Use cases must not parse SQLite/D1 error messages or import infrastructure helpers.
- Infrastructure workflow ports build the atomic `db.batch(...)` for the idempotency row plus business rows, and translate idempotency unique-key storage failures into shared typed reservation conflicts.
- `IdempotencyRepository` only owns idempotency record lookup/cleanup. It must not orchestrate resource creation.

## JSDoc Standard

Add JSDoc at boundaries where intention can be lost:

- entity lifecycle rules
- use case responsibilities
- policy/ReBAC decisions
- `CrudAdapter` behavior
- route registration helpers
- composition and middleware boundaries

Avoid comments that repeat the code. Prefer short comments explaining why a boundary exists or what invariant it protects.

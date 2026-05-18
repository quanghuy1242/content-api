---
name: content-api-architecture
description: Use this skill whenever working with the content-api repository — whether analyzing, reviewing, reading, answering questions about, or modifying its architecture, Cloudflare Worker API routes, @hono/zod-openapi schemas, domain entities, use cases, policies, repositories, Drizzle/D1 persistence, auth boundaries, tests, or deployment workflow behavior.
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
9. Run targeted audits after edits, then `corepack pnpm lint`, `corepack pnpm check:dup`, `corepack pnpm typecheck`, and `corepack pnpm test`.
10. Treat `corepack pnpm lint` as the architecture gate as well as the code-style gate; it must catch layer-boundary, entity, mapper, repository, persistence, and OpenAPI route violations before review.
11. If the change introduces lint failures that the repo can auto-correct safely, run `corepack pnpm lint:fix` and re-run `corepack pnpm lint`.
12. Run `corepack pnpm advise` after substantial code changes and treat the output as review input, not a hard architecture gate.

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
- Mapper files must not import `application`, `http`, or `composition`.
- Mapper functions must accept one object argument, map fields explicitly, and never return or spread the input object directly.
- Entity row-to-domain mappers must call `Entity.reconstitute(...)`.
- Entity-to-row mappers must derive persistence payloads from `entity.toSnapshot()`.

## Persistence Rules

- Common CRUD behavior belongs in `CrudAdapter`, including insert, update, delete, find, list, cursor, simple filter, and reusable batch-statement builders.
- Add JSDoc for every public `CrudAdapter` method because it defines repository behavior across resources.
- Resource repositories own table-specific predicates and mapper calls, but should not duplicate common CRUD mechanics.
- Workflow-specific repositories may compose multiple `CrudAdapter` statements into `db.batch(...)`; they must still keep Drizzle details in infrastructure.
- Storage-driver helpers, such as SQLite constraint detectors, belong under `src/infrastructure/persistence/**`.
- `src/infrastructure/repositories/drizzle-*.repository.ts` and `drizzle-*.workflow.ts` must import the relevant infrastructure mapper.
- Repository and workflow code must not call `Entity.reconstitute(...)` directly; that belongs in mappers.
- Repository and workflow writes must go through `CrudAdapter` helpers. Do not call `this.db.insert(...)`, `this.db.update(...)`, or `this.db.delete(...)` directly.
- `this.db.batch(...)` is allowed only in infrastructure workflow ports, and the statements inside the batch should be built by `CrudAdapter`.
- Repositories and workflows must not import policies or `assert-can`; authorization stays in use cases and domain policies.

## OpenAPI Rules

All API routes must use `@hono/zod-openapi`:

- Use `OpenAPIHono`, `createRoute`, and `app.openapi`.
- Use `c.req.valid("param" | "query" | "json" | "header")`; do not manually parse route input.
- Do not call raw route request parsers such as `req.json()`, `req.query()`, `req.param()`, `req.header()`, `req.text()`, `req.formData()`, or `req.parseBody()` in route modules.
- Route schemas must import `z` from `@hono/zod-openapi`.
- Response schemas must document the actual `{ data }`, `{ data, page }`, or `{ error }` envelopes.
- Authenticated operations must declare exactly `security: bearerSecurity`.
- Routes declaring `security: bearerSecurity` must call `requireActor(c)` in the handler.
- Route handlers must call exactly one use case `.execute(...)`; do not orchestrate multiple workflows in a route.
- Route handlers must stay thin: no direct `c.env`, global `fetch`, `crypto`, `JSON.parse`/`JSON.stringify`, direct storage calls, or manual `Request`/`Response` construction.
- Do not add undocumented endpoints.

`app.doc("/openapi.json", ...)` is allowed for serving the generated document.

## Entity Class Rules

All `src/domain/**/*.entity.ts` files must use the same class model:

- Export exactly the domain entity class plus supporting exported type aliases.
- Use `export type XxxProps = { ... }` as the full persisted snapshot. It includes generated fields such as `id`, timestamps, generated slugs, status fields, and nullable lifecycle timestamps.
- Use `private constructor(private props: XxxProps)`.
- Use `static create(input: CreateXxxProps): Xxx` for new entities. It owns generated fields such as `crypto.randomUUID()`, `new Date()`, generated slugs, default status, default visibility, and lifecycle timestamps.
- Use `export type CreateXxxProps = Omit<XxxProps, "...generated fields...">`; do not use `Pick` for create props.
- `CreateXxxProps` must omit every field assigned by `static create(...)`.
- Use `static reconstitute(props: XxxProps): Xxx` only for trusted persistence/idempotency snapshots.
- Add getters for entity fields; clone mutable references such as arrays on read and in `toSnapshot()`.
- Use `update(input: UpdateXxxProps)` for mutable entities and update timestamps inside the entity when the resource has `updatedAt`.
- Use `toSnapshot(): XxxProps` before persistence mapping, response spreading, or idempotency serialization.
- Never pass domain entity instances directly to `JSON.stringify(...)` or object spread in application/http code.

## Resource Pattern

Use documented resource names consistently. Do not introduce generic `entry/entries` names unless the docs explicitly define such a resource. For a new or changed collection, align these files:

Before adding a new entity/resource, inspect at least one existing comparable resource end to end and follow its established setup. Prefer the closest match:

- `posts` for aggregate-like content with lifecycle methods and publish state.
- `media` for class-based entities with private mutable props and snapshot/reconstitution.
- `categories` for simple object-shaped entities.
- `users` for identity/profile records and field-level presentation.
- `relationships`, `grant-mirror`, or `deferred-grants` for authz/supporting tables.

Match the existing pattern for entity construction, `CreateXxxProps`/`UpdateXxxProps`, reconstitution, update methods, timestamp handling, repository interface shape, mapper naming, route/schema/presenter envelopes, composition wiring, and tests. Do not invent a new entity style unless the existing patterns cannot represent the documented behavior.

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

## Oxlint Architecture Gate

`scripts/oxlint-js-plugins/architecture.js` is the executable version of these rules. It currently enforces:

When explicitly asked to change, rename, debug, or extend this linter, use the local `content-api-architecture-lint` skill first. Do not use that linter-maintenance skill for ordinary feature-work lint failures; fix the code instead.

- `architecture/layer-imports`: layer import allowlists and banned external imports.
- `architecture/no-mapper-imports-outside-infra`: mapper imports only inside infrastructure.
- `architecture/no-storage-error-parsing`: SQLite/D1/Drizzle/UNIQUE parsing terms only in infrastructure helpers.
- `architecture/no-custom-errors-outside-shared`: custom `Error`/`AppError` classes only in `src/shared/errors.ts`.
- `architecture/req-valid-usage`: route input must come from `req.valid(...)`.
- `architecture/no-plain-zod-import`: schema and shared validation files import `z` from `@hono/zod-openapi`.
- `architecture/route-module`: `createRoute` + `app.openapi`, exact `bearerSecurity` pairing, and one `.execute(...)` per handler.
- `architecture/route-handler-boundary`: route handlers validate input, call one use case, and present output without direct env, fetch, crypto, JSON serialization, storage calls, or manual Request/Response construction.
- `architecture/repository-workflow`: mapper usage, no authorization decisions, no inline entity reconstitution, no direct DB writes, and `db.batch(...)` only in workflow ports.
- `architecture/mapper-file`: one-argument explicit mappers, `Entity.reconstitute(...)`, and `entity.toSnapshot()`.
- `architecture/entity-class`: class-only entities, private props constructor, `create/reconstitute/toSnapshot`, `CreateXxxProps = Omit<XxxProps, ...>`, and generated field omission.
- `architecture/no-raw-entity-serialization`: application/http code must snapshot before entity JSON serialization or object spread.
- `architecture/crud-adapter-jsdoc`: every public `CrudAdapter` method needs JSDoc.

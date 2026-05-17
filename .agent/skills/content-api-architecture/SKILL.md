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
5. Keep D1/Drizzle code in infrastructure repositories and shared CRUD in `CrudAdapter`.
6. Run targeted audits after edits, then `corepack pnpm typecheck` and `corepack pnpm test`.

## Layer Rules

- `src/domain/**`: entities, repository interfaces, policies, and authorization vocabulary. No Hono, Drizzle, D1, or infrastructure imports.
- `src/application/**`: explicit use cases and workflow logic. Depends on domain interfaces and shared errors only.
- `src/http/**`: OpenAPI route definitions, request/response schemas, presenters, and middleware. No Drizzle and no resource-specific permission logic.
- `src/infrastructure/**`: D1/Drizzle schema, `CrudAdapter`, repository implementations, and row/entity mappers. No permission decisions.
- `src/composition/**`: request-scoped dependency wiring only.
- `src/shared/**`: small cross-cutting primitives used by multiple layers, such as errors, cursor pagination, and reusable validation fields. Do not use it as a dumping ground.

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

- `src/domain/<resource>/<resource>.entity.ts`
- `src/domain/<resource>/<resource>.repository.ts`
- `src/domain/<resource>/<resource>.policy.ts`
- `src/application/<resource>/*.usecase.ts`
- `src/http/schemas/<resource>.schema.ts`
- `src/http/presenters/<resource>.presenter.ts`
- `src/http/routes/<resource>.routes.ts`
- `src/infrastructure/repositories/drizzle-<resource>.repository.ts`
- `src/infrastructure/repositories/mappers/<resource>.mapper.ts`

## JSDoc Standard

Add JSDoc at boundaries where intention can be lost:

- entity lifecycle rules
- use case responsibilities
- policy/ReBAC decisions
- `CrudAdapter` behavior
- route registration helpers
- composition and middleware boundaries

Avoid comments that repeat the code. Prefer short comments explaining why a boundary exists or what invariant it protects.

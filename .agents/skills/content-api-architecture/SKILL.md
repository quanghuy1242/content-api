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

## Repository Layout

The repo ships **one main API Worker** under `src/` and **N additional Workers** under `workers/<name>/`, each with its own `wrangler.jsonc`. The main API Worker entry is `src/main.ts` (see top-level `wrangler.jsonc` `main` field — it is NOT `src/index.ts`). New cron, queue, scheduled, or processor Workers go under `workers/<name>/`, never inside `src/`. `pnpm-workspace.yaml` lists only `"."` — `workers/*` are sibling deployment units, not pnpm workspace packages.

Use this tree to locate files and to choose the right home for new code. Patterns (e.g. `*.usecase.ts`) are conventions enforced by `scripts/oxlint-js-plugins/architecture.js` and by the `Resource Pattern` section below — do not invent new suffixes.

```
content-api/
├── src/                                  # Main API Worker source; entry: src/main.ts
│   ├── main.ts                           # Worker entry; exports default { fetch, scheduled? }; builds OpenAPIHono + container
│   │
│   ├── domain/                           # Pure domain layer — NO Hono, Drizzle, D1, or infrastructure imports
│   │   ├── <resource>/
│   │   │   ├── *.entity.ts               # Domain entity class (private props, create/reconstitute/toSnapshot)
│   │   │   ├── *.repository.ts           # Repository INTERFACE only (domain contract)
│   │   │   ├── *.policy.ts               # Domain authorization decisions (when not covered by Content IAM)
│   │   │   └── *.workflow.ts             # Workflow port INTERFACE for atomic multi-row writes (e.g. create+owner+audit)
│   │   ├── auth/                         # Actor types, scope helpers (requireContentScope), assertAllowed
│   │   ├── iam/                          # Content IAM: permissions, built-in roles, ContentPolicy, resource-loader helpers
│   │   └── idempotency/                  # IdempotencyRepository contract + IdempotencyRecord type
│   │
│   ├── application/                      # Explicit use cases — depends on domain interfaces + shared/errors only
│   │   └── <resource>/
│   │       └── *.usecase.ts              # One verb per file: create/get/list/update/publish/unpublish/delete/...
│   │
│   ├── http/                             # Hono OpenAPI layer — thin handlers, no business logic
│   │   ├── app-env.ts                    # Hono Variables/Bindings types (container, actor, request id)
│   │   ├── openapi.ts                    # Shared OpenAPI helpers: bearerSecurity, jsonContent, response envelopes
│   │   ├── routes/<resource>.routes.ts   # createRoute() + app.openapi(); one .execute(...) per handler
│   │   ├── schemas/<resource>.schema.ts  # Zod request/response schemas; `z` MUST come from @hono/zod-openapi
│   │   ├── presenters/<resource>.presenter.ts  # Domain entity → response JSON (NOT persistence mapping)
│   │   └── middleware/*.middleware.ts    # auth, error envelope, request id; no resource logic
│   │
│   ├── infrastructure/                   # Adapters that satisfy domain contracts; ONLY layer that touches Drizzle/D1/R2
│   │   ├── db/
│   │   │   ├── client.ts                 # Drizzle/D1 client factory
│   │   │   └── schema.ts                 # Single source of truth for D1 tables (sqliteTable definitions + indexes)
│   │   ├── persistence/
│   │   │   ├── crud-adapter.ts           # Shared CRUD primitive — every public method needs JSDoc
│   │   │   └── sqlite-errors.ts          # Storage-driver error detectors (only place allowed to parse UNIQUE/constraint text)
│   │   ├── repositories/
│   │   │   ├── drizzle-<resource>.repository.ts        # Implements domain repo; uses CrudAdapter, never raw this.db.insert/update/delete
│   │   │   ├── drizzle-<resource>-<flow>.workflow.ts   # Implements workflow port; ONLY place allowed to call db.batch(...)
│   │   │   └── mappers/<resource>.mapper.ts            # Row ↔ entity; ONLY place that calls Entity.reconstitute(...); cannot import application/http/composition
│   │   ├── identity/                     # `id` (auth) adapters: principal-validation client, client-credentials token provider
│   │   ├── images/                       # Cloudflare Images service adapter
│   │   └── storage/                      # R2 object storage adapter + presigned-URL signer
│   │
│   ├── composition/                      # Request-scoped DI graph
│   │   └── create-request-container.ts   # ONLY place that wires repos + workflows + policies + use cases together
│   │
│   ├── config/
│   │   └── env.ts                        # Zod-validated env parsing; Worker bindings type
│   │
│   ├── shared/                           # Cross-cutting primitives used by ≥2 layers — NOT a dumping ground
│   │   ├── errors.ts                     # AppError + ValidationError/Unauthorized/Forbidden/NotFound/Conflict — ONLY place for custom Error classes
│   │   ├── constants.ts                  # HTTP status codes, route name constants, idempotency TTL
│   │   ├── idempotency.ts                # Canonical request-body hashing
│   │   ├── pagination/                   # encodeCursor/decodeCursor + CursorPage<T> type
│   │   ├── validation/                   # Reusable Zod field schemas (slugs, ids, timestamps)
│   │   └── media/                        # Shared media constants used by main API + media-processor Worker
│   │
│   └── types/                            # Global ambient types (cloudflare-env.d.ts, raw imports)
│
├── workers/                              # ADDITIONAL Cloudflare Workers (queue consumers, cron drivers, processors)
│   └── <worker-name>/                    # Each Worker is self-contained — separate wrangler + tsconfig
│       ├── wrangler.jsonc                # Own bindings; can share D1/R2/Queues with the API Worker
│       ├── tsconfig.json
│       └── src/                          # This Worker's source — usually one or two files (config + index/handler)
│                                         # Example today: workers/media-processor/ consumes the R2 object-create queue.
│                                         # New scheduled/queue Workers (e.g. scheduled-publish) belong here, NOT under src/.
│
├── drizzle/                              # Generated D1 migrations: NNNN_<slug>.sql, sequential; meta/ tracks Drizzle Kit state
│
├── tests/                                # Vitest + @cloudflare/vitest-pool-workers integration tests
│   ├── helpers.ts                        # JWT minting, container fixtures, D1 seeding
│   └── *.test.ts                         # Run inside a real Workers runtime against in-memory D1
│
├── docs/                                 # Planning + implementation docs, numbered NNN_<slug>.md
│
├── scripts/                              # Repo tooling
│   ├── oxlint-js-plugins/architecture.js # The architecture-lint plugin — extend only via content-api-architecture-lint skill
│   ├── check-duplication-threshold.mjs   # Wrapper enforcing the Fallow mild duplicate threshold
│   └── filter-advise.mjs                 # Filters known noise from `pnpm advise` using .advise-suppressions.json
│
├── patches/                              # pnpm patch-package targets
├── .agents/skills/                       # Local agent skills (this file is content-api-architecture/SKILL.md)
├── .oxlintrc.json                        # Oxlint config; wires the architecture plugin
├── .advise-suppressions.json             # Known-noise suppressions consumed by filter-advise.mjs
├── wrangler.jsonc                        # Main API Worker config: name=content-api, main=src/main.ts, D1+R2 bindings
├── wrangler.test.jsonc                   # Test-runtime Worker config (committed mock R2 creds)
├── drizzle.config.ts                     # Drizzle Kit config (schema → drizzle/)
├── package.json                          # pnpm scripts: check, lint, lint:fix, check:dup, typecheck, test, advise, db:*
├── pnpm-workspace.yaml                   # Workspace: only "." — workers/* are NOT pnpm packages
└── README.md
```

Notable conventions reinforced by the tree:

- **Cron / queue / processor handlers go in `workers/<name>/`, not in `src/`.** Each new Worker is its own deployment unit with its own `wrangler.jsonc`. CI deploys them as separate Cloudflare Workers.
- **The main API Worker entry is `src/main.ts`.** Do not assume `src/index.ts`.
- **Mappers under `src/infrastructure/repositories/mappers/` are the only place that calls `Entity.reconstitute(...)`** and the only place that can be imported by both `drizzle-<resource>.repository.ts` and `drizzle-<resource>-<flow>.workflow.ts`.
- **`db.batch(...)` is only allowed in `drizzle-<resource>-<flow>.workflow.ts` files**, never in `*.repository.ts`.
- **Drizzle migrations are sequential numbered files.** Next migration number is one greater than the highest existing `drizzle/NNNN_*.sql`.
- **`workers/*` Workers may share `src/shared/**` only by relative import or via path alias in their own tsconfig.** They do not pull `src/application/**`, `src/domain/**`, or `src/infrastructure/**` wholesale; if they need that surface, the dependency should be reviewed.

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

## Content Lifecycle Plugin

`docs/012` defines a pluggable status machine — `draft → scheduled → published → archived` — shared by every editorial resource. Use it for any new resource that has draft/publish semantics (Post, Book, future Chapter, SiteConfig, etc.); do not invent per-resource publish/unpublish use cases.

Layout:

```
src/domain/lifecycle/
  lifecycle-entity.ts            # LifecycleStatus + LifecycleCapable interface
  lifecycle-manager.ts           # LifecycleManager<T> contract

src/application/lifecycle/
  publish.usecase.ts             # PublishUseCase<T>           draft|scheduled → published
  unpublish.usecase.ts           # UnpublishUseCase<T>         scheduled|published → draft
  schedule-publish.usecase.ts    # SchedulePublishUseCase<T>   draft → scheduled (validates scheduledAt > now)
  archive.usecase.ts             # ArchiveUseCase<T>           any non-archived → archived (terminal)
  <resource>-lifecycle-manager.ts # per-resource adapter (maps can* → ContentPolicy permission keys)

src/composition/
  scheduled-lifecycle.ts         # buildScheduledLifecycleManagers + runScheduledPublish (cron driver core)

workers/scheduled-publish/       # dedicated Cloudflare Worker, hourly cron ("0 * * * *")
                                 # API Worker has NO scheduled handler; cron lives in its own deploy unit
```

To add lifecycle to a new resource:

1. **Entity** implements `LifecycleCapable`: add `lifecycleStatus`, `publishedAt`, `scheduledAt`, `archivedAt` getters and `publish()`, `unpublish()`, `schedule(scheduledAt)`, `archive()` methods. Each method throws `ConflictError` for invalid transitions; entities own the state machine guard. `archived` is terminal in Level 1.
2. **`UpdateXxxProps` MUST NOT contain `status`, `publishedAt`, `scheduledAt`, or `archivedAt`** — generic PATCH cannot mutate lifecycle. `Xxx.update()` MUST reject mutations on archived entities.
3. **Repository** separates ordinary metadata persistence from lifecycle persistence:
   - Ordinary `save(entity)` must omit lifecycle fields from its update row and reject writes after `status === "archived"` so a stale update cannot revive or mutate terminal content.
   - `saveLifecycle(entity, expectedStatus)` conditionally updates only lifecycle fields under the entity's loaded source status. Manual transition races return `ConflictError` rather than overwriting committed state.
   It also adds two methods used by the cron driver:
   - `findScheduledReadyIds(now, limit)` — indexed SELECT of overdue scheduled ids.
   - `publishScheduledReady(id, now)` — conditional `UPDATE ... WHERE status = 'scheduled' AND scheduled_at <= ?` via `CrudAdapter.updateRowsConditional`; returns whether the row transitioned. This is the only safe cron transition primitive under D1 (no row locks → compare-and-set).
4. **Adapter** `src/application/lifecycle/<resource>-lifecycle-manager.ts` implements `LifecycleManager<T>`. It is the only place that names a `{resource}.publish` / `{resource}.archive` permission. Schedule and unpublish reuse `{resource}.publish` (same authorization question: "may this actor cause this to be published?"); only archive uses a dedicated `{resource}.archive` key.
5. **Permission catalog** in `src/domain/iam/content-permission.ts`: add `{resource}.publish` and `{resource}.archive` to `ContentPermissionKey` + `CONTENT_PERMISSIONS` (both `delegationClass: "ordinary"`). Wire them into the appropriate built-in roles (resource owner gets both; an author-style role gets publish only; an editor-style role gets neither).
6. **Wiring** in `src/composition/create-request-container.ts`: add `<resource>.publish/unpublish/schedule/archive` keys instantiating the generic use cases against the adapter. Add the adapter to `buildScheduledLifecycleManagers` in `src/composition/scheduled-lifecycle.ts` so the cron picks the resource up. The cron path passes `undefined as never` for `ContentPolicy` because authorization was committed at schedule time; the cron never calls `can*` (asserted by spy test in `tests/scheduled-publish.test.ts`).
7. **Routes** in `src/http/routes/<resource>.routes.ts`: add four `POST /<resources>/{id}/{publish|unpublish|schedule|archive}` routes. Schedule body uses the shared `scheduleBodySchema` from `src/http/schemas/lifecycle.schema.ts`. Each handler calls exactly one use case (`route-module` lint rule).
8. **Schema + migration**: add `scheduled_at` / `archived_at` columns (plus `published_at` if not already present) as nullable `integer("…", { mode: "timestamp_ms" })`. Add a partial index `<table>_scheduled_idx ON (scheduled_at) WHERE status = 'scheduled'` to keep the cron predicate fast. Run `pnpm db:generate` — never hand-roll the SQL or `meta/_journal.json` will diverge.
9. **Response schema + presenter**: extend `<resource>ResponseSchema` with `scheduledAt`, `archivedAt` (nullable ISO strings). Presenter converts `Date | null` → ISO string or `null`.
10. **Tests**: add `tests/<resource>-lifecycle.test.ts` covering the four endpoints, 409 on invalid transitions, 400 on past `scheduledAt`, and 403 without `content:write` or policy binding. Race coverage for `publishScheduledReady` lives in `tests/lifecycle/scheduled-publish-race.test.ts`.

Cron semantics (read before changing the driver):

- The cron Worker has no actor/JWT (`§5.6` of docs/012). Authorization is checked at schedule time, never at publish time. Permission revoked between schedule and fire → schedule still fires; cancel by calling `unpublish` or `archive`.
- Compare-and-set guards apply to manual lifecycle saves as well as cron publishes: Cloudflare's at-least-once cron and concurrent manual transitions cannot overwrite an already committed lifecycle state.
- The driver iterates sequentially per resource (`SCHEDULED_PUBLISH_BATCH_LIMIT = 500`) by design — D1 concurrent-write limits would throttle a parallelized fan-out. `// eslint-disable-next-line no-await-in-loop` annotations on the two `await` sites are intentional.

Media is **not** lifecycle-capable: it has its own pipeline status (`pending_upload → processing → ready → failed → expired`) and an orthogonal `visibility` flag. `publish-media.usecase.ts` / `unpublish-media.usecase.ts` are kept as-is.

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

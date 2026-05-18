# Architecture Lint Rule Contract

## Strictness Policy

The architecture linter is a guardrail. If the linter and code disagree, assume the code is wrong first. Loosen a rule only after checking `docs/architecture.md`, `docs/payloadcms-schema-spec.md`, `.agents/skills/content-api-architecture/SKILL.md`, and `.agents/skills/content-api-architecture/references/architecture-rules.md`.

When adding a new rule, start from the canonical allowed shape and make the linter reject every known non-canonical variation. Prefer failing closed over accepting ambiguous architecture. Avoid configuration switches that weaken boundaries. Valid exceptions must be narrow, path-specific, documented, and covered by a negative fixture showing the rule still catches the forbidden form elsewhere.

Every new rule must include:

- a precise invariant statement
- the canonical allowed pattern
- the forbidden patterns, including common aliases/renames/equivalent AST forms
- path scope and any narrow exceptions
- `.oxlintrc.json` wiring at `"error"`
- documentation updates in the main architecture skill and proposal/reference docs
- a temporary negative fixture proving the rule catches the intended violation

## Existing Rule Intent

- `architecture/layer-imports`: enforce clean layer dependency direction and banned framework/storage imports.
- `architecture/no-mapper-imports-outside-infra`: persistence mappers stay infrastructure-only.
- `architecture/no-storage-error-parsing`: SQLite/D1/Drizzle/UNIQUE parsing terms stay in infrastructure helpers, including template literals.
- `architecture/no-custom-errors-outside-shared`: cross-layer custom errors live in `src/shared/errors.ts`.
- `architecture/req-valid-usage`: route input comes from `req.valid("param" | "query" | "json" | "header")`, not raw request parsers.
- `architecture/no-plain-zod-import`: OpenAPI/validation schemas use `z` from `@hono/zod-openapi`.
- `architecture/route-module`: routes use `createRoute` + `app.openapi`, protected handlers pair `requireActor(c)` with exact `security: bearerSecurity`, and each route handler calls exactly one use case `.execute(...)`.
- `architecture/route-handler-boundary`: route handlers stay at the HTTP orchestration boundary. They may validate with `c.req.valid(...)`, call `requireActor(c)`, call one use case, and present responses. They must not directly read `c.env`, call global `fetch`, use `crypto`, call `JSON.parse`/`JSON.stringify`, call direct storage methods (`prepare`, `select`, `insert`, `update`, `delete`, `batch`, `exec`), or construct `Request`/`Response` manually.
- `architecture/repository-workflow`: repository/workflow implementations use mappers, avoid authorization decisions, avoid inline entity reconstitution, write through `CrudAdapter`, and reserve `db.batch(...)` for workflow ports.
- `architecture/mapper-file`: mapper functions accept one object argument, map fields explicitly, use `Entity.reconstitute(...)` for row-to-entity, and use `entity.toSnapshot()` for entity-to-row.
- `architecture/entity-class`: entity files export class entities with `private constructor(private props: XxxProps)`, `static create(input: CreateXxxProps)`, `static reconstitute(...)`, `toSnapshot()`, and `CreateXxxProps = Omit<XxxProps, generated fields>`.
- `architecture/no-raw-entity-serialization`: application/http code snapshots entities before JSON serialization or object spread.
- `architecture/crud-adapter-jsdoc`: every public `CrudAdapter` method documents the invariant it centralizes.
- `architecture/no-magic-numbers`: numeric literals in application, domain, HTTP, and shared layers must be extracted to named constants. 0 and 1 are exempt as universal base values. SCREAMING_SNAKE_CASE `const` declarations, property keys, enum members, and type annotations are exempt as definition sites.
- `architecture/constants-placement`: SCREAMING_SNAKE_CASE const declarations must live in `src/shared/`, `src/domain/`, or `src/infrastructure/`. They are forbidden in `src/application/` and `src/http/`.
- `architecture/constants-jsdoc`: every SCREAMING_SNAKE_CASE `const` declaration must have JSDoc. A `/** group doc */` above a consecutive, non-blank-line-separated block of related constants documents the entire block; individual `/** doc */` above each constant is also accepted.

## Required Sync Points

When changing a rule, update all applicable places:

- `scripts/oxlint-js-plugins/architecture.js`
- `.oxlintrc.json`
- `docs/003_entity-classes-and-oxlint-arch-linting.md`
- `.agents/skills/content-api-architecture/SKILL.md`
- `.agents/skills/content-api-architecture/references/architecture-rules.md`
- This file, if rule intent or workflow changes

## Validation

Always run:

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
```

For rule changes, also run at least one temporary negative fixture and verify lint fails with the intended architecture rule.

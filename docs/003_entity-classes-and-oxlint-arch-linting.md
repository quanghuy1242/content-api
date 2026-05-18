# Domain Entity Classes & Oxlint Architecture Linting

> Status: implemented in current codebase
>
> Date: 2026-05-18
>
> Scope:
>
> - `src/domain/**/*.entity.ts` (7 files)
> - `src/infrastructure/repositories/mappers/*.mapper.ts` (8 files)
> - `src/application/**/*.usecase.ts` (10 files)
> - `src/http/presenters/*.presenter.ts` (4 files)
> - `src/infrastructure/repositories/drizzle-*.repository.ts` (5 files)
> - `src/infrastructure/repositories/drizzle-*-create.workflow.ts` (2 files)
> - `src/domain/*/*.repository.ts` (5 files)
> - `scripts/oxlint-js-plugins/architecture.js` (new)
> - `scripts/lint-architecture.mjs` (removed)
> - `.oxlintrc.json`
> - `package.json`
>
> Source docs:
>
> - `docs/architecture.md`
> - `.agents/skills/content-api-architecture/references/architecture-rules.md`
> - [oxlint JS Plugins documentation](https://oxc.rs/docs/guide/usage/linter/js-plugins)
> - [oxlint Writing JS Plugins](https://oxc.rs/docs/guide/usage/linter/writing-js-plugins)
>
> Related docs:
>
> - `docs/001_idempotency-batch-design.md`
> - `docs/002_media-upload-flow.md`

## Table Of Contents

- [1. Goal](#1-goal)
- [2. Current-State Findings](#2-current-state-findings)
  - [2.1 Mixed Entity Shapes](#21-mixed-entity-shapes)
  - [2.2 Cross-File Lint Dependency](#22-cross-file-lint-dependency)
  - [2.3 Dual Lint Pass](#23-dual-lint-pass)
- [3. Target Model](#3-target-model)
- [4. Architecture Decisions](#4-architecture-decisions)
  - [4.1 Option C: Convert All Entities To Classes](#41-option-c-convert-all-entities-to-classes)
  - [4.2 Oxlint JS Plugin Over TypeScript Compiler API](#42-oxlint-js-plugin-over-typescript-compiler-api)
- [5. Implementation Strategy](#5-implementation-strategy)
- [6. Detailed Implementation Plan](#6-detailed-implementation-plan)
  - [6.1 Entity Class Conversion](#61-entity-class-conversion)
  - [6.2 Downstream Fixes](#62-downstream-fixes)
  - [6.3 Oxlint Architecture Plugin](#63-oxlint-architecture-plugin)
  - [6.4 Build Pipeline Consolidation](#64-build-pipeline-consolidation)
- [7. Edge Cases And Failure Modes](#7-edge-cases-and-failure-modes)
- [8. Definition Of Done](#8-definition-of-done)
- [9. Final Model](#9-final-model)

## 1. Goal

Eliminate the mixed entity type/class split in `src/domain/` so all domain entities are classes with a uniform `private constructor` / `static create()` / `static reconstitute()` / `toSnapshot()` shape. Remove the cross-file TypeScript Compiler API linter (`scripts/lint-architecture.mjs`) and fold all architecture rules into oxlint as a single JS plugin, making `pnpm lint` one command.

## 2. Current-State Findings

### 2.1 Mixed Entity Shapes

Before this change, the codebase had two entity styles:

**Classes** (full lifecycle pattern):

| Entity | `static create()` | `static reconstitute()` | `toSnapshot()` | `update()` | lifecycle methods |
|--------|-------------------|------------------------|----------------|------------|-------------------|
| `Post` | yes | yes | yes | yes | `publish()`, `unpublish()` |
| `Media` | yes | yes | yes | yes | `publish()`, `unpublish()` |

**Plain types** (no lifecycle, no methods):

| Entity | Shape |
|--------|-------|
| `Category` | `export type Category = { id, name, slug, ... }` |
| `User` | `export type User = { id, email, role, ... }` |
| `DeferredGrant` | `export type DeferredGrant = { id, betterAuthUserId, ... }` |
| `GrantMirror` | `export type GrantMirror = { id, autherTupleId, ... }` |
| `Relationship` | `export type Relationship = { id, subjectType, ... }` |

This meant:
- Mappers for plain-type entities returned object literals via inline property spread.
- Mappers for class entities called `.reconstitute()` / `.toSnapshot()`.
- `JSON.stringify(entity)` worked on plain types but would fail on classes (returns `"{}"`).
- Presenters could spread `{ ...entity }` on plain types but would return `{}` for classes.
- Update use cases for plain types passed `Partial<...>` directly to the repository without an entity mutation step.

### 2.2 Cross-File Lint Dependency

The old linter (`scripts/lint-architecture.mjs`) used the TypeScript Compiler API (`ts.createSourceFile`) to parse all `.ts` files upfront, building a `sourceFiles` Map. Its `getClassEntityNamesForMapper` function (lines 468–499) resolved domain import specifiers to other files, parsed them, and checked whether the imported name was an exported class vs. a type. It used this to conditionally enforce `.reconstitute()` and `.toSnapshot()` checks only on mappers whose entities were classes.

Problem: cross-file resolution is not available in standard ESLint/oxlint rules, which are per-file.

### 2.3 Dual Lint Pass

`package.json` scripts ran two separate lint commands:

```
"lint": "pnpm lint:code && pnpm lint:arch"
```

`lint:code` invoked oxlint for code-style rules. `lint:arch` invoked a separate Node.js script that parsed the entire TypeScript AST with the compiler API. This was slower than a single pass and required TypeScript as a runtime dependency for linting.

## 3. Target Model

1. Every entity in `src/domain/**/*.entity.ts` is a **class** with:
   - `private constructor(private props: XxxProps)`
   - `static create(input: CreateXxxProps): Xxx`
   - `static reconstitute(props: XxxProps): Xxx`
   - Getters for all fields
   - `toSnapshot(): XxxProps`
   - `update(input: UpdateXxxProps)` where the entity owns mutable state
   - A `*Props` type export for the raw snapshot shape
   - A `Create*Props` type export for create input (omitting auto-generated fields like `id`, `createdAt`, `updatedAt`)
2. All mappers use `Entity.reconstitute(...)` in `*RowToEntity` and `entity.toSnapshot()` in `*ToInsertRow` / `*ToUpdateRow`.
3. All presenters spread `entity.toSnapshot()` instead of `{ ...entity }`.
4. All update use cases call `entity.update(input)` + `repo.save(entity)` instead of `repo.update(id, partial)`.
5. Architecture linting runs inside oxlint as a JS plugin with 15 rules, matching the behavior of the old script and adding a guard against raw entity serialization.
6. `pnpm lint` is a single `oxlint` invocation — no separate arch lint step.

## 4. Architecture Decisions

### 4.1 Option C: Convert All Entities To Classes

Three options were considered for resolving the cross-file `getClassEntityNamesForMapper` problem:

| Option | Description | Verdict |
|--------|-------------|---------|
| A | Precompute class entity names into a JSON config, pass as rule options | Works, but external config drifts |
| B | Use `fs.readFileSync` inside the rule to resolve other files at lint time | Slow, duplicates parsing |
| **C** | **Convert all plain-type entities to classes, enforce class-only rules** | **Cleanest. No cross-file resolution needed.** |

Option C was chosen because:
- The codebase already had `Post` and `Media` as well-structured class entities; this extends the pattern.
- Eliminates the need for per-file cross-module resolution entirely.
- Mapper rules are simpler: always enforce `.reconstitute()` / `.toSnapshot()` — no conditional checks.
- A new `architecture/entity-class` rule prevents future drift back to plain types.

### 4.2 Oxlint JS Plugin Over TypeScript Compiler API

Oxlint's JS plugin API emulates ESLint v9+. Key tradeoffs:

| Aspect | TypeScript Compiler API (old) | Oxlint JS Plugin (new) |
|--------|-------------------------------|------------------------|
| AST flavor | TypeScript AST (`ts.Node`, `ts.SyntaxKind`) | ESTree (`Literal`, `ImportDeclaration`, etc.) |
| Cross-file | Yes (via `sourceFiles` Map) | No (per-file ESLint model) — resolved by entity conversion |
| Speed | Parses all files upfront, single-threadeded TypeScript | Rust-parallel oxlint, JS plugin runs in V8 isolate |
| Integration | Separate `node` process | Same `oxlint` invocation |
| Rules | Hardcoded in one script | 11 independent rules, configurable severity |

The ESTree-to-TypeScript AST mapping differences (e.g., `ts.PropertyAccessExpression` → ESTree `MemberExpression`, `ts.heritageClauses` → `node.superClass`) required rewriting all AST navigation logic. The `findDescendants()` helper uses a `visited` Set to avoid infinite recursion through `node.parent` back-references present in the ESTree tree.

## 5. Implementation Strategy

1. Convert all 5 plain-type entities to classes first, preserving behavior.
2. Run typecheck and tests to catch broken call sites.
3. Fix downstream code in mappers, use cases, presenters, repositories, and workflows.
4. Write the oxlint plugin with all 15 rules.
5. Wire the plugin into `.oxlintrc.json`, remove old script, consolidate `package.json` scripts.
6. Verify `pnpm check` passes.

## 6. Detailed Implementation Plan

### 6.1 Entity Class Conversion

Each entity gets a matching structure:

```ts
// Pattern applied to {Category, User, DeferredGrant, GrantMirror, Relationship}
export type XxxProps = { /* all fields including id, createdAt, updatedAt */ };
export type CreateXxxProps = Omit<XxxProps, "id" | "createdAt" | "updatedAt">;
export type UpdateXxxProps = Partial<Pick<XxxProps, /* mutable fields */>>;

export class Xxx {
  private constructor(private props: XxxProps) {}

  static create(input: CreateXxxProps) {
    const now = new Date();
    return new Xxx({ ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now });
  }

  static reconstitute(props: XxxProps) { return new Xxx({ ...props }); }

  // Getters for each field

  update(input: UpdateXxxProps) { /* apply mutable fields, call touch() */ }

  toSnapshot(): XxxProps { return { ...this.props }; }

  private touch() { this.props.updatedAt = new Date(); }
}
```

Files changed:
- `src/domain/categories/category.entity.ts` — `Category` type → `Category` class + `CategoryProps`, `CreateCategoryProps`, `UpdateCategoryProps`
- `src/domain/users/user.entity.ts` — `User` type → `User` class + `UserProps`, `CreateUserProps`, `UpdateUserProps`
- `src/domain/deferred-grants/deferred-grant.entity.ts` — `DeferredGrant` type → `DeferredGrant` class + `DeferredGrantProps`, `CreateDeferredGrantProps`
- `src/domain/grant-mirror/grant-mirror.entity.ts` — `GrantMirror` type → `GrantMirror` class + `GrantMirrorProps`, `CreateGrantMirrorProps`
- `src/domain/authz/relationship.entity.ts` — `Relationship` type → `Relationship` class + `RelationshipProps`, `CreateRelationshipProps` (lookup types `RelationshipLookup`, `RelationshipSubjectLookup`, `HasAnyRelationParams` preserved)

### 6.2 Downstream Fixes

#### Mappers (8 files)

`*RowToEntity` changed from `return { id: row.id, ... }` to `return Entity.reconstitute({ ... })`.
`*ToInsertRow` / `*ToUpdateRow` changed from accessing `input.field` to `entity.toSnapshot()` then field selection.
`idempotency.mapper.ts` excluded from reconstitute/toSnapshot enforcement (does not import domain entities).

Files:
- `src/infrastructure/repositories/mappers/category.mapper.ts`
- `src/infrastructure/repositories/mappers/user.mapper.ts`
- `src/infrastructure/repositories/mappers/deferred-grant.mapper.ts`
- `src/infrastructure/repositories/mappers/grant-mirror.mapper.ts`
- `src/infrastructure/repositories/mappers/relationship.mapper.ts`

#### Use cases (10 files)

Create use cases: `buildXxx()` now calls `Xxx.create(input)` instead of spread-constructing plain objects.
Idempotent serialization: `JSON.stringify(entity)` → `JSON.stringify(entity.toSnapshot())`.
Idempotent deserialization: `return { ...snapshot, ... }` → `return Entity.reconstitute(deserializeXxxSnapshot(...))`.
Non-idempotent create: `repo.create({ field: entity.field, ... })` → `repo.create(entity)`.
Update use cases: `repo.update(id, input)` → `entity.update(input)` + `repo.save(entity)`.

Files:
- `src/application/categories/create-category.usecase.ts`
- `src/application/categories/update-category.usecase.ts`
- `src/application/users/create-user.usecase.ts`
- `src/application/users/update-user.usecase.ts`
- `src/application/deferred-grants/create-deferred-grant.usecase.ts`
- `src/application/deferred-grants/update-deferred-grant.usecase.ts`
- `src/application/grant-mirror/create-grant-mirror.usecase.ts`
- `src/application/grant-mirror/update-grant-mirror.usecase.ts`
- `src/application/relationships/create-relationship.usecase.ts`
- Three `createRelationship()` helpers in `create-post.usecase.ts`, `create-media.usecase.ts`, `create-category.usecase.ts` — now use `Relationship.create(...)`

#### Presenters (4 files)

Object spread `{ ...entity }` on a class instance returns `{}` (no own enumerable properties). Fixed by calling `entity.toSnapshot()` first, then spreading the snapshot.

Files:
- `src/http/presenters/category.presenter.ts` — `{ ...category, ... }` → `const snap = category.toSnapshot(); { ...snap, ... }`
- `src/http/presenters/authz.presenter.ts` — `presentGrantMirror`, `presentDeferredGrant`, `presentRelationship` all fixed

The `user.presenter.ts` accesses individual getters (`user.id`, `user.email`, etc.) — no object spread, so getters work without change.

#### Repository interfaces & implementations (5 files each)

`create(input: Omit<Xxx, ...>): Promise<Xxx>` → `create(entity: Xxx): Promise<Xxx>`
`update(id: string, input: Partial<...>): Promise<Xxx | null>` → `save(entity: Xxx): Promise<void>`

Files:
- `src/domain/categories/category.repository.ts` + `src/infrastructure/repositories/drizzle-category.repository.ts`
- `src/domain/users/user.repository.ts` + `src/infrastructure/repositories/drizzle-user.repository.ts`
- `src/domain/deferred-grants/deferred-grant.repository.ts` + `src/infrastructure/repositories/drizzle-deferred-grant.repository.ts`
- `src/domain/grant-mirror/grant-mirror.repository.ts` + `src/infrastructure/repositories/drizzle-grant-mirror.repository.ts`

#### Workflows (2 files)

Removed redundant `{ ...mapperResult, createdAt: entity.createdAt, updatedAt: entity.updatedAt }` spreads. Mappers now include `createdAt`/`updatedAt` from the snapshot, so the workflow uses the mapper result directly.

Files:
- `src/infrastructure/repositories/drizzle-category-create.workflow.ts`
- `src/infrastructure/repositories/drizzle-user-create.workflow.ts`

### 6.3 Oxlint Architecture Plugin

New file: `scripts/oxlint-js-plugins/architecture.js` — ESLint v9-compatible JS plugin using ESTree AST visitors.

#### Rule reference

| Rule | What it enforces | File filter |
|------|-----------------|-------------|
| `layer-imports` | Internal import allowlists per layer + banned external deps per layer | All `.ts` files |
| `no-mapper-imports-outside-infra` | Mapper imports only inside `src/infrastructure/` | Non-infrastructure files |
| `no-storage-error-parsing` | No SQLite/D1/Drizzle/UNIQUE string literals or template literals in app/domain/http/shared | Files outside infra |
| `no-custom-errors-outside-shared` | Classes extending `Error` or `AppError` must live in `src/shared/errors.ts` | All files except `errors.ts` |
| `req-valid-usage` | `req.valid("param"|"query"|"json"|"header")` only, no raw `req.json()`/`req.query()`/`req.param()`/`req.header()`/body parsers in routes | All `.ts` files |
| `no-plain-zod-import` | `import ... from "zod"` forbidden in schema/validation/pagination files | `src/http/schemas/`, `src/shared/validation/`, `src/shared/pagination/` |
| `route-module` | Routes must import `createRoute` from `@hono/zod-openapi`, use `createRoute({...})` + `app.openapi(...)`, have exactly one `.execute()` per handler, and pair `requireActor` with exact `security: bearerSecurity` | `src/http/routes/*.routes.ts` |
| `repository-workflow` | Repos/workflows must import mappers, must not import policies, must not call `.reconstitute()` inline, must not direct-write through `this.db.insert/update/delete`, and only workflow ports may call `this.db.batch(...)` | `src/infrastructure/repositories/drizzle-*.{repository,workflow}.ts` |
| `mapper-file` | Mapper functions must accept exactly one arg, must not spread or return the input directly, `RowToEntity` must call `.reconstitute()`, `ToInsertRow`/`ToUpdateRow` must call `.toSnapshot()` | `src/infrastructure/repositories/mappers/*.mapper.ts` |
| `entity-class` | `.entity.ts` files must export a class with `private constructor(private props: XxxProps)`, `static create(input: CreateXxxProps)`, `static reconstitute()`, and `toSnapshot()`; type-only entity files fail; `CreateXxxProps` must be `Omit<XxxProps, ...>` and exclude fields generated by `static create()` | `src/domain/**/*.entity.ts` |
| `no-raw-entity-serialization` | Application/HTTP code must call `entity.toSnapshot()` before JSON serialization or object spread | `src/application/`, `src/http/` |
| `crud-adapter-jsdoc` | Every public `CrudAdapter` method must have a JSDoc comment | `src/infrastructure/persistence/crud-adapter.ts` |
| `no-magic-numbers` | No numeric literals (except 0, 1) in application, domain, HTTP, or shared layers; extract to named constants | `src/application/`, `src/domain/`, `src/http/`, `src/shared/` |
| `constants-placement` | `SCREAMING_SNAKE_CASE` `const` declarations must live in `src/shared/`, `src/domain/`, or `src/infrastructure/` | All `src/` except `src/tests/` |
| `constants-jsdoc` | `SCREAMING_SNAKE_CASE` constants must have JSDoc (direct or group) | `src/shared/`, `src/domain/`, `src/infrastructure/` |

#### AST navigation notes

- `ImportDeclaration.source.value` (ESTree `Literal`) for module specifier strings.
- `node.parent` used to detect exported vs. non-exported declarations.
- `findDescendants()` with a `visited` Set avoids infinite loops through `node.parent` back-references.
- `hasJSDoc()` reads `context.sourceCode.getCommentsBefore(node)` and checks the first character is `*`.
- `oxlint`'s `sourceCode.getJSDocComment` is deprecated and not supported; only `getCommentsBefore` is used.

### 6.4 Build Pipeline Consolidation

**`package.json` script changes**:

```
- "lint": "pnpm lint:code && pnpm lint:arch",
- "lint:code": "oxlint",
- "lint:arch": "node ./scripts/lint-architecture.mjs",
- "lint:fix": "pnpm lint:code:fix && pnpm lint:arch",
- "lint:code:fix": "oxlint --fix",
+ "lint": "oxlint",
+ "lint:fix": "oxlint --fix",
```

**`.oxlintrc.json` changes**:

- Added `"jsPlugins": ["./scripts/oxlint-js-plugins/architecture.js"]`
- Enabled all 12 `architecture/*` rules at `"error"` severity.
- `layer-imports` rule carries the `internalAllowed` and `externalBanned` maps as `context.options[0]`.
- All `architecture/*` rules disabled in `tests/**` and `**/*.d.ts` overrides to avoid false positives on test files and declaration files.

**Removed**:

- `scripts/lint-architecture.mjs` (656 lines, TypeScript Compiler API)

## 7. Edge Cases And Failure Modes

- **Object spread on class instances**: `{ ...entity }` returns `{}` because class getters are on the prototype. All presenters now call `entity.toSnapshot()` first. The `entity-class` rule prevents new plain types, so this class of bug cannot recur.
- **JSON.stringify on class instances**: Returns `"{}"` because no own enumerable properties. All serialization now uses `.toSnapshot()`. The `mapper-file` rule enforces mapper functions call `.toSnapshot()` before row construction, which covers all entity-to-persistence boundaries.
- **Raw entity serialization regression**: A dedicated `no-raw-entity-serialization` rule rejects entity-like identifiers/member expressions passed directly to `JSON.stringify(...)` or object spread in application/HTTP code.
- **Generated create fields**: The `entity-class` rule compares fields written by `static create()` against `CreateXxxProps`. Generated fields such as IDs, timestamps, and generated slugs must not be accepted from callers, and `CreateXxxProps` must consistently use `Omit<XxxProps, ...>`.
- **Route and persistence shortcuts**: Route validation is checked against any handler parameter name, not just `c`; protected route security must be the exact `bearerSecurity` helper; repository/workflow writes must use `CrudAdapter`, with `db.batch(...)` limited to workflow ports.
- **Oxlint JS plugin stack overflow**: The ESTree AST includes `node.parent` back-references. Without cycle detection, recursive tree walks cause maximum call stack errors. The `findDescendants()` and `countExecute()` helpers both use a `visited` Set and skip the `"parent"` key.
- **Idempotency mapper excluded from entity rules**: `idempotency.mapper.ts` deals with `IdempotencyRecord` (a type from the idempotency repository, not a domain entity class). The `mapper-file` rule checks `hasDomainEntityImport` before enforcing `.reconstitute()` / `.toSnapshot()`.
- **Unused type imports**: Converting entities to classes means some `import type { Xxx }` statements become unused (the class type is inferred through method return types). Oxlint's built-in `no-unused-vars` catches these; they were removed.

## 8. Definition Of Done

- [x] All 7 domain entity files export a class with `private constructor`, `static create()`, `static reconstitute()`, and `toSnapshot()`.
- [x] Entity `create()` methods own generated ids/timestamps and generated slugs; use cases no longer pass generated IDs into entity factories.
- [x] All domain entity mappers use `.reconstitute()` / `.toSnapshot()`; the idempotency mapper remains explicitly outside entity rules.
- [x] All use cases construct entities through `.create()` and serialize/deserialize through `.toSnapshot()` / `.reconstitute()`.
- [x] All presenters use `entity.toSnapshot()` spreads or individual getter access (no bare `{ ...entity }` spreads).
- [x] All update use cases call `entity.update(input)` + `repo.save(entity)`.
- [x] `pnpm lint` returns 0 errors, 0 warnings (178 rules on 125 files).
- [x] `pnpm typecheck` passes clean.
- [x] `pnpm test` passes (19/19 tests).
- [x] `scripts/lint-architecture.mjs` removed (no separate arch lint step).
- [x] Architecture rules are discoverable, configurable, and file-filtered in `.oxlintrc.json`.
- [x] `architecture/entity-class` rule prevents regression to plain-type entities, and `architecture/no-raw-entity-serialization` prevents class instance spread/serialization regressions.

## 9. Final Model

```
src/domain/
├── authz/
│   └── relationship.entity.ts          class Relationship + RelationshipProps + lookup types
├── categories/
│   └── category.entity.ts              class Category + CategoryProps + Create/Update
├── deferred-grants/
│   └── deferred-grant.entity.ts        class DeferredGrant + DeferredGrantProps + Create
├── grant-mirror/
│   └── grant-mirror.entity.ts          class GrantMirror + GrantMirrorProps + Create
├── media/
│   └── media.entity.ts                 class Media + MediaProps + Create/Update (unchanged)
├── posts/
│   └── post.entity.ts                  class Post + PostProps + Create/Update (unchanged)
└── users/
    └── user.entity.ts                  class User + UserProps + Create/Update

Every entity class has:
  private constructor(private props: XxxProps)
  static create(input: CreateXxxProps): Xxx
  static reconstitute(props: XxxProps): Xxx
  toSnapshot(): XxxProps

Lint pipeline:
  pnpm lint  →  oxlint (166 built-in/plugin rules + 12 architecture JS plugin rules, 178 total)
  Single pass, 0 warnings, 0 errors.
```

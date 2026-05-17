# Idempotent Create Workflows With D1 Batch

> Status: revised implementation-grade proposal
>
> Date: 2026-05-17
>
> Scope:
>
> - `docs/architecture.md`
> - `src/domain/idempotency/idempotency.repository.ts` (new)
> - `src/application/posts/create-post.usecase.ts`
> - `src/application/media/create-media.usecase.ts`
> - `src/application/categories/create-category.usecase.ts`
> - `src/application/users/create-user.usecase.ts`
> - `src/domain/posts/post-create.workflow.ts` (new)
> - `src/domain/media/media-create.workflow.ts` (new)
> - `src/domain/categories/category-create.workflow.ts` (new)
> - `src/domain/users/user-create.workflow.ts` (new)
> - `src/infrastructure/repositories/drizzle-post-create.workflow.ts` (new)
> - `src/infrastructure/repositories/drizzle-media-create.workflow.ts` (new)
> - `src/infrastructure/repositories/drizzle-category-create.workflow.ts` (new)
> - `src/infrastructure/repositories/drizzle-user-create.workflow.ts` (new)
> - `src/infrastructure/repositories/drizzle-idempotency.repository.ts` (new)
> - `src/infrastructure/db/schema.ts`
> - `src/composition/create-request-container.ts`
> - `src/http/routes/posts.routes.ts`
> - `src/http/routes/media.routes.ts`
> - `src/http/routes/categories.routes.ts`
> - `src/http/routes/users.routes.ts`
> - `src/http/schemas/common.schema.ts`
> - `tests/api.test.ts`
>
> Source docs:
>
> - `docs/architecture.md` §17 (Idempotency)
> - `docs/architecture.md` §18 (Transaction & Partial-Write Policy)
> - `.agents/skills/content-api-architecture/references/architecture-rules.md`
>
> Related docs:
>
> - `src/infrastructure/persistence/crud-adapter.ts`
> - `src/infrastructure/repositories/drizzle-post.repository.ts`
> - `src/infrastructure/repositories/drizzle-media.repository.ts`
> - `src/infrastructure/repositories/drizzle-category.repository.ts`
> - `src/infrastructure/repositories/drizzle-user.repository.ts`
> - `src/infrastructure/repositories/drizzle-relationship.repository.ts`
>
> Assumptions:
>
> - Cloudflare D1 `batch()` can be used for atomic write workflows in this Worker runtime.
> - First release only covers create-style `POST` endpoints in this repo: `/posts`, `/media`, `/categories`, `/users`.
> - First release does not yet add idempotency to media completion, publishing, reprocessing, or queue consumers.

## Table Of Contents

- [1. Goal](#1-goal)
- [2. System Summary](#2-system-summary)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 Current Create Flows](#31-current-create-flows)
  - [3.2 Current Repository Contracts](#32-current-repository-contracts)
  - [3.3 Current Architecture Constraints](#33-current-architecture-constraints)
  - [3.4 Current Problems](#34-current-problems)
- [4. Target Model](#4-target-model)
  - [4.1 Product Behavior](#41-product-behavior)
  - [4.2 Ownership Model](#42-ownership-model)
  - [4.3 Persistence Model](#43-persistence-model)
- [5. Architecture Decisions](#5-architecture-decisions)
  - [5.1 Recommended Approach](#51-recommended-approach)
  - [5.2 Why Not `BatchContext`](#52-why-not-batchcontext)
  - [5.3 Rejected Or Deferred Options](#53-rejected-or-deferred-options)
- [6. Implementation Strategy](#6-implementation-strategy)
- [7. Detailed Implementation Plan](#7-detailed-implementation-plan)
  - [7.1 Shared Idempotency Persistence](#71-shared-idempotency-persistence)
  - [7.2 Workflow Ports For Atomic Create Operations](#72-workflow-ports-for-atomic-create-operations)
  - [7.3 Use Case Changes](#73-use-case-changes)
  - [7.4 HTTP Route And Schema Changes](#74-http-route-and-schema-changes)
  - [7.5 Composition Wiring](#75-composition-wiring)
  - [7.6 Tests And Verification](#76-tests-and-verification)
- [8. Migration And Rollout](#8-migration-and-rollout)
- [9. Edge Cases And Failure Modes](#9-edge-cases-and-failure-modes)
- [10. Implementation Backlog](#10-implementation-backlog)
- [11. Future Backlog](#11-future-backlog)
- [12. Definition Of Done](#12-definition-of-done)
- [13. Final Model](#13-final-model)

## 1. Goal

Add transport-level idempotency for create endpoints so clients can safely retry `POST /posts`, `POST /media`, `POST /categories`, and `POST /users` without producing duplicate rows or partially-written authorization relationships.

First-release boundary:

- Include idempotency key storage, request-hash enforcement, cached success replay, and atomic batch writes.
- Keep route handlers thin and keep authorization in use cases and policies.
- Do not introduce `application -> infrastructure` imports.
- Do not redesign existing CRUD repositories to support generic deferred writes.

Non-goals for this document:

- Generic transaction support for all use cases.
- Idempotency for queue consumers or non-create endpoints.
- Background cleanup beyond a minimal future backlog item.

## 2. System Summary

The create workflows in this repo are application-level orchestration flows:

- `CreatePostUseCase` creates a `posts` row and an `author` relationship.
- `CreateMediaUseCase` creates a `media` row and an `owner` relationship.
- `CreateCategoryUseCase` creates a `categories` row and an `owner` relationship.
- `CreateUserUseCase` creates a `users` row only.

Today those workflows call ordinary CRUD repositories sequentially. The target model keeps use cases in control of the workflow but gives them a dedicated write port for the atomic persistence step. The use case still decides:

- who is allowed to create
- what domain entity to build
- whether an idempotency key is present
- whether a replay is valid or conflicting

The infrastructure implementation of the workflow port decides:

- how to translate the domain object into row inserts
- how to build the D1 batch
- how to insert the idempotency row and business rows atomically

## 3. Current-State Findings

### 3.1 Current Create Flows

Observed create use cases:

- [`src/application/posts/create-post.usecase.ts`](/home/quanghuy1242/pjs/content-api/src/application/posts/create-post.usecase.ts:1) creates a `Post`, then calls `posts.create(post)`, then `relationships.create(...)`.
- [`src/application/media/create-media.usecase.ts`](/home/quanghuy1242/pjs/content-api/src/application/media/create-media.usecase.ts:1) creates a `Media`, then `mediaRepository.create(media)`, then `relationships.create(...)`.
- [`src/application/categories/create-category.usecase.ts`](/home/quanghuy1242/pjs/content-api/src/application/categories/create-category.usecase.ts:1) creates a category, then `categories.create(...)`, then `relationships.create(...)`.
- [`src/application/users/create-user.usecase.ts`](/home/quanghuy1242/pjs/content-api/src/application/users/create-user.usecase.ts:1) checks uniqueness by email and creates a user.

These are application-level workflows already, which is the right place for idempotency decisions.

### 3.2 Current Repository Contracts

Current domain repository interfaces are not uniform:

- [`PostRepository`](/home/quanghuy1242/pjs/content-api/src/domain/posts/post.repository.ts:1) has `create(post): Promise<void>`.
- [`MediaRepository`](/home/quanghuy1242/pjs/content-api/src/domain/media/media.repository.ts:1) has `create(input): Promise<Media>`.
- [`CategoryRepository`](/home/quanghuy1242/pjs/content-api/src/domain/categories/category.repository.ts:1) has `create(input): Promise<Category>`.
- [`UserRepository`](/home/quanghuy1242/pjs/content-api/src/domain/users/user.repository.ts:1) has `create(input): Promise<User>`.
- [`RelationshipRepository`](/home/quanghuy1242/pjs/content-api/src/domain/authz/relationship.repository.ts:1) has `create(input): Promise<Relationship>`.

Current infrastructure implementations also perform immediate post-insert reads in several repositories:

- [`drizzle-media.repository.ts`](/home/quanghuy1242/pjs/content-api/src/infrastructure/repositories/drizzle-media.repository.ts:56) inserts, then immediately `findById`.
- [`drizzle-category.repository.ts`](/home/quanghuy1242/pjs/content-api/src/infrastructure/repositories/drizzle-category.repository.ts:47) inserts, then immediately `findById`.
- [`drizzle-user.repository.ts`](/home/quanghuy1242/pjs/content-api/src/infrastructure/repositories/drizzle-user.repository.ts:54) inserts, then immediately `findById`.
- [`drizzle-relationship.repository.ts`](/home/quanghuy1242/pjs/content-api/src/infrastructure/repositories/drizzle-relationship.repository.ts:88) inserts with `onConflictDoNothing`, then reads back the row.

This matters because any design that turns `create()` into “defer now, flush later” will break current repository semantics.

### 3.3 Current Architecture Constraints

The repo’s architecture rules are explicit:

- `application` may depend on `domain/*` and `shared/*`, not infrastructure.
- `http` must not do database work.
- shared CRUD belongs in [`src/infrastructure/persistence/crud-adapter.ts`](/home/quanghuy1242/pjs/content-api/src/infrastructure/persistence/crud-adapter.ts:1).
- repositories must not own authorization logic.

See:

- [`docs/architecture.md`](/home/quanghuy1242/pjs/content-api/docs/architecture.md:1299)
- [`architecture-rules.md`](/home/quanghuy1242/pjs/content-api/.agents/skills/content-api-architecture/references/architecture-rules.md:11)

### 3.4 Current Problems

1. Multi-write create flows are not atomic today.
2. No idempotency key persistence exists in code today.
3. A generic batch deferral mechanism would not fit the current repository contracts.
4. The architecture doc names idempotency as a required capability, but current code does not implement it.

## 4. Target Model

### 4.1 Product Behavior

For each supported create endpoint:

- If the client omits `Idempotency-Key`, the request behaves exactly as it does today.
- If the client sends a new `Idempotency-Key`, the API performs the create workflow once and stores a replay record.
- If the client retries the same request with the same key and same body, the API returns the same successful response body and status.
- If the client retries with the same key but a different request body, the API returns `409 Conflict`.

First-release status behavior:

- Replay returns the original `201` status for create endpoints.
- Only successful create responses are cached.
- Failed requests do not persist an idempotency row.

### 4.2 Ownership Model

The design introduces two separate kinds of persistence ports:

1. Existing CRUD repositories remain as-is for ordinary reads and non-atomic writes.
2. New workflow-specific write ports handle the atomic create transaction shape for each resource.

Recommended workflow ports:

- `PostCreateWorkflow`
- `MediaCreateWorkflow`
- `CategoryCreateWorkflow`
- `UserCreateWorkflow`

Each port is a domain-facing or application-facing interface defined outside `infrastructure`, but implemented in `infrastructure/repositories/`.

### 4.3 Persistence Model

Add the idempotency table based on the architecture doc, scoped by actor and route so clients can reuse the same generated key in separate idempotency namespaces:

```sql
CREATE TABLE idempotency_keys (
  key TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  route TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT,
  status INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (key, actor_id, route)
)
```

Recommended first-release read model:

```ts
export interface IdempotencyRecord {
  key: string;
  actorId: string;
  route: string;
  requestHash: string;
  responseJson: string | null;
  status: number;
  createdAt: Date;
  expiresAt: Date;
}
```

The use case needs `requestHash`, `status`, and `responseJson`. Omitting `requestHash` from the read contract would make conflict detection impossible.

## 5. Architecture Decisions

### 5.1 Recommended Approach

Use dedicated workflow write ports for idempotent atomic create operations.

Recommended use case shape:

1. Route validates optional `Idempotency-Key` header and passes it to the use case.
2. Use case authenticates and authorizes.
3. Use case computes a canonical request hash when a key is present.
4. Use case queries `IdempotencyRepository.findActive(...)`.
5. If a row exists:
   - if hash differs, throw `ConflictError`
   - else deserialize cached response and return it
6. If no row exists:
   - remove any expired row for the same key, actor, and route
   - build the domain entity
   - call a workflow port that writes the idempotency row and business rows in one D1 batch
   - return the created resource

This keeps the application in charge of behavior and conflict semantics, while keeping Drizzle and D1 batch construction in infrastructure.
Infrastructure workflow implementations translate idempotency unique-key storage failures into a shared typed reservation conflict; application use cases must not parse SQLite/D1 error messages.

### 5.2 Why Not `BatchContext`

The earlier draft proposed an infrastructure `BatchContext` passed directly into use cases. That is not the right fit here for three reasons:

1. It requires `application` to import an infrastructure type, which violates this repo’s boundary rules.
2. It assumes repository `create()` methods can defer execution safely, which is false for repositories that read after insert.
3. It introduces a generic hidden execution mode into `CrudAdapter.insertRow()` without updating the semantics of all repositories that depend on immediate persistence.

### 5.3 Rejected Or Deferred Options

Rejected for first release:

- Generic deferred batching in `CrudAdapter`.
- Middleware-owned idempotency lookup and replay.
- A single “super repository” that replaces all create flows.
- Persisting failed responses in the idempotency table.

Deferred:

- General transaction abstraction for all write workflows.
- Shared infrastructure helper that reduces duplication across the four workflow implementations.
- Background cleanup job for expired idempotency rows.

## 6. Implementation Strategy

Sequence the work so the first release is understandable and safe:

1. Add the idempotency table and a focused `IdempotencyRepository`.
2. Add one workflow port and implementation for `posts` first.
3. Wire `CreatePostUseCase` and route support, then add tests.
4. Roll the same pattern to `media`, `categories`, and `users`.
5. Only after all four resources are passing tests, consider extracting shared infrastructure helpers.

This keeps the first implementation reviewable. The `posts` flow is the best first slice because it already uses the simplest repository contract: `PostRepository.create()` returns `void`.

## 7. Detailed Implementation Plan

### 7.1 Shared Idempotency Persistence

Current problem:

- No schema or repository exists for idempotency keys.

Target behavior:

- The application can query an active idempotency record by key, actor, and route.
- The application can remove an expired record for the same key, actor, and route before retrying a create.
- The infrastructure can write idempotency rows atomically inside a D1 batch.

Implementation tasks:

- Add `idempotencyKeys` to [`src/infrastructure/db/schema.ts`](/home/quanghuy1242/pjs/content-api/src/infrastructure/db/schema.ts:1).
- Generate a migration for the new table.
- Add `src/domain/idempotency/idempotency.repository.ts` with:
  - `findActive(params: { key: string; actorId: string; route: string }): Promise<IdempotencyRecord | null>`
  - `deleteExpired(params: { key: string; actorId: string; route: string }): Promise<void>`
- Implement `src/infrastructure/repositories/drizzle-idempotency.repository.ts`.
- Make `findActive` ignore expired rows.
- Keep `responseJson` nullable in storage but require non-null before replaying a cached success.
- Keep SQLite/D1 constraint-message parsing inside infrastructure workflow implementations.

Recommended repository behavior:

```ts
export interface IdempotencyRepository {
  findActive(params: {
    key: string;
    actorId: string;
    route: string;
  }): Promise<IdempotencyRecord | null>;

  deleteExpired(params: {
    key: string;
    actorId: string;
    route: string;
  }): Promise<void>;
}
```

Do not make `IdempotencyRepository` responsible for the whole create workflow. Its role is persistence and lookup of idempotency records, not business-row orchestration.

Tests:

- Unit test missing key returns `null`.
- Unit test expired row returns `null`.
- Unit test active row returns `requestHash`, `responseJson`, and `status`.

### 7.2 Workflow Ports For Atomic Create Operations

Current problem:

- Existing CRUD repository methods are not shaped for generic deferred execution.
- Several repository implementations depend on immediate insert visibility.

Target behavior:

- Each create use case has a dedicated workflow port whose single responsibility is “perform the atomic create workflow and idempotency insert.”

Recommended interface examples:

```ts
// src/domain/posts/post-create.workflow.ts
export interface PostCreateWorkflow {
  createWithIdempotency(params: {
    post: Post;
    authorRelationship: Relationship;
    idempotency: {
      key: string;
      actorId: string;
      route: "POST /posts";
      requestHash: string;
      responseJson: string;
      status: 201;
      expiresAt: Date;
    };
  }): Promise<void>;
}
```

```ts
// src/domain/media/media-create.workflow.ts
export interface MediaCreateWorkflow {
  createWithIdempotency(params: {
    media: Media;
    ownerRelationship: Relationship;
    idempotency: {
      key: string;
      actorId: string;
      route: "POST /media";
      requestHash: string;
      responseJson: string;
      status: 201;
      expiresAt: Date;
    };
  }): Promise<Media>;
}
```

Infrastructure implementations should:

- live under `src/infrastructure/repositories/`
- use Drizzle table imports and row mappers directly
- build a `db.batch([...])` with the idempotency insert first
- rely on the unique key constraint for collision detection
- avoid calling the ordinary repository `create()` methods internally if those methods do read-after-write

For example, `DrizzleMediaCreateWorkflow` should insert `media` rows directly with `mediaToInsertRow(media)` instead of calling `DrizzleMediaRepository.create(media)`.

This is intentional duplication at the workflow boundary. It is safer than introducing hidden deferred behavior into CRUD repositories.

Tests:

- Integration test that a duplicate idempotency key causes no duplicate business rows.
- Integration test that any batch failure leaves zero rows for all affected tables.

### 7.3 Use Case Changes

Current problem:

- Create use cases have no idempotency key handling.

Target behavior:

- Use cases stay as the source of truth for auth, request hashing, replay validation, and fallback behavior when no key is supplied.

Implementation tasks:

- Update `CreatePostUseCase` constructor to accept:
  - `PostRepository`
  - `RelationshipRepository`
  - `IdempotencyRepository`
  - `PostCreateWorkflow`
  - `PostPolicy`
- Add `idempotencyKey?: string` to the execute params.
- Compute `requestHash` only when a key is present.
- Query `idempotencyRepository.findActive({ key, actorId, route })`.
- On replay:
  - compare stored `requestHash`
  - return `JSON.parse(responseJson)` if same
  - throw `ConflictError` if different
- On new request with key:
  - delete an expired row for the same key, actor, and route
  - build domain entities
  - call `postCreateWorkflow.createWithIdempotency(...)`
  - if the workflow reports an idempotency reservation conflict, re-read the active row and replay it
  - return the domain object already built in memory
- On request without key:
  - keep current behavior

Apply the same pattern to:

- [`src/application/media/create-media.usecase.ts`](/home/quanghuy1242/pjs/content-api/src/application/media/create-media.usecase.ts:1)
- [`src/application/categories/create-category.usecase.ts`](/home/quanghuy1242/pjs/content-api/src/application/categories/create-category.usecase.ts:1)
- [`src/application/users/create-user.usecase.ts`](/home/quanghuy1242/pjs/content-api/src/application/users/create-user.usecase.ts:1)

Important resource-specific notes:

- `CreateUserUseCase` already does an email uniqueness pre-check. Keep that pre-check. The batch protects replay and atomic persistence, not business uniqueness semantics.
- `CreateMediaUseCase`, `CreateCategoryUseCase`, and `CreateUserUseCase` should return the in-memory entity they just built, not re-read through the normal CRUD repository during the atomic path.
- `CreatePostUseCase` can continue returning the built `Post` object, since it already does that today.

Recommended request hashing:

- Use a stable canonical JSON serialization helper in `shared/` rather than raw `JSON.stringify(input)` if field order could vary between semantically identical payloads.
- If a canonical serializer is out of scope for first release, document that identical retries must preserve the same JSON field order.

Tests:

- Replay with same key and same body returns the same `201` body.
- Replay with same key and different body returns `409`.
- No-key path still works.

### 7.4 HTTP Route And Schema Changes

Current problem:

- Create routes accept only JSON bodies today.

Target behavior:

- Each create route declares the optional `Idempotency-Key` header in OpenAPI and reads it through validated request input.

Implementation tasks:

- Add a shared schema in `src/http/schemas/common.schema.ts`:

```ts
export const idempotencyHeaderSchema = z.object({
  "idempotency-key": z.string().uuid().optional(),
});
```

- Use that schema in:
  - [`src/http/routes/posts.routes.ts`](/home/quanghuy1242/pjs/content-api/src/http/routes/posts.routes.ts:1)
  - [`src/http/routes/media.routes.ts`](/home/quanghuy1242/pjs/content-api/src/http/routes/media.routes.ts:1)
  - [`src/http/routes/categories.routes.ts`](/home/quanghuy1242/pjs/content-api/src/http/routes/categories.routes.ts:1)
  - [`src/http/routes/users.routes.ts`](/home/quanghuy1242/pjs/content-api/src/http/routes/users.routes.ts:1)

- Read the header with `c.req.valid("header")`, not `c.req.header(...)`.

Recommended route handler pattern:

```ts
const headers = c.req.valid("header");
const result = await c.get("container").posts.create.execute({
  actor,
  idempotencyKey: headers["idempotency-key"],
  input: body,
});
```

Keep the HTTP layer limited to validation and transport wiring. Do not add DB lookups or replay logic to middleware.

Tests:

- OpenAPI route registration includes the header for all four create endpoints.
- Invalid UUID header returns request validation error.

### 7.5 Composition Wiring

Current problem:

- The request container does not know about idempotency services or workflow ports.

Target behavior:

- Composition wires the new repositories and workflow implementations once per request.

Implementation tasks:

- Update [`src/composition/create-request-container.ts`](/home/quanghuy1242/pjs/content-api/src/composition/create-request-container.ts:1) to construct:
  - `DrizzleIdempotencyRepository`
  - `DrizzlePostCreateWorkflow`
  - `DrizzleMediaCreateWorkflow`
  - `DrizzleCategoryCreateWorkflow`
  - `DrizzleUserCreateWorkflow`
- Inject the new dependencies only into the affected create use cases.
- Keep existing CRUD repositories in place for read, update, delete, and non-idempotent create paths.

This composition model fits the repo’s architecture because the use cases receive interfaces, while concrete D1/Drizzle implementations remain in infrastructure and composition.

### 7.6 Tests And Verification

Add integration coverage in `tests/api.test.ts` or split into create-focused API test files if that file is already too large.

Required cases per resource:

- `POST` without `Idempotency-Key` creates the resource successfully.
- `POST` with new key creates the resource successfully.
- replay with same key and same body returns `201` and same response body.
- replay with same key and different body returns `409`.
- duplicate replay does not create an extra relationship row where applicable.

Also add at least one atomicity failure test:

- simulate a forced relationship insert failure after the idempotency row insert would have been staged
- assert that no idempotency row and no resource row remain after the failed batch

Verification commands:

```bash
corepack pnpm typecheck
corepack pnpm test
```

## 8. Migration And Rollout

No production data migration complexity is expected in this repo at the moment, but a schema migration is still required.

Rollout order:

1. Add schema and migration.
2. Ship post workflow support and tests.
3. Ship remaining resource workflows in the same branch if desired, or as tightly sequenced follow-ups.

Rollback notes:

- If the app code must be rolled back after the migration is applied, the extra table is harmless.
- Avoid cleanup scripts that drop the table during rollback.

## 9. Edge Cases And Failure Modes

- Same key, same actor, same route, same body: return cached success response.
- Same key, same actor, same route, different body: return `409 Conflict`.
- Same key, different actor: treat as a different idempotency namespace by including `actorId` in lookup semantics.
- Same key, different route: treat as a different idempotency namespace by including `route` in lookup semantics.
- Expired key: treat as missing and allow a new create.
- Concurrent first-use requests with same key: one batch wins, the other hits a unique-key failure, re-reads the idempotency row, validates hash, then returns cached response.
- Unique-key failure but no row found on re-read: surface as infrastructure error because the persistence state is inconsistent.
- Invalid JSON in cached `responseJson`: surface as server error; tests should ensure this cannot happen from application-controlled writes.
- No key present: existing non-idempotent path remains unchanged.
- Resource-specific business uniqueness conflict, such as duplicate user email: continue to return the existing conflict behavior.

## 10. Implementation Backlog

### R1-A. Add Idempotency Schema And Repository

Scope:

- `src/infrastructure/db/schema.ts`
- `src/domain/idempotency/idempotency.repository.ts`
- `src/infrastructure/repositories/drizzle-idempotency.repository.ts`
- migration files

Tasks:

- [ ] Add `idempotency_keys` schema.
- [ ] Generate migration.
- [ ] Implement `IdempotencyRecord` and `IdempotencyRepository`.
- [ ] Implement D1-backed lookup logic with expiry filtering.

Acceptance criteria:

- Active idempotency rows can be loaded with `requestHash`, `status`, and `responseJson`.
- Expired rows are ignored by application lookups.

Tests:

- Repository tests or integration tests covering active, missing, and expired rows.

### R1-B. Add Post Atomic Workflow

Scope:

- `src/domain/posts/post-create.workflow.ts`
- `src/infrastructure/repositories/drizzle-post-create.workflow.ts`
- `src/application/posts/create-post.usecase.ts`
- `src/http/routes/posts.routes.ts`

Tasks:

- [ ] Define `PostCreateWorkflow`.
- [ ] Implement D1 batch insert for idempotency row, post row, and relationship row.
- [ ] Update post create use case for replay and conflict handling.
- [ ] Add validated `Idempotency-Key` route support.

Acceptance criteria:

- Post create with a key is atomic and replay-safe.
- A conflict on replay with a different body returns `409`.

Tests:

- Post API replay tests.
- Atomicity failure integration test.

### R1-C. Add Media Atomic Workflow

Scope:

- `src/domain/media/media-create.workflow.ts`
- `src/infrastructure/repositories/drizzle-media-create.workflow.ts`
- `src/application/media/create-media.usecase.ts`
- `src/http/routes/media.routes.ts`

Tasks:

- [ ] Define `MediaCreateWorkflow`.
- [ ] Implement batch insert for idempotency row, media row, and relationship row.
- [ ] Update media create use case.
- [ ] Add validated header support.

Acceptance criteria:

- Media create replays safely and does not duplicate relationships.

Tests:

- Media API replay tests.

### R1-D. Add Category Atomic Workflow

Scope:

- `src/domain/categories/category-create.workflow.ts`
- `src/infrastructure/repositories/drizzle-category-create.workflow.ts`
- `src/application/categories/create-category.usecase.ts`
- `src/http/routes/categories.routes.ts`

Tasks:

- [ ] Define `CategoryCreateWorkflow`.
- [ ] Implement batch insert for idempotency row, category row, and relationship row.
- [ ] Update category create use case.
- [ ] Add validated header support.

Acceptance criteria:

- Category create replays safely and remains atomic.

Tests:

- Category API replay tests.

### R1-E. Add User Atomic Workflow

Scope:

- `src/domain/users/user-create.workflow.ts`
- `src/infrastructure/repositories/drizzle-user-create.workflow.ts`
- `src/application/users/create-user.usecase.ts`
- `src/http/routes/users.routes.ts`

Tasks:

- [ ] Define `UserCreateWorkflow`.
- [ ] Implement batch insert for idempotency row and user row.
- [ ] Update user create use case.
- [ ] Add validated header support.

Acceptance criteria:

- User create replays safely.
- Existing duplicate-email conflict behavior still works.

Tests:

- User API replay tests.
- Duplicate email test remains green.

### R1-F. Shared HTTP Schema And Container Wiring

Scope:

- `src/http/schemas/common.schema.ts`
- `src/composition/create-request-container.ts`

Tasks:

- [ ] Add shared idempotency header schema.
- [ ] Wire new repositories and workflow implementations into the request container.

Acceptance criteria:

- All four create routes accept the validated optional header.
- All four create use cases receive the required workflow dependencies.

Tests:

- Typecheck plus route-level API tests.

## 11. Future Backlog

- Extract shared infrastructure helpers for repeated “idempotency row + business rows” batch assembly after the first release lands.
- Add a scheduled cleanup job for expired idempotency rows.
- Extend idempotency to non-create workflows named in `docs/architecture.md` §17.
- Add canonical JSON serialization helper if first release ships with a simpler hashing strategy.

## 12. Definition Of Done

- `idempotency_keys` exists in schema and migration files.
- `IdempotencyRepository` supports active-row lookup with request hash and cached response data.
- `CreatePostUseCase`, `CreateMediaUseCase`, `CreateCategoryUseCase`, and `CreateUserUseCase` support optional idempotency keys.
- Each create workflow has a dedicated atomic D1 batch implementation in infrastructure.
- All four create routes validate and pass through `Idempotency-Key`.
- Replay with same key and same body returns the original successful create response.
- Replay with same key and different body returns `409`.
- Atomicity tests prove that failed batched writes leave no partial rows behind.
- `corepack pnpm typecheck` passes.
- `corepack pnpm test` passes.
- The document remains aligned with the actual implemented file paths and interfaces.

## 13. Final Model

The final architecture keeps idempotency behavior where it belongs:

- routes validate and forward the transport header
- use cases own authorization, replay semantics, and request-hash checks
- workflow-specific infrastructure ports own D1 batch construction
- CRUD repositories keep their existing immediate semantics

This is narrower than a generic batching abstraction, but it fits the current codebase, preserves the clean architecture boundary, and can be implemented incrementally without destabilizing existing repository behavior.

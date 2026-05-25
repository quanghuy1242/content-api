# Publish Lifecycle Adapter

> Status: superseded by [docs/012_content-lifecycle-plugin.md](012_content-lifecycle-plugin.md)
>
> Date: 2026-05-22
>
> Scope:
>
> - `/home/quanghuy1242/pjs/content-api`
>
> Source docs:
>
> - `docs/architecture.md`
> - `docs/003_entity-classes-and-oxlint-arch-linting.md`
> - `src/application/posts/` — all use case files
> - `src/application/media/` — all use case files
> - `src/application/categories/` — all use case files
> - `src/application/users/` — all use case files
> - `src/application/deferred-grants/` — all use case files
> - `src/application/grant-mirror/` — all use case files
> - `src/domain/posts/post.entity.ts`
> - `src/domain/media/media.entity.ts`
> - `src/domain/posts/post.policy.ts`
> - `src/domain/media/media.policy.ts`
> - `src/domain/categories/category.policy.ts`
> - `src/domain/users/user.policy.ts`
> - `src/domain/posts/post.repository.ts`
> - `src/domain/media/media.repository.ts`
> - `src/domain/categories/category.repository.ts`
> - `src/domain/users/user.repository.ts`
> - `src/domain/deferred-grants/deferred-grant.repository.ts`
> - `src/domain/grant-mirror/grant-mirror.repository.ts`
> - `src/application/posts/publish-post.usecase.ts`
> - `src/application/posts/unpublish-post.usecase.ts`
> - `src/application/media/publish-media.usecase.ts`
> - `src/application/media/unpublish-media.usecase.ts`
> - `src/domain/posts/post.policy.ts`
> - `src/domain/media/media.policy.ts`
> - `src/domain/deferred-grants/deferred-grant.policy.ts`
> - `src/domain/grant-mirror/grant-mirror.policy.ts`
> - `src/http/routes/posts.routes.ts`
> - `src/http/routes/media.routes.ts`
> - `src/http/routes/categories.routes.ts`
> - `src/http/routes/users.routes.ts`
> - `src/http/routes/deferred-grants.routes.ts`
> - `src/http/routes/grant-mirror.routes.ts`
> - `src/http/routes/relationships.routes.ts`
>
> Related docs:
>
> - `docs/003_entity-classes-and-oxlint-arch-linting.md`

## Table Of Contents

- [1. Goal](#1-goal)
- [2. System Summary](#2-system-summary)
- [3. Current-State Findings](#3-current-state-findings)
- [4. Target Model](#4-target-model)
- [5. Architecture Decisions](#5-architecture-decisions)
- [6. Edge Cases And Failure Modes](#6-edge-cases-and-failure-modes)
- [7. Definition Of Done](#7-definition-of-done)
- [8. Final Model](#8-final-model)
- [9. Additional Domain Concepts For Extraction](#9-additional-domain-concepts-for-extraction)
  - [9.1 CRUD Use Cases (GET / UPDATE / DELETE)](#91-crud-use-cases-get--update--delete)
  - [9.2 Idempotent Create Workflow](#92-idempotent-create-workflow)
  - [9.3 ReBAC Policy Base](#93-rebac-policy-base)
  - [9.4 Entity Base Class Skeleton](#94-entity-base-class-skeleton)
  - [9.5 Route Handler Registration](#95-route-handler-registration)
  - [9.6 Summary](#96-summary)

## 1. Goal

Eliminate the duplicated use case orchestration between resource-specific publish/unpublish workflows while keeping entity-specific mutation logic where it belongs — inside the domain entity. The result should be a single generic `PublishUseCase` and `UnpublishUseCase` that any resource can opt into via a thin adapter, with no change to route ergonomics or API contracts.

This document also surveys the full codebase for other domain concepts that share the same structural duplication and could benefit from the same plugin/adapter treatment. Each candidate is described with its current duplication count, the variable parts, and a recommended generic shape.

## 2. System Summary

Currently two resources (`Post`, `Media`) each have:

- `publish()`/`unpublish()` methods on their entity class
- `canPublish()`/`canUnpublish()` methods on their policy class (both delegate to `canUpdate()`)
- A dedicated use case class that follows the exact same 4-step flow: `findById` → `assertAllowed(policy)` → `entity.publish()` → `repository.save(entity)`
- A `POST /{resource}/{id}/publish` and `POST /{resource}/{id}/unpublish` route

The routes are HTTP boilerplate, the policies are structurally identical in delegation pattern, and the use cases are pure boilerplate. Only the entity mutation and the policy relation differ per resource.

## 3. Current-State Findings

### 3.1 Relevant Files

- `src/application/posts/publish-post.usecase.ts` — 22 lines, boilerplate orchestration
- `src/application/posts/unpublish-post.usecase.ts` — 22 lines, boilerplate orchestration
- `src/application/media/publish-media.usecase.ts` — 24 lines, boilerplate orchestration
- `src/application/media/unpublish-media.usecase.ts` — 24 lines, boilerplate orchestration
- `src/domain/posts/post.policy.ts` — lines 42-48: `canPublish`/`canUnpublish` both delegate to `canUpdate`
- `src/domain/media/media.policy.ts` — lines 44-50: `canPublish`/`canUnpublish` both delegate to `canUpdate`
- `src/domain/posts/post.entity.ts` — lines 82-96: `publish()`/`unpublish()` entity logic
- `src/domain/media/media.entity.ts` — lines 128-137: `publish()`/`unpublish()` entity logic

### 3.2 Current Behavior

Post publish flow (`src/application/posts/publish-post.usecase.ts`):
```
findById → NotFoundError check → assertAllowed(policy.canPublish) → post.publish() → repository.save(post)
```

Media publish flow (`src/application/media/publish-media.usecase.ts`):
```
findById → NotFoundError check → assertAllowed(policy.canPublish) → media.publish() → repository.update(media)
```

The two differences across the four files:

1. **Repository method signature**: `PostRepository.save(post): Promise<void>` vs `MediaRepository.update(media): Promise<Media>` — minor return type variance, both persist the mutated entity.
2. **Entity type**: `Post` vs `Media` — the entity's own `publish()` and `unpublish()` already encode different domain semantics.

### 3.3 Current Problems

- Adding a third resource (e.g. `pages`, `recipes`, `events`) requires writing 4 nearly identical files.
- The use cases contribute no domain value — they are pure mechanical orchestration.
- Policy `canPublish`/`canUnpublish` are themselves boilerplate delegates to `canUpdate` — they exist only to satisfy the use case's method call contract.
- The duplication is invisible to linting (fallow is configured to suppress duplicate-block in routes, not in use cases).

## 4. Target Model

### 4.1 New Domain Contract: `PublishManager<T>`

A domain interface in `src/domain/publishing/` that captures the variable parts of the orchestration:

```ts
interface PublishManager<T extends { publish(): void; unpublish(): void }> {
  findById(id: string): Promise<T | null>;
  save(entity: T): Promise<void>;
  canPublish(actor: Actor, entity: T): Promise<boolean>;
  canUnpublish(actor: Actor, entity: T): Promise<boolean>;
}
```

### 4.2 Generic Use Cases

Two generic use cases in `src/application/publishing/`:

- `PublishUseCase<T>` — one `execute({ actor, id })` that calls `manager.findById`, `manager.canPublish`, `entity.publish()`, `manager.save`.
- `UnpublishUseCase<T>` — same flow with `unpublish` and `canUnpublish`.

### 4.3 Resource Adapters

One adapter per resource in `src/infrastructure/publishing/` that implements `PublishManager<T>` by composing the existing repository + policy. For example:

- `PostPublishManager` wraps `PostRepository` + `PostPolicy`
- `MediaPublishManager` wraps `MediaRepository` + `MediaPolicy`

### 4.4 Routes Stay The Same

Routes keep the same `POST /posts/{id}/publish` signature. The handler changes from:

```ts
c.get("container").posts.publish.execute({ actor, postId: params.id })
```

to:

```ts
c.get("container").publish.post.execute({ actor, id: params.id })
```

Or, if per-resource naming is preferred for clarity:

```ts
c.get("container").posts.publish.execute({ actor, id: params.id })
```

(The `id` param name normalizes to `id` instead of `postId`/`mediaId` since the generic use case doesn't know the resource type.)

### 4.5 Existing Policy Methods Become Optional

`PostPolicy.canPublish` / `PostPolicy.canUnpublish` can be removed since the adapter delegates to `canUpdate` internally — or kept as explicit pass-through if preferred for readability. The adapter is the single point of delegation.

## 5. Architecture Decisions

### 5.1 Recommended: Generic Use Case + Resource Adapter

The generic `PublishUseCase<T>` + per-resource `PublishManager<T>` adapter keeps the orchestration centralized while letting each resource define its own entity semantics and policy relation.

**Why this fits the codebase:**

- Clean layer boundaries are preserved: domain (`PublishManager` interface + `Publishable` structural type), application (generic use case), infrastructure (adapter implementations).
- No change to entities themselves — `publish()`/`unpublish()` stay exactly where they are.
- Composition wiring becomes simpler — one use case instantiation per resource adapter instead of one use case per action per resource.
- Adding a third resource is one new adapter class instead of 4 files.
- The pattern mirrors the existing `CrudAdapter` philosophy: a central reusable driver with resource-specific callback/parameterization at the edges.

**Naming options** (all equivalent, choose one):

| Name | Rationale |
|------|-----------|
| `PublishManager` | Manager is the codebase convention (the skill doc uses "PublishManager") |
| `PublishAdapter` | Adapter is the Gang of Four term for what it does — wrap a specific resource |
| `PublishPort` | Ports & Adapters / Hexagonal vocabulary |

### 5.2 Rejected: Trait / Mixin

Entity-level trait (`Publishable`) that auto-generates `publish()`/`unpublish()` from field configuration would require a new abstraction layer inside entity classes. The existing entities have very different publish semantics (Post flips `status` + stamps `publishedAt`; Media requires `status === "ready"` then flips `visibility`). A trait cannot capture this without becoming as complex as the entities themselves. Entity mutation logic should stay explicit.

### 5.3 Rejected: Event-Driven Publish

An event bus approach (`PublishRequested` event → handler per resource) would decouple the route from the logic but would add async indirection without benefit: publish/unpublish are synchronous, caller-facing operations that return the updated entity. Event-driven adds no value here and breaks the request-response contract.

### 5.4 Rejected: Keep As-Is

Acceptable for 2 resources, but the pattern will compound with each new collection. The cost of the generic approach is one interface + two use case classes + one infrastructure directory — a fixed cost that pays for itself at the third resource.

### 5.5 Open Question: Use Case Identity

Should the composition container expose:

- `c.get("container").publish.post.execute(...)` — centralized publish namespace
- `c.get("container").posts.publish.execute(...)` — per-resource publish namespace (current style)

The latter preserves existing route handler patterns. The former avoids namespace collision risks. Either works — the document assumes per-resource for minimal route disruption.

## 6. Edge Cases And Failure Modes

- **Entity not found**: Generic use case throws `NotFoundError` — identical to current behavior. The error message should be dynamic (`"${resourceName} not found"`) or accept a resource label in the adapter.
- **Policy deny**: `assertAllowed` throws — no change from current behavior.
- **Entity variant persistence**: `PostRepository.save()` returns `void`, `MediaRepository.update()` returns `Media`. The adapter's `save()` method normalizes to `Promise<void>` by discarding the return value. No caller uses the return value today.
- **Multiple resources with the same `id` param**: Generic use case uses `params.id` (not `params.postId`/`params.mediaId`). Route handlers that call the generic use case must pass `id` instead of the resource-specific key.

## 7. Definition Of Done

- `PublishManager<T>` interface exists in `src/domain/publishing/publish-manager.ts`
- `PublishUseCase<T>` and `UnpublishUseCase<T>` exist in `src/application/publishing/`
- `PostPublishManager` and `MediaPublishManager` adapters exist in `src/infrastructure/publishing/`
- Existing per-resource publish/unpublish use case files are removed
- Routes are updated to call generic use cases via adapters
- Composition wiring updated to register adapters and generic use cases
- All existing publish/unpublish tests pass without modification to test assertions
- `pnpm lint`, `pnpm typecheck`, `pnpm test` pass
- `pnpm advise` shows no new findings (or findings are auto-suppressed per `AGENTS.md` policy)

## 8. Final Model

```
src/domain/publishing/publish-manager.ts       # PublishManager<T> interface
src/application/publishing/publish.usecase.ts   # PublishUseCase<T>
src/application/publishing/unpublish.usecase.ts # UnpublishUseCase<T>
src/infrastructure/publishing/post-publish-manager.ts   # PostPublishManager
src/infrastructure/publishing/media-publish-manager.ts  # MediaPublishManager
```

Deleted files:
- `src/application/posts/publish-post.usecase.ts`
- `src/application/posts/unpublish-post.usecase.ts`
- `src/application/media/publish-media.usecase.ts`
- `src/application/media/unpublish-media.usecase.ts`

The 8 existing files collapse to 5 new files (3 of which are pure orchestration). Each new resource adds 1 adapter file instead of 4 use case files. Entity mutation logic and policy authorization rules remain unchanged.

## 9. Additional Domain Concepts For Extraction

The publish/unpublish pattern is not the only structural duplication in this codebase. A full survey of every use case, policy, entity, and route file reveals five more candidates that follow the same shape: **identical orchestration, differing only in entity type, policy relation, or field names.**

Each candidate below follows the same template: current duplication → variable parts → recommended generic shape.

---

### 9.1 CRUD Use Cases (GET / UPDATE / DELETE)

**Current duplication:**

| Operation | File count | Files |
|-----------|-----------|-------|
| GET by ID | 6 | `get-post`, `get-media`, `get-category`, `get-user`, `get-deferred-grant`, `get-grant-mirror` |
| UPDATE | 6 | `update-post`, `update-media`, `update-category`, `update-user`, `update-deferred-grant`, `update-grant-mirror` |
| DELETE | 7 | `delete-post`, `delete-media`, `delete-category`, `delete-user`, `delete-deferred-grant`, `delete-grant-mirror`, `delete-relationship` |

**Identical orchestration (GET):**
```
findById → NotFoundError → assertAllowed(policy.canRead) → return entity
```

**Identical orchestration (UPDATE):**
```
findById → NotFoundError → assertAllowed(policy.canUpdate) → entity.update(input) → repo.save(entity)
```

**Identical orchestration (DELETE):**
```
assertAllowed(policy.canDelete) → repo.delete(id) → throw NotFoundError if not found
```

**Variable parts:**
- Entity type `T`
- Policy method name (`canRead` / `canUpdate` / `canDelete`)
- Repository method signatures (`save` vs `update`, `void` vs `Entity` return)
- Resource label in error messages

**Recommended generic shape:**

```ts
// src/domain/crud/crud-manager.ts
interface CrudManager<T> {
  findById(id: string): Promise<T | null>;
  save(entity: T): Promise<void>;
  canRead(actor: Actor | null, entity: T): Promise<boolean>;
  canUpdate(actor: Actor, entity: T): Promise<boolean>;
  canDelete(actor: Actor, entity: T): Promise<boolean>;
}

// src/application/crud/get.usecase.ts
class GetUseCase<T> {
  constructor(private manager: CrudManager<T>) {}
  async execute({ actor, id }: { actor: Actor | null; id: string }) { ... }
}

// src/application/crud/update.usecase.ts
class UpdateUseCase<T, TUpdate> {
  constructor(private manager: CrudManager<T>) {}
  async execute({ actor, id, input }: { actor: Actor; id: string; input: TUpdate }) { ... }
}

// src/application/crud/delete.usecase.ts
class DeleteUseCase<T> {
  constructor(private manager: CrudManager<T>) {}
  async execute({ actor, id }: { actor: Actor; id: string }) { ... }
}
```

**Impact:** 19 files → 3 generic classes + 6 adapters.

---

### 9.2 Idempotent Create Workflow

**Current duplication:** 4 files (`CreatePost`, `CreateMediaUpload`, `CreateCategory`, `CreateUser`) share the same idempotency subroutine quartet:

| Subroutine | Purpose |
|------------|---------|
| `executeWithIdempotency(...)` | Wraps entity creation in idempotency workflow |
| `handleIdempotentInsertConflict(...)` | Catches unique constraint violation, re-reads row |
| `replayExisting(...)` | Returns cached success for a matched hash |
| `deserializeXxxSnapshot(...)` | Parses ISO date strings back into `Date` objects |

Each is ~15 lines of 100% structurally identical code across all 4 resources. Only the entity type, the `CreateProps` type, the route constant, and the snapshot serializer differ.

**Recommended generic shape:**

```ts
// src/application/idempotent-create/idempotent-create.usecase.ts
class IdempotentCreateUseCase<TEntity, TCreate> {
  constructor(
    private readonly repo: IdempotentCreateRepository<TEntity>,
    private readonly idempotencyRepo: IdempotencyRepository,
    private readonly idempotencyConfig: { route: string },
  ) {}

  // buildEntity and serializeSnapshot are injected via the repository adapter
  async execute(params: { actor: Actor; idempotencyKey?: string; input: TCreate }) { ... }

  private executeWithIdempotency(...) { ... }
  private handleIdempotentInsertConflict(...) { ... }
  private replayExisting(...) { ... }
}
```

Where `IdempotentCreateRepository<TEntity>` extends `CrudManager` with:

```ts
interface IdempotentCreateRepository<TEntity> extends CrudManager<TEntity> {
  buildEntity(actorId: string, input: TCreate): TEntity;
  serializeSnapshot(entity: TEntity): Record<string, unknown>;
  create(entity: TEntity): Promise<void>;
}
```

**Impact:** Eliminates the 4 duplicated subroutines from each create use case. The per-resource adapter provides `buildEntity` and `serializeSnapshot` — the only parts that actually differ.

---

### 9.3 ReBAC Policy Base

**Current duplication:** `PostPolicy` and `MediaPolicy` have identical method surfaces:

| Method | PostPolicy | MediaPolicy |
|--------|-----------|-------------|
| `canCreate` | `actor?.type === "user"` | `actor?.type === "user"` |
| `canRead` | public if `published`, else `author` relation | public if `ready + public`, else `owner` relation |
| `canUpdate` | `author` ReBAC | `owner` ReBAC |
| `canDelete` | delegates to `canUpdate` | delegates to `canUpdate` |
| `canPublish` | delegates to `canUpdate` | delegates to `canUpdate` |
| `canUnpublish` | delegates to `canUpdate` | delegates to `canUpdate` |

Three things vary:
1. Relation name (`"author"` vs `"owner"`)
2. Object type (`"post"` vs `"media"`)
3. Public-read guard condition (`post.status === "published"` vs `media.visibility === "public" && media.status === "ready"`)

**Recommended generic shape:**

```ts
// src/domain/authz/rebac-policy.ts
class ReBACPolicy<TEntity> {
  constructor(
    private readonly relationships: RelationshipRepository,
    private readonly config: {
      relation: string;
      objectType: string;
      canReadPublic: (entity: TEntity) => boolean;
    },
  ) {}

  canCreate(actor: Actor | null) { return Promise.resolve(actor?.type === "user"); }
  canRead(actor: Actor | null, entity: TEntity) { ... }
  canUpdate(actor: Actor | null, entity: TEntity) { ... }
  canDelete(actor: Actor | null, entity: TEntity) { return this.canUpdate(actor, entity); }
  canPublish(actor: Actor | null, entity: TEntity) { return this.canUpdate(actor, entity); }
  canUnpublish(actor: Actor | null, entity: TEntity) { return this.canUpdate(actor, entity); }
}
```

Usage:

```ts
const postPolicy = new ReBACPolicy<Post>(relationships, {
  relation: "author",
  objectType: "post",
  canReadPublic: (post) => post.status === "published",
});
```

**Impact:** Eliminates 2 full policy classes (~50 lines each). A resource that needs custom policy logic (like `UserPolicy` with admin checks) can still write a bespoke class and compose or extend `ReBACPolicy`.

---

### 9.4 Entity Base Class Skeleton

**Current duplication:** 6 of 7 entities (`Post`, `Media`, `Category`, `User`, `DeferredGrant`, `GrantMirror`) follow this exact skeleton:

```ts
class Xxx {
  private constructor(private props: XxxProps) {}
  static create(input: CreateXxxProps): Xxx { ... }
  static reconstitute(props: XxxProps): Xxx { ... }
  // getters for all fields
  update(input: UpdateXxxProps): void { ... if (...) this.props.field = input.field; this.touch(); }
  toSnapshot(): XxxProps { ... }
  private touch() { this.props.updatedAt = new Date(); }
}
```

This is a **structural** pattern, not a behavioral abstraction — no runtime polymorphism between entity types. However, codifying it as a shared base class (or a creation helper) would:

- Enforce consistency for new entities
- Eliminate the `touch()` method duplication (currently inlined in Post, private method in Category/User/Media)
- Standardize `toSnapshot()` cloning behavior

**Caveat:** A shared base class with TypeScript generics for `Props` / `CreateProps` / `UpdateProps` is possible but adds type complexity. This is lower priority than the use case or policy extraction.

---

### 9.5 Route Handler Registration

**Current duplication:** Every route file repeats the same handler body structure:

```
LIST:   c.req.valid("query") → container.xxx.list.execute(...) → presentXxx → 200
CREATE: requireActor + c.req.valid("header") + c.req.valid("json") → container.xxx.create.execute(...) → presentXxx → 201
GET:    c.req.valid("param") → container.xxx.get.execute(...) → presentXxx → 200
UPDATE: requireActor + c.req.valid("param") + c.req.valid("json") → container.xxx.update.execute(...) → presentXxx → 200
DELETE: requireActor + c.req.valid("param") → container.xxx.delete.execute(...) → 204
```

Only the container path segment (`posts` / `media` / `categories` / etc.), the resource ID param name, and the presenter function vary.

**Recommended shape:**

```ts
// src/http/helpers/register-crud-routes.ts
function registerCrudRoutes<T>(
  app: OpenAPIHono,
  resource: {
    name: string;                    // "posts"
    idParam: string;                 // "id"
    tags: string[];
    listSchema: { query: ZodSchema };
    createSchema: { header: ZodSchema; json: ZodSchema };
    updateSchema: { param: ZodSchema; json: ZodSchema };
    deleteSchema: { param: ZodSchema };
    responseSchema: ZodSchema;
    containerPath: string;           // "posts"
    presenter: (entity: T) => unknown;
  },
) { ... }
```

The helper registers all 5 routes with their OpenAPI schemas and handler bodies. A route file shrinks from ~160 lines to ~20 lines of configuration.

**Trade-off:** OpenAPI schema definitions (`createRoute` + `postXxxRoute` constants) still live in the route file for explicit documentation. Only the handler registration is deduplicated. This is lower priority than use case extraction since routes change less frequently.

---

### 9.6 Summary

| Concept | Files today | Generic classes | Adapters needed | Priority |
|---------|-----------|-----------------|-----------------|----------|
| Publish/Unpublish | 4 use cases | 2 | 2 per resource | High (in progress) |
| CRUD (GET/UPDATE/DELETE) | 19 use cases | 3 | 1 per resource | **Highest** |
| Idempotent Create | 4 use cases | 1 | 1 per resource | High |
| ReBAC Policy | 2 policies | 1 base class | config object per resource | Medium |
| Entity base skeleton | 6 entities | 1 base class | none | Low |
| Route registration | 6 route files | 1 helper | config object per resource | Low |

**Recommendation order:**
1. CRUD use cases — biggest reduction (19 files), simplest abstraction (one `CrudManager` interface)
2. Idempotent create — most complex duplication, highest maintenance cost
3. ReBAC policy base — small but clean win
4. Entity base / Route registration — nice-to-haves after the main extraction is done

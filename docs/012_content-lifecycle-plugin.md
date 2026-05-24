# Content Lifecycle Plugin

> Status: implementation-grade proposal — ready for handoff
>
> Date: 2026-05-25
>
> Scope:
>
> - `/home/quanghuy1242/pjs/content-api`
>
> Source docs:
>
> - `docs/architecture.md`
> - `docs/005_publish-lifecycle-adapter.md` — superseded by this document
> - `docs/007_content-iam-policy-binding-model.md`
> - `docs/009_book-resource-hierarchy-and-collaboration-plan.md`
> - `docs/012_site-config-collection.md` — depends on this plugin
> - `.claude/skills/content-api-architecture/SKILL.md`
> - `.claude/skills/content-iam-usage/SKILL.md`
> - `src/domain/posts/post.entity.ts`
> - `src/domain/books/book.entity.ts`
> - `src/domain/iam/content-permission.ts`
> - `src/domain/iam/content-policy.ts`
> - `src/domain/iam/resource-loader.ts`
> - `src/application/posts/publish-post.usecase.ts`
> - `src/application/posts/unpublish-post.usecase.ts`
> - `src/infrastructure/persistence/crud-adapter.ts`
> - `src/infrastructure/repositories/drizzle-post.repository.ts`
> - `src/infrastructure/repositories/drizzle-book-create.workflow.ts`
> - `src/composition/create-request-container.ts`
>
> Related docs:
>
> - `docs/012_site-config-collection.md` — first new resource that adopts this plugin from day one
>
> Assumptions:
>
> - Content IAM (`docs/007`) is fully operational. `ContentPolicy.can(actor, permission, resource)` is the only authorization channel for lifecycle transitions.
> - Cloudflare Workers Cron Triggers are available. There is no Queue or Durable Object dependency in Level 1.
> - D1 is the only persistence layer. SQLite has no row-level locks, so concurrency safety is built on compare-and-set `UPDATE … WHERE status = ?` statements, not on application-side coordination.
> - Level 1 (status machine + scheduling) is the only release target. Level 2 (draft/live split) and Level 3 (versioning) are designed in §11 as forward-compatible extensions and are not implemented now.
> - `Media` (`src/domain/media/media.entity.ts`) keeps its own pipeline statuses (`pending_upload → processing → ready → failed/expired`) and its `visibility` flag. It is intentionally **not** wrapped by this plugin.
> - The actor type used throughout this document is `Actor` from `src/domain/auth/actor.ts`. There is no `ContentActor` type; do not invent one.

## Table Of Contents

- [1. Goal](#1-goal)
- [2. System Summary](#2-system-summary)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 Relevant Files](#31-relevant-files)
  - [3.2 Current Lifecycle Per Resource](#32-current-lifecycle-per-resource)
  - [3.3 Current Problems](#33-current-problems)
- [4. Target Model](#4-target-model)
  - [4.1 Lifecycle Status Machine](#41-lifecycle-status-machine)
  - [4.2 Domain Contracts](#42-domain-contracts)
  - [4.3 Generic Application Use Cases](#43-generic-application-use-cases)
  - [4.4 Per-Resource Adapters](#44-per-resource-adapters)
  - [4.5 Repository Contract — Compare-And-Set Publish](#45-repository-contract--compare-and-set-publish)
  - [4.6 Cron Worker — Scheduled Publish Driver](#46-cron-worker--scheduled-publish-driver)
  - [4.7 Content IAM — Permission Catalog And Role Wiring](#47-content-iam--permission-catalog-and-role-wiring)
  - [4.8 Entity Migrations](#48-entity-migrations)
  - [4.9 Database Migration](#49-database-migration)
  - [4.10 HTTP API Surface](#410-http-api-surface)
  - [4.11 Module Layout](#411-module-layout)
- [5. Architecture Decisions](#5-architecture-decisions)
  - [5.1 Interface-Based Plugin, Not Mixin Or Event Bus](#51-interface-based-plugin-not-mixin-or-event-bus)
  - [5.2 Compare-And-Set Publish Owned By The Repository](#52-compare-and-set-publish-owned-by-the-repository)
  - [5.3 Generic Status Update Routes Cannot Change Lifecycle](#53-generic-status-update-routes-cannot-change-lifecycle)
  - [5.4 Dedicated `*.archive` Permissions](#54-dedicated-archive-permissions)
  - [5.5 Schedule Reuses The Publish Permission](#55-schedule-reuses-the-publish-permission)
  - [5.6 Cron Has No Actor — Authorization Is Checked At Schedule Time](#56-cron-has-no-actor--authorization-is-checked-at-schedule-time)
  - [5.7 Archived Is Terminal In Level 1](#57-archived-is-terminal-in-level-1)
  - [5.8 Media Is Excluded](#58-media-is-excluded)
  - [5.9 Supersedes Docs/005](#59-supersedes-docs005)
  - [5.10 Rejected Options](#510-rejected-options)
- [6. Resource Coverage Matrix](#6-resource-coverage-matrix)
  - [6.1 Post](#61-post)
  - [6.2 Book](#62-book)
  - [6.3 SiteConfig](#63-siteconfig)
  - [6.4 Chapter](#64-chapter)
  - [6.5 Excluded](#65-excluded)
- [7. Implementation Strategy](#7-implementation-strategy)
- [8. Migration And Rollout](#8-migration-and-rollout)
- [9. Edge Cases And Failure Modes](#9-edge-cases-and-failure-modes)
- [10. Implementation Backlog](#10-implementation-backlog)
  - [LCY-A. Domain Contracts And Generic Use Cases](#lcy-a-domain-contracts-and-generic-use-cases)
  - [LCY-B. Content IAM Permission And Role Updates](#lcy-b-content-iam-permission-and-role-updates)
  - [LCY-C. Database Migration 0007_lifecycle_fields](#lcy-c-database-migration-0007_lifecycle_fields)
  - [LCY-D. Post Lifecycle Adoption](#lcy-d-post-lifecycle-adoption)
  - [LCY-E. Book Lifecycle Adoption](#lcy-e-book-lifecycle-adoption)
  - [LCY-F. Scheduled Publish Cron Worker](#lcy-f-scheduled-publish-cron-worker)
  - [LCY-G. Documentation And Cleanup](#lcy-g-documentation-and-cleanup)
- [11. Future Backlog](#11-future-backlog)
  - [11.1 Level 2 — Draft/Live Split](#111-level-2--draftlive-split)
  - [11.2 Level 3 — Version History](#112-level-3--version-history)
  - [11.3 Higher-Reliability Scheduling](#113-higher-reliability-scheduling)
- [12. Test And Verification Plan](#12-test-and-verification-plan)
- [13. Definition Of Done](#13-definition-of-done)
- [14. Final Model](#14-final-model)

## 1. Goal

Replace the per-resource publish/unpublish use cases with a single pluggable lifecycle system that any new resource can opt into by implementing one entity interface and one adapter. The system covers four transitions — `publish`, `unpublish`, `schedule`, `archive` — through generic use cases that delegate authorization and persistence to per-resource adapters.

Concrete outcomes after this release:

- `Post`, `Book`, and `SiteConfig` (the new resource introduced in `docs/012`) all use the same four lifecycle use cases.
- Adding a fifth resource costs one entity interface implementation + one adapter file + one migration. No new application or domain code is required.
- Authors can schedule a publish at a future time; an hourly cron promotes overdue items.
- Lifecycle state transitions are race-safe under D1's lack of row locking via repository-level compare-and-set.
- Generic `PATCH /{resources}/{id}` routes can no longer mutate lifecycle status. Status changes happen only through dedicated lifecycle endpoints.

Non-goals for this release (covered in `§11 Future Backlog`):

- Draft/live split: editing a published row currently mutates the live record in place. There is no working copy.
- Full version history with rollback.
- Sub-hour scheduling precision.
- Wrapping `Media`. Media has a processing pipeline + visibility flag and stays on its own model.
- Tag, comment, bookmark publication. Those are not editorial publishable content.

## 2. System Summary

Each lifecycle-capable resource exposes four verbs in addition to its CRUD routes:

```text
POST /{resources}/{id}/publish     draft|scheduled    → published
POST /{resources}/{id}/unpublish   scheduled|published → draft
POST /{resources}/{id}/schedule    draft              → scheduled  (body: { scheduledAt })
POST /{resources}/{id}/archive     draft|scheduled|published → archived  (terminal)
```

Each verb maps to one generic use case. The use case calls one `LifecycleManager<T>` adapter, which the composition container wires per resource.

### Synchronous manual publish path

```text
Hono route handler
  └─▶ container.<resource>.publish.execute({ actor, id })          PublishUseCase<T>
        ├─ requireContentScope(actor, "content:write")
        ├─ manager.findById(id)                                    repo.findById
        ├─ manager.canPublish(actor, entity)                       ContentPolicy.can("{resource}.publish", ref)
        ├─ entity.publish()                                        domain invariant guard
        └─ manager.save(entity)                                    repo.save
```

### Scheduled publish driver (hourly cron)

The cron is a **separate Cloudflare Worker** deployed alongside the API Worker, living under `workers/scheduled-publish/` (sibling of `workers/media-processor/`). It has its own `wrangler.jsonc`, its own `tsconfig.json`, and shares the D1 binding with the API Worker. The API Worker itself does NOT export a `scheduled` handler.

```text
Cloudflare Cron Trigger ("0 * * * *") on the workers/scheduled-publish Worker
  └─▶ workers/scheduled-publish/src/index.ts → exports default { scheduled }
        managers = buildScheduledLifecycleManagers(env)         from src/composition/scheduled-lifecycle.ts
        runScheduledPublish(managers, now):
          for each manager:
            ids = manager.findScheduledReadyIds(now, limit=500) indexed SELECT
            for each id in ids:
              transitioned = manager.publishScheduledReady(id, now)  conditional UPDATE
              // no entity load, no canPublish check — see §5.2 and §5.6
```

## 3. Current-State Findings

### 3.1 Relevant Files

| File | Role |
|---|---|
| `src/domain/posts/post.entity.ts` | `PostStatus = "draft" | "published"`; has `publish()`, `unpublish()`, `publishedAt`. |
| `src/domain/books/book.entity.ts` | `BookStatus = "draft" | "published" | "archived"`; no `publish()` — status changes go through `update()` and an exposed `status` field on `UpdateBookProps`. |
| `src/domain/media/media.entity.ts` | Independent state machine; explicit non-target of this plugin. |
| `src/domain/iam/content-permission.ts` | Defines `ContentPermissionKey`. Has `post.publish`, `chapter.publish`; no `book.publish`, no `*.archive` keys. |
| `src/domain/iam/content-policy.ts` | `ContentPolicy.can(...)` signature taking `Actor | null`. |
| `src/domain/iam/resource-loader.ts` | Resource ref helpers: `postResource`, `bookResource`, `organizationResource`. |
| `src/application/posts/publish-post.usecase.ts` | 28-line use case, `post.publish` permission, calls `posts.save`. |
| `src/application/posts/unpublish-post.usecase.ts` | Same shape. |
| `src/application/media/publish-media.usecase.ts` | Calls `media.update`; kept as-is (Media is excluded). |
| `src/application/media/unpublish-media.usecase.ts` | Same; kept as-is. |
| `src/infrastructure/db/schema.ts` | `posts.status`, `posts.publishedAt`; `books.status`; **no** `scheduled_at` or `archived_at` columns anywhere. |
| `src/infrastructure/persistence/crud-adapter.ts` | `buildUpdate(...)`, `updateRow(...)`, `buildInsert(...)`. Workflows compose statements into `db.batch(...)`. |
| `src/infrastructure/repositories/drizzle-post.repository.ts` | Reference repository pattern. |
| `src/composition/create-request-container.ts` | Per-request DI graph. Where adapters and use cases must be registered. |
| `src/http/routes/posts.routes.ts` | Existing `POST /posts/{id}/publish` and `POST /posts/{id}/unpublish` routes; reference for new schedule/archive routes. |
| `drizzle/0006_content_resources_org_scope.sql` | Latest existing migration; the next number is `0007`. |

### 3.2 Current Lifecycle Per Resource

| Resource | Status values | Publish? | scheduledAt? | archivedAt? | Authz key |
|---|---|---|---|---|---|
| Post | `draft \| published` | `publish()`, `unpublish()` on entity | no | no | `post.publish` |
| Book | `draft \| published \| archived` | no — `update({ status })` only | no | no | `book.update` |
| Media | `pending_upload \| processing \| ready \| failed \| expired` + `visibility` | `publish-media.usecase.ts` flips visibility | no | no | `media.update` |
| Chapter | not implemented | — | — | — | `chapter.publish` already in catalog |
| SiteConfig | not implemented (this doc + `docs/012`) | — | — | — | — |

### 3.3 Current Problems

1. **Boilerplate.** `publish-post.usecase.ts` and `unpublish-post.usecase.ts` are structurally identical 28-line files. Each new publishable resource currently requires another two.
2. **Status escape hatch on Book.** `UpdateBookProps` includes `status` ([src/domain/books/book.entity.ts:17](../src/domain/books/book.entity.ts#L17)). A caller with `book.update` can flip `draft → published → archived` through the generic PATCH route, bypassing any future publish-only authorization or invariant.
3. **No scheduling.** Authors cannot set "publish at 09:00 tomorrow". There is no `scheduled_at` column, no cron handler, no schedule use case.
4. **No first-class archive transition.** `Book.archive` is achievable through generic update; `Post.archive` is impossible. There is no `*.archive` permission key.
5. **Permission catalog gaps.** Catalog has `post.publish` and `chapter.publish` but no `book.publish`. Authorization is inconsistent across resource types.
6. **D1 has no row locks.** Any future "load → mutate → save" cron approach is exposed to lost-update races. Compare-and-set must be designed in from the start.
7. **`docs/005` is stale.** Its `PublishManager<T>` predates the Content IAM model in `docs/007` and covers only two transitions.

## 4. Target Model

### 4.1 Lifecycle Status Machine

```text
          ┌──────────────────────────────┐
          │                              │
          ▼                              │
       [ draft ] ──schedule──▶ [ scheduled ] ──cron-fires──┐
          │                       │                       │
          │ publish               │ unpublish             │
          ▼                       ▼                       ▼
       [ published ] ◀───────── [ draft ] ◀───────── [ published ]
          │
          │ unpublish
          ▼
       [ draft ]

       Any non-archived state ──archive──▶ [ archived ]   (terminal)
```

Allowed transitions (rejected transitions throw `ConflictError`):

| From | To | Trigger |
|---|---|---|
| `draft` | `published` | `publish()` |
| `draft` | `scheduled` | `schedule(scheduledAt)` (must be `> now`) |
| `scheduled` | `published` | `publish()` (cron or manual) |
| `scheduled` | `draft` | `unpublish()` (cancel schedule) |
| `published` | `draft` | `unpublish()` |
| `draft` | `archived` | `archive()` |
| `scheduled` | `archived` | `archive()` |
| `published` | `archived` | `archive()` |
| `archived` | *(any)* | rejected — terminal |
| `published` | `published` | rejected — already published |

Adapters MAY add resource-specific guardrails on top (e.g. SiteConfig refuses to archive the currently-active config).

### 4.2 Domain Contracts

Two new files under `src/domain/lifecycle/`. No framework imports allowed.

```ts
// src/domain/lifecycle/lifecycle-entity.ts

export type LifecycleStatus = "draft" | "scheduled" | "published" | "archived";

/**
 * Structural contract for entities that opt into the lifecycle plugin.
 * Entities own the state machine guard; the application layer never
 * mutates `lifecycleStatus` directly.
 */
export interface LifecycleCapable {
  readonly id: string;
  readonly lifecycleStatus: LifecycleStatus;
  readonly publishedAt: Date | null;
  readonly scheduledAt: Date | null;
  readonly archivedAt: Date | null;

  /** draft|scheduled → published. ConflictError if already published or archived. */
  publish(): void;
  /** scheduled|published → draft. ConflictError if draft or archived. */
  unpublish(): void;
  /** draft → scheduled. ConflictError if already scheduled, published, or archived. */
  schedule(scheduledAt: Date): void;
  /** any non-archived → archived. ConflictError if already archived. Terminal. */
  archive(): void;
}
```

```ts
// src/domain/lifecycle/lifecycle-manager.ts

import type { Actor } from "@/domain/auth/actor";
import type { LifecycleCapable } from "./lifecycle-entity";

/**
 * Per-resource adapter that connects a `LifecycleCapable` entity to:
 *   - its persistence (findById, save, scheduled-ready scan, compare-and-set publish)
 *   - its Content IAM authorization vocabulary
 *
 * The generic use cases only see this interface. They never import a
 * specific repository, entity, or permission key.
 */
export interface LifecycleManager<T extends LifecycleCapable> {
  /** Short label used in error messages: "post", "book", "site_config". */
  readonly resourceType: string;

  findById(id: string): Promise<T | null>;
  save(entity: T): Promise<void>;

  /** Authorization checks. Each adapter decides which permission key applies. */
  canPublish(actor: Actor, entity: T): Promise<boolean>;
  canUnpublish(actor: Actor, entity: T): Promise<boolean>;
  canSchedule(actor: Actor, entity: T): Promise<boolean>;
  canArchive(actor: Actor, entity: T): Promise<boolean>;

  /**
   * Lists IDs of entities whose schedule is overdue at `now`.
   * Used by the cron driver. Implementations return at most `limit` IDs.
   *
   * Returns IDs only; the cron driver never hydrates entities — it calls
   * publishScheduledReady on each id to perform an atomic transition.
   */
  findScheduledReadyIds(now: Date, limit: number): Promise<readonly string[]>;

  /**
   * Atomically transitions the row from `scheduled` to `published` if and
   * only if its current status is `scheduled` and `scheduled_at <= now`.
   * Returns true if the row transitioned, false otherwise (e.g. cancelled,
   * already published, or row missing).
   *
   * This is the only safe cron transition primitive under D1.
   */
  publishScheduledReady(id: string, now: Date): Promise<boolean>;
}
```

Adapter-method authorization decisions remain inside infrastructure adapters because the permission key is resource-specific. The use case is permission-key-agnostic.

### 4.3 Generic Application Use Cases

Four use cases under `src/application/lifecycle/`. They depend only on the domain contracts and shared errors.

```ts
// src/application/lifecycle/publish.usecase.ts
import { assertAllowed } from "@/domain/auth/assert-can";
import type { Actor } from "@/domain/auth/actor";
import { requireContentScope } from "@/domain/auth/scopes";
import type { LifecycleCapable } from "@/domain/lifecycle/lifecycle-entity";
import type { LifecycleManager } from "@/domain/lifecycle/lifecycle-manager";
import { NotFoundError } from "@/shared/errors";

/** draft|scheduled → published, manually triggered by an authenticated actor. */
export class PublishUseCase<T extends LifecycleCapable> {
  constructor(private readonly manager: LifecycleManager<T>) {}

  async execute(params: { actor: Actor; id: string }): Promise<T> {
    requireContentScope(params.actor, "content:write");
    const entity = await this.manager.findById(params.id);
    if (!entity) throw new NotFoundError(`${this.manager.resourceType} not found`);

    await assertAllowed(
      this.manager.canPublish(params.actor, entity),
      `You cannot publish this ${this.manager.resourceType}`,
    );

    entity.publish();
    await this.manager.save(entity);
    return entity;
  }
}
```

```ts
// src/application/lifecycle/unpublish.usecase.ts
export class UnpublishUseCase<T extends LifecycleCapable> {
  constructor(private readonly manager: LifecycleManager<T>) {}

  async execute(params: { actor: Actor; id: string }): Promise<T> {
    requireContentScope(params.actor, "content:write");
    const entity = await this.manager.findById(params.id);
    if (!entity) throw new NotFoundError(`${this.manager.resourceType} not found`);
    await assertAllowed(
      this.manager.canUnpublish(params.actor, entity),
      `You cannot unpublish this ${this.manager.resourceType}`,
    );
    entity.unpublish();
    await this.manager.save(entity);
    return entity;
  }
}
```

```ts
// src/application/lifecycle/schedule-publish.usecase.ts
import { ValidationError } from "@/shared/errors";

export class SchedulePublishUseCase<T extends LifecycleCapable> {
  constructor(
    private readonly manager: LifecycleManager<T>,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(params: { actor: Actor; id: string; scheduledAt: Date }): Promise<T> {
    requireContentScope(params.actor, "content:write");
    if (params.scheduledAt.getTime() <= this.clock().getTime()) {
      throw new ValidationError("scheduledAt must be in the future");
    }
    const entity = await this.manager.findById(params.id);
    if (!entity) throw new NotFoundError(`${this.manager.resourceType} not found`);
    await assertAllowed(
      this.manager.canSchedule(params.actor, entity),
      `You cannot schedule this ${this.manager.resourceType}`,
    );
    entity.schedule(params.scheduledAt);
    await this.manager.save(entity);
    return entity;
  }
}
```

```ts
// src/application/lifecycle/archive.usecase.ts
export class ArchiveUseCase<T extends LifecycleCapable> {
  constructor(private readonly manager: LifecycleManager<T>) {}

  async execute(params: { actor: Actor; id: string }): Promise<T> {
    requireContentScope(params.actor, "content:write");
    const entity = await this.manager.findById(params.id);
    if (!entity) throw new NotFoundError(`${this.manager.resourceType} not found`);
    await assertAllowed(
      this.manager.canArchive(params.actor, entity),
      `You cannot archive this ${this.manager.resourceType}`,
    );
    entity.archive();
    await this.manager.save(entity);
    return entity;
  }
}
```

### 4.4 Per-Resource Adapters

Each opt-in resource adds one adapter under `src/infrastructure/lifecycle/`. The adapter is the only place where a resource-specific permission key is named.

```ts
// src/infrastructure/lifecycle/post-lifecycle-manager.ts
import type { Actor } from "@/domain/auth/actor";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import { postResource } from "@/domain/iam/resource-loader";
import type { LifecycleManager } from "@/domain/lifecycle/lifecycle-manager";
import type { Post } from "@/domain/posts/post.entity";
import type { PostRepository } from "@/domain/posts/post.repository";

export class PostLifecycleManager implements LifecycleManager<Post> {
  readonly resourceType = "post";

  constructor(
    private readonly posts: PostRepository,
    private readonly contentPolicy: ContentPolicy,
  ) {}

  findById(id: string) { return this.posts.findById(id); }
  save(entity: Post) { return this.posts.save(entity); }

  canPublish(actor: Actor, entity: Post) {
    return this.contentPolicy.can({ actor, permission: "post.publish", resource: postResource(entity) });
  }
  canUnpublish(actor: Actor, entity: Post) {
    return this.contentPolicy.can({ actor, permission: "post.publish", resource: postResource(entity) });
  }
  canSchedule(actor: Actor, entity: Post) {
    return this.contentPolicy.can({ actor, permission: "post.publish", resource: postResource(entity) });
  }
  canArchive(actor: Actor, entity: Post) {
    return this.contentPolicy.can({ actor, permission: "post.archive", resource: postResource(entity) });
  }

  findScheduledReadyIds(now: Date, limit: number) {
    return this.posts.findScheduledReadyIds(now, limit);
  }
  publishScheduledReady(id: string, now: Date) {
    return this.posts.publishScheduledReady(id, now);
  }
}
```

`BookLifecycleManager` and `SiteConfigLifecycleManager` follow the same shape with their own permission keys (see [§4.7](#47-content-iam--permission-catalog-and-role-wiring)) and resource-ref helpers. `SiteConfigLifecycleManager.canArchive` adds the "not the currently-active config" guard from `docs/012`.

### 4.5 Repository Contract — Compare-And-Set Publish

Every lifecycle-capable repository implements two new methods. Example for `PostRepository`:

```ts
// src/domain/posts/post.repository.ts (additions)
findScheduledReadyIds(now: Date, limit: number): Promise<readonly string[]>;
publishScheduledReady(id: string, now: Date): Promise<boolean>;
```

Drizzle implementation:

```ts
// src/infrastructure/repositories/drizzle-post.repository.ts (additions)
import { and, eq, lte, sql } from "drizzle-orm";

async findScheduledReadyIds(now: Date, limit: number): Promise<readonly string[]> {
  const rows = await this.crud.findRowsWhere<{ id: string }>(
    posts,
    [posts.id],
    and(eq(posts.status, "scheduled"), lte(posts.scheduledAt, now)),
    { orderBy: posts.scheduledAt, direction: "asc", limit },
  );
  return rows.map((row) => row.id);
}

async publishScheduledReady(id: string, now: Date): Promise<boolean> {
  const result = await this.crud.updateRowsConditional(posts, {
    set: {
      status: "published",
      publishedAt: now,
      scheduledAt: null,
      updatedAt: now,
    },
    where: and(eq(posts.id, id), eq(posts.status, "scheduled"), lte(posts.scheduledAt, now)),
  });
  return result.rowsAffected === 1;
}
```

This requires two additions to `CrudAdapter` (see [LCY-A](#lcy-a-domain-contracts-and-generic-use-cases) backlog):

- `findRowsWhere<Row>(table, columns, where, { orderBy, direction, limit })`: a centralized predicate-scoped multi-row read with stable ordering and limit. Required so per-resource repositories do not hand-roll Drizzle selects.
- `updateRowsConditional(table, { set, where })`: returns `{ rowsAffected: number }`. Required for compare-and-set; the existing `updateRow(table, idColumn, id, values)` cannot express a conditional `status = 'scheduled'` guard.

Both helpers are added once and reused by Book and SiteConfig adapters.

### 4.6 Cron Worker — Scheduled Publish Driver

The cron driver is a **dedicated Cloudflare Worker** at `workers/scheduled-publish/`, matching the existing `workers/media-processor/` pattern. It is a separate deployment unit with its own `wrangler.jsonc`, its own `tsconfig.json`, and its own CI deploy step. The API Worker (`src/main.ts`) is not modified.

#### 4.6.1 Worker Layout

```
workers/scheduled-publish/
  wrangler.jsonc          # name, main, triggers.crons, shared D1 binding
  tsconfig.json           # extends root tsconfig; @/* alias points at ../../src/*
  src/
    index.ts              # exports default { scheduled }
```

`workers/scheduled-publish/wrangler.jsonc`:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "content-api-scheduled-publish",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-17",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "content_api",
      "database_id": "73f94f30-cd96-464c-ba37-87c857d99d88",
      "migrations_dir": "../../drizzle"
    }
  ],
  "triggers": {
    "crons": ["0 * * * *"]
  }
}
```

`workers/scheduled-publish/tsconfig.json`:

```jsonc
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "baseUrl": "../..",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src/**/*"]
}
```

`workers/scheduled-publish/src/index.ts`:

```ts
import type { AppBindings } from "@/config/env";
import { buildScheduledLifecycleManagers, runScheduledPublish } from "@/composition/scheduled-lifecycle";

export default {
  async scheduled(event: ScheduledController, env: AppBindings, ctx: ExecutionContext) {
    const managers = buildScheduledLifecycleManagers(env);
    ctx.waitUntil(runScheduledPublish(managers, new Date(event.scheduledTime)));
  },
} satisfies ExportedHandler<AppBindings>;
```

#### 4.6.2 Shared Composition Helper

The runner and the cron-path DI graph live in `src/composition/scheduled-lifecycle.ts` so they are testable in isolation and reusable by integration tests under `tests/`. Composition is the established home for DI graphs; the cron path uses a graph without `ContentPolicy` (cron is authorless — see [§5.6](#56-cron-has-no-actor--authorization-is-checked-at-schedule-time)).

```ts
// src/composition/scheduled-lifecycle.ts
import type { AppBindings } from "@/config/env";
import { createDb } from "@/infrastructure/db/client";
import { DrizzlePostRepository } from "@/infrastructure/repositories/drizzle-post.repository";
import { DrizzleBookRepository } from "@/infrastructure/repositories/drizzle-book.repository";
// (and DrizzleSiteConfigRepository once docs/012 ships)
import { PostLifecycleManager } from "@/infrastructure/lifecycle/post-lifecycle-manager";
import { BookLifecycleManager } from "@/infrastructure/lifecycle/book-lifecycle-manager";
import type { LifecycleCapable } from "@/domain/lifecycle/lifecycle-entity";
import type { LifecycleManager } from "@/domain/lifecycle/lifecycle-manager";

const BATCH_LIMIT = 500;

/**
 * Builds the lifecycle managers required by the scheduled-publish cron.
 *
 * The cron path needs repositories + adapters but NOT ContentPolicy:
 * authorization was committed when the schedule was created (§5.6).
 * Adapters' canPublish/canArchive methods are unused by the cron driver.
 */
export function buildScheduledLifecycleManagers(env: AppBindings): readonly LifecycleManager<LifecycleCapable>[] {
  const db = createDb(env);
  return [
    new PostLifecycleManager(new DrizzlePostRepository(db), undefined as never),
    new BookLifecycleManager(new DrizzleBookRepository(db), undefined as never),
    // SiteConfigLifecycleManager added by docs/012
  ];
}

/**
 * Iterates over each lifecycle manager and atomically publishes every overdue
 * scheduled entity using compare-and-set. No entity hydration, no can* check.
 */
export async function runScheduledPublish(
  managers: readonly LifecycleManager<LifecycleCapable>[],
  now: Date,
): Promise<{ transitioned: number; skipped: number }> {
  let transitioned = 0;
  let skipped = 0;
  for (const manager of managers) {
    const ids = await manager.findScheduledReadyIds(now, BATCH_LIMIT);
    for (const id of ids) {
      const ok = await manager.publishScheduledReady(id, now);
      if (ok) transitioned += 1;
      else skipped += 1;
    }
  }
  return { transitioned, skipped };
}
```

The `undefined as never` placeholder for `ContentPolicy` is acceptable here because the cron path never calls `can*`. To avoid the hazard, lifecycle adapters can take an optional `contentPolicy` constructor parameter, or the cron path can use lightweight cron-only adapter variants that omit `can*` from the interface. Either is fine; the simplest is to keep one adapter class and rely on the fact that the cron driver only calls `findScheduledReadyIds` and `publishScheduledReady`. **Acceptance criterion for LCY-F**: a unit test asserts `runScheduledPublish` never invokes `can*` methods.

#### 4.6.3 Cadence And Bounds

Hourly cadence rationale: editorial scheduling tolerates up to ~1 hour of latency; hourly cron amortizes Worker cold-start and DB connections; D1 reads in the cron path are bounded (one indexed SELECT plus N compare-and-set updates per resource type, capped at 500).

### 4.7 Content IAM — Permission Catalog And Role Wiring

Updates to `src/domain/iam/content-permission.ts`.

New `ContentPermissionKey` entries:

```ts
| "book.publish"
| "book.archive"
| "post.archive"
| "chapter.archive"
| "site_config.create"      // org.create_site_config is renamed below
| "site_config.read"
| "site_config.update"
| "site_config.publish"
| "site_config.archive"
| "site_config.delete"
```

> Note: `org.create_site_config` from the previous `docs/012` draft is renamed to `site_config.create` for consistency with the existing `chapter.create` pattern; org-scoped creation is expressed through the `assignableResourceType: "org"` of the role that holds it, not through an `org.create_*` permission key. This aligns with how `org.create_book` is the exception (legacy) and new resource types follow the `<resource>.create` convention.

Permission rows added to `CONTENT_PERMISSIONS`:

```ts
{ key: "book.publish",         description: "Publish or unpublish a book",           delegationClass: "ordinary" },
{ key: "book.archive",         description: "Archive a book (non-destructive)",       delegationClass: "ordinary" },
{ key: "post.archive",         description: "Archive a post (non-destructive)",       delegationClass: "ordinary" },
{ key: "chapter.archive",      description: "Archive a chapter (non-destructive)",    delegationClass: "ordinary" },
{ key: "site_config.create",   description: "Create a site config in an organization", delegationClass: "ordinary" },
{ key: "site_config.read",     description: "Read a draft or archived site config",   delegationClass: "ordinary" },
{ key: "site_config.update",   description: "Update a site config",                   delegationClass: "ordinary" },
{ key: "site_config.publish",  description: "Promote a site config to active",        delegationClass: "ordinary" },
{ key: "site_config.archive",  description: "Archive a site config (non-active only)",delegationClass: "ordinary" },
{ key: "site_config.delete",   description: "Delete a site config",                   delegationClass: "ordinary" },
```

Additions to `ContentResourceType`: `"site_config"`.

New built-in role:

```ts
{
  id: "system:org.site_manager",
  key: "org.site_manager",
  name: "Organization Site Manager",
  assignableResourceType: "org",
  protected: false,
  permissions: [
    "site_config.create",
    "site_config.read",
    "site_config.update",
    "site_config.publish",
    "site_config.archive",
    "site_config.delete",
  ],
},
```

Updates to existing built-in roles in `BUILT_IN_CONTENT_ROLES`:

| Role | Add permissions |
|---|---|
| `system:post.owner` | `post.archive` |
| `system:book.owner` | `book.publish`, `book.archive` |
| `system:book.author` | `book.publish` |
| `system:book.editor` | *(no publish, no archive — editors update but do not promote)* |
| `system:org.content_admin` | `book.publish`, `book.archive`, `post.archive`, `chapter.archive`, `site_config.create`, `site_config.read`, `site_config.update`, `site_config.publish`, `site_config.archive`, `site_config.delete` |

`assertContentPermissionKey` continues to gate any string accepted as a permission. Built-in role rows are reseeded by `ContentRoleRepository.ensureSystemCatalog()` on next IAM use case execution (no migration needed for the role catalog; rows are seeded on demand).

### 4.8 Entity Migrations

#### Post

Edits to [src/domain/posts/post.entity.ts](../src/domain/posts/post.entity.ts):

```ts
export type PostStatus = "draft" | "scheduled" | "published" | "archived";

export type PostProps = {
  // … existing fields …
  status: PostStatus;
  publishedAt: Date | null;
  scheduledAt: Date | null;          // new
  archivedAt: Date | null;           // new
  // … existing timestamps …
};

export type CreatePostProps = Omit<
  PostProps,
  "id" | "slug" | "status" | "publishedAt" | "scheduledAt" | "archivedAt" | "createdAt" | "updatedAt"
>;

// UpdatePostProps stays without `status`. It already does.

export class Post implements LifecycleCapable {
  // … existing constructor / create / reconstitute …

  get lifecycleStatus(): LifecycleStatus { return this.props.status; }
  get scheduledAt(): Date | null { return this.props.scheduledAt; }
  get archivedAt(): Date | null { return this.props.archivedAt; }

  publish(): void {
    if (this.props.status === "archived") throw new ConflictError("Cannot publish an archived post");
    if (this.props.status === "published") throw new ConflictError("Post is already published");
    if (!this.props.title || !this.props.slug) throw new ConflictError("Post cannot be published without title and slug");
    this.props.status = "published";
    this.props.publishedAt = new Date();
    this.props.scheduledAt = null;
    this.props.updatedAt = new Date();
  }

  unpublish(): void {
    if (this.props.status === "archived") throw new ConflictError("Cannot unpublish an archived post");
    if (this.props.status === "draft") throw new ConflictError("Post is already a draft");
    this.props.status = "draft";
    this.props.publishedAt = null;
    this.props.scheduledAt = null;
    this.props.updatedAt = new Date();
  }

  schedule(scheduledAt: Date): void {
    if (this.props.status !== "draft") throw new ConflictError(`Cannot schedule a ${this.props.status} post`);
    if (!this.props.title || !this.props.slug) throw new ConflictError("Post cannot be scheduled without title and slug");
    this.props.status = "scheduled";
    this.props.scheduledAt = scheduledAt;
    this.props.updatedAt = new Date();
  }

  archive(): void {
    if (this.props.status === "archived") throw new ConflictError("Post is already archived");
    this.props.status = "archived";
    this.props.archivedAt = new Date();
    this.props.scheduledAt = null;
    this.props.updatedAt = new Date();
  }
}
```

The entity now implements `LifecycleCapable`. The existing `publish()` / `unpublish()` methods are tightened with the new precondition checks. `archived` is now reachable for posts.

#### Book

Edits to [src/domain/books/book.entity.ts](../src/domain/books/book.entity.ts):

```ts
export type BookStatus = "draft" | "scheduled" | "published" | "archived";

export type BookProps = {
  // … existing fields …
  status: BookStatus;
  publishedAt: Date | null;          // new
  scheduledAt: Date | null;          // new
  archivedAt: Date | null;           // new
};

// IMPORTANT: status is removed from UpdateBookProps (§5.3).
export type UpdateBookProps = Partial<Pick<BookProps, "title" | "visibility">>;

export class Book implements LifecycleCapable {
  // … existing constructor / create / reconstitute …
  // Book.create still defaults status: "draft", publishedAt/scheduledAt/archivedAt: null.

  get lifecycleStatus(): LifecycleStatus { return this.props.status; }
  get publishedAt(): Date | null { return this.props.publishedAt; }
  get scheduledAt(): Date | null { return this.props.scheduledAt; }
  get archivedAt(): Date | null { return this.props.archivedAt; }

  // publish, unpublish, schedule, archive — same shape as Post above.

  update(input: UpdateBookProps): void {
    if (this.props.status === "archived") throw new ConflictError("Cannot update an archived book");
    if (input.title !== undefined) this.props.title = input.title;
    if (input.visibility !== undefined) this.props.visibility = input.visibility;
    this.props.updatedAt = new Date();
  }
}
```

Mapper updates:

- `src/infrastructure/repositories/mappers/post.mapper.ts`: include `scheduledAt`, `archivedAt` in `postToInsertRow`, `postToUpdateRow`, and the `Post.reconstitute(...)` call inside `postRowToEntity`.
- `src/infrastructure/repositories/mappers/book.mapper.ts`: include `publishedAt`, `scheduledAt`, `archivedAt`. Drop the `status` field from any update path that consumes `UpdateBookProps`; the mapper still writes `status` to the row from the entity snapshot (the entity owns transitions).

HTTP schema updates:

- `src/http/schemas/posts.schema.ts`: extend `postResponseSchema` with `scheduledAt`, `archivedAt`. The PATCH body schema does not include `status` (it never did).
- `src/http/schemas/books.schema.ts`: extend `bookResponseSchema` similarly. PATCH body schema MUST NOT include `status` — remove it.

### 4.9 Database Migration

`drizzle/0007_lifecycle_fields.sql`:

```sql
-- Posts: add scheduled_at, archived_at
ALTER TABLE posts ADD COLUMN scheduled_at INTEGER;
ALTER TABLE posts ADD COLUMN archived_at INTEGER;

-- Books: add published_at, scheduled_at, archived_at
ALTER TABLE books ADD COLUMN published_at INTEGER;
ALTER TABLE books ADD COLUMN scheduled_at INTEGER;
ALTER TABLE books ADD COLUMN archived_at INTEGER;

-- Indexes for cron predicate: scheduled rows with overdue scheduled_at.
CREATE INDEX posts_scheduled_idx ON posts (scheduled_at) WHERE status = 'scheduled';
CREATE INDEX books_scheduled_idx ON books (scheduled_at) WHERE status = 'scheduled';
```

Drizzle schema additions to [src/infrastructure/db/schema.ts](../src/infrastructure/db/schema.ts):

```ts
export const posts = sqliteTable("posts", {
  // … existing …
  publishedAt: integer("published_at", { mode: "timestamp_ms" }),
  scheduledAt: integer("scheduled_at", { mode: "timestamp_ms" }),
  archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
  // …
}, (table) => [
  index("posts_scheduled_idx").on(table.scheduledAt).where(sql`status = 'scheduled'`),
]);

export const books = sqliteTable("books", {
  // … existing …
  publishedAt: integer("published_at", { mode: "timestamp_ms" }),
  scheduledAt: integer("scheduled_at", { mode: "timestamp_ms" }),
  archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
  // …
}, (table) => [
  index("books_org_status_idx").on(table.orgId, table.status),
  index("books_created_by_idx").on(table.createdByUserId),
  index("books_scheduled_idx").on(table.scheduledAt).where(sql`status = 'scheduled'`),
]);
```

Backfill policy for existing `posts` rows where `status = 'published'` and `publishedAt IS NULL`: leave `publishedAt NULL`. This is acceptable because no current row qualifies (Post already populates `publishedAt` in `publish()`). For `books` rows where `status = 'published'`: also leave NULL. Treat NULL as "published at an unknown time"; presenters surface `null` and the front-end falls back to `updatedAt` for display.

### 4.10 HTTP API Surface

New routes are added through `@hono/zod-openapi` `createRoute` + `app.openapi`, matching the existing publish route pattern in [src/http/routes/posts.routes.ts](../src/http/routes/posts.routes.ts).

| Method | Path | Auth | Use case | Permission |
|---|---|---|---|---|
| `POST` | `/posts/{id}/publish` | `content:write` | `posts.publish` (PublishUseCase) | `post.publish` |
| `POST` | `/posts/{id}/unpublish` | `content:write` | `posts.unpublish` | `post.publish` |
| `POST` | `/posts/{id}/schedule` | `content:write` | `posts.schedule` | `post.publish` |
| `POST` | `/posts/{id}/archive` | `content:write` | `posts.archive` | `post.archive` |
| `POST` | `/books/{id}/publish` | `content:write` | `books.publish` | `book.publish` |
| `POST` | `/books/{id}/unpublish` | `content:write` | `books.unpublish` | `book.publish` |
| `POST` | `/books/{id}/schedule` | `content:write` | `books.schedule` | `book.publish` |
| `POST` | `/books/{id}/archive` | `content:write` | `books.archive` | `book.archive` |

Site config routes are defined in `docs/012`.

Schedule body schema (shared):

```ts
// src/http/schemas/lifecycle.schema.ts
import { z } from "@hono/zod-openapi";

export const scheduleBodySchema = z
  .object({
    scheduledAt: z
      .string()
      .datetime()
      .openapi({ description: "ISO-8601 timestamp when the resource should publish. Must be in the future." }),
  })
  .openapi("SchedulePublishBody");
```

Route handler pattern (single use case per handler, in line with `architecture/route-module` lint rule):

```ts
const postScheduleRoute = createRoute({
  method: "post",
  path: "/posts/{id}/schedule",
  tags: ["posts"],
  description: "Schedule a draft post to publish at a future time.",
  security: bearerSecurity,
  request: {
    params: idParamSchema,
    body: jsonRequestBody(scheduleBodySchema, "Scheduled publish payload"),
  },
  responses: {
    200: jsonContent(dataResponseSchema(postResponseSchema), "Scheduled post"),
    ...commonErrorResponses,
  },
});

app.openapi(postScheduleRoute, async (c) => {
  const actor = requireActor(c);
  const params = c.req.valid("param");
  const body = c.req.valid("json");
  const result = await c.get("container").posts.schedule.execute({
    actor,
    id: params.id,
    scheduledAt: new Date(body.scheduledAt),
  });
  return c.json({ data: presentPost(result) }, HTTP_STATUS_OK);
});
```

### 4.11 Module Layout

```
src/domain/lifecycle/
  lifecycle-entity.ts                # LifecycleStatus, LifecycleCapable
  lifecycle-manager.ts               # LifecycleManager<T>

src/application/lifecycle/
  publish.usecase.ts
  unpublish.usecase.ts
  schedule-publish.usecase.ts
  archive.usecase.ts

src/infrastructure/lifecycle/
  post-lifecycle-manager.ts
  book-lifecycle-manager.ts
  site-config-lifecycle-manager.ts   # introduced by docs/012
  chapter-lifecycle-manager.ts       # future, when Chapter is implemented

src/composition/
  create-request-container.ts        # request graph (HTTP)
  scheduled-lifecycle.ts             # NEW: buildScheduledLifecycleManagers + runScheduledPublish
                                     #      consumed by the scheduled-publish Worker

src/http/schemas/
  lifecycle.schema.ts                # scheduleBodySchema (shared)

drizzle/
  0007_lifecycle_fields.sql

workers/scheduled-publish/           # NEW: dedicated Cloudflare Worker (sibling of workers/media-processor)
  wrangler.jsonc                     # triggers.crons = ["0 * * * *"]; shares D1 binding with API
  tsconfig.json                      # extends root tsconfig; @/* path alias to ../../src/*
  src/index.ts                       # exports default { scheduled }; calls runScheduledPublish
```

Files deleted as part of the rollout (after adapters and routes are switched):

```
src/application/posts/publish-post.usecase.ts        # replaced by generic PublishUseCase<Post>
src/application/posts/unpublish-post.usecase.ts      # replaced by generic UnpublishUseCase<Post>
```

Files **not** modified (callout — common false expectation):

```
src/main.ts                          # The API Worker is unchanged. Cron lives in its own Worker.
```

Files **kept** (excluded from the plugin):

```
src/application/media/publish-media.usecase.ts       # Media uses visibility, not lifecycle
src/application/media/unpublish-media.usecase.ts
```

## 5. Architecture Decisions

### 5.1 Interface-Based Plugin, Not Mixin Or Event Bus

Layer boundaries (enforced by `scripts/oxlint-js-plugins/architecture.js`):

- `LifecycleCapable` and `LifecycleManager` live in `src/domain/lifecycle/` — pure interfaces, no framework imports.
- Generic use cases live in `src/application/lifecycle/` — depend only on domain and `shared/errors`.
- Adapters live in `src/infrastructure/lifecycle/` — they compose repositories + `ContentPolicy`.
- Entities implement `LifecycleCapable` by adding methods. No base class, no inheritance, no decorator.

Adding a new resource costs one adapter file. Generic use cases are never modified.

### 5.2 Compare-And-Set Publish Owned By The Repository

D1 has no row-level locking. A naive cron `find → entity.publish() → repo.save()` is exposed to lost-update races against simultaneous manual publish or unpublish on the same row.

Resolution: the repository exposes `publishScheduledReady(id, now)` issuing a single conditional `UPDATE` (`WHERE status = 'scheduled' AND scheduled_at <= ?`). Two paths, two contracts:

- **Manual transitions** (`PublishUseCase`, etc.) call `entity.publish()` and the entity guards invariants. `entity.publish()` is intentionally strict — it throws if already published — because the caller expressed an explicit user intent.
- **Cron transitions** call `repo.publishScheduledReady(id, now)`. The SQL guard makes the operation idempotent without touching the entity. Concurrent manual publish wins the race (the cron UPDATE matches 0 rows), and vice versa.

This removes the need for an entity-level "idempotent if already published" hack.

### 5.3 Generic Status Update Routes Cannot Change Lifecycle

`UpdateBookProps` currently allows `status`. Removing it is required for the plugin to be real, not cosmetic. Lifecycle status MUST be reachable only through `publish/unpublish/schedule/archive`. Same rule applies prophylactically to all other lifecycle-capable resources: their `UpdateXxxProps` MUST NOT include `status`, `publishedAt`, `scheduledAt`, or `archivedAt`.

Migration impact: any external caller that was patching `status` on `PATCH /books/{id}` must switch to the lifecycle endpoints. The internal codebase does not appear to rely on this; the patch surface is a public API change that ships with the migration. There is no compatibility shim.

### 5.4 Dedicated `*.archive` Permissions

Archive and delete are different product actions. Archive removes the resource from the live surface but keeps its record (useful for audit, history, and possible later restoration). Delete destroys the row.

Dedicated `*.archive` permissions allow:

- Editors who may archive but may not destroy.
- Audit and compliance flows that distinguish removal-from-surface from permanent loss.
- Future flexibility to add restore-from-archive without re-shaping permissions.

Adapters MUST map `canArchive` to `{resource}.archive`, not `{resource}.delete`. The catalog gains: `post.archive`, `book.archive`, `chapter.archive`, `site_config.archive`. All `delegationClass: "ordinary"`.

### 5.5 Schedule Reuses The Publish Permission

Scheduling is "publish, later". The authorization question is identical: may this actor cause this resource to be published? A separate `*.schedule` key would add catalog noise without expressing a different decision.

Cancelling a schedule routes through `unpublish` (`scheduled → draft`), which also maps to `{resource}.publish`. Vocabulary stays uniform.

### 5.6 Cron Has No Actor — Authorization Is Checked At Schedule Time

The Cloudflare cron event has no JWT and no actor. `SchedulePublishUseCase` runs `canSchedule(actor, entity)` when the schedule is created. The cron path is authorized by the existence of `status = 'scheduled'` on the row, not by a re-check.

Implication: if a user's permission is revoked after they schedule a post, the schedule still fires. To stop a fired-but-not-yet-published schedule, an authorized caller must call unpublish/archive before the cron interval elapses. This is the same property held by every other "fire-at-time-T" scheduler.

### 5.7 Archived Is Terminal In Level 1

`archived` cannot transition to any other state. Restore-from-archive is deferred because the destination state (draft? published?) is a product question that should not be answered in this release. To resurrect content, callers duplicate the entity through the existing CRUD create paths.

### 5.8 Media Is Excluded

`Media` has a processing-pipeline status (`pending_upload → processing → ready → failed → expired`) driven by background workers, plus an orthogonal `visibility` (`private | public`). These are not editorial statuses. Wrapping Media in `LifecycleCapable` would require collapsing two orthogonal axes into one.

`publish-media.usecase.ts` and `unpublish-media.usecase.ts` are kept verbatim.

### 5.9 Supersedes Docs/005

`docs/005` predates Content IAM (`docs/007`) and covers only publish/unpublish for Post and Media with a 4-step orchestration matching the older policy model. The interface naming, transition set, IAM integration, and scheduling story all differ. `docs/005` is marked `superseded` at delivery time; its `PublishManager<T>` interface and any planned `PostPublishManager` / `MediaPublishManager` files are not built.

### 5.10 Rejected Options

- **Mixin / trait on entity class.** TypeScript structural gymnastics, couples entities to a library, complicates `entity.toSnapshot()`. The plain `LifecycleCapable` interface is a contract; entities own the invariants.
- **Event-driven publish.** Emitting `PublishRequested` and consuming asynchronously adds queue infrastructure, hides errors from the synchronous HTTP caller, and does not solve the cron concurrency problem (which is a DB problem).
- **Separate state machine library.** XState or hand-rolled state-machine objects make the entity opaque and complicate `pnpm advise` duplication scoring. Inline transition methods on each entity stay readable.
- **Unified "lifecycles" table** (`lifecycles(resource_type, resource_id, status, …)`). Doubles writes, complicates reads, and prevents the partial-index trick used in `0007_lifecycle_fields`.
- **Per-resource `*.schedule` permission keys.** Adds catalog noise without expressing a distinct authorization decision (§5.5).

## 6. Resource Coverage Matrix

### 6.1 Post

| Item | Action |
|---|---|
| `PostStatus` | extend to `draft \| scheduled \| published \| archived` |
| `PostProps` | add `scheduledAt: Date \| null`, `archivedAt: Date \| null` |
| Methods | add `schedule()`, `archive()`; tighten `publish()`, `unpublish()` |
| Repository | add `findScheduledReadyIds`, `publishScheduledReady` |
| Mapper | add new fields to insert/update/reconstitute |
| Permission | add `post.archive` |
| Roles | `system:post.owner` gains `post.archive` |
| Use cases deleted | `publish-post.usecase.ts`, `unpublish-post.usecase.ts` |
| Adapter | `src/infrastructure/lifecycle/post-lifecycle-manager.ts` |
| Routes added | `POST /posts/{id}/schedule`, `POST /posts/{id}/archive` |

Existing `POST /posts/{id}/publish` and `POST /posts/{id}/unpublish` routes retain their request/response shape; only the handler plumbing changes (calls `posts.publish.execute(...)` on the generic use case).

### 6.2 Book

| Item | Action |
|---|---|
| `BookStatus` | extend to `draft \| scheduled \| published \| archived` |
| `BookProps` | add `publishedAt`, `scheduledAt`, `archivedAt` |
| `UpdateBookProps` | **remove** `status` (§5.3) |
| Methods | add `publish()`, `unpublish()`, `schedule()`, `archive()`; lock `update()` against archived books |
| Repository | add `findScheduledReadyIds`, `publishScheduledReady` |
| Mapper | add new fields; status is sourced from the entity snapshot only |
| Permission | add `book.publish`, `book.archive` |
| Roles | `system:book.owner`: `book.publish`, `book.archive`; `system:book.author`: `book.publish`; `system:book.editor`: no change |
| Adapter | `src/infrastructure/lifecycle/book-lifecycle-manager.ts` |
| Routes added | `POST /books/{id}/publish`, `/unpublish`, `/schedule`, `/archive` |

### 6.3 SiteConfig

Implemented from day one against the plugin; see `docs/012`. Summary:

| Item | Action |
|---|---|
| Adapter | `src/infrastructure/lifecycle/site-config-lifecycle-manager.ts` |
| `canArchive` extra rule | reject if entity is the currently-active config (DB lookup) |
| Permission keys | `site_config.create/.read/.update/.publish/.archive/.delete` |
| Routes | `/site-configs/{id}/publish`, `/unpublish`, `/schedule`, `/archive` plus CRUD |

### 6.4 Chapter

Chapter is not implemented yet (`docs/009`). When the Chapter entity is built, it MUST implement `LifecycleCapable` from the start. The `chapter.publish` key already exists; `chapter.archive` is added by [LCY-B](#lcy-b-content-iam-permission-and-role-updates).

### 6.5 Excluded

| Resource | Reason |
|---|---|
| Media | separate pipeline + visibility (§5.8) |
| Category | shared org taxonomy; no draft/publish concept |
| Comment | moderation is not a publish lifecycle |
| User | identity, not content |
| Bookmark / reading state | user-private data |

## 7. Implementation Strategy

Phased to keep `pnpm check` green at every step:

1. **LCY-A — Domain contracts and generic use cases.** Add `src/domain/lifecycle/*`, `src/application/lifecycle/*`. No resource yet uses them. `pnpm check` must pass.
2. **LCY-B — IAM permission catalog.** Add new keys + role wiring. No routes use them yet. Tests for `assertContentPermissionKey` and role seeding updated.
3. **LCY-C — DB migration 0007.** Generate, apply locally, verify schema diff. Add new columns to Drizzle schema and mappers. No business logic uses them yet.
4. **LCY-D — Post adoption.** Add `PostLifecycleManager`. Replace `posts.publish` / `posts.unpublish` wiring in `create-request-container.ts` to use generic use cases. Add `posts.schedule`, `posts.archive`. Add new routes. Delete `publish-post.usecase.ts` and `unpublish-post.usecase.ts`. Existing post lifecycle tests stay green by definition.
5. **LCY-E — Book adoption.** Add `BookLifecycleManager`. Add four routes. Remove `status` from `UpdateBookProps` and the PATCH route schema (breaking change, called out in CHANGELOG/README).
6. **LCY-F — Cron worker.** Create `workers/scheduled-publish/` as a new Cloudflare Worker (sibling of `workers/media-processor/`). Add `src/composition/scheduled-lifecycle.ts` with `buildScheduledLifecycleManagers` and `runScheduledPublish`. Add an integration test using a frozen clock and a seeded scheduled row. Extend the CI deploy workflow to deploy the new Worker alongside the API and media-processor Workers.
7. **LCY-G — Documentation and cleanup.** Mark `docs/005` superseded. Update README. Update `docs/architecture.md` if it references the old publish use case names.

`docs/012` (SiteConfig) is implementable in parallel after LCY-A/B/C land, but lands as a separate PR series tracked under that doc.

## 8. Migration And Rollout

### 8.1 Database

Generate: `pnpm db:generate` after editing schema.ts; verify the generated SQL matches the SQL in §4.9 (Drizzle's diff may rename indexes — preserve the names listed). Apply locally with `pnpm db:migrate:local`. Apply to remote with `pnpm db:migrate:remote` as part of the deploy workflow (already handled by `.github/workflows/ci-deploy.yml` `wrangler d1 migrations apply content_api --remote`).

### 8.2 Deploy Order

The migration adds nullable columns and partial indexes. It is forward-compatible with the previous Worker binary; rollback is also safe (new columns are unused by the previous binary). Deploy order: migration → Worker. CI/CD already runs migration before deploy.

### 8.3 Public API Change

Removing `status` from `PATCH /books/{id}` is a breaking change for any client that was setting it. There are no internal consumers in this repository. External clients must switch to the lifecycle endpoints. Documented in:

- `README.md` "Not Implemented" / changelog section (added by [LCY-G](#lcy-g-documentation-and-cleanup)).
- `bookResponseSchema` / `updateBookBodySchema` regenerated OpenAPI spec.

No feature flag. The change is small and the surface is internal.

### 8.4 Cron Worker

The cron driver ships as a **new Cloudflare Worker** at `workers/scheduled-publish/`, alongside the existing `workers/media-processor/`. It is a separate deployment unit:

- Its own `wrangler.jsonc` declares `triggers.crons = ["0 * * * *"]` and re-uses the API's D1 binding (same `database_id`, same `migrations_dir` resolved relative to the Worker dir).
- Its own `tsconfig.json` extends the root tsconfig and adds the `@/*` path alias targeting `../../src/*` so the Worker can import shared composition helpers from the main source tree.
- `pnpm-workspace.yaml` is **not** modified — `workers/*` are deployment units, not pnpm workspace packages.
- CI deploy workflow `.github/workflows/ci-deploy.yml` gains a `wrangler deploy --config workers/scheduled-publish/wrangler.jsonc` step after the API Worker deploy.

Adding `triggers.crons` requires a Workers Paid or Cron-eligible plan. Confirm the plan allows cron before merging LCY-F. For fast local iteration, `wrangler dev --config workers/scheduled-publish/wrangler.jsonc --test-scheduled` invokes the handler on demand without waiting for the real cron tick.

### 8.5 Rollback

- Code: revert the deploy. The migration's nullable columns are inert.
- DB: do not drop columns. If a rollback is needed, deploy the older Worker; the new columns remain unused.

## 9. Edge Cases And Failure Modes

| Scenario | Handling |
|---|---|
| `PATCH /books/{id}` body includes `status` after rollout | OpenAPI rejects unknown property → `400 Bad Request`. |
| Schedule with `scheduledAt <= now` | `SchedulePublishUseCase` raises `ValidationError` → `400`. |
| Schedule while already scheduled or published | `entity.schedule()` raises `ConflictError` → `409`. |
| Publish while archived | `entity.publish()` raises `ConflictError` → `409`. |
| Publish while already published (manual path) | `entity.publish()` raises `ConflictError` → `409`. Manual callers see explicit failure, not silent no-op. |
| Cron and manual publish race | Cron compare-and-set `WHERE status = 'scheduled'`; if manual already moved the row to `published`, cron UPDATE affects 0 rows → `publishScheduledReady` returns `false` → skipped. |
| Cron job interrupted mid-batch | Already-transitioned rows are now `status = 'published'` and outside the next batch's predicate. Untransitioned rows remain `scheduled` and are picked up next hour. |
| Cron batch > 500 overdue rows | Limit is 500 per resource type per run. The remainder fires next cron. Worst-case under a single cron tick is `500 × number_of_lifecycle_resources` writes. |
| Unpublish a scheduled item | Allowed; transitions back to `draft`, clears `scheduledAt`. |
| Archive the currently-active SiteConfig | Adapter's `canArchive` returns `false` (resource rule), even if the actor has `site_config.archive` on the org. Caller must activate a replacement first (`409`). |
| Permission revoked after schedule was set | Schedule still fires (§5.6). To prevent, revoke the schedule via unpublish/archive. |
| Existing published row with `publishedAt = NULL` after migration | Presenter surfaces `null`; front-end falls back to `updatedAt` for display. |
| Service-account actor calls lifecycle endpoints | Authorized via service-account principal binding the same way as user actor. No special path. |
| Direct-share user actor calls lifecycle endpoints | Works for resources where a direct binding grants `{resource}.publish` (e.g. a direct book editor). For org-level resources like SiteConfig, direct-share tokens cannot meet the binding requirement. |
| Cron runs at a time the DB is degraded | `findScheduledReadyIds` rejection or `publishScheduledReady` rejection is logged and re-tried next hour. No retry within a single cron tick. |
| Two cron triggers fire simultaneously (Cloudflare guarantees at-least-once) | Compare-and-set ensures duplicate transitions match 0 rows on the second attempt. Operations are idempotent at the row level. |
| Clock skew between scheduling and cron | Both use server clock (`new Date()`). `scheduledAt <= now` predicate uses the cron's `event.scheduledTime`. Skew across Cloudflare regions is bounded. |

## 10. Implementation Backlog

### LCY-A. Domain Contracts And Generic Use Cases

Scope:

- `src/domain/lifecycle/lifecycle-entity.ts` (new)
- `src/domain/lifecycle/lifecycle-manager.ts` (new)
- `src/application/lifecycle/publish.usecase.ts` (new)
- `src/application/lifecycle/unpublish.usecase.ts` (new)
- `src/application/lifecycle/schedule-publish.usecase.ts` (new)
- `src/application/lifecycle/archive.usecase.ts` (new)
- `src/http/schemas/lifecycle.schema.ts` (new)
- `src/infrastructure/persistence/crud-adapter.ts` (extend)

Tasks:

- [ ] Define `LifecycleStatus` and `LifecycleCapable` (§4.2).
- [ ] Define `LifecycleManager<T>` (§4.2).
- [ ] Implement `PublishUseCase`, `UnpublishUseCase`, `SchedulePublishUseCase`, `ArchiveUseCase` (§4.3).
- [ ] Extend `CrudAdapter` with `findRowsWhere<Row>` and `updateRowsConditional` (§4.5). Add JSDoc per `architecture/crud-adapter-jsdoc`.
- [ ] Add `scheduleBodySchema` in `src/http/schemas/lifecycle.schema.ts`. Imports `z` from `@hono/zod-openapi`.

Acceptance criteria:

- All four use cases compile and pass an in-memory `LifecycleManager` test double's expected sequence (scope check → find → can* → entity method → save).
- `CrudAdapter.updateRowsConditional` returns `{ rowsAffected }` matching D1's `meta.changes`.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` pass.

Tests:

- `tests/lifecycle/lifecycle-use-cases.test.ts` (new): unit tests using an in-memory `LifecycleManager` and `LifecycleCapable` test entity. Covers happy path, scope failure, not-found, forbidden, conflict-on-entity-method, schedule-in-past.

### LCY-B. Content IAM Permission And Role Updates

Scope:

- `src/domain/iam/content-permission.ts`
- `tests/content-iam.policy.test.ts`
- `tests/iam-roles.test.ts`

Tasks:

- [ ] Extend `ContentResourceType` with `"site_config"`.
- [ ] Extend `ContentPermissionKey` and `CONTENT_PERMISSIONS` with the new keys in §4.7.
- [ ] Update `BUILT_IN_CONTENT_ROLES`:
  - `system:post.owner` += `post.archive`
  - `system:book.owner` += `book.publish`, `book.archive`
  - `system:book.author` += `book.publish`
  - `system:org.content_admin` += new permissions listed in §4.7
- [ ] Add `system:org.site_manager` role (permissions in §4.7).
- [ ] Update unit tests that snapshot the permission catalog and role catalog.

Acceptance criteria:

- `assertContentPermissionKey("post.archive")` succeeds.
- `assertContentPermissionKey("site_config.publish")` succeeds.
- `BUILT_IN_CONTENT_ROLES.find(r => r.id === "system:org.site_manager")` is defined with the documented permissions.
- `pnpm test tests/iam-roles.test.ts` passes.

Tests:

- `pnpm test tests/iam-roles.test.ts`
- `pnpm test tests/content-iam.policy.test.ts`

### LCY-C. Database Migration 0007_lifecycle_fields

Scope:

- `src/infrastructure/db/schema.ts`
- `drizzle/0007_lifecycle_fields.sql` (generated)
- `src/infrastructure/repositories/mappers/post.mapper.ts`
- `src/infrastructure/repositories/mappers/book.mapper.ts`
- `src/http/schemas/posts.schema.ts`
- `src/http/schemas/books.schema.ts`

Tasks:

- [ ] Add `scheduledAt`, `archivedAt` columns to `posts` Drizzle table; add `publishedAt`, `scheduledAt`, `archivedAt` to `books`.
- [ ] Add partial indexes `posts_scheduled_idx`, `books_scheduled_idx` on `(scheduled_at) WHERE status = 'scheduled'`.
- [ ] Run `pnpm db:generate`; verify the generated SQL against §4.9. Edit the SQL only to standardize index names if Drizzle picks different ones.
- [ ] Update post.mapper and book.mapper for new fields. Post mapper passes `scheduledAt`, `archivedAt` through `Post.reconstitute(...)` and `postToInsertRow` / `postToUpdateRow`.
- [ ] Update `postResponseSchema` and `bookResponseSchema` to include new optional ISO fields.
- [ ] Remove `status` from `updateBookBodySchema` (paired with LCY-E).

Acceptance criteria:

- `pnpm db:migrate:local` applies cleanly to a fresh D1.
- `pnpm typecheck` passes.
- Selecting from `posts` after migration shows the new columns as NULL for all existing rows.

Tests:

- Re-run all `posts` and `books` route tests; they remain green because the new fields are nullable and presenters default `null`.

### LCY-D. Post Lifecycle Adoption

Scope:

- `src/domain/posts/post.entity.ts`
- `src/domain/posts/post.repository.ts`
- `src/infrastructure/repositories/drizzle-post.repository.ts`
- `src/infrastructure/lifecycle/post-lifecycle-manager.ts` (new)
- `src/composition/create-request-container.ts`
- `src/http/routes/posts.routes.ts`
- Delete `src/application/posts/publish-post.usecase.ts`
- Delete `src/application/posts/unpublish-post.usecase.ts`

Tasks:

- [ ] Implement `LifecycleCapable` on `Post`: getters, `schedule()`, `archive()`; tighten `publish()` and `unpublish()` (§4.8).
- [ ] Add `findScheduledReadyIds` and `publishScheduledReady` to `PostRepository` interface and Drizzle implementation (§4.5).
- [ ] Add `PostLifecycleManager` (§4.4).
- [ ] Replace `posts.publish` / `posts.unpublish` in `create-request-container.ts` with `new PublishUseCase(postLifecycleManager)` etc. Add `posts.schedule`, `posts.archive`.
- [ ] Add `POST /posts/{id}/schedule` and `POST /posts/{id}/archive` routes; refactor existing publish/unpublish handlers to call generic use cases by `{ actor, id }`.
- [ ] Delete `publish-post.usecase.ts` and `unpublish-post.usecase.ts`.
- [ ] Update `postResponseSchema` to include `scheduledAt`, `archivedAt`.

Acceptance criteria:

- All existing publish/unpublish post tests pass without modification (same request/response shape).
- New `/posts/{id}/schedule` test: schedule a draft, observe `status = scheduled`, `scheduledAt` set.
- New `/posts/{id}/archive` test: archive a draft and a published post, observe terminal state.
- `pnpm lint` passes (no lifecycle-related architecture lint hits).

Tests:

- `pnpm test tests/posts-media.test.ts`
- New `tests/posts-lifecycle.test.ts` covering schedule, archive, archive-while-archived, schedule-in-past.

### LCY-E. Book Lifecycle Adoption

Scope:

- `src/domain/books/book.entity.ts`
- `src/domain/books/book.repository.ts`
- `src/infrastructure/repositories/drizzle-book.repository.ts`
- `src/infrastructure/repositories/mappers/book.mapper.ts`
- `src/infrastructure/lifecycle/book-lifecycle-manager.ts` (new)
- `src/composition/create-request-container.ts`
- `src/http/routes/books.routes.ts`
- `src/http/schemas/books.schema.ts`

Tasks:

- [ ] Implement `LifecycleCapable` on `Book`: `publish`, `unpublish`, `schedule`, `archive` (§4.8).
- [ ] Remove `status` from `UpdateBookProps` and from `updateBookBodySchema`.
- [ ] Tighten `Book.update()` to reject mutations when `status === "archived"`.
- [ ] Add `findScheduledReadyIds` and `publishScheduledReady` to `BookRepository`.
- [ ] Add `BookLifecycleManager`.
- [ ] Wire `books.publish/unpublish/schedule/archive` in `create-request-container.ts`.
- [ ] Add four new routes to `books.routes.ts`.

Acceptance criteria:

- Existing book CRUD tests pass with `status` removed from PATCH (any test that patched status must be migrated to the new lifecycle endpoints).
- New `/books/{id}/publish` test transitions draft → published.
- `PATCH /books/{id}` with `status` in body returns `400`.
- `pnpm lint` passes; no `architecture/route-module` violation (each handler calls exactly one use case).

Tests:

- `pnpm test tests/books.test.ts`
- New `tests/books-lifecycle.test.ts`.

### LCY-F. Scheduled Publish Cron Worker

Scope:

- `workers/scheduled-publish/wrangler.jsonc` (new)
- `workers/scheduled-publish/tsconfig.json` (new)
- `workers/scheduled-publish/src/index.ts` (new)
- `src/composition/scheduled-lifecycle.ts` (new)
- `.github/workflows/ci-deploy.yml` (extend with the new Worker's deploy step)

**Do not modify** `src/main.ts` or the API Worker's `wrangler.jsonc`. The cron handler lives in its own Worker; the API Worker stays cron-free.

Tasks:

- [ ] Create the `workers/scheduled-publish/` directory matching the layout in §4.6.1.
- [ ] Implement `workers/scheduled-publish/wrangler.jsonc` with `triggers.crons = ["0 * * * *"]` and the shared D1 binding (same `database_id` as the API Worker; `migrations_dir: "../../drizzle"`).
- [ ] Implement `workers/scheduled-publish/tsconfig.json` extending the root tsconfig with `@/*` path alias to `../../src/*`.
- [ ] Implement `workers/scheduled-publish/src/index.ts` exporting `default { scheduled }` that builds managers and calls `runScheduledPublish` inside `ctx.waitUntil(...)`.
- [ ] Implement `buildScheduledLifecycleManagers(env)` and `runScheduledPublish(managers, now)` in `src/composition/scheduled-lifecycle.ts` (§4.6.2).
- [ ] Add a deploy step to `.github/workflows/ci-deploy.yml`: `wrangler deploy --config workers/scheduled-publish/wrangler.jsonc` after the API deploy step.
- [ ] Document the cron Worker in README under "Deployment" alongside the existing media-processor Worker.

Acceptance criteria:

- A scheduled post with `scheduledAt = now - 1s` transitions to `published` on the next `runScheduledPublish` invocation.
- A scheduled post that is concurrently archived is not double-transitioned.
- `runScheduledPublish` is idempotent (running it twice in a row publishes overdue rows only once).
- `runScheduledPublish` does not invoke any `can*` method on the managers it iterates (asserted via spy in the unit test).
- `pnpm test tests/scheduled-publish.test.ts` passes.
- `wrangler deploy --dry-run --config workers/scheduled-publish/wrangler.jsonc` validates the Worker config.

Tests:

- New `tests/scheduled-publish.test.ts`: seed 3 scheduled posts (two overdue, one future), run `runScheduledPublish`, assert two transitioned. Seed an overdue post, archive it before invoking, assert `publishScheduledReady` returns `false` and final status remains `archived`. Assert no `can*` adapter call is made during the run.

### LCY-G. Documentation And Cleanup

Scope:

- `docs/005_publish-lifecycle-adapter.md`
- `docs/013_content-lifecycle-plugin.md` (this doc)
- `README.md`

Tasks:

- [ ] Mark `docs/005` `Status: superseded by docs/013` at the top of the file.
- [ ] Update README "planning/status list" entry for `docs/013` to `implemented`.
- [ ] Update README to mention `triggers.crons` and the new lifecycle endpoints under "Routes".
- [ ] Run `pnpm advise`. Suppress only catalogued duplications (entity lifecycle methods, lifecycle adapter shape) per `.advise-suppressions.json` conventions in `CLAUDE.md`.

Acceptance criteria:

- README links resolve.
- `docs/005` clearly says superseded with a link to `docs/013`.

Tests:

- `pnpm check` green.

## 11. Future Backlog

### 11.1 Level 2 — Draft/Live Split

`PATCH /{resources}/{id}` on a published row currently mutates the live record. Level 2 adds a `content_drafts` table:

```ts
export const contentDrafts = sqliteTable(
  "content_drafts",
  {
    id: text("id").primaryKey(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    orgId: text("org_id").notNull(),
    snapshotJson: text("snapshot_json", { mode: "json" }).notNull(),
    createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("content_drafts_resource_idx").on(table.resourceType, table.resourceId)],
);
```

`LifecycleManager<T>` gains optional `saveDraft(entity)` / `findDraft(id)`. `PublishUseCase` applies the draft to the live row inside a single D1 batch and deletes the draft row.

### 11.2 Level 3 — Version History

```ts
export const contentVersions = sqliteTable(
  "content_versions",
  {
    id: text("id").primaryKey(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    orgId: text("org_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    snapshotJson: text("snapshot_json", { mode: "json" }).notNull(),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }).notNull(),
    publishedBy: text("published_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("content_versions_resource_version_idx").on(table.resourceType, table.resourceId, table.versionNumber),
    index("content_versions_resource_idx").on(table.resourceType, table.resourceId),
  ],
);
```

`PublishUseCase` writes a new `content_versions` row in the same batch as the live update. `RollbackUseCase<T>` re-applies a past version. Retention policy (e.g. last 50 versions) is operational.

### 11.3 Higher-Reliability Scheduling

For sub-hour precision or SLA-grade reliability, replace the cron with Cloudflare Queues. The schedule writer enqueues a delayed message keyed on `scheduledAt`; the consumer calls the same `publishScheduledReady(id, now)` primitive. The Level 1 entity/use case/adapter shape is unchanged.

## 12. Test And Verification Plan

| Layer | Test |
|---|---|
| Unit — generic use cases | `tests/lifecycle/lifecycle-use-cases.test.ts` with in-memory `LifecycleManager` test double covering scope, not-found, forbidden, conflict, schedule-in-past. |
| Unit — entities | Direct tests on `Post.publish/unpublish/schedule/archive` and `Book.*` for every allowed transition and every rejected transition. |
| Unit — adapters | `tests/lifecycle/post-lifecycle-manager.test.ts`: spy on `ContentPolicy.can` to verify the permission key is `post.publish` / `post.archive` per method. |
| Integration — HTTP routes | `tests/posts-lifecycle.test.ts`, `tests/books-lifecycle.test.ts`: full HTTP round-trip through the worker test pool, including `403` when permission is missing and `409` for invalid transitions. |
| Integration — cron | `tests/scheduled-publish.test.ts`: seed scheduled rows, invoke `runScheduledPublish(managers, frozenNow)`, assert transitions and skip behavior. |
| Race — compare-and-set | `tests/scheduled-publish-race.test.ts`: invoke `publishScheduledReady` twice concurrently using `Promise.all`; assert exactly one returns `true`. |
| Permissions catalog | `tests/content-iam.policy.test.ts`: `assertContentPermissionKey` accepts new keys; roles seed with new keys. |
| Update-status block | `tests/books.test.ts`: `PATCH /books/{id}` with `{ status: "published" }` returns 400 with the OpenAPI unknown-field error. |
| Lint architecture | `pnpm lint` — verifies no `architecture/route-module` regression and no mapper imports outside infrastructure. |
| Duplication | `pnpm check:dup` — verifies the four adapter files do not trip the Fallow mild gate. If they do, add a suppression entry referencing this doc. |
| Advisory | `pnpm advise` — manual review; expected suppressions limited to entity-lifecycle and adapter-shape patterns. |

## 13. Definition Of Done

- `src/domain/lifecycle/{lifecycle-entity,lifecycle-manager}.ts` exist and compile.
- `src/application/lifecycle/{publish,unpublish,schedule-publish,archive}.usecase.ts` exist; each calls scope check → manager → entity method → save in that order.
- `CrudAdapter` exposes `findRowsWhere` and `updateRowsConditional`; both have JSDoc; both have at least one test path through Post repository.
- `Post` and `Book` implement `LifecycleCapable`; their props include `publishedAt`, `scheduledAt`, `archivedAt` (Post had `publishedAt` already).
- `PostLifecycleManager` and `BookLifecycleManager` exist under `src/infrastructure/lifecycle/`.
- `posts.routes.ts` exposes `/publish`, `/unpublish`, `/schedule`, `/archive`. `books.routes.ts` exposes the same four routes. `PATCH /books/{id}` rejects `status`.
- `BUILT_IN_CONTENT_ROLES` contains `system:org.site_manager`; updated owner/admin roles include the new keys.
- `drizzle/0007_lifecycle_fields.sql` applies cleanly on fresh D1.
- `workers/scheduled-publish/wrangler.jsonc` declares `triggers.crons = ["0 * * * *"]` and reuses the API's D1 binding; `workers/scheduled-publish/src/index.ts` exports default `{ scheduled }` that dispatches `runScheduledPublish` through `ctx.waitUntil`. The API Worker's own `wrangler.jsonc` and `src/main.ts` are unchanged.
- `.github/workflows/ci-deploy.yml` deploys the cron Worker after the API Worker.
- `pnpm check` is green: lint (including architecture rules), duplicate gate, typecheck, vitest.
- `pnpm advise` shows no new unacknowledged findings.
- `README.md` lists the new endpoints and marks docs/013 implemented.
- `docs/005` marked `superseded by docs/013`.
- Deleted files: `src/application/posts/publish-post.usecase.ts`, `src/application/posts/unpublish-post.usecase.ts`.

## 14. Final Model

```
src/domain/lifecycle/
  lifecycle-entity.ts            LifecycleStatus, LifecycleCapable
  lifecycle-manager.ts           LifecycleManager<T> (find/save, can*, scheduled-ready, compare-and-set)

src/application/lifecycle/
  publish.usecase.ts             PublishUseCase<T>
  unpublish.usecase.ts           UnpublishUseCase<T>
  schedule-publish.usecase.ts    SchedulePublishUseCase<T> (validates future scheduledAt)
  archive.usecase.ts             ArchiveUseCase<T>

src/infrastructure/lifecycle/
  post-lifecycle-manager.ts      can*(actor, post) → ContentPolicy.can("post.publish"|"post.archive", postResource(post))
  book-lifecycle-manager.ts      can*(actor, book) → ContentPolicy.can("book.publish"|"book.archive", bookResource(book))
  site-config-lifecycle-manager.ts   adds "not the active config" guard inside canArchive (docs/012)

src/composition/
  create-request-container.ts    HTTP request graph (posts.publish, books.schedule, …)
  scheduled-lifecycle.ts         buildScheduledLifecycleManagers + runScheduledPublish
                                 (db + repositories only; no ContentPolicy needed)

workers/scheduled-publish/       dedicated Cloudflare Worker (sibling of workers/media-processor/)
  wrangler.jsonc                 triggers.crons = ["0 * * * *"]; shares the API's D1 binding
  tsconfig.json                  extends root tsconfig; @/* alias targets ../../src/*
  src/index.ts                   exports default { scheduled }; calls runScheduledPublish

drizzle/0007_lifecycle_fields.sql
  posts: + scheduled_at, archived_at; index on (scheduled_at) WHERE status='scheduled'
  books: + published_at, scheduled_at, archived_at; same partial index

Catalog:
  + post.archive, book.publish, book.archive, chapter.archive
  + site_config.create/.read/.update/.publish/.archive/.delete
  + system:org.site_manager role
  system:post.owner +post.archive
  system:book.owner +book.publish, +book.archive
  system:book.author +book.publish
  system:org.content_admin += all lifecycle and site_config keys above
```

A resource opts into the plugin in three files:

1. Its entity implements `LifecycleCapable`.
2. A `XxxLifecycleManager` chooses the permission key per transition.
3. A few lines in `create-request-container.ts` wire `PublishUseCase`/`UnpublishUseCase`/`SchedulePublishUseCase`/`ArchiveUseCase` against the adapter, and four `app.openapi(...)` route handlers expose the verbs.

The generic use cases are never modified. The cron driver is never modified. New resources cost one adapter and one migration column set.

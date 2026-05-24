# Content Lifecycle Plugin

> Status: research and proposal
>
> Date: 2026-05-24
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
> - `docs/012_site-config-collection.md`
> - `src/domain/posts/post.entity.ts`
> - `src/domain/books/book.entity.ts`
> - `src/domain/media/media.entity.ts`
> - `src/domain/iam/content-permission.ts`
> - `src/application/posts/publish-post.usecase.ts`
> - `src/application/posts/unpublish-post.usecase.ts`
> - `src/application/media/publish-media.usecase.ts`
> - `src/application/media/unpublish-media.usecase.ts`
>
> Related docs:
>
> - `docs/005_publish-lifecycle-adapter.md` — the original narrow extract proposal; this doc replaces its design intent
>
> Assumptions:
>
> - Content IAM (`docs/007`) is fully operational and permission keys are the mechanism for lifecycle authorization.
> - Cloudflare Workers Cron Triggers are available for scheduled publish execution.
> - D1 is the only persistence layer; there is no Redis or external message queue.
> - Level 1 (status machine + scheduling) is the first-release target. Level 2 (draft/live split) and Level 3 (versioning) are explicitly deferred and designed as future extensions without requiring breaking changes to Level 1 entities.
> - `Media` intentionally keeps its own lifecycle (`pending_upload → processing → ready → failed/expired` + `visibility: private | public`) and is excluded from this plugin. Media visibility is a property of the upload processing pipeline, not a content editorial decision.
> - The term "publish" in this document maps directly to Content IAM permission key `{resource}.publish` where such a key exists, or to the closest existing permission (e.g. `book.update`) where it does not yet. Adding fine-grained `{resource}.publish` keys per resource is part of this work.

## Table Of Contents

- [1. Goal](#1-goal)
- [2. System Summary](#2-system-summary)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 Relevant Files](#31-relevant-files)
  - [3.2 Current Lifecycle Models Per Resource](#32-current-lifecycle-models-per-resource)
  - [3.3 Current Problems](#33-current-problems)
- [4. Target Model](#4-target-model)
  - [4.1 Lifecycle Status Machine](#41-lifecycle-status-machine)
  - [4.2 LifecycleCapable Interface](#42-lifecyclecapable-interface)
  - [4.3 LifecycleManager Interface](#43-lifecyclemanager-interface)
  - [4.4 Generic Lifecycle Use Cases](#44-generic-lifecycle-use-cases)
  - [4.5 Per-Resource Lifecycle Adapters](#45-per-resource-lifecycle-adapters)
  - [4.6 Scheduling And Cron Execution](#46-scheduling-and-cron-execution)
  - [4.7 Content IAM — New Permission Keys](#47-content-iam--new-permission-keys)
  - [4.8 Entity Migrations For Existing Resources](#48-entity-migrations-for-existing-resources)
  - [4.9 Module Layout](#49-module-layout)
- [5. Architecture Decisions](#5-architecture-decisions)
  - [5.1 Interface-Based Plugin, Not Mixin Or Event Bus](#51-interface-based-plugin-not-mixin-or-event-bus)
  - [5.2 Superseding 005 Rather Than Extending It](#52-superseding-005-rather-than-extending-it)
  - [5.3 Schedule State On The Resource Row, Not A Separate Queue](#53-schedule-state-on-the-resource-row-not-a-separate-queue)
  - [5.4 One Permission Check Per Transition, Adapter Decides Which Key](#54-one-permission-check-per-transition-adapter-decides-which-key)
  - [5.5 Media Excluded From This Plugin](#55-media-excluded-from-this-plugin)
  - [5.6 Archive As A Terminal State In Level 1](#56-archive-as-a-terminal-state-in-level-1)
  - [5.7 Rejected: Trait / Mixin On Entity Class](#57-rejected-trait--mixin-on-entity-class)
  - [5.8 Rejected: Event-Driven Publish](#58-rejected-event-driven-publish)
- [6. Resource Coverage Matrix](#6-resource-coverage-matrix)
  - [6.1 Post](#61-post)
  - [6.2 Book](#62-book)
  - [6.3 Chapter](#63-chapter)
  - [6.4 SiteConfig](#64-siteconfig)
  - [6.5 Resources Excluded In V1](#65-resources-excluded-in-v1)
- [7. Edge Cases And Failure Modes](#7-edge-cases-and-failure-modes)
- [8. Future Backlog](#8-future-backlog)
  - [8.1 Level 2: Draft/Live Split](#81-level-2-draftlive-split)
  - [8.2 Level 3: Full Version History](#82-level-3-full-version-history)
  - [8.3 Scheduled Publish With Retry And Dead Letter](#83-scheduled-publish-with-retry-and-dead-letter)
- [9. Definition Of Done](#9-definition-of-done)
- [10. Final Model](#10-final-model)

## 1. Goal

Design a pluggable content lifecycle system that any resource in `content-api` can opt into. The system covers four transitions — draft → published, published → draft (unpublish), draft → scheduled → published, and published/draft → archived — through a shared interface, generic use cases, and thin per-resource adapters that wire in Content IAM and repository calls.

This supersedes the narrow publish/unpublish adapter design in `docs/005`. That document proposed a `PublishManager<T>` covering only two operations on two resources. This document replaces that design intent with a richer lifecycle model (four operations), a cleaner adapter interface, scheduling support, and a forward-compatible structure for adding draft/live split and versioning later.

Non-goals for Level 1 (this release):

- Draft/live split: authors edit a working draft while the live version remains readable. Deferred to Level 2.
- Full version history: every publish creates a snapshot that can be rolled back. Deferred to Level 3.
- Media lifecycle (upload pipeline states and visibility). Media has its own pipeline; it is not wrapped by this plugin.
- Tags, comments, bookmarks: not publishable content.

## 2. System Summary

Any resource that opts into the plugin gains four HTTP verbs beside its standard CRUD routes:

```text
POST /{resources}/{id}/publish         draft → published
POST /{resources}/{id}/unpublish       published → draft
POST /{resources}/{id}/schedule        draft → scheduled (with scheduledAt body param)
POST /{resources}/{id}/archive         any → archived
```

Each verb maps to one generic use case, which delegates the resource lookup, save, and authorization check to a per-resource `LifecycleManager<T>` adapter. The adapter is registered in the composition container alongside the existing CRUD use cases.

Request flow for publish:

```text
route handler
  -> PublishUseCase<Post>.execute({ actor, id })
  -> manager.findById(id)         [PostLifecycleManager → PostRepository]
  -> manager.canPublish(actor, entity)  [→ ContentPolicy.can("post.publish", postRef)]
  -> entity.publish()             [Post.publish() — entity owns the invariant check]
  -> manager.save(entity)         [→ PostRepository.save]
  -> return entity
```

Scheduled publish cron flow:

```text
Cloudflare Cron Trigger (every 5 min)
  -> ScheduledPublishJob.execute()
  -> for each registered LifecycleManager:
       repo.findScheduledReady(now)   [SELECT * WHERE status='scheduled' AND scheduled_at <= now]
       for each entity: entity.publish(); manager.save(entity)
```

## 3. Current-State Findings

### 3.1 Relevant Files

- `src/domain/posts/post.entity.ts` — `PostStatus = "draft" | "published"`, has `publish()`, `unpublish()`, `publishedAt`
- `src/domain/books/book.entity.ts` — `BookStatus = "draft" | "published" | "archived"`, has generic `update()` (no dedicated `publish()` method)
- `src/domain/media/media.entity.ts` — `MediaStatus = "pending_upload" | "processing" | "ready" | "failed" | "expired"`, `MediaVisibility = "private" | "public"` — explicitly separate pipeline
- `src/application/posts/publish-post.usecase.ts` — 28 lines, calls `ContentPolicy.can("post.publish", ...)`
- `src/application/posts/unpublish-post.usecase.ts` — same pattern
- `src/application/media/publish-media.usecase.ts` — 28 lines, calls `ContentPolicy.can("media.update", ...)` for visibility change
- `src/application/media/unpublish-media.usecase.ts` — same
- `src/domain/iam/content-permission.ts` — `ContentPermissionKey` has `"post.publish"`, `"chapter.publish"`, but no `"book.publish"`, `"book.archive"`, `"post.archive"`, `"site_config.publish"`
- `src/infrastructure/db/schema.ts` — `posts.status`, `posts.published_at`, `books.status`; neither table has `scheduled_at` or `archived_at`

### 3.2 Current Lifecycle Models Per Resource

| Resource | Status values | Has publish()? | Has scheduledAt? | Has archivedAt? | IAM permission |
|---|---|---|---|---|---|
| Post | `draft \| published` | Yes | No | No | `post.publish` |
| Book | `draft \| published \| archived` | No (uses `update()`) | No | No | `book.update` |
| Media | `pending_upload \| processing \| ready \| failed \| expired` + `visibility` | Yes (visibility flip) | No | No | `media.update` |
| Chapter | Not yet implemented | — | — | — | `chapter.publish` (key exists) |
| SiteConfig | `draft \| active \| archived` (proposed in `docs/012`) | Yes (via `activate()`) | No | No | `site_config.activate` |

### 3.3 Current Problems

- Publish/unpublish use cases for Post and Media are structurally identical boilerplate (four files, ~28 lines each). Adding a third publishable resource (Chapter, SiteConfig) repeats the same code.
- `Book` has no dedicated `publish()` method; its status is mutable through the generic `update()` path, which bypasses any publish-specific invariant checks.
- No scheduling support anywhere. Authors cannot set "publish at 09:00 tomorrow".
- No archive-as-terminal-transition use case; `Book.status` can be set to `"archived"` through the generic PATCH route with no lifecycle semantics.
- `docs/005` designed a `PublishManager<T>` covering only publish/unpublish for two resources — not scheduling, not archiving, not the richer IAM model from `docs/007`.
- The Content IAM permission catalog has `"post.publish"` and `"chapter.publish"` but no equivalent for book publishing or archiving. Authorization is inconsistent across resources.

## 4. Target Model

### 4.1 Lifecycle Status Machine

```text
          ┌──────────────┐
          │              │
          ▼              │
      [ draft ] ─────> [ scheduled ] ─────┐
          │                               │
          │ publish()                     │ (cron fires)
          ▼                               ▼
      [ published ] ◄─────────────────────┘
          │
          │ unpublish()
          ▼
      [ draft ]

Any non-archived state ──> archive() ──> [ archived ]  (terminal)
```

Allowed transitions:

| From | To | Trigger |
|---|---|---|
| `draft` | `published` | `publish()` |
| `draft` | `scheduled` | `schedule(scheduledAt)` |
| `scheduled` | `published` | `publish()` (cron or manual override) |
| `scheduled` | `draft` | `unpublish()` |
| `published` | `draft` | `unpublish()` |
| `draft` | `archived` | `archive()` |
| `published` | `archived` | `archive()` |
| `scheduled` | `archived` | `archive()` |
| `archived` | *(any)* | blocked — terminal state |

### 4.2 LifecycleCapable Interface

```ts
// src/domain/lifecycle/lifecycle-entity.ts

export type LifecycleStatus = "draft" | "published" | "scheduled" | "archived";

/** Structural interface that entities implement to opt into the lifecycle plugin. */
export interface LifecycleCapable {
  readonly id: string;
  readonly lifecycleStatus: LifecycleStatus;
  readonly publishedAt: Date | null;
  readonly scheduledAt: Date | null;
  /** Transition to published. Throws ConflictError if already archived. */
  publish(): void;
  /** Transition back to draft. Throws ConflictError if archived. */
  unpublish(): void;
  /** Transition to scheduled. Throws ConflictError if already published or archived. */
  schedule(scheduledAt: Date): void;
  /** Transition to archived. Terminal — cannot be undone. */
  archive(): void;
}
```

Each entity that opts in implements this interface in addition to its own domain methods. The interface is structural in TypeScript — no base class required, no runtime check needed.

### 4.3 LifecycleManager Interface

```ts
// src/domain/lifecycle/lifecycle-manager.ts

import type { ContentActor } from "@/domain/iam/content-policy";
import type { LifecycleCapable } from "./lifecycle-entity";

/** Adapter interface that connects a specific resource to the generic lifecycle use cases. */
export interface LifecycleManager<T extends LifecycleCapable> {
  /** Short resource label used in error messages ("post", "book", "chapter"). */
  readonly resourceType: string;
  findById(id: string): Promise<T | null>;
  save(entity: T): Promise<void>;
  canPublish(actor: ContentActor | null, entity: T): Promise<boolean>;
  canUnpublish(actor: ContentActor | null, entity: T): Promise<boolean>;
  canSchedule(actor: ContentActor | null, entity: T): Promise<boolean>;
  canArchive(actor: ContentActor | null, entity: T): Promise<boolean>;
  /** Returns all entities in scheduled state whose scheduledAt is in the past. */
  findScheduledReady(now: Date): Promise<T[]>;
}
```

The adapter owns the permission key selection for each transition (Section 5.4). The generic use case calls the adapter method; it never calls `ContentPolicy` directly.

### 4.4 Generic Lifecycle Use Cases

```ts
// src/application/lifecycle/publish.usecase.ts

export class PublishUseCase<T extends LifecycleCapable> {
  constructor(private readonly manager: LifecycleManager<T>) {}

  async execute(params: { actor: ContentActor; id: string }): Promise<T> {
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

  async execute(params: { actor: ContentActor; id: string }): Promise<T> {
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

export class SchedulePublishUseCase<T extends LifecycleCapable> {
  constructor(private readonly manager: LifecycleManager<T>) {}

  async execute(params: { actor: ContentActor; id: string; scheduledAt: Date }): Promise<T> {
    requireContentScope(params.actor, "content:write");
    if (params.scheduledAt <= new Date()) throw new ValidationError("scheduledAt must be in the future");
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

  async execute(params: { actor: ContentActor; id: string }): Promise<T> {
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

The four use cases live in `src/application/lifecycle/`. They are generic; they are never resource-specific.

### 4.5 Per-Resource Lifecycle Adapters

Each resource that opts in gets one adapter file in `src/infrastructure/lifecycle/`. Example for Post:

```ts
// src/infrastructure/lifecycle/post-lifecycle-manager.ts

export class PostLifecycleManager implements LifecycleManager<Post> {
  readonly resourceType = "post";

  constructor(
    private readonly posts: PostRepository,
    private readonly contentPolicy: ContentPolicy,
  ) {}

  findById(id: string) { return this.posts.findById(id); }
  save(entity: Post) { return this.posts.save(entity); }

  canPublish(actor: ContentActor | null, entity: Post) {
    return this.contentPolicy.can({ actor, permission: "post.publish", resource: postResource(entity) });
  }
  canUnpublish(actor: ContentActor | null, entity: Post) {
    return this.contentPolicy.can({ actor, permission: "post.publish", resource: postResource(entity) });
  }
  canSchedule(actor: ContentActor | null, entity: Post) {
    return this.contentPolicy.can({ actor, permission: "post.publish", resource: postResource(entity) });
  }
  canArchive(actor: ContentActor | null, entity: Post) {
    return this.contentPolicy.can({ actor, permission: "post.delete", resource: postResource(entity) });
  }

  async findScheduledReady(now: Date): Promise<Post[]> {
    return this.posts.findScheduledReady(now);
  }
}
```

The composition container in `src/composition/create-request-container.ts` registers:

```ts
const postLifecycleManager = new PostLifecycleManager(postRepo, contentPolicy);
const posts = {
  // existing CRUD use cases ...
  publish: new PublishUseCase(postLifecycleManager),
  unpublish: new UnpublishUseCase(postLifecycleManager),
  schedule: new SchedulePublishUseCase(postLifecycleManager),
  archive: new ArchiveUseCase(postLifecycleManager),
};
```

Route handler pattern remains unchanged in spirit:

```ts
// posts.routes.ts
.openapi(publishPostRoute, async (c) => {
  const { id } = c.req.valid("param");
  const actor = c.get("actor");
  const post = await c.get("container").posts.publish.execute({ actor, id });
  return c.json(presentPost(post), 200);
})
```

### 4.6 Scheduling And Cron Execution

Cloudflare Workers Cron Triggers run the scheduled publish job on a configurable interval (recommended: every 5 minutes). The cron handler lives at `src/workers/scheduled-publish.ts`:

```ts
// src/workers/scheduled-publish.ts

export async function runScheduledPublish(
  managers: LifecycleManager<LifecycleCapable>[],
  now: Date,
): Promise<void> {
  for (const manager of managers) {
    const ready = await manager.findScheduledReady(now);
    for (const entity of ready) {
      entity.publish();
      await manager.save(entity);
    }
  }
}
```

The cron handler itself is registered in `wrangler.toml`:

```toml
[triggers]
crons = ["*/5 * * * *"]
```

And dispatched in the main Worker's `scheduled` export:

```ts
// src/index.ts
export default {
  // ...fetch handler...
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduledPublish(buildScheduledManagers(env), new Date(event.scheduledTime)));
  },
};
```

The cron does not have an authenticated actor. It calls `entity.publish()` directly, bypassing `canPublish()`. Authorization was already checked when the schedule was set. The cron only executes entities already in `"scheduled"` state.

`findScheduledReady(now)` is bounded: it returns at most 100 entities per run per resource type to avoid long-running executions. If more than 100 entities are overdue, the next cron run processes the next batch.

### 4.7 Content IAM — New Permission Keys

The following additions are needed in `src/domain/iam/content-permission.ts`:

```ts
// New ContentPermissionKey entries:
| "book.publish"
| "book.archive"
| "post.archive"
| "chapter.archive"
| "site_config.publish"   // equivalent to site_config.activate from docs/012

// New CONTENT_PERMISSIONS entries:
{ key: "book.publish",        description: "Publish or unpublish a book",           delegationClass: "ordinary" },
{ key: "book.archive",        description: "Archive a book",                         delegationClass: "ordinary" },
{ key: "post.archive",        description: "Archive a post",                         delegationClass: "ordinary" },
{ key: "chapter.archive",     description: "Archive a chapter",                      delegationClass: "ordinary" },
{ key: "site_config.publish", description: "Activate a site config (promote to live)", delegationClass: "ordinary" },
```

Built-in role updates:

| Role | Added permissions |
|---|---|
| `system:post.owner` | `post.archive` |
| `system:book.owner` | `book.publish`, `book.archive` |
| `system:book.author` | `book.publish` |
| `system:book.editor` | *(no publish — editors update but do not publish)* |
| `system:org.content_admin` | `book.publish`, `book.archive`, `post.archive`, `chapter.archive`, `site_config.publish` |
| `system:org.site_manager` (from docs/012) | `site_config.publish` replaces `site_config.activate` |

The `site_config.activate` permission key defined in `docs/012` should be renamed to `site_config.publish` for consistency with the lifecycle vocabulary. The activate endpoint (`POST /site-configs/{id}/activate`) is renamed to `POST /site-configs/{id}/publish` with a migration note.

### 4.8 Entity Migrations For Existing Resources

**Post entity** (`src/domain/posts/post.entity.ts`):

Changes required:

- `PostStatus` extended from `"draft" | "published"` to `"draft" | "published" | "scheduled" | "archived"`.
- Add `scheduledAt: Date | null` to `PostProps`.
- Add `archivedAt: Date | null` to `PostProps` (optional; useful for audit).
- Add `schedule(scheduledAt: Date): void` method.
- Add `archive(): void` method.
- Existing `publish()` and `unpublish()` methods unchanged.
- Entity now satisfies `LifecycleCapable`; add `get lifecycleStatus(): LifecycleStatus` getter returning `this.props.status`.
- `get scheduledAt()` getter.

DB schema additions to `posts` table: `scheduled_at INTEGER`, `archived_at INTEGER`. New migration: `0006_post_lifecycle_fields` (or combined with other migrations pending).

**Book entity** (`src/domain/books/book.entity.ts`):

Changes required:

- `BookStatus` already includes `"archived"`. Extend to `"draft" | "published" | "scheduled" | "archived"`.
- Add `publish(): void` method (transition `draft | scheduled → published`). Currently book status changes go through generic `update()`.
- Add `unpublish(): void` method (transition `published → draft`).
- Add `schedule(scheduledAt: Date): void` method.
- Book already has `archive()` semantics via `update({ status: "archived" })`; add dedicated `archive(): void` that validates the transition.
- Add `publishedAt: Date | null`, `scheduledAt: Date | null`, `archivedAt: Date | null` to `BookProps`.
- Entity satisfies `LifecycleCapable`.

DB schema additions to `books` table: `published_at INTEGER`, `scheduled_at INTEGER`, `archived_at INTEGER`.

**Post and Book repositories** must add `findScheduledReady(now: Date): Promise<Post[] | Book[]>` returning rows where `status = 'scheduled' AND scheduled_at <= now LIMIT 100`.

### 4.9 Module Layout

```
src/domain/lifecycle/
  lifecycle-entity.ts           # LifecycleStatus, LifecycleCapable interface
  lifecycle-manager.ts          # LifecycleManager<T> adapter interface

src/application/lifecycle/
  publish.usecase.ts
  unpublish.usecase.ts
  schedule-publish.usecase.ts
  archive.usecase.ts

src/infrastructure/lifecycle/
  post-lifecycle-manager.ts
  book-lifecycle-manager.ts
  chapter-lifecycle-manager.ts  # once Chapter entity is implemented
  site-config-lifecycle-manager.ts

src/workers/
  scheduled-publish.ts          # cron execution handler
```

Deleted files once adapters are wired:

```
src/application/posts/publish-post.usecase.ts
src/application/posts/unpublish-post.usecase.ts
src/application/media/publish-media.usecase.ts     # kept — Media is excluded from this plugin
src/application/media/unpublish-media.usecase.ts   # kept — same
```

The Media publish/unpublish use cases are kept as-is because Media uses a different visibility model (`visibility: private | public`, controlled by `media.update`), not the `LifecycleStatus` state machine.

## 5. Architecture Decisions

### 5.1 Interface-Based Plugin, Not Mixin Or Event Bus

The `LifecycleManager<T>` adapter pattern keeps the clean architecture layer boundaries intact:

- `LifecycleCapable` and `LifecycleManager` live in `src/domain/lifecycle/` — domain contracts only, no framework imports.
- Generic use cases live in `src/application/lifecycle/` — orchestration only.
- Per-resource adapters live in `src/infrastructure/lifecycle/` — they compose repository + Content IAM, which are both infrastructure dependencies.
- Entities implement `LifecycleCapable` by adding transition methods — no base class, no inheritance, no runtime coupling.

This mirrors how the `CrudAdapter` pattern works in `src/infrastructure/persistence/crud-adapter.ts`: a central driver class with resource-specific parameterization at the edges.

Adding a new resource (e.g. `Series`, `Collection`) to the lifecycle system requires one new adapter file. It does not touch the generic use cases, the domain interface, or existing adapters.

### 5.2 Superseding 005 Rather Than Extending It

`docs/005` proposed `PublishManager<T>` covering publish/unpublish for two resources (Post, Media), with a flat 4-step orchestration matching the existing policy model (pre-Content IAM). That design predates the full Content IAM system from `docs/007`.

This document replaces `docs/005` because:

- The IAM model changed fundamentally (`ContentPolicy.can(actor, permission, resourceRef)` vs the old `assertAllowed(policy.canPublish(actor))`).
- Four transitions (publish, unpublish, schedule, archive) are needed, not two.
- Media's lifecycle is distinct from editorial lifecycle; `docs/005` conflated them.
- The adapter interface can be designed properly now that the full system is known.

`docs/005` is marked superseded. Its `PublishManager` interface and the planned `PostPublishManager` / `MediaPublishManager` infrastructure adapters should not be created.

### 5.3 Schedule State On The Resource Row, Not A Separate Queue

Scheduled publish state (`status = "scheduled"`, `scheduled_at`) is stored on the resource row itself rather than in a separate job queue or KV store. Reasons:

- D1 is the only store in use; no external queue dependency.
- `SELECT WHERE status = 'scheduled' AND scheduled_at <= now` is a bounded indexed query.
- Canceling a schedule is a simple `UPDATE` (calling `entity.unpublish()`).
- The scheduled entity is immediately visible in list/get endpoints with its status, giving authors clear feedback.

The tradeoff: precision is limited to the cron interval (5 minutes). For editorial content this is acceptable. Sub-minute scheduling precision would require a Durable Object or Queue; that is a future concern.

### 5.4 One Permission Check Per Transition, Adapter Decides Which Key

The generic use case calls `manager.canPublish(actor, entity)` — a black box returning `Promise<boolean>`. The adapter decides which Content IAM permission key maps to each transition. This keeps the use case free of resource-specific permission vocabulary.

For example:

- `PostLifecycleManager.canPublish` → `ContentPolicy.can("post.publish", ...)`
- `BookLifecycleManager.canPublish` → `ContentPolicy.can("book.publish", ...)`
- `SiteConfigLifecycleManager.canPublish` → `ContentPolicy.can("site_config.publish", ...)`

`canArchive` is mapped to the deletion permission in v1 for resources where archiving and deletion are equivalent in IAM terms (e.g. `post.delete` for Post). Resources with distinct archive authority can add a dedicated `post.archive` permission key instead.

### 5.5 Media Excluded From This Plugin

`Media` has a processing pipeline status (`pending_upload → processing → ready → failed/expired`) that is driven by background jobs, not editorial decisions. Visibility (`private → public`) is a separate property from processing status. Wrapping Media in `LifecycleCapable` would require mapping `lifecycleStatus` from two orthogonal fields, which would mislead the generic use cases.

The existing `publish-media.usecase.ts` and `unpublish-media.usecase.ts` are kept as-is.

### 5.6 Archive As A Terminal State In Level 1

In Level 1, `archived` is terminal: no transition out. Rationale: archiving signals deliberate removal from the live site. Allowing un-archiving would require product decisions about what "un-archive" means (restore to draft? restore to published?). Keeping it terminal avoids ambiguity. If un-archive is needed, the use case is to duplicate the entity and start a new draft.

### 5.7 Rejected: Trait / Mixin On Entity Class

A `publishable()` mixin factory that adds `publish()`, `unpublish()`, etc. to entity classes would require TypeScript structural gymnastics and would couple entity classes to the lifecycle library. The interface approach (`LifecycleCapable`) is purely a contract; the entity implements it explicitly and owns the invariant checks.

### 5.8 Rejected: Event-Driven Publish

Emitting a `PublishRequested` domain event consumed by a handler per resource would add async indirection for what is a synchronous, caller-visible state change. Publish returns the updated entity to the caller. Event-driven adds complexity (event bus, handler registration, error propagation) without addressing the core problem (duplicated orchestration).

## 6. Resource Coverage Matrix

### 6.1 Post

`Post` (`src/domain/posts/post.entity.ts`) already has `publish()`, `unpublish()`, `status`, and `publishedAt`. It needs:

- Status extended to include `"scheduled"` and `"archived"`.
- `scheduledAt` and `archivedAt` fields.
- `schedule(scheduledAt)` and `archive()` transition methods.
- `lifecycleStatus` getter returning `this.props.status` cast to `LifecycleStatus`.

Existing `PublishPostUseCase` and `UnpublishPostUseCase` are deleted after `PostLifecycleManager` is wired.

Permissions: `post.publish` (existing), `post.archive` (new).

Routes added to `posts.routes.ts`: `POST /posts/{id}/schedule`, `POST /posts/{id}/archive`. Existing `POST /posts/{id}/publish` and `POST /posts/{id}/unpublish` routes are unchanged (same URL, different handler plumbing via lifecycle use case).

### 6.2 Book

`Book` (`src/domain/books/book.entity.ts`) has `status: "draft" | "published" | "archived"` but no dedicated lifecycle methods. It needs:

- `publish()`, `unpublish()`, `schedule(scheduledAt)`, `archive()` methods (not generic `update({ status })`).
- `publishedAt`, `scheduledAt`, `archivedAt` fields added to `BookProps`.
- `lifecycleStatus` getter.

Book status via the generic PATCH route can still accept `status` in `UpdateBookProps` for convenience, but the lifecycle methods must be used by lifecycle use cases. Remove `"status"` from the `PATCH /books/{id}` route's accepted body fields, or keep it only for admin-only override with a separate permission check.

Permissions: `book.publish` (new), `book.archive` (new).

Routes added to `books.routes.ts`: `POST /books/{id}/publish`, `POST /books/{id}/unpublish`, `POST /books/{id}/schedule`, `POST /books/{id}/archive`.

### 6.3 Chapter

Chapter is not yet fully implemented as a standalone resource (pending from `docs/009`). When Chapter is built, it should implement `LifecycleCapable` from the start. The `chapter.publish` permission key already exists. A `ChapterLifecycleManager` is added to `src/infrastructure/lifecycle/` at that time.

The lifecycle interface is a write-once design decision: the Chapter entity author does not need to design publish semantics from scratch.

### 6.4 SiteConfig

`SiteConfig` (from `docs/012`) uses the vocabulary `draft | active | archived` where `active` = `published`. When the lifecycle plugin is adopted for SiteConfig:

- `status` field is renamed to `lifecycleStatus` (or a getter maps `"active"` → `"published"`).
- `activate()` method is renamed `publish()`.
- `activatedAt` maps to `publishedAt`.
- `ActivateSiteConfigUseCase` is replaced by `PublishUseCase<SiteConfig>`.
- The `POST /site-configs/{id}/activate` endpoint is renamed to `POST /site-configs/{id}/publish` (301 redirect for compatibility).
- `site_config.activate` permission key is renamed to `site_config.publish`.

The SiteConfig adapter enforces the single-active-per-org invariant inside `SiteConfigLifecycleManager.save()`, which calls `siteConfigRepo.activateAtomic(entity)` instead of a plain `save`.

### 6.5 Resources Excluded In V1

| Resource | Reason |
|---|---|
| Media | Separate processing pipeline; visibility ≠ editorial lifecycle |
| Category | Shared org taxonomy; no draft/publish concept |
| User | Identity, not content |
| Comment | Comment moderation is not a publish lifecycle |
| Bookmark / Reading progress | User-private data, not publishable |

## 7. Edge Cases And Failure Modes

- **Publishing an archived entity**: `entity.publish()` throws `ConflictError("Cannot publish an archived …")`. The use case propagates as `409`.
- **Scheduling in the past**: `SchedulePublishUseCase` validates `scheduledAt > now` before calling the entity. Returns `400 Bad Request`.
- **Cron fires while a manual publish is in flight**: Both attempt `entity.publish(); manager.save(entity)`. D1 does not provide row-level locking in SQLite. The second writer overwrites with an already-published entity, which is idempotent — `publish()` on an already-published entity is a no-op if the method is made safe (check `status !== "published"` before setting fields). The entity method should be idempotent or throw if already published; idempotent is safer for cron.
- **Cron batch > 100 entities**: `findScheduledReady` is capped at 100. The next cron execution (5 min later) processes the remainder. High-volume schedules (e.g. 500 posts scheduled for 09:00) will fully publish within 25 minutes. This is acceptable for editorial content.
- **Cron failure mid-batch**: Already-published entities in the batch are not re-published (idempotent). Unpublished entities in the interrupted batch are picked up by the next cron run (they remain in `scheduled` state).
- **`unpublish()` on a draft**: `ConflictError` — already in draft, no transition needed. The use case should check `lifecycleStatus !== "draft"` before calling `unpublish()` and return a sensible error.
- **Archive of an active SiteConfig**: Archiving the currently active site config would leave the site with no active config. `SiteConfigLifecycleManager.canArchive()` should additionally check whether the entity is the active config and either block the operation or require a replacement to be activated first.
- **DB migration for existing posts/books**: The new columns (`scheduled_at`, `archived_at`, `published_at` for books) are nullable. Existing rows with `status = "published"` will have `published_at = NULL` after migration; a one-time backfill can set `published_at = updated_at` as an approximation, or leave NULL and populate on next publish.

## 8. Future Backlog

### 8.1 Level 2: Draft/Live Split

In the current (Level 1) design, editing a published resource mutates it directly. There is no "working copy" that authors can iterate on while readers see the stable published version.

Level 2 adds a draft/live split:

- The live resource row holds the published state.
- A `content_drafts` table holds a working draft for the resource:

```ts
export const contentDrafts = sqliteTable(
  "content_drafts",
  {
    id: text("id").primaryKey(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    orgId: text("org_id").notNull(),
    snapshotJson: text("snapshot_json", { mode: "json" }).notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("content_drafts_resource_idx").on(table.resourceType, table.resourceId),
  ],
);
```

Workflow:

```text
PATCH /posts/{id}          → creates or updates a content_drafts row (not the live posts row)
GET /posts/{id}?draft=true → returns draft snapshot
GET /posts/{id}            → returns live row
POST /posts/{id}/publish   → applies draft snapshot to live row, deletes draft row
```

The `LifecycleManager<T>` interface gains an optional `saveDraft(entity: T): Promise<void>` and `findDraft(id: string): Promise<T | null>`. Adapters that support Level 2 implement these; adapters that do not use the default Level 1 behavior (live row editing).

The JSON snapshot schema is validated by the same Zod schema used at the API boundary for that resource type. Type safety lives in the application, not the DB column.

### 8.2 Level 3: Full Version History

Level 3 adds a version history table so every publish creates a retrievable snapshot:

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
    uniqueIndex("content_versions_resource_version_idx").on(
      table.resourceType,
      table.resourceId,
      table.versionNumber,
    ),
    index("content_versions_resource_idx").on(table.resourceType, table.resourceId),
  ],
);
```

`PublishUseCase` is augmented to write a `content_versions` row atomically with the resource save. A new `RollbackUseCase<T>` re-applies a past version snapshot to the live row and writes a new version entry.

API additions: `GET /{resources}/{id}/versions`, `POST /{resources}/{id}/versions/{versionNumber}/restore`.

Version retention policy (e.g. keep last 50 versions per resource) is a separate operational concern.

### 8.3 Scheduled Publish With Retry And Dead Letter

The cron approach in Level 1 has no retry logic — if `entity.publish()` or `manager.save(entity)` throws, the entity stays in `scheduled` state and the next cron run retries. This is acceptable for editorial content.

For higher-reliability requirements (SLAs, audit of publish failures), a Cloudflare Queue or Durable Object-based scheduler can replace the cron. Each entity's scheduled publish becomes a queue message with the entity ID and scheduled time. The queue consumer publishes the entity and acknowledges the message on success. Failed messages are retried by the queue's built-in retry mechanism.

This is a future replacement for the cron handler with no change to the entity or use case interfaces.

## 9. Definition Of Done

- `LifecycleCapable` interface and `LifecycleStatus` type in `src/domain/lifecycle/lifecycle-entity.ts`.
- `LifecycleManager<T>` interface in `src/domain/lifecycle/lifecycle-manager.ts`.
- Four generic use cases in `src/application/lifecycle/`: `PublishUseCase`, `UnpublishUseCase`, `SchedulePublishUseCase`, `ArchiveUseCase`.
- `PostLifecycleManager` in `src/infrastructure/lifecycle/post-lifecycle-manager.ts`; existing `PublishPostUseCase` and `UnpublishPostUseCase` deleted.
- `BookLifecycleManager` in `src/infrastructure/lifecycle/book-lifecycle-manager.ts`.
- `Post` entity extended with `schedule()`, `archive()`, `scheduledAt`, `archivedAt`; `PostStatus` includes `"scheduled"` and `"archived"`.
- `Book` entity extended with `publish()`, `unpublish()`, `schedule()`, `archive()`, `publishedAt`, `scheduledAt`, `archivedAt`.
- New permission keys (`book.publish`, `book.archive`, `post.archive`, `chapter.archive`, `site_config.publish`) added to `content-permission.ts`; affected built-in roles updated.
- DB migration adding `scheduled_at`, `archived_at` to `posts`; `published_at`, `scheduled_at`, `archived_at` to `books`.
- `findScheduledReady(now)` method on `PostRepository` and `BookRepository`.
- Cron handler `src/workers/scheduled-publish.ts` registered in `wrangler.toml`; runs every 5 minutes.
- Routes: `POST /posts/{id}/schedule`, `POST /posts/{id}/archive`, `POST /books/{id}/publish`, `POST /books/{id}/unpublish`, `POST /books/{id}/schedule`, `POST /books/{id}/archive`.
- All existing publish/unpublish routes for Post continue to work with the same request/response shape.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` pass.
- `pnpm advise` shows no new unacknowledged findings.
- `README.md` updated.

## 10. Final Model

```
src/domain/lifecycle/
  lifecycle-entity.ts       # LifecycleStatus, LifecycleCapable interface
  lifecycle-manager.ts      # LifecycleManager<T> adapter interface

src/application/lifecycle/
  publish.usecase.ts
  unpublish.usecase.ts
  schedule-publish.usecase.ts
  archive.usecase.ts

src/infrastructure/lifecycle/
  post-lifecycle-manager.ts
  book-lifecycle-manager.ts
  chapter-lifecycle-manager.ts      # added when Chapter entity is built
  site-config-lifecycle-manager.ts  # replaces bespoke ActivateSiteConfigUseCase

src/workers/
  scheduled-publish.ts              # Cloudflare Cron Trigger handler
```

The lifecycle plugin is opt-in: a resource opts in by implementing `LifecycleCapable` on its entity and creating one `LifecycleManager<T>` adapter. Adding a new resource to the lifecycle system costs one adapter file. The generic use cases are never modified.

Level 1 (this release) covers four transitions (publish, unpublish, schedule, archive) with a status machine on the resource row. Level 2 (draft/live split) and Level 3 (versioning) extend the system using the same adapter interface without requiring breaking changes to Level 1 entities or use cases.

`docs/005` is superseded by this document. Its `PublishManager<T>` interface design and planned `PostPublishManager` / `MediaPublishManager` infrastructure adapters should not be created.

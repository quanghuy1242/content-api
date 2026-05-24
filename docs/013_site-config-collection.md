# Site Config Collection

> Status: implementation-grade proposal — ready for handoff (depends on docs/013)
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
> - `docs/007_content-iam-policy-binding-model.md`
> - `docs/009_book-resource-hierarchy-and-collaboration-plan.md`
> - `docs/013_content-lifecycle-plugin.md` — required prerequisite; lifecycle vocabulary and adapter interface live there
> - `.claude/skills/content-api-architecture/SKILL.md`
> - `.claude/skills/content-iam-usage/SKILL.md`
> - `src/domain/iam/content-permission.ts`
> - `src/domain/iam/content-policy.ts`
> - `src/domain/iam/resource-loader.ts`
> - `src/domain/posts/post.entity.ts`
> - `src/domain/media/media.entity.ts`
> - `src/infrastructure/db/schema.ts`
> - `src/infrastructure/persistence/crud-adapter.ts`
>
> Related docs:
>
> - `docs/013_content-lifecycle-plugin.md` — SiteConfig adopts the lifecycle plugin from day one
>
> Assumptions:
>
> - Content IAM (`docs/007`) is operational. SiteConfig integrates exactly as Book/Post do.
> - `docs/013` (Content Lifecycle Plugin) lands first. SiteConfig depends on `LifecycleCapable`, `LifecycleManager<T>`, the four generic use cases, and the partial-index pattern for `(scheduled_at) WHERE status = 'scheduled'`.
> - Blocks are validated at the API boundary by Zod and stored as a single JSON column. D1 (SQLite) supports JSON querying only through `json_extract`; this is acceptable because no first-release feature needs to query blocks by content.
> - At most one `SiteConfig` per org may have `status = "published"` at a time. The invariant is enforced both by a DB partial unique index and by adapter-level checks.
> - The `category.owner` system role is already marked deprecated in code with a reference to this doc; this doc formalizes that rationale.
> - The `aboutContent` field is a Lexical editor state (`unknown` JSON object), not plain text. Validation accepts any JSON object at the boundary; the front-end deserializes it as Lexical state.
> - The slug is caller-supplied at create time and must be unique per org. The server validates shape and uniqueness; auto-derivation from `name` is the fallback when omitted.

## Table Of Contents

- [1. Goal](#1-goal)
- [2. System Summary](#2-system-summary)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 Relevant Files](#31-relevant-files)
  - [3.2 Current Behavior](#32-current-behavior)
  - [3.3 Current Problems](#33-current-problems)
- [4. Target Model](#4-target-model)
  - [4.1 What A SiteConfig Is](#41-what-a-siteconfig-is)
  - [4.2 Lifecycle Mapping](#42-lifecycle-mapping)
  - [4.3 Activation Model And Single-Published Invariant](#43-activation-model-and-single-published-invariant)
  - [4.4 Dynamic Block Schema](#44-dynamic-block-schema)
  - [4.5 SiteConfig Entity](#45-siteconfig-entity)
  - [4.6 Repository Contract](#46-repository-contract)
  - [4.7 Database Schema](#47-database-schema)
  - [4.8 Content IAM Integration](#48-content-iam-integration)
  - [4.9 Application Use Cases](#49-application-use-cases)
  - [4.10 SiteConfig Lifecycle Adapter](#410-siteconfig-lifecycle-adapter)
  - [4.11 HTTP API Surface](#411-http-api-surface)
  - [4.12 Categories As Org-Owned Resources (Formal Rationale)](#412-categories-as-org-owned-resources-formal-rationale)
  - [4.13 Module Layout](#413-module-layout)
- [5. Architecture Decisions](#5-architecture-decisions)
  - [5.1 Multiple Promotable Configs](#51-multiple-promotable-configs)
  - [5.2 Lifecycle Plugin From Day One](#52-lifecycle-plugin-from-day-one)
  - [5.3 Zod Discriminated Union Stored As JSON](#53-zod-discriminated-union-stored-as-json)
  - [5.4 Org-Level IAM Only For Site Configs](#54-org-level-iam-only-for-site-configs)
  - [5.5 Active SiteConfig Cannot Be Archived](#55-active-siteconfig-cannot-be-archived)
  - [5.6 Caller-Supplied Slug With Server Validation](#56-caller-supplied-slug-with-server-validation)
  - [5.7 aboutContent Is Lexical JSON](#57-aboutcontent-is-lexical-json)
  - [5.8 Rejected Options](#58-rejected-options)
- [6. Implementation Strategy](#6-implementation-strategy)
- [7. Migration And Rollout](#7-migration-and-rollout)
- [8. Edge Cases And Failure Modes](#8-edge-cases-and-failure-modes)
- [9. Implementation Backlog](#9-implementation-backlog)
  - [SCG-A. Domain Foundation And Schema](#scg-a-domain-foundation-and-schema)
  - [SCG-B. Block Schema And Shared Validation](#scg-b-block-schema-and-shared-validation)
  - [SCG-C. Repository And Workflow](#scg-c-repository-and-workflow)
  - [SCG-D. Application Use Cases](#scg-d-application-use-cases)
  - [SCG-E. Lifecycle Adapter Integration](#scg-e-lifecycle-adapter-integration)
  - [SCG-F. HTTP Routes And Presenter](#scg-f-http-routes-and-presenter)
  - [SCG-G. Composition Wiring And Cron Registration](#scg-g-composition-wiring-and-cron-registration)
  - [SCG-H. Documentation And Cleanup](#scg-h-documentation-and-cleanup)
- [10. Future Backlog](#10-future-backlog)
- [11. Test And Verification Plan](#11-test-and-verification-plan)
- [12. Definition Of Done](#12-definition-of-done)
- [13. Final Model](#13-final-model)

## 1. Goal

Introduce `site_configs` as a first-class org-scoped content collection. A `SiteConfig` is a promotable configuration record that drives the appearance and structure of a front-end site: top-level metadata (title, bio, about text, hero media) and an ordered list of typed dynamic blocks. Multiple configs exist per org; exactly one is published (active) at a time. Authors maintain campaign variants, seasonal themes, or mood-driven layouts and switch between them with a single `publish` call.

SiteConfig is the **first new resource implemented against the Content Lifecycle Plugin from day one** — it does not ship a bespoke activate use case. Its `draft → scheduled → published → archived` flow is the same code path used by Post and Book.

This document also formally records the rationale for the `category.owner` role being deprecated and categories being org-owned resources rather than per-user-owned content. The `BUILT_IN_CONTENT_ROLES` constant in [src/domain/iam/content-permission.ts](../src/domain/iam/content-permission.ts) already references this doc as the source of truth.

Non-goals for the first release:

- Real-time preview of a non-published SiteConfig in the live front-end (covered by a future preview-token flow).
- Block-level IAM bindings (org-level authority is sufficient for site configuration).
- Importing/exporting site configs across orgs.
- Querying or indexing block contents in SQL (acceptable because the front-end consumes the JSON whole).
- Draft/live separation of the *currently published* config (a published config is mutated in place — see `docs/013 §11.1` for the future split).

## 2. System Summary

Typical author flow:

```text
author
  ┌─ POST   /site-configs                         create a draft
  │           Idempotency-Key, body: { name, slug?, ... }
  ├─ PATCH  /site-configs/{id}                    edit metadata / blocks
  ├─ POST   /site-configs/{id}/schedule           optional: set scheduledAt
  ├─ POST   /site-configs/{id}/publish            promote to live (atomically archives previous active)
  ├─ POST   /site-configs/{id}/unpublish          published → draft (rare; usually replace via publish another)
  ├─ POST   /site-configs/{id}/archive            non-active config only
  └─ DELETE /site-configs/{id}                    destroy a draft or archived config

front-end
  └─ GET    /site-configs/active                  unauthenticated; renders the live site
```

Content IAM evaluation:

| Operation | Scope | Permission | Resource ref |
|---|---|---|---|
| Create | `content:write` | `site_config.create` | `organizationResource(orgId)` |
| Read active | none | none (public) | — |
| Read draft/scheduled/archived | `content:read` | `site_config.read` | `siteConfigResource(config)` |
| Update | `content:write` | `site_config.update` | `siteConfigResource(config)` |
| Publish (incl. schedule/unpublish) | `content:write` | `site_config.publish` | `siteConfigResource(config)` |
| Archive | `content:write` | `site_config.archive` | `siteConfigResource(config)` (+ active-guard) |
| Delete | `content:write` | `site_config.delete` | `siteConfigResource(config)` |

## 3. Current-State Findings

### 3.1 Relevant Files

| File | Role in this work |
|---|---|
| `src/domain/iam/content-permission.ts` | `ContentPermissionKey`, `ContentResourceType`, `CONTENT_PERMISSIONS`, `BUILT_IN_CONTENT_ROLES`. Updated by `docs/013` to add `site_config.*` keys and the `system:org.site_manager` role. |
| `src/domain/iam/resource-loader.ts` | Resource-ref helpers. New `siteConfigResource(config)` needed. |
| `src/domain/posts/post.entity.ts` | Reference entity pattern with class, props, create, reconstitute, toSnapshot. |
| `src/domain/books/book.entity.ts` | Reference entity with status field; soon implements `LifecycleCapable` (docs/013). |
| `src/infrastructure/db/schema.ts` | Existing Drizzle tables. No `site_configs` table. |
| `src/infrastructure/persistence/crud-adapter.ts` | Shared CRUD primitive; gains `findRowsWhere` and `updateRowsConditional` in `docs/013`. SiteConfig uses both. |
| `src/infrastructure/repositories/drizzle-book-create.workflow.ts` | Reference workflow port: idempotent batch insert + owner binding + audit event. |
| `src/application/posts/create-post.usecase.ts` | Reference idempotent create use case. |
| `src/composition/create-request-container.ts` | Per-request DI graph where SiteConfig use cases must register. |
| `src/http/routes/posts.routes.ts` | Reference route module pattern (`createRoute` + `app.openapi`). |

### 3.2 Current Behavior

There is no `site_configs` table. `ContentResourceType` does not include `"site_config"`. `ContentPermissionKey` has no site-config permissions. The `BUILT_IN_CONTENT_ROLES` array has no `system:org.site_manager` role.

The `category.owner` built-in role is already marked deprecated in code (`src/domain/iam/content-permission.ts` line ~172) with a comment pointing at this doc. `org.author` already includes `category.read/update/delete`. No code path creates a `category.owner` binding on category creation.

### 3.3 Current Problems

- No place to store site-level metadata or layout configuration for the front-end. Sites currently hardcode title, bio, hero image, etc. in code.
- No mechanism for A/B layouts, seasonal campaigns, or mood-variant sites without a deploy.
- The categories-as-org-owned decision is implemented but undocumented; the code points at "docs/012" which does not yet exist.

## 4. Target Model

### 4.1 What A SiteConfig Is

An org-scoped configuration record. An org may have many; exactly one is `published` at any time. Each config carries:

| Field | Type | Purpose |
|---|---|---|
| `id` | `string` (uuid) | Primary key |
| `orgId` | `string` | Org tenancy boundary |
| `name` | `string` | Human label, e.g. `"Summer 2026 Campaign"` |
| `slug` | `string` | URL-safe identifier, unique within org. Caller-supplied or server-derived. |
| `status` | `LifecycleStatus` (`"draft" \| "scheduled" \| "published" \| "archived"`) | Provided by the lifecycle plugin |
| `pageTitle` | `string \| null` | `<title>` and OG title |
| `bio` | `string \| null` | Short author/site bio (plain text) |
| `aboutContent` | `unknown \| null` | Lexical editor state (JSON) for richer About content |
| `heroMediaId` | `string \| null` | FK to `media.id` (`onDelete: "set null"`) |
| `blocks` | `SiteBlock[]` (max 30) | Ordered dynamic sections, Zod-validated, stored as JSON |
| `publishedAt` | `Date \| null` | Set by `publish()` |
| `scheduledAt` | `Date \| null` | Set by `schedule(scheduledAt)` |
| `archivedAt` | `Date \| null` | Set by `archive()` |
| `createdByUserId` | `string` | FK to `users.id` (`onDelete: "restrict"`) |
| `createdAt` | `Date` | |
| `updatedAt` | `Date` | |

### 4.2 Lifecycle Mapping

SiteConfig adopts `docs/013` directly. The vocabulary uses the same words:

| Lifecycle state | SiteConfig meaning |
|---|---|
| `draft` | Work in progress; not visible to the public front-end. |
| `scheduled` | Set to auto-publish at `scheduledAt` via the hourly cron. |
| `published` | The active configuration; rendered by `GET /site-configs/active`. |
| `archived` | Retired and immutable; cannot become active again. |

Publish transition has a side-effect on another row (atomic deactivation of the currently-published config). This is handled inside the adapter's `save()` path — see [§4.10](#410-siteconfig-lifecycle-adapter).

### 4.3 Activation Model And Single-Published Invariant

Only one config per org may be `status = 'published'`. Invariant enforced at three layers:

1. **DB**: partial unique index `site_configs_single_published_org_idx` on `(org_id) WHERE status = 'published'`. Any second concurrent publish fails with a unique-constraint error; infrastructure translates it to `ConflictError`.
2. **Adapter `save()`**: when persisting a config whose new status is `published`, the adapter issues a D1 batch:

```sql
-- Step A: archive the current published config in this org (no-op for first ever publish).
UPDATE site_configs
   SET status = 'archived', published_at = NULL, archived_at = ?, updated_at = ?
 WHERE org_id = ? AND status = 'published' AND id != ?;

-- Step B: persist the new published row (insert if new, update if existing).
UPDATE site_configs
   SET status = 'published', published_at = ?, scheduled_at = NULL, archived_at = NULL, updated_at = ?,
       name = ?, slug = ?, page_title = ?, bio = ?, about_content_json = ?, hero_media_id = ?, blocks_json = ?
 WHERE id = ?;
```

3. **Adapter `canArchive`**: refuses to archive the currently-published config. Caller must publish a replacement first.

The first publish ever for an org has no predecessor; Step A is a no-op.

There is no `deactivate` operation. To go dark, publish a minimal "maintenance mode" config.

### 4.4 Dynamic Block Schema

Blocks are validated at the API boundary with a Zod discriminated union and stored as a JSON array (`blocks_json` text column).

```ts
// src/domain/site-config/site-block.schema.ts
import { z } from "@hono/zod-openapi";

export const heroBlockSchema = z.object({
  type: z.literal("hero"),
  title: z.string().min(1).max(200),
  subtitle: z.string().max(500).optional(),
  mediaId: z.string().uuid().optional(),
  cta: z.object({ label: z.string().min(1).max(80), url: z.string().url() }).optional(),
}).openapi("HeroBlock");

export const bioBlockSchema = z.object({
  type: z.literal("bio"),
  body: z.string().min(1).max(2000),
  avatarMediaId: z.string().uuid().optional(),
}).openapi("BioBlock");

export const aboutBlockSchema = z.object({
  type: z.literal("about"),
  heading: z.string().max(200).optional(),
  body: z.string().min(1).max(8000),
}).openapi("AboutBlock");

export const featuredPostsBlockSchema = z.object({
  type: z.literal("featured_posts"),
  heading: z.string().max(200).optional(),
  postIds: z.array(z.string().uuid()).max(12),
}).openapi("FeaturedPostsBlock");

export const linksBlockSchema = z.object({
  type: z.literal("links"),
  heading: z.string().max(200).optional(),
  items: z.array(
    z.object({ label: z.string().min(1).max(80), url: z.string().url() }),
  ).max(20),
}).openapi("LinksBlock");

export const siteBlockSchema = z.discriminatedUnion("type", [
  heroBlockSchema,
  bioBlockSchema,
  aboutBlockSchema,
  featuredPostsBlockSchema,
  linksBlockSchema,
]).openapi("SiteBlock");

export const siteBlocksSchema = z.array(siteBlockSchema).max(30).openapi("SiteBlocks");

export type SiteBlock = z.infer<typeof siteBlockSchema>;
export type SiteBlocks = z.infer<typeof siteBlocksSchema>;
```

Adding a new block type is a code change: extend `siteBlockSchema`. Existing rows remain valid because the discriminator is a closed-set literal — a row that contains an unknown discriminant survives a future deploy only if the deploy preserves the old block type or strips unknown blocks during read. To keep read paths resilient, the row-to-entity mapper uses `siteBlocksSchema.safeParse(...)`; on failure it falls back to filtering blocks individually with `siteBlockSchema.safeParse(...)` and dropping unrecognized entries (with a structured `console.warn` event to flag rollbacks).

`aboutContent` is typed as `unknown` and validated only as "is a JSON object". Lexical editor state is a tree that varies by editor configuration; the API contract is "JSON in, JSON out".

### 4.5 SiteConfig Entity

```ts
// src/domain/site-config/site-config.entity.ts
import type { LifecycleCapable, LifecycleStatus } from "@/domain/lifecycle/lifecycle-entity";
import type { SiteBlocks } from "@/domain/site-config/site-block.schema";
import { ConflictError } from "@/shared/errors";

export type SiteConfigProps = {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  status: LifecycleStatus;
  pageTitle: string | null;
  bio: string | null;
  aboutContent: unknown | null;        // Lexical JSON
  heroMediaId: string | null;
  blocks: SiteBlocks;
  publishedAt: Date | null;
  scheduledAt: Date | null;
  archivedAt: Date | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateSiteConfigProps = Omit<
  SiteConfigProps,
  "id" | "status" | "publishedAt" | "scheduledAt" | "archivedAt" | "createdAt" | "updatedAt"
>;

export type UpdateSiteConfigProps = Partial<
  Pick<SiteConfigProps, "name" | "pageTitle" | "bio" | "aboutContent" | "heroMediaId" | "blocks">
>;

/**
 * Org-scoped, promotable site configuration.
 * The entity owns lifecycle state transitions and content invariants. It does
 * not enforce the single-published-per-org rule by itself — that is the
 * SiteConfigLifecycleManager's responsibility through an atomic DB batch.
 */
export class SiteConfig implements LifecycleCapable {
  private constructor(private props: SiteConfigProps) {}

  static create(input: CreateSiteConfigProps): SiteConfig {
    const now = new Date();
    return new SiteConfig({
      ...input,
      id: crypto.randomUUID(),
      status: "draft",
      publishedAt: null,
      scheduledAt: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      blocks: [...input.blocks],
    });
  }

  static reconstitute(props: SiteConfigProps): SiteConfig {
    return new SiteConfig({ ...props, blocks: [...props.blocks] });
  }

  get id() { return this.props.id; }
  get orgId() { return this.props.orgId; }
  get name() { return this.props.name; }
  get slug() { return this.props.slug; }
  get status() { return this.props.status; }
  get lifecycleStatus(): LifecycleStatus { return this.props.status; }
  get pageTitle() { return this.props.pageTitle; }
  get bio() { return this.props.bio; }
  get aboutContent() { return this.props.aboutContent; }
  get heroMediaId() { return this.props.heroMediaId; }
  get blocks(): SiteBlocks { return [...this.props.blocks]; }
  get publishedAt() { return this.props.publishedAt; }
  get scheduledAt() { return this.props.scheduledAt; }
  get archivedAt() { return this.props.archivedAt; }
  get createdByUserId() { return this.props.createdByUserId; }
  get createdAt() { return this.props.createdAt; }
  get updatedAt() { return this.props.updatedAt; }

  update(input: UpdateSiteConfigProps): void {
    if (this.props.status === "archived") throw new ConflictError("Cannot update an archived site config");
    if (input.name !== undefined) this.props.name = input.name;
    if (input.pageTitle !== undefined) this.props.pageTitle = input.pageTitle;
    if (input.bio !== undefined) this.props.bio = input.bio;
    if (input.aboutContent !== undefined) this.props.aboutContent = input.aboutContent;
    if (input.heroMediaId !== undefined) this.props.heroMediaId = input.heroMediaId;
    if (input.blocks !== undefined) this.props.blocks = [...input.blocks];
    this.props.updatedAt = new Date();
  }

  publish(): void {
    if (this.props.status === "archived") throw new ConflictError("Cannot publish an archived site config");
    if (this.props.status === "published") throw new ConflictError("Site config is already published");
    this.props.status = "published";
    this.props.publishedAt = new Date();
    this.props.scheduledAt = null;
    this.props.archivedAt = null;
    this.props.updatedAt = new Date();
  }

  unpublish(): void {
    if (this.props.status === "archived") throw new ConflictError("Cannot unpublish an archived site config");
    if (this.props.status === "draft") throw new ConflictError("Site config is already a draft");
    this.props.status = "draft";
    this.props.publishedAt = null;
    this.props.scheduledAt = null;
    this.props.updatedAt = new Date();
  }

  schedule(scheduledAt: Date): void {
    if (this.props.status !== "draft") throw new ConflictError(`Cannot schedule a ${this.props.status} site config`);
    this.props.status = "scheduled";
    this.props.scheduledAt = scheduledAt;
    this.props.updatedAt = new Date();
  }

  archive(): void {
    if (this.props.status === "archived") throw new ConflictError("Site config is already archived");
    // SiteConfigLifecycleManager.canArchive enforces "not the currently-published config".
    this.props.status = "archived";
    this.props.archivedAt = new Date();
    this.props.scheduledAt = null;
    this.props.updatedAt = new Date();
  }

  toSnapshot(): SiteConfigProps {
    return { ...this.props, blocks: [...this.props.blocks] };
  }
}
```

### 4.6 Repository Contract

```ts
// src/domain/site-config/site-config.repository.ts
import type { SiteConfig } from "@/domain/site-config/site-config.entity";
import type { CursorPage } from "@/shared/pagination/cursor";

export interface SiteConfigRepository {
  findById(id: string): Promise<SiteConfig | null>;
  findActiveByOrgId(orgId: string): Promise<SiteConfig | null>;
  findBySlug(orgId: string, slug: string): Promise<SiteConfig | null>;
  listByOrgId(params: { orgId: string; limit: number; cursor?: string }): Promise<CursorPage<SiteConfig>>;
  save(config: SiteConfig): Promise<void>;
  delete(id: string): Promise<boolean>;

  /** Required by the lifecycle plugin (docs/013 §4.5). */
  findScheduledReadyIds(now: Date, limit: number): Promise<readonly string[]>;
  publishScheduledReady(id: string, now: Date): Promise<boolean>;
}
```

A separate workflow port handles the atomic publish:

```ts
// src/domain/site-config/site-config-publish.workflow.ts
import type { SiteConfig } from "@/domain/site-config/site-config.entity";

export interface SiteConfigPublishWorkflow {
  /**
   * Atomically archives the currently-published config for the org (if any)
   * and persists `config` with status='published'. Translates a unique-index
   * violation on (org_id) WHERE status='published' into ConflictError.
   */
  publishAtomic(config: SiteConfig): Promise<void>;
}
```

### 4.7 Database Schema

Migration: `drizzle/0008_site_configs.sql` (one ordinal after `0007_lifecycle_fields.sql` from `docs/013`).

```sql
CREATE TABLE site_configs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  page_title TEXT,
  bio TEXT,
  about_content_json TEXT,
  hero_media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  blocks_json TEXT NOT NULL DEFAULT '[]',
  published_at INTEGER,
  scheduled_at INTEGER,
  archived_at INTEGER,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE UNIQUE INDEX site_configs_org_slug_idx ON site_configs (org_id, slug);
CREATE INDEX site_configs_org_status_idx ON site_configs (org_id, status);

-- Single-published-per-org invariant (matches publish flow §4.3).
CREATE UNIQUE INDEX site_configs_single_published_org_idx
  ON site_configs (org_id) WHERE status = 'published';

-- Cron predicate (matches docs/013 §4.5 partial index pattern).
CREATE INDEX site_configs_scheduled_idx
  ON site_configs (scheduled_at) WHERE status = 'scheduled';
```

Drizzle schema added to [src/infrastructure/db/schema.ts](../src/infrastructure/db/schema.ts):

```ts
export const siteConfigs = sqliteTable(
  "site_configs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: text("status").notNull().default("draft"),
    pageTitle: text("page_title"),
    bio: text("bio"),
    aboutContentJson: text("about_content_json", { mode: "json" }),
    heroMediaId: text("hero_media_id").references(() => media.id, { onDelete: "set null" }),
    blocksJson: text("blocks_json", { mode: "json" }).notNull().default("[]"),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    scheduledAt: integer("scheduled_at", { mode: "timestamp_ms" }),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
    createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("site_configs_org_slug_idx").on(table.orgId, table.slug),
    index("site_configs_org_status_idx").on(table.orgId, table.status),
    uniqueIndex("site_configs_single_published_org_idx")
      .on(table.orgId)
      .where(sql`status = 'published'`),
    index("site_configs_scheduled_idx").on(table.scheduledAt).where(sql`status = 'scheduled'`),
  ],
);
```

### 4.8 Content IAM Integration

All catalog additions are made by `docs/013 §4.7`. SiteConfig only needs to wire the resource-ref helper.

`src/domain/iam/resource-loader.ts` addition:

```ts
import type { SiteConfig } from "@/domain/site-config/site-config.entity";

export function siteConfigResource(config: SiteConfig): ContentResourceRef {
  return {
    type: "site_config",
    id: config.id,
    orgId: config.orgId,
    ancestors: [{ type: "org", id: config.orgId }],
  };
}
```

`ContentResourceInput` is **not** extended for site_config — site configs are not policy-binding targets in v1; they inherit from org. If per-config bindings become necessary in the future, extend `ContentResourceInput` and add a `loadSiteConfigResource` helper.

Permission keys (added by `docs/013`):

| Key | Description | delegationClass |
|---|---|---|
| `site_config.create` | Create a site config in an organization | `ordinary` |
| `site_config.read` | Read a draft, scheduled, or archived site config | `ordinary` |
| `site_config.update` | Update a site config | `ordinary` |
| `site_config.publish` | Promote a site config to active (also unpublish/schedule) | `ordinary` |
| `site_config.archive` | Archive a site config (non-active only) | `ordinary` |
| `site_config.delete` | Delete a site config | `ordinary` |

Roles (added or updated by `docs/013`):

| Role | Permissions added |
|---|---|
| `system:org.site_manager` (new) | All six site_config keys |
| `system:org.content_admin` | All six site_config keys |

### 4.9 Application Use Cases

SiteConfig adds **CRUD** use cases. Lifecycle use cases (`publish`, `unpublish`, `schedule`, `archive`) are the generic ones from `docs/013` parameterized with `SiteConfigLifecycleManager`.

```
src/application/site-config/
  create-site-config.usecase.ts    # idempotent create, slug uniqueness, IAM check, owner workflow
  get-site-config.usecase.ts       # by id, IAM check (public if active)
  get-active-site-config.usecase.ts # by orgId, no actor, no IAM check
  list-site-configs.usecase.ts     # cursor-paginated by org
  update-site-config.usecase.ts    # PATCH metadata + blocks; cannot update archived; cannot change status
  delete-site-config.usecase.ts    # only on draft or archived; never on published or scheduled
```

Create use case skeleton (mirrors `src/application/posts/create-post.usecase.ts`):

```ts
// src/application/site-config/create-site-config.usecase.ts
export class CreateSiteConfigUseCase {
  constructor(
    private readonly configs: SiteConfigRepository,
    private readonly users: UserRepository,
    private readonly roles: ContentRoleRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly workflow: SiteConfigCreateWorkflow,        // see §4.6 — atomic insert + audit event
    private readonly contentPolicy: ContentPolicy,
  ) {}

  async execute(params: {
    actor: Actor;
    idempotencyKey?: string;
    input: { name: string; slug?: string; pageTitle?: string | null; bio?: string | null;
             aboutContent?: unknown; heroMediaId?: string | null; blocks?: SiteBlocks };
  }) {
    requireContentScope(params.actor, "content:write");
    await this.roles.ensureSystemCatalog();

    const ctx = await requireOwnedContentCreateContext({
      actor: params.actor,
      contentPolicy: this.contentPolicy,
      orgCreatePermission: "site_config.create",
    });

    const slug = await this.resolveSlug({ orgId: ctx.orgId, name: params.input.name, requestedSlug: params.input.slug });
    const config = SiteConfig.create({
      orgId: ctx.orgId,
      name: params.input.name,
      slug,
      pageTitle: params.input.pageTitle ?? null,
      bio: params.input.bio ?? null,
      aboutContent: params.input.aboutContent ?? null,
      heroMediaId: params.input.heroMediaId ?? null,
      blocks: params.input.blocks ?? [],
      createdByUserId: ctx.actor.id,
    });

    // Idempotency follows the same shape as CreatePostUseCase. Replay snapshot is the
    // serialized SiteConfig with createdAt/updatedAt date strings.
    // workflow.create({ config, idempotency? }) commits the row + audit event atomically.

    return this.runCreate(params.idempotencyKey, ctx.actor.id, params.input, config);
  }

  private async resolveSlug(params: { orgId: string; name: string; requestedSlug?: string }) {
    if (params.requestedSlug) {
      if (!isValidSlug(params.requestedSlug)) throw new ValidationError("Invalid slug shape");
      const existing = await this.configs.findBySlug(params.orgId, params.requestedSlug);
      if (existing) throw new ConflictError("Slug already in use", { slug: params.requestedSlug });
      return params.requestedSlug;
    }
    return randomizedSlugFromTitle(params.name); // existing helper in src/shared/validation/fields
  }
}
```

The `requireOwnedContentCreateContext` helper (from `src/application/content-ownership.ts`) gates the create on org membership + `site_config.create` and resolves the org id. Site configs do not create a per-resource owner binding; access flows through org-level roles only (see [§5.4](#54-org-level-iam-only-for-site-configs)).

Update use case must reject any input that smuggles a `status`, `publishedAt`, `scheduledAt`, or `archivedAt`. The Zod request schema does not include those fields, so this is enforced at the boundary.

### 4.10 SiteConfig Lifecycle Adapter

```ts
// src/infrastructure/lifecycle/site-config-lifecycle-manager.ts
import type { Actor } from "@/domain/auth/actor";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import { siteConfigResource } from "@/domain/iam/resource-loader";
import type { LifecycleManager } from "@/domain/lifecycle/lifecycle-manager";
import type { SiteConfigRepository } from "@/domain/site-config/site-config.repository";
import type { SiteConfigPublishWorkflow } from "@/domain/site-config/site-config-publish.workflow";
import type { SiteConfig } from "@/domain/site-config/site-config.entity";

export class SiteConfigLifecycleManager implements LifecycleManager<SiteConfig> {
  readonly resourceType = "site_config";

  constructor(
    private readonly configs: SiteConfigRepository,
    private readonly publishWorkflow: SiteConfigPublishWorkflow,
    private readonly contentPolicy: ContentPolicy,
  ) {}

  findById(id: string) { return this.configs.findById(id); }

  /**
   * Persists the entity. When the new status is "published", we route through
   * the publish workflow's atomic batch (archive current + write target). Other
   * transitions are plain saves.
   */
  async save(entity: SiteConfig): Promise<void> {
    if (entity.lifecycleStatus === "published") {
      await this.publishWorkflow.publishAtomic(entity);
      return;
    }
    await this.configs.save(entity);
  }

  canPublish(actor: Actor, entity: SiteConfig) {
    return this.contentPolicy.can({ actor, permission: "site_config.publish", resource: siteConfigResource(entity) });
  }
  canUnpublish(actor: Actor, entity: SiteConfig) {
    return this.contentPolicy.can({ actor, permission: "site_config.publish", resource: siteConfigResource(entity) });
  }
  canSchedule(actor: Actor, entity: SiteConfig) {
    return this.contentPolicy.can({ actor, permission: "site_config.publish", resource: siteConfigResource(entity) });
  }

  /**
   * Archive is rejected for the currently-published config regardless of IAM.
   * Caller must publish a replacement first. The IAM check still applies
   * for any other config.
   */
  async canArchive(actor: Actor, entity: SiteConfig): Promise<boolean> {
    if (entity.lifecycleStatus === "published") return false;
    return this.contentPolicy.can({ actor, permission: "site_config.archive", resource: siteConfigResource(entity) });
  }

  findScheduledReadyIds(now: Date, limit: number) {
    return this.configs.findScheduledReadyIds(now, limit);
  }
  publishScheduledReady(id: string, now: Date) {
    return this.configs.publishScheduledReady(id, now);
  }
}
```

The cron driver's `publishScheduledReady(id, now)` for SiteConfig must also enforce the single-published invariant. Implementation:

```ts
// src/infrastructure/repositories/drizzle-site-config.repository.ts (publishScheduledReady)
async publishScheduledReady(id: string, now: Date): Promise<boolean> {
  try {
    const result = await this.db.batch([
      // Archive current published config (if any) in the same org as the scheduled row.
      this.db
        .update(siteConfigs)
        .set({ status: "archived", publishedAt: null, archivedAt: now, updatedAt: now })
        .where(
          and(
            eq(siteConfigs.status, "published"),
            // Subselect the orgId of the scheduled target.
            eq(
              siteConfigs.orgId,
              this.db.select({ id: siteConfigs.orgId }).from(siteConfigs).where(eq(siteConfigs.id, id)).limit(1),
            ),
          ),
        ),
      // Promote the scheduled row.
      this.db
        .update(siteConfigs)
        .set({ status: "published", publishedAt: now, scheduledAt: null, archivedAt: null, updatedAt: now })
        .where(and(eq(siteConfigs.id, id), eq(siteConfigs.status, "scheduled"), lte(siteConfigs.scheduledAt, now))),
    ]);
    // result is an array of D1 results; second item's meta.changes indicates whether the target row transitioned.
    const targetChanges = (result[1] as { meta?: { changes?: number } }).meta?.changes ?? 0;
    return targetChanges === 1;
  } catch (error) {
    if (isSqliteUniqueConstraintError(error, "site_configs.single_published_org")) {
      // A manual publish in the same org won the race; leave the scheduled row alone for next cron tick.
      return false;
    }
    throw error;
  }
}
```

Two important notes:

- D1 SQLite does not support arbitrary subqueries in `UPDATE … WHERE` against the same table in all builds. If Drizzle's subquery feature does not translate cleanly, replace the first batch statement with two passes: (a) `SELECT org_id FROM site_configs WHERE id = ?`; (b) `UPDATE site_configs SET status='archived' … WHERE org_id = ? AND status='published'`. The implementation backlog calls this out under [SCG-E](#scg-e-lifecycle-adapter-integration).
- The unique partial index can still fire if another transaction publishes a different config in the same org between the two statements of the batch. The adapter catches that case and returns `false`.

### 4.11 HTTP API Surface

Routes live in `src/http/routes/site-configs.routes.ts`. All routes require `content:write` except read paths (`content:read`) and the active endpoint (public).

| Method | Path | Auth | Use case | Permission |
|---|---|---|---|---|
| `GET` | `/site-configs` | `content:read` | `siteConfigs.list` | `site_config.read` (org) |
| `POST` | `/site-configs` | `content:write` | `siteConfigs.create` | `site_config.create` |
| `GET` | `/site-configs/active` | public | `siteConfigs.getActive` | — |
| `GET` | `/site-configs/{id}` | `content:read` (active is public) | `siteConfigs.get` | `site_config.read` if not active |
| `PATCH` | `/site-configs/{id}` | `content:write` | `siteConfigs.update` | `site_config.update` |
| `DELETE` | `/site-configs/{id}` | `content:write` | `siteConfigs.delete` | `site_config.delete` |
| `POST` | `/site-configs/{id}/publish` | `content:write` | `siteConfigs.publish` (generic `PublishUseCase`) | `site_config.publish` |
| `POST` | `/site-configs/{id}/unpublish` | `content:write` | `siteConfigs.unpublish` (generic) | `site_config.publish` |
| `POST` | `/site-configs/{id}/schedule` | `content:write` | `siteConfigs.schedule` (generic) | `site_config.publish` |
| `POST` | `/site-configs/{id}/archive` | `content:write` | `siteConfigs.archive` (generic) | `site_config.archive` |

`GET /site-configs/active` returns `200` with the active config, `404` when no active config exists. No actor is required; it explicitly does not call `requireActor(c)` and the route does not declare `security: bearerSecurity`.

Schemas in `src/http/schemas/site-configs.schema.ts`:

```ts
import { z } from "@hono/zod-openapi";
import { siteBlocksSchema } from "@/domain/site-config/site-block.schema";

const slugSchema = z.string().regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i).min(2).max(120);

export const createSiteConfigBodySchema = z.object({
  name: z.string().min(1).max(200),
  slug: slugSchema.optional(),
  pageTitle: z.string().max(200).nullable().optional(),
  bio: z.string().max(2000).nullable().optional(),
  aboutContent: z.record(z.string(), z.unknown()).nullable().optional(),  // Lexical JSON
  heroMediaId: z.string().uuid().nullable().optional(),
  blocks: siteBlocksSchema.optional(),
}).openapi("CreateSiteConfigBody");

export const updateSiteConfigBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  pageTitle: z.string().max(200).nullable().optional(),
  bio: z.string().max(2000).nullable().optional(),
  aboutContent: z.record(z.string(), z.unknown()).nullable().optional(),
  heroMediaId: z.string().uuid().nullable().optional(),
  blocks: siteBlocksSchema.optional(),
}).strict().openapi("UpdateSiteConfigBody");

export const siteConfigResponseSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(["draft", "scheduled", "published", "archived"]),
  pageTitle: z.string().nullable(),
  bio: z.string().nullable(),
  aboutContent: z.unknown().nullable(),
  heroMediaId: z.string().nullable(),
  blocks: siteBlocksSchema,
  publishedAt: z.string().datetime().nullable(),
  scheduledAt: z.string().datetime().nullable(),
  archivedAt: z.string().datetime().nullable(),
  createdByUserId: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).openapi("SiteConfig");
```

`updateSiteConfigBodySchema.strict()` rejects unknown fields — including `status` — at the API boundary.

Presenter `src/http/presenters/site-config.presenter.ts` mirrors `presentPost`: takes a domain entity, returns the response shape. Dates are emitted as ISO strings.

### 4.12 Categories As Org-Owned Resources (Formal Rationale)

The `system:category.owner` role is **deprecated**. Code already reflects this in `src/domain/iam/content-permission.ts` and points at this doc.

Decision summary:

- Categories are a shared organizational taxonomy. They are not authored content owned by one person.
- If categories had per-resource owners, an author leaving the org would leave categories unmanageable without admin intervention.
- Any org member who can author content needs to be able to maintain the category taxonomy.

Resulting model:

- `system:org.author` (the role seeded when a user creates their first content in an org) holds `org.create_category`, `category.read`, `category.update`, `category.delete`.
- `system:org.content_admin` also holds all four category permissions.
- No `category.owner` binding is created at category creation time. The role definition is preserved in `BUILT_IN_CONTENT_ROLES` only to avoid breaking pre-existing bindings in production databases.

This rule generalizes: any new resource that is a shared org taxonomy (tags, collections, series) follows the same model — no per-resource owner binding; managed entirely via org-level roles.

### 4.13 Module Layout

```
src/domain/site-config/
  site-config.entity.ts                  # SiteConfig (LifecycleCapable)
  site-block.schema.ts                   # Zod blocks (also imported by HTTP schemas)
  site-config.repository.ts              # SiteConfigRepository interface
  site-config-publish.workflow.ts        # SiteConfigPublishWorkflow interface (atomic publish)

src/application/site-config/
  create-site-config.usecase.ts
  get-site-config.usecase.ts
  get-active-site-config.usecase.ts
  list-site-configs.usecase.ts
  update-site-config.usecase.ts
  delete-site-config.usecase.ts

src/infrastructure/repositories/
  drizzle-site-config.repository.ts
  drizzle-site-config-publish.workflow.ts
  mappers/site-config.mapper.ts

src/infrastructure/lifecycle/
  site-config-lifecycle-manager.ts

src/http/schemas/
  site-configs.schema.ts

src/http/presenters/
  site-config.presenter.ts

src/http/routes/
  site-configs.routes.ts

drizzle/
  0008_site_configs.sql

src/domain/iam/resource-loader.ts        # add siteConfigResource(...)
src/composition/create-request-container.ts   # wire all of the above
src/composition/scheduled-lifecycle.ts        # register SiteConfigLifecycleManager for cron
```

## 5. Architecture Decisions

### 5.1 Multiple Promotable Configs

A singleton SiteConfig (one row, one `GET /site-config`) gives no history, no campaign testing, no rollback. Making it a regular collection with a lifecycle adds one `status` column and a partial unique index — almost free — and immediately enables seasonal variants and rollback by publishing a prior config.

### 5.2 Lifecycle Plugin From Day One

`docs/013` lands first. SiteConfig does not ship a bespoke `ActivateSiteConfigUseCase`. The same `PublishUseCase<SiteConfig>` / `UnpublishUseCase<SiteConfig>` / `SchedulePublishUseCase<SiteConfig>` / `ArchiveUseCase<SiteConfig>` generic use cases are wired in `create-request-container.ts`. The vocabulary is `publish/published`, not `activate/active`, across permissions, endpoints, timestamps, and entity methods.

Rationale: shipping a bespoke activate now and renaming later doubles the work, breaks public API once, and produces redundant docs.

### 5.3 Zod Discriminated Union Stored As JSON

Blocks are validated by `siteBlocksSchema` at the API boundary on every write and re-validated on every read through the mapper using `safeParse` with per-block fallback. The single `blocks_json` column avoids a `site_config_blocks` join table while preserving type safety in application code. Tradeoff: block-level SQL queries require `json_extract`, which is functional but unindexed. No first-release query needs this.

Adding a new block type is a code change. Removing a block type requires either a data migration or graceful filtering on read (already implemented).

### 5.4 Org-Level IAM Only For Site Configs

Unlike books, site configs do not need per-resource collaborator sharing. The `system:org.site_manager` and `system:org.content_admin` roles are the complete access control. No `system:site_config.owner` role is created.

If per-config sharing becomes necessary later, extend `ContentResourceInput` and add policy-bindings routes scoped to `site_config`. The architecture already supports it: `siteConfigResource(...)` carries org ancestry.

### 5.5 Active SiteConfig Cannot Be Archived

Archiving the currently-published config would leave the site with no active configuration. Adapter-level rule: `canArchive` returns false for the published config regardless of IAM. Callers must publish a replacement first.

This is a product invariant, not an IAM decision, so it lives in the adapter rather than as a denial binding.

### 5.6 Caller-Supplied Slug With Server Validation

A site config slug is a meaningful identifier that the front-end may surface in admin UIs and preview URLs. Auto-derived slugs from `name` are usable but noisy when authors iterate on naming. The API:

- Accepts an optional `slug` field on create.
- Validates shape with `slugSchema` (lowercase letters, digits, hyphens; 2–120 chars).
- Rejects duplicates within an org via `site_configs_org_slug_idx`.
- Auto-derives from `name` via the existing `randomizedSlugFromTitle` helper if omitted.

Slug is immutable after creation. PATCH does not include slug. Renaming requires creating a new config.

### 5.7 aboutContent Is Lexical JSON

`aboutContent` is typed `unknown` at the entity level and `z.record(z.string(), z.unknown()).nullable().optional()` at the API boundary. The server treats it as opaque JSON. The Lexical state structure is the front-end's contract; the API does not enforce it.

Plain text is rejected — clients should use the `bio` field for short plain-text strings. A plain-text About would be captured inside Lexical as a single paragraph node.

### 5.8 Rejected Options

- **JSONB typed block columns.** SQLite has no JSONB. Per-block typed columns (`hero_title`, `hero_media_id`, …) require migrations for every new block type and cannot represent ordered heterogeneous lists.
- **Separate `site_config_blocks` table.** A join per read for blocks that are always consumed together. Multi-statement writes on every edit. Marginal benefit (queries over block types) that no first-release feature needs.
- **Bespoke activate use case (the original `docs/012` draft).** Replaced by lifecycle plugin reuse; see [§5.2](#52-lifecycle-plugin-from-day-one).
- **Per-resource SiteConfig owner role.** Site configs are org-shared; per-resource ownership creates abandonment risk.
- **`status` reachable through PATCH.** Same rule as `docs/013 §5.3`: lifecycle status only flows through dedicated endpoints. Enforced by `updateSiteConfigBodySchema.strict()`.

## 6. Implementation Strategy

Prerequisite: `docs/013` LCY-A, LCY-B, LCY-C must be merged. Without LCY-A there is no `LifecycleCapable`; without LCY-B there are no `site_config.*` permission keys; without LCY-C the partial-index pattern is unproven.

Phased work, each phase keeps `pnpm check` green:

1. **SCG-A** — schema + entity skeleton. No routes, no IAM, no business logic.
2. **SCG-B** — block schema and shared validation.
3. **SCG-C** — repository, mappers, publish workflow port.
4. **SCG-D** — application CRUD use cases.
5. **SCG-E** — lifecycle adapter (uses generic use cases from LCY-A).
6. **SCG-F** — HTTP routes and presenter.
7. **SCG-G** — composition wiring (HTTP container + cron container).
8. **SCG-H** — docs/README/lint cleanup.

## 7. Migration And Rollout

- **Database**: `drizzle/0008_site_configs.sql` is independent and additive. Apply via `pnpm db:migrate:local` / `pnpm db:migrate:remote` (CI handles remote).
- **Deploy order**: migration → Worker. The new Drizzle table is unused by the previous Worker binary, so the migration is forward-compatible.
- **No feature flag.** The collection is new; no existing client uses it.
- **Cron**: the `SiteConfigLifecycleManager` is registered in `src/composition/scheduled-lifecycle.ts` (the shared helper consumed by the `workers/scheduled-publish/` Worker shipped by `docs/013 LCY-F`). No new Cloudflare Worker is created by this doc; SiteConfig piggybacks on the existing scheduled-publish Worker. Adding the manager to `buildScheduledLifecycleManagers` is the only wiring required for the cron path.
- **Rollback**: deploy the older Worker. The new table is inert. Do not drop the table on rollback; subsequent re-deploy keeps data.

## 8. Edge Cases And Failure Modes

| Scenario | Handling |
|---|---|
| Two concurrent publishes for different configs in the same org | Adapter's `publishAtomic` issues a batch with the archive step on the current published and the promote step on the target. The unique partial index on `(org_id) WHERE status='published'` rejects the second commit; infrastructure translates to `ConflictError` → `409`. |
| Cron and manual publish race | Both go through compare-and-set logic. The adapter's `publishScheduledReady` catches the unique-index error and returns `false`. The manual call wins or vice versa; the row ends in `published` exactly once. |
| `GET /site-configs/active` with no active config | `200` with empty data is rejected — return `404`. Front-end renders an unconfigured state. |
| `heroMediaId` references deleted media | FK uses `ON DELETE SET NULL`; the field becomes `null` and presenters surface null. |
| Block embeds `mediaId` that points to deleted media | Blocks are inside JSON; SQLite FK does not apply. Front-end shows a broken-media placeholder. A periodic cleanup job (future) can scan `blocks_json` for stale media IDs. |
| Publishing an archived config | Entity rejects: `ConflictError("Cannot publish an archived site config")` → `409`. Caller must duplicate and publish. |
| Updating an archived config | Entity rejects in `update()` → `409`. |
| Block schema evolution — unknown block type on read | Mapper uses `siteBlocksSchema.safeParse` then per-block `siteBlockSchema.safeParse`, dropping unrecognized entries. Adds a `console.warn` record for ops. |
| Slug collision on create | Repository `findBySlug` returns existing; use case raises `ConflictError("Slug already in use")` → `409`. If slug omitted, `randomizedSlugFromTitle` includes a random suffix; collision probability is negligible. |
| Empty `blocks` array | Valid. Active config renders with only top-level fields. |
| `postIds` in `featured_posts` block reference deleted posts | Not validated at write time. Front-end filters missing posts at render. |
| Delete a scheduled or published config | Use case rejects with `ConflictError("Cannot delete a {status} site config")` → `409`. Caller must unpublish or unschedule first. Deletion is reserved for draft/archived only. |
| Archiving the active config | Adapter `canArchive` returns false → `403 Forbidden`. Caller publishes a replacement, which atomically archives the previous active, then can archive that one. |
| Scheduled config waiting through `archive()` on the same row | The schedule is cleared (entity sets `scheduledAt = null`); the cron will not pick it up. |
| Cron picks up a scheduled config whose org gained an active config between schedule and cron | Compare-and-set commits the second config as the new active; the previous active is archived in the same batch. This is the documented behavior — schedule wins. To prevent it, the author should unpublish the schedule or activate manually beforehand. |
| Concurrent publish at top-of-hour with multiple scheduled configs in same org | The first cron tick selects N candidates; for each, `publishScheduledReady` either succeeds or fails. Only one can succeed (unique partial index). The others remain `scheduled` and are picked up next hour. **Operator-visible note**: scheduling two configs for the same org at the same minute is a likely UX bug. Surfacing this in the admin UI is a non-goal here. |
| `Idempotency-Key` reused with different body on create | `CONFLICT` per existing idempotency contract. |
| Service-account create | Same authorization path as user; service account must have `site_config.create` on the org. |

## 9. Implementation Backlog

### SCG-A. Domain Foundation And Schema

Scope:

- `src/infrastructure/db/schema.ts`
- `drizzle/0008_site_configs.sql` (generated)
- `src/domain/site-config/site-config.entity.ts` (new)

Tasks:

- [ ] Add `siteConfigs` to Drizzle schema (§4.7).
- [ ] Generate the migration with `pnpm db:generate`; verify the resulting SQL matches §4.7.
- [ ] Implement `SiteConfig` entity (§4.5), including `LifecycleCapable` methods.
- [ ] Add `aboutContent` typing as `unknown | null`.
- [ ] Add JSDoc to entity and to each lifecycle transition method.

Acceptance criteria:

- `pnpm db:migrate:local` applies cleanly.
- `SiteConfig.create`, `.reconstitute`, `.update`, `.publish`, `.unpublish`, `.schedule`, `.archive`, `.toSnapshot` covered by entity unit tests.
- `architecture/entity-class` lint passes (`Omit`-based `CreateSiteConfigProps`, private constructor, generated fields handled by `create`).

Tests:

- `tests/site-config/site-config.entity.test.ts` (new).

### SCG-B. Block Schema And Shared Validation

Scope:

- `src/domain/site-config/site-block.schema.ts`
- `src/shared/validation/fields.ts` (re-export or add `isValidSlug` if not present)

Tasks:

- [ ] Implement Zod discriminated union per §4.4.
- [ ] Add `.openapi(...)` registration to every block schema so OpenAPI generation labels them.
- [ ] Confirm slug regex and `randomizedSlugFromTitle` are in `src/shared/validation/fields.ts`; add `isValidSlug(value: string): boolean` if missing.

Acceptance criteria:

- `siteBlocksSchema.parse([{ type: "hero", title: "X" }])` succeeds.
- `siteBlockSchema.safeParse({ type: "unknown" }).success === false`.
- `pnpm typecheck` passes.

Tests:

- `tests/site-config/site-block.schema.test.ts` (new).

### SCG-C. Repository And Workflow

Scope:

- `src/domain/site-config/site-config.repository.ts` (new)
- `src/domain/site-config/site-config-publish.workflow.ts` (new)
- `src/infrastructure/repositories/drizzle-site-config.repository.ts` (new)
- `src/infrastructure/repositories/drizzle-site-config-publish.workflow.ts` (new)
- `src/infrastructure/repositories/mappers/site-config.mapper.ts` (new)

Tasks:

- [ ] Implement `SiteConfigRepository` interface (§4.6).
- [ ] Implement `SiteConfigPublishWorkflow` interface; the Drizzle implementation runs the two-step archive-then-promote batch with subquery or two-pass org-id resolution (§4.10).
- [ ] Implement mappers: `siteConfigRowToEntity`, `siteConfigToInsertRow`, `siteConfigToUpdateRow`. All explicit field-by-field per `architecture/mapper-file`. Reconstitute via `SiteConfig.reconstitute`. Use mapper safe-parse for blocks on read.
- [ ] Implement `findScheduledReadyIds(now, limit)` using `CrudAdapter.findRowsWhere`.
- [ ] Implement `publishScheduledReady(id, now)` using a `db.batch(...)` plus `isSqliteUniqueConstraintError(error, "site_configs.single_published_org")` translation.

Acceptance criteria:

- Drizzle repo passes integration tests for `findById`, `findActiveByOrgId`, `findBySlug`, `listByOrgId`, `save`, `delete`.
- `publishAtomic` rejects with `ConflictError` when a unique-index violation is raised.
- `publishScheduledReady` is idempotent under concurrent invocation (test: `Promise.all([fn(id), fn(id)])` — exactly one returns true).

Tests:

- `tests/site-config/site-config.repository.test.ts` (new, integration via wrangler vitest pool).
- `tests/site-config/site-config-publish.workflow.test.ts` (new).

### SCG-D. Application Use Cases

Scope:

- `src/application/site-config/create-site-config.usecase.ts` (new)
- `src/application/site-config/get-site-config.usecase.ts` (new)
- `src/application/site-config/get-active-site-config.usecase.ts` (new)
- `src/application/site-config/list-site-configs.usecase.ts` (new)
- `src/application/site-config/update-site-config.usecase.ts` (new)
- `src/application/site-config/delete-site-config.usecase.ts` (new)

Tasks:

- [ ] `CreateSiteConfigUseCase` mirrors `CreatePostUseCase` (idempotency, scope, IAM via `requireOwnedContentCreateContext`, slug resolution, workflow port). Permission key: `site_config.create`.
- [ ] `GetActiveSiteConfigUseCase` takes `{ orgId }`, no actor, no permission check. Returns `null` if absent (route translates to `404`).
- [ ] `GetSiteConfigUseCase` takes `{ actor, id }`; if active, returns it without IAM; otherwise calls `ContentPolicy.can("site_config.read", siteConfigResource(config))`.
- [ ] `UpdateSiteConfigUseCase`: scope check → load → `can("site_config.update", ref)` → `entity.update(...)` → `repo.save(entity)`.
- [ ] `DeleteSiteConfigUseCase`: scope check → load → `can("site_config.delete", ref)` → reject if `status in ("scheduled", "published")` → `repo.delete(id)`.
- [ ] `ListSiteConfigsUseCase`: scope check → derive org → `repo.listByOrgId(...)` → filter via `canMany("site_config.read", refs)`.

Acceptance criteria:

- Each use case passes `architecture/layer-imports`: no `hono`, `drizzle-orm`, or infrastructure imports.
- Each use case has JSDoc describing its lifecycle hook (per `architecture-rules.md` "JSDoc Standard").

Tests:

- `tests/site-config/use-cases.test.ts` (new).

### SCG-E. Lifecycle Adapter Integration

Scope:

- `src/infrastructure/lifecycle/site-config-lifecycle-manager.ts` (new)
- `src/domain/iam/resource-loader.ts` (extend)

Tasks:

- [ ] Add `siteConfigResource(config)` helper (§4.8).
- [ ] Implement `SiteConfigLifecycleManager` (§4.10):
  - `findById` → repo.
  - `save` routes published states through `SiteConfigPublishWorkflow.publishAtomic` and other states through `repo.save`.
  - `can{Publish,Unpublish,Schedule}` → `ContentPolicy.can("site_config.publish", siteConfigResource(entity))`.
  - `canArchive` returns false for the published config; otherwise `ContentPolicy.can("site_config.archive", siteConfigResource(entity))`.
  - `findScheduledReadyIds`, `publishScheduledReady` → repo.

Acceptance criteria:

- Generic `PublishUseCase<SiteConfig>` parameterized with this adapter publishes a draft config, archives the previously published one in the same org.
- Generic `ArchiveUseCase<SiteConfig>` returns `403` (via `assertAllowed`) when invoked on a published config; succeeds for draft/scheduled.

Tests:

- `tests/site-config/site-config-lifecycle-manager.test.ts` (new).

### SCG-F. HTTP Routes And Presenter

Scope:

- `src/http/schemas/site-configs.schema.ts` (new)
- `src/http/presenters/site-config.presenter.ts` (new)
- `src/http/routes/site-configs.routes.ts` (new)
- `src/http/routes/index.ts` (register the new route module)

Tasks:

- [ ] Implement Zod schemas with `.strict()` on update (§4.11).
- [ ] Implement `presentSiteConfig(entity)` converting entity to response shape; serialize `aboutContent` as-is.
- [ ] Implement 10 routes per the table in §4.11. Each handler calls exactly one `.execute(...)`. `GET /site-configs/active` does not call `requireActor`.
- [ ] Register the route module in `src/http/routes/index.ts`.

Acceptance criteria:

- `architecture/route-module`, `architecture/route-handler-boundary`, `architecture/req-valid-usage`, `architecture/no-plain-zod-import` all pass.
- OpenAPI doc at `/openapi.json` exposes all 10 endpoints with the documented schemas.

Tests:

- `tests/site-config/site-configs.routes.test.ts` (new).

### SCG-G. Composition Wiring And Cron Registration

Scope:

- `src/composition/create-request-container.ts` (extend)
- `src/composition/scheduled-lifecycle.ts` (extend — the helper consumed by `workers/scheduled-publish/src/index.ts` from `docs/013 LCY-F`)

**Do not** create a new Cloudflare Worker for SiteConfig. The scheduled-publish Worker shipped by `docs/013 LCY-F` already iterates every registered `LifecycleManager<LifecycleCapable>`; SiteConfig joins by adding its manager to the array returned by `buildScheduledLifecycleManagers(env)`.

Tasks:

- [ ] Build per-request `siteConfigRepository`, `siteConfigCreateWorkflow`, `siteConfigPublishWorkflow`, `siteConfigLifecycleManager` in `create-request-container.ts`.
- [ ] Register the CRUD use cases under `siteConfigs` in the container return object.
- [ ] Add four lifecycle use cases (`publish`, `unpublish`, `schedule`, `archive`) under `siteConfigs`, each constructed from the corresponding generic class from `docs/013` against `siteConfigLifecycleManager`.
- [ ] In `src/composition/scheduled-lifecycle.ts`, instantiate `SiteConfigLifecycleManager` (with `DrizzleSiteConfigRepository` and `DrizzleSiteConfigPublishWorkflow`) and append it to the array returned by `buildScheduledLifecycleManagers(env)`. No `ContentPolicy` is required on the cron path (see `docs/013 §4.6.2`).

Acceptance criteria:

- `container.siteConfigs.publish.execute({ actor, id })` end-to-end publishes a draft config and archives the previous published one in the same org.
- After redeploying the `workers/scheduled-publish/` Worker, the hourly cron picks up a scheduled site config and promotes it (verified by extending `tests/scheduled-publish.test.ts` to seed a site config).
- No changes to `workers/scheduled-publish/wrangler.jsonc`, its `tsconfig.json`, or its `src/index.ts` are required; SiteConfig is wired entirely through `src/composition/scheduled-lifecycle.ts`.

### SCG-H. Documentation And Cleanup

Scope:

- `docs/012_site-config-collection.md` (this doc — status update)
- `README.md`
- `docs/architecture.md` (only if it lists collections)

Tasks:

- [ ] Update this doc's top-of-file `Status:` to `implemented` once code lands.
- [ ] Add SiteConfig to README's collection list and route summary.
- [ ] Run `pnpm advise`; suppress only catalogued duplications (mapper field-by-field; lifecycle adapter shape — already covered by `docs/013` suppression entries).

Acceptance criteria:

- README references the new collection.
- `docs/012` status reflects the merged state.

## 10. Future Backlog

- **Per-config sharing.** Extend `ContentResourceInput` and add `loadSiteConfigResource(...)`. Allows scoping a `site_config.update` binding to a specific config. Useful for contractors editing only the campaign config.
- **Preview tokens.** Short-lived signed tokens that authorize reading a non-published config via the front-end without granting `site_config.read` to the audience.
- **Block content cleanup job.** Periodic scan of `blocks_json` for media IDs that no longer resolve. Either invalidate the block or surface a maintenance event.
- **A/B testing variants.** Add a sibling `variant_group_id` and weight selection. Not part of this release.
- **Site config import/export.** A JSON dump/restore flow with safe slug remapping.
- **Draft/live split (`docs/013 §11.1`).** When implemented, SiteConfig opts in by adding `saveDraft` / `findDraft` to its lifecycle manager. Authors edit a draft layered over the published config; publish applies the draft.

## 11. Test And Verification Plan

| Layer | Test |
|---|---|
| Unit — entity | Every transition method; `update` rejects on archived; `toSnapshot` clones `blocks` (no aliasing). |
| Unit — block schema | Discriminator coverage; `safeParse` recovery for unknown discriminants. |
| Unit — mapper | Round-trip entity → row → entity preserves all fields including dates and `blocks`. Malformed `blocks_json` recovers via per-block filtering. |
| Integration — repository | All `SiteConfigRepository` methods against a real D1 (vitest worker pool). |
| Integration — publish workflow | Concurrent `publishAtomic` calls on different configs in the same org: one succeeds, the other returns `ConflictError`. |
| Integration — lifecycle adapter | Generic `PublishUseCase<SiteConfig>` with adapter publishes a draft and archives the prior published. `ArchiveUseCase<SiteConfig>` on published config → `Forbidden`. |
| Integration — HTTP | All 10 endpoints. Public `GET /site-configs/active`, `404` when none active, idempotent create replay, `PATCH` rejecting `status`. |
| Integration — IAM | Direct-share actor without `site_config.create` is forbidden on create; org `system:org.site_manager` member can publish; `system:org.content_admin` can do everything. |
| Integration — cron | Scheduled config with `scheduledAt = now - 1s` is promoted by `runScheduledPublish`; prior published is archived. |
| Race | Two concurrent publishes on different configs in the same org via `Promise.all` — assert exactly one ends `published`. |
| Architecture lint | `pnpm lint` — verify `architecture/entity-class`, `architecture/mapper-file`, `architecture/route-module`, `architecture/no-plain-zod-import`, `architecture/req-valid-usage` all pass. |
| Duplication | `pnpm check:dup` — Drizzle repo and mapper expected to clone-match book/post repo; add suppression entries pointing at this doc and `docs/013`. |
| Advisory | `pnpm advise` — no new unacknowledged findings. |

## 12. Definition Of Done

- `site_configs` table created with all four indexes (`org_slug_idx`, `org_status_idx`, `single_published_org_idx`, `scheduled_idx`).
- `SiteConfig` entity implements `LifecycleCapable` with all four transition methods, snapshot clone, and full getters.
- `siteBlockSchema` and `siteBlocksSchema` Zod schemas in `src/domain/site-config/site-block.schema.ts`.
- `SiteConfigRepository`, `SiteConfigPublishWorkflow`, Drizzle implementations, and explicit mapper present.
- `SiteConfigLifecycleManager` present and wired in `create-request-container.ts` and `scheduled-lifecycle.ts`.
- Use cases under `src/application/site-config/`: create, get, get-active, list, update, delete. Lifecycle use cases are the generic ones from `docs/013`.
- Routes in `src/http/routes/site-configs.routes.ts`: 10 endpoints documented in §4.11, registered in `src/http/routes/index.ts`.
- Permission keys and `system:org.site_manager` role active in the catalog (delivered by `docs/013`).
- `siteConfigResource(...)` exported from `src/domain/iam/resource-loader.ts`.
- `GET /site-configs/active` returns `200` with the active config, `404` when none exists, with no actor or permission requirement.
- `POST /site-configs/{id}/publish` atomically archives the previous published config in the same org and promotes the target; concurrent attempts return `409`.
- `POST /site-configs/{id}/archive` returns `403` for the currently-published config.
- `PATCH /site-configs/{id}` rejects `status` in body (`400`).
- `DELETE /site-configs/{id}` rejects scheduled/published configs (`409`).
- Cron run promotes scheduled site configs at `scheduledAt <= event.scheduledTime`.
- `pnpm lint`, `pnpm check:dup`, `pnpm typecheck`, `pnpm test` pass.
- `pnpm advise` shows no new unacknowledged findings (existing suppressions for mapper/adapter duplication patterns may be extended).
- `README.md` lists `site_configs` under "collections" and the new endpoints under "Routes".
- This document's top `Status:` updated to `implemented`.

## 13. Final Model

```
docs/013 prerequisites           lifecycle plugin + permission catalog + crud-adapter helpers

src/domain/site-config/
  site-config.entity.ts          SiteConfig implements LifecycleCapable
  site-block.schema.ts           Zod discriminated union (hero, bio, about, featured_posts, links)
  site-config.repository.ts      findById/findActive/findBySlug/list/save/delete + scheduled-ready methods
  site-config-publish.workflow.ts publishAtomic(config) → archive current published + promote target

src/infrastructure/repositories/
  drizzle-site-config.repository.ts
  drizzle-site-config-publish.workflow.ts
  mappers/site-config.mapper.ts  explicit one-to-one with safe-parse block fallback on read

src/infrastructure/lifecycle/
  site-config-lifecycle-manager.ts
    canPublish/Unpublish/Schedule → "site_config.publish"
    canArchive                    → false if published; else "site_config.archive"
    save                          → publishAtomic for published, repo.save otherwise

src/application/site-config/
  create-site-config.usecase.ts        idempotent + slug resolution + "site_config.create"
  get-site-config.usecase.ts           public-read shortcut when active
  get-active-site-config.usecase.ts    no actor, no permission check
  list-site-configs.usecase.ts         cursor pagination, canMany filter
  update-site-config.usecase.ts        rejects archived; "site_config.update"
  delete-site-config.usecase.ts        rejects scheduled/published; "site_config.delete"

(generic lifecycle use cases from docs/013 parameterize SiteConfigLifecycleManager:
  PublishUseCase<SiteConfig>,  UnpublishUseCase<SiteConfig>,
  SchedulePublishUseCase<SiteConfig>, ArchiveUseCase<SiteConfig>)

src/http/routes/site-configs.routes.ts  10 endpoints — CRUD + lifecycle + public active
src/http/schemas/site-configs.schema.ts strict update body; slug regex; lexical-json aboutContent
src/http/presenters/site-config.presenter.ts

drizzle/0008_site_configs.sql           table + 4 indexes (incl. partial unique on published + scheduled idx)
src/infrastructure/db/schema.ts         siteConfigs table

src/composition/create-request-container.ts   wires CRUD + lifecycle for site_config (HTTP path)
src/composition/scheduled-lifecycle.ts        adds SiteConfigLifecycleManager to the cron-path manager array
                                              (consumed by workers/scheduled-publish/src/index.ts — docs/013 LCY-F)
src/domain/iam/resource-loader.ts             + siteConfigResource(...)
```

A SiteConfig starts as `draft`, may be `scheduled` for a future publish, becomes `published` atomically (archiving any previously-published sibling in the same org), and may be `archived` after being unpublished or replaced. Active configs are publicly readable through `GET /site-configs/active`. All non-active reads, mutations, and lifecycle transitions go through Content IAM. Blocks are Zod-validated on write and stored as JSON. The single-published-per-org invariant is enforced by a DB partial unique index and an adapter-level write workflow. Scheduled publishes are committed by the hourly Worker cron through the same compare-and-set primitive used by Post and Book.

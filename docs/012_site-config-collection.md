# Site Config Collection

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
> - `docs/007_content-iam-policy-binding-model.md`
> - `docs/009_book-resource-hierarchy-and-collaboration-plan.md`
> - `src/domain/iam/content-permission.ts`
> - `src/infrastructure/db/schema.ts`
> - `src/domain/books/book.entity.ts`
>
> Related docs:
>
> - `docs/013_content-lifecycle-plugin.md`
>
> Assumptions:
>
> - Content IAM (`docs/007`) is fully implemented and operational.
> - The lifecycle plugin system (`docs/013`) is a parallel track; the SiteConfig entity will be designed to adopt it once that system is stable.
> - Blocks are validated at the API boundary by Zod and stored as a JSON column in D1. SQLite does not support typed JSON querying beyond `json_extract`, so richer block filtering is a future concern.
> - Only one `SiteConfig` per org may have `status = "active"` at a time. This invariant is enforced by both the DB partial unique index and the application layer.
> - The `category.owner` built-in role was deprecated before this document was written; this doc formalizes the rationale that the code already references.

## Table Of Contents

- [1. Goal](#1-goal)
- [2. System Summary](#2-system-summary)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 Relevant Files](#31-relevant-files)
  - [3.2 Current Behavior](#32-current-behavior)
  - [3.3 Current Problems](#33-current-problems)
- [4. Target Model](#4-target-model)
  - [4.1 What A SiteConfig Is](#41-what-a-siteconfig-is)
  - [4.2 Activation Model](#42-activation-model)
  - [4.3 Dynamic Block Schema](#43-dynamic-block-schema)
  - [4.4 SiteConfig Entity](#44-siteconfig-entity)
  - [4.5 Database Schema](#45-database-schema)
  - [4.6 Content IAM Integration](#46-content-iam-integration)
  - [4.7 HTTP API Shape](#47-http-api-shape)
  - [4.8 Categories As Org-Owned Resources (Formal Rationale)](#48-categories-as-org-owned-resources-formal-rationale)
- [5. Architecture Decisions](#5-architecture-decisions)
  - [5.1 Multiple Promotable Configs, Not A Singleton](#51-multiple-promotable-configs-not-a-singleton)
  - [5.2 Zod-Validated Discriminated Union Stored As JSON](#52-zod-validated-discriminated-union-stored-as-json)
  - [5.3 Org-Level IAM Only — No Per-Resource Bindings For Site Configs](#53-org-level-iam-only--no-per-resource-bindings-for-site-configs)
  - [5.4 Activate As An Explicit Atomic Operation](#54-activate-as-an-explicit-atomic-operation)
  - [5.5 Lifecycle Plugin Opt-In](#55-lifecycle-plugin-opt-in)
  - [5.6 Rejected: JSONB Typed Block Columns](#56-rejected-jsonb-typed-block-columns)
  - [5.7 Rejected: Separate BlockInstance Table](#57-rejected-separate-blockinstance-table)
- [6. Edge Cases And Failure Modes](#6-edge-cases-and-failure-modes)
- [7. Definition Of Done](#7-definition-of-done)
- [8. Final Model](#8-final-model)

## 1. Goal

Introduce `site_configs` as a first-class org-level content collection in `content-api`. A `SiteConfig` is a promotable configuration record that drives the appearance and structure of a front-end site: it holds top-level metadata (title, bio, about text, hero media) and an ordered list of typed dynamic blocks (sections). Multiple configs exist per org; exactly one is active at a time. This lets an author maintain campaign variants, seasonal themes, or mood-driven layouts and switch between them with a single activate operation.

This document also formally records the rationale for categories being org-owned resources rather than user-owned — a decision already implemented in code that the `BUILT_IN_CONTENT_ROLES` constant in `src/domain/iam/content-permission.ts` references as `docs/012`.

Non-goals for the first release:

- Real-time preview of an inactive config in the front-end (can be added with a preview token later).
- Block-level IAM bindings (org-level authority is sufficient for site configuration).
- Scheduled activation (activate at a future datetime). The lifecycle plugin (`docs/013`) covers scheduling generically.
- Import/export of site configs across orgs.

## 2. System Summary

Typical author workflow:

```text
author
  -> POST /site-configs            create a new draft SiteConfig
  -> PATCH /site-configs/{id}      add/edit blocks, set title and bio
  -> POST /site-configs/{id}/activate   atomically deactivate current, activate this one
  -> GET /site-configs/active      front-end reads the active config to render the site
```

Content IAM evaluation on each step:

```text
create:    ContentPolicy.can(actor, "org.create_site_config", orgRef)
read:      public if active; requires site_config.read binding if draft or archived
update:    ContentPolicy.can(actor, "site_config.update", siteConfigRef)
activate:  ContentPolicy.can(actor, "site_config.activate", orgRef)
delete:    ContentPolicy.can(actor, "site_config.delete", siteConfigRef)
```

The `activate` check targets the `org` resource because activating a config is an org-global state change, not a mutation scoped to the single config being promoted.

## 3. Current-State Findings

### 3.1 Relevant Files

- `src/domain/iam/content-permission.ts` — `ContentPermissionKey`, `ContentResourceType`, `CONTENT_PERMISSIONS`, `BUILT_IN_CONTENT_ROLES`
- `src/infrastructure/db/schema.ts` — existing table definitions; no `site_configs` table
- `src/domain/books/book.entity.ts` — reference entity pattern with `visibility` and `status`
- `src/domain/posts/post.entity.ts` — reference entity with `status: "draft" | "published"`, `publishedAt`
- `src/application/posts/publish-post.usecase.ts` — reference for Content IAM permission check pattern
- `src/domain/iam/content-resource.ts` — `postResource`, `bookResource` loader helpers

### 3.2 Current Behavior

No `site_configs` table exists. `ContentResourceType` does not include `"site_config"`. `ContentPermissionKey` has no site-config permissions. The `BUILT_IN_CONTENT_ROLES` array has no `org.site_manager` role.

The `org.author` built-in role already includes `org.create_site_config` — wait, it does not yet; this permission does not exist. The `category.owner` built-in role is marked deprecated in code with a comment pointing at this doc:

```ts
// Deprecated: no longer assigned on category creation. Categories are org-owned resources
// managed entirely through org-level roles (system:org.author, system:org.content_admin).
// This role definition is kept to preserve any historical bindings that may exist in
// production. See docs/012 for the full decision rationale.
```

The `org.author` role already omits per-category ownership and handles the category taxonomy through org-level permissions, also referencing this doc.

### 3.3 Current Problems

- No way to store site-level metadata or page layout configuration in `content-api`.
- Front-end blogs have no authoritative source for title, bio, hero image, or dynamic section layout other than hardcoded values or a separate config file.
- No mechanism to run A/B layouts, seasonal campaigns, or mood-variant sites without a code deployment.
- Category IAM design is already implemented but undocumented; the code references this doc for rationale.

## 4. Target Model

### 4.1 What A SiteConfig Is

A `SiteConfig` is an org-scoped configuration record. An org may have many configs; exactly one may be active. Each config contains:

| Field | Type | Purpose |
|---|---|---|
| `id` | `string` | Primary key |
| `orgId` | `string` | Org tenancy boundary |
| `name` | `string` | Human label, e.g. `"Summer 2026 Campaign"` |
| `slug` | `string` | URL-safe identifier, unique within org |
| `status` | `"draft" \| "active" \| "archived"` | Activation state |
| `pageTitle` | `string \| null` | `<title>` tag and OG title |
| `bio` | `string \| null` | Short author/site bio |
| `aboutContent` | `string \| null` | Richer about-me text (plain text or serialized rich text JSON) |
| `heroMediaId` | `string \| null` | FK to `media.id` |
| `blocksJson` | `SiteBlock[]` | Ordered dynamic sections (Zod-validated, stored as JSON) |
| `activatedAt` | `Date \| null` | When this config became active |
| `createdByUserId` | `string` | FK to `users.id` |
| `createdAt` | `Date` | |
| `updatedAt` | `Date` | |

### 4.2 Activation Model

Only one config may be `active` per org at any time. The activate operation is atomic:

```text
1. Load the target config; require status !== "archived".
2. ContentPolicy.can(actor, "site_config.activate", orgRef).
3. In one D1 batch:
   a. UPDATE site_configs SET status = 'archived', activated_at = NULL
      WHERE org_id = ? AND status = 'active'
   b. UPDATE site_configs SET status = 'active', activated_at = NOW()
      WHERE id = ?
```

The partial unique index `site_configs_single_active_org_idx` on `(org_id) WHERE status = 'active'` acts as a DB-level guard. If step 3b races with another activation, the unique constraint will reject the second commit.

The first config ever activated for an org has no predecessor to archive; step 3a is a no-op in that case.

There is no `deactivate` endpoint — archiving the active config would leave the site with no active config. If a site owner wants to go dark, they activate a minimal "maintenance mode" config instead.

### 4.3 Dynamic Block Schema

Blocks are page sections rendered by the front-end. The full set is open for extension; v1 ships these block types:

```ts
// src/domain/site-config/site-block.schema.ts

export const heroBlockSchema = z.object({
  type: z.literal("hero"),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  mediaId: z.string().optional(),
  cta: z.object({ label: z.string(), url: z.string() }).optional(),
});

export const bioBlockSchema = z.object({
  type: z.literal("bio"),
  body: z.string().min(1),
  avatarMediaId: z.string().optional(),
});

export const aboutBlockSchema = z.object({
  type: z.literal("about"),
  heading: z.string().optional(),
  body: z.string().min(1),
});

export const featuredPostsBlockSchema = z.object({
  type: z.literal("featured_posts"),
  heading: z.string().optional(),
  postIds: z.array(z.string()).max(12),
});

export const linksBlockSchema = z.object({
  type: z.literal("links"),
  heading: z.string().optional(),
  items: z.array(z.object({ label: z.string().min(1), url: z.string().url() })).max(20),
});

export const siteBlockSchema = z.discriminatedUnion("type", [
  heroBlockSchema,
  bioBlockSchema,
  aboutBlockSchema,
  featuredPostsBlockSchema,
  linksBlockSchema,
]);

export const siteBlocksSchema = z.array(siteBlockSchema).max(30);

export type SiteBlock = z.infer<typeof siteBlockSchema>;
export type SiteBlocks = z.infer<typeof siteBlocksSchema>;
```

Validation happens at the route handler on write. Reads return the raw JSON parsed back through `siteBlocksSchema` in the mapper to ensure backward-compatible deserialization.

Adding a new block type is a code change to `siteBlocksSchema` — existing stored JSON is unaffected as long as the new type has a distinct `type` discriminant.

### 4.4 SiteConfig Entity

```ts
// src/domain/site-config/site-config.entity.ts

export type SiteConfigStatus = "draft" | "active" | "archived";

export type SiteConfigProps = {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  status: SiteConfigStatus;
  pageTitle: string | null;
  bio: string | null;
  aboutContent: string | null;
  heroMediaId: string | null;
  blocks: SiteBlocks;
  activatedAt: Date | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateSiteConfigProps = Omit<
  SiteConfigProps,
  "id" | "slug" | "status" | "activatedAt" | "createdAt" | "updatedAt"
>;

export type UpdateSiteConfigProps = Partial<
  Pick<SiteConfigProps, "name" | "pageTitle" | "bio" | "aboutContent" | "heroMediaId" | "blocks">
>;

export class SiteConfig {
  private constructor(private props: SiteConfigProps) {}

  static create(input: CreateSiteConfigProps): SiteConfig {
    const now = new Date();
    return new SiteConfig({
      ...input,
      id: crypto.randomUUID(),
      slug: randomizedSlugFromTitle(input.name),
      status: "draft",
      activatedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstitute(props: SiteConfigProps): SiteConfig {
    return new SiteConfig({ ...props, blocks: [...props.blocks] });
  }

  // getters ...

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

  activate(): void {
    if (this.props.status === "archived") throw new ConflictError("Cannot activate an archived site config");
    this.props.status = "active";
    this.props.activatedAt = new Date();
    this.props.updatedAt = new Date();
  }

  toSnapshot(): SiteConfigProps {
    return { ...this.props, blocks: [...this.props.blocks] };
  }
}
```

The entity does not enforce the single-active-per-org invariant by itself — that is a DB constraint. `activate()` sets the local state; the use case handles the atomic DB swap.

### 4.5 Database Schema

```ts
// src/infrastructure/db/schema.ts (addition)

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
    aboutContent: text("about_content"),
    heroMediaId: text("hero_media_id").references(() => media.id, { onDelete: "set null" }),
    blocksJson: text("blocks_json", { mode: "json" }).notNull().default("[]"),
    activatedAt: integer("activated_at", { mode: "timestamp_ms" }),
    createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("site_configs_org_slug_idx").on(table.orgId, table.slug),
    index("site_configs_org_status_idx").on(table.orgId, table.status),
    // Enforces at most one active config per org at the DB level.
    uniqueIndex("site_configs_single_active_org_idx")
      .on(table.orgId)
      .where(sql`${table.status} = 'active'`),
  ],
);
```

Migration: a new `0006_site_configs` migration file containing the `CREATE TABLE` and the partial unique index.

### 4.6 Content IAM Integration

New entries added to `ContentPermissionKey` and `CONTENT_PERMISSIONS` in `src/domain/iam/content-permission.ts`:

```ts
// ContentResourceType addition:
| "site_config"

// ContentPermissionKey additions:
| "org.create_site_config"
| "site_config.read"
| "site_config.update"
| "site_config.activate"
| "site_config.delete"

// CONTENT_PERMISSIONS additions:
{ key: "org.create_site_config",  description: "Create a site config inside an organization",  delegationClass: "ordinary" },
{ key: "site_config.read",        description: "Read a draft or archived site config",           delegationClass: "ordinary" },
{ key: "site_config.update",      description: "Update a site config's content or blocks",       delegationClass: "ordinary" },
{ key: "site_config.activate",    description: "Promote a site config to active",                delegationClass: "ordinary" },
{ key: "site_config.delete",      description: "Delete a draft or archived site config",         delegationClass: "ordinary" },
```

New built-in role in `BUILT_IN_CONTENT_ROLES`:

```ts
{
  id: "system:org.site_manager",
  key: "org.site_manager",
  name: "Organization Site Manager",
  assignableResourceType: "org",
  protected: false,
  permissions: [
    "org.create_site_config",
    "site_config.read",
    "site_config.update",
    "site_config.activate",
    "site_config.delete",
  ],
},
```

Update `org.content_admin` to also include all five site config permissions.

Policy evaluation at each operation:

| Operation | Permission checked | Resource ref |
|---|---|---|
| Create | `org.create_site_config` | `orgRef` |
| Read (draft/archived) | `site_config.read` | `siteConfigRef` |
| Read (active) | public, no permission check | — |
| Update | `site_config.update` | `siteConfigRef` |
| Activate | `site_config.activate` | `orgRef` (org-global effect) |
| Delete | `site_config.delete` | `siteConfigRef` |

`siteConfigRef` carries `orgId` and `ancestors: [{ type: "org", id: orgId }]` so bindings inherited from `org` apply.

Resource loader helper to add in `src/domain/iam/resource-loader.ts`:

```ts
export function siteConfigResource(config: SiteConfig): ContentResourceRef {
  return {
    type: "site_config",
    id: config.id,
    orgId: config.orgId,
    ancestors: [{ type: "org", id: config.orgId }],
  };
}
```

### 4.7 HTTP API Shape

Routes live in `src/http/routes/site-configs.routes.ts`. All routes require `content:write` scope except the active config read.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/site-configs` | `content:read`, `site_config.read` on org | List all configs for the actor's org |
| `POST` | `/site-configs` | `content:write`, `org.create_site_config` | Create a draft config |
| `GET` | `/site-configs/active` | public | Read the active config (used by front-end) |
| `GET` | `/site-configs/{id}` | `content:read`, `site_config.read` or public if active | Read one config |
| `PATCH` | `/site-configs/{id}` | `content:write`, `site_config.update` | Update metadata and blocks |
| `POST` | `/site-configs/{id}/activate` | `content:write`, `site_config.activate` on org | Atomically promote to active |
| `DELETE` | `/site-configs/{id}` | `content:write`, `site_config.delete` | Delete draft or archived config |

The active config endpoint (`GET /site-configs/active`) requires no actor and no permission check — it is the public read surface. It returns `404` when no active config exists.

Response shape (presenter in `src/http/presenters/site-config.presenter.ts`):

```ts
type SiteConfigResponse = {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  status: "draft" | "active" | "archived";
  pageTitle: string | null;
  bio: string | null;
  aboutContent: string | null;
  heroMediaId: string | null;
  blocks: SiteBlock[];
  activatedAt: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};
```

### 4.8 Categories As Org-Owned Resources (Formal Rationale)

The `category.owner` built-in role (`system:category.owner`) is deprecated. The code in `src/domain/iam/content-permission.ts` already reflects this and references this doc. Here is the rationale:

Categories are a shared taxonomy for an organization, not personal content. A post references a category; a category is not authored and owned by one person the way a post is. Any org author needs to be able to create, edit, and manage the taxonomy so that newly created posts can be categorized correctly. Giving each category a direct owner creates friction: if the owner leaves or is removed, the category becomes unmanageable without an org admin intervening.

The decision:

- `org.author` (the role seeded when a user creates their first content) receives `org.create_category`, `category.read`, `category.update`, `category.delete`.
- `org.content_admin` also includes all four category permissions.
- `category.owner` bindings are no longer created on category creation. The role definition is preserved in `BUILT_IN_CONTENT_ROLES` only to avoid breaking any historical bindings that exist in production databases from before this decision.

Any new resource that is a shared org taxonomy (e.g. tags, collections, series) should follow the same model: no per-resource owner binding; managed via org-level roles.

## 5. Architecture Decisions

### 5.1 Multiple Promotable Configs, Not A Singleton

A singleton would mean one row with a fixed primary key, accessed via `GET /site-config` (no ID). This gives no history, no rollback, no campaign testing. Making it a normal collection with an activation step costs almost nothing — it is just a `status` column and a partial unique index — and immediately enables seasonal variants, campaign configs, and rollback by activating a previous config.

### 5.2 Zod-Validated Discriminated Union Stored As JSON

Block content is stored in a single `blocks_json` text column as a JSON array. The Zod discriminated union schema (`siteBlockSchema`) is the contract enforced at the API boundary on every write and re-validated on every read-through-mapper path.

This avoids the need for a `site_config_blocks` join table while preserving type safety in application code. The tradeoff is that block-level SQL queries (e.g. "all configs containing a hero block") require `json_extract`, which is functional but not indexed. That query pattern is not a first-release requirement.

Adding a new block type is a code change (extend `siteBlockSchema`) with no migration needed. Removing a block type requires a data migration to strip orphaned blocks; soft-deprecation (keep parsing the old type) is preferred.

### 5.3 Org-Level IAM Only — No Per-Resource Bindings For Site Configs

Unlike books, site configs do not need collaborator sharing at the individual config level. The `org.site_manager` role and `org.content_admin` role are the complete access control model. A direct user or team that should manage site configs is given `org.site_manager` on the org resource.

This keeps the binding model simple. If per-config sharing becomes necessary (e.g. a contractor can only edit the campaign config but not the default), it can be added by extending `site_config.update` bindings to target individual `site_config` resources — the architecture already supports it, since `siteConfigRef` carries ancestry.

### 5.4 Activate As An Explicit Atomic Operation

Activate is modeled as a dedicated HTTP action (`POST /site-configs/{id}/activate`) rather than a `PATCH` that sets `status = "active"`. Reasons:

- It has a side-effect on another row (deactivating the current active config), which a generic PATCH must not silently perform.
- It requires a different permission check (`site_config.activate` on the org) than a regular update.
- It maps cleanly onto the lifecycle plugin's `publish` transition once that system is adopted (see `docs/013`).

### 5.5 Lifecycle Plugin Opt-In

`SiteConfig` has three statuses (`draft`, `active`, `archived`) that correspond directly to the lifecycle plugin's `draft → published → archived` model described in `docs/013`, with `active` mapping to `published`. Once `docs/013` is implemented, `SiteConfig` should be adapted to use the generic `LifecycleManager<SiteConfig>` and `PublishUseCase<SiteConfig>` rather than its own bespoke activate use case.

The entity design in Section 4.4 deliberately follows the lifecycle entity pattern: `status`, `activatedAt` (→ `publishedAt` in lifecycle terms), and explicit transition methods (`activate()`).

### 5.6 Rejected: JSONB Typed Block Columns

Storing each block field as a separate column (`hero_title`, `hero_media_id`, `bio_body`, ...) or using a typed JSONB column per block type would make adding new block types require schema migrations and could not represent heterogeneous ordered lists without a join table.

### 5.7 Rejected: Separate BlockInstance Table

A `site_config_blocks(id, site_config_id, type, order, payload_json)` table would enable SQL queries over block types and orderings. The cost is an extra join on every read and a multi-statement write on every block update. For the query patterns expected (read the full config, update all blocks atomically), the JSON column is simpler and sufficient.

## 6. Edge Cases And Failure Modes

- **Concurrent activation race**: Two requests activate different configs simultaneously. The partial unique index (`site_configs_single_active_org_idx`) causes the second D1 batch to fail with a unique constraint violation. The application should catch this and return `409 Conflict`.
- **No active config**: `GET /site-configs/active` returns `404`. The front-end must handle an unconfigured state gracefully.
- **Media reference in blocks**: `heroMediaId` and `mediaId` in hero/bio blocks reference `media.id`. If the referenced media is deleted, the FK uses `onDelete: "set null"` for `heroMediaId`. Block-embedded `mediaId` fields are not foreign keys (they are inside JSON); if media is deleted, the front-end receives a dangling ID and should degrade gracefully (broken image, not a 500). A future cleanup job can scan `blocks_json` for stale media IDs.
- **Activating an archived config**: Rejected by `activate()` with a `ConflictError`. The caller must duplicate the config and activate the copy.
- **Updating an archived config**: Rejected by `update()` with a `ConflictError`. Same: duplicate first.
- **Block schema evolution — unknown type on read**: If the DB contains a block type that the current `siteBlockSchema` does not recognize (e.g. from a rolled-back code deploy), `siteBlocksSchema.parse(...)` will fail. The mapper should use `siteBlocksSchema.safeParse(...)` and filter out unrecognized blocks rather than failing the entire response.
- **Slug collision**: The `site_configs_org_slug_idx` unique index rejects duplicate slugs within an org. The create use case should derive a randomized slug (same pattern as `randomizedSlugFromTitle`) to avoid collisions on similarly-named configs.
- **Empty blocks array**: Valid. An active config with no blocks renders a minimal site with just the top-level fields.
- **`postIds` in `featured_posts` block pointing to non-existent posts**: Not validated at write time. The front-end should filter out missing posts rather than breaking the render.

## 7. Definition Of Done

- `site_configs` table created with partial unique index; migration file present and applies cleanly to a fresh D1 instance.
- `SiteConfig` entity in `src/domain/site-config/site-config.entity.ts` with `create`, `reconstitute`, `update`, `activate`, `toSnapshot`.
- `siteBlockSchema` and `siteBlocksSchema` Zod validators in `src/domain/site-config/site-block.schema.ts`.
- `SiteConfigRepository` interface in `src/domain/site-config/site-config.repository.ts` with `findById`, `findActiveByOrgId`, `listByOrgId`, `save`, `activateAtomic`, `delete`.
- Drizzle repository implementation in `src/infrastructure/repositories/drizzle-site-config.repository.ts`.
- Five permission keys and `org.site_manager` role added to `src/domain/iam/content-permission.ts`; `org.content_admin` updated.
- `ContentResourceType` includes `"site_config"`; `siteConfigResource()` helper added to `src/domain/iam/resource-loader.ts`.
- Use cases in `src/application/site-config/`: `CreateSiteConfigUseCase`, `GetSiteConfigUseCase`, `GetActiveSiteConfigUseCase`, `ListSiteConfigsUseCase`, `UpdateSiteConfigUseCase`, `ActivateSiteConfigUseCase`, `DeleteSiteConfigUseCase`.
- Routes in `src/http/routes/site-configs.routes.ts` with OpenAPI schemas; presenter in `src/http/presenters/site-config.presenter.ts`.
- `GET /site-configs/active` returns `200` with the active config and `404` with no body when none is active.
- `POST /site-configs/{id}/activate` atomically deactivates the previous active config and activates the new one; concurrent requests return `409`.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` pass.
- `pnpm advise` shows no new unacknowledged findings.
- `README.md` updated to list this feature.

## 8. Final Model

```
src/domain/site-config/
  site-config.entity.ts         # SiteConfig entity: draft/active/archived lifecycle
  site-block.schema.ts          # Zod discriminated union for all block types
  site-config.repository.ts     # Domain repository interface

src/infrastructure/repositories/
  drizzle-site-config.repository.ts

src/application/site-config/
  create-site-config.usecase.ts
  get-site-config.usecase.ts
  get-active-site-config.usecase.ts
  list-site-configs.usecase.ts
  update-site-config.usecase.ts
  activate-site-config.usecase.ts
  delete-site-config.usecase.ts

src/http/routes/
  site-configs.routes.ts

src/http/presenters/
  site-config.presenter.ts
```

DB: one new table `site_configs` with a partial unique index enforcing single-active-per-org.

IAM: five new permission keys, one new `org.site_manager` role, `org.content_admin` updated.

A `SiteConfig` starts as `draft`, is activated to `active` (atomically deactivating the previous active config), and can be archived. Active configs are publicly readable. All other states require `site_config.read`. Blocks are Zod-validated on write and stored as a JSON array in `blocks_json`.

When `docs/013` (lifecycle plugin) is implemented, `ActivateSiteConfigUseCase` should be replaced by the generic `PublishUseCase<SiteConfig>` using a `SiteConfigLifecycleManager` adapter, with `active` mapping to `published`.

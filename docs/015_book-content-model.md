# Book Content Model

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
> - `docs/007_content-iam-policy-binding-model.md`
> - `docs/012_content-lifecycle-plugin.md` — required prerequisite; chapters and books reuse `LifecycleCapable` + adapter pattern
> - `docs/013_site-config-collection.md` — block-schema-as-Zod-JSON pattern reference
> - `docs/payloadcms-schema-spec.md` — what the old PayloadCMS `books`/`chapters` collections stored
> - `docs/payloadcms-access-control-policy-spec.md` — the access semantics being replaced
> - `.claude/skills/content-api-architecture/SKILL.md`
> - `.claude/skills/content-iam-usage/SKILL.md`
> - `src/domain/books/book.entity.ts`
> - `src/infrastructure/db/schema.ts`
> - `src/infrastructure/repositories/drizzle-book.repository.ts`
> - `src/domain/iam/content-permission.ts`
> - `src/domain/iam/content-policy.ts`
> - `src/domain/iam/resource-loader.ts`
> - `/home/quanghuy1242/pjs/payloadcms/src/utils/epubLexical.ts` — old HTML→Lexical conversion, read for node-shape reference only
>
> Related docs:
>
> - `docs/014_audit-service-stub.md` — audit triggers from this doc
> - `docs/016_book-interactions.md` — comments + reading state on top of this model
> - `docs/017_epub-import.md` — import pipeline consumes this model
> - `docs/009_book-resource-hierarchy-and-collaboration-plan.md` — **ABANDONED**; remaining work absorbed into this document plus 016 and 017
>
> Assumptions:
>
> - Content IAM (docs/007) is operational. Every chapter operation goes through `ContentPolicy.can(actor, permission, resource)` with the chapter resource's ancestors set to `[parent-chapter…, book, org]`.
> - The Content Lifecycle Plugin (docs/012) is operational. Chapters and Books use the plugin's `draft → scheduled → published → archived` machine. This document does not redefine lifecycle vocabulary; it lists which permissions and adapters chapters add.
> - Block content is validated by Zod at the API boundary and stored as a single JSON column on `chapters.content_json`. There is **no** `blocks` table.
> - The configurable max chapter depth defaults to 4 (book is depth 0; root chapter is depth 1; deepest leaf chapter is depth 4). The config lives in an environment-validated constant, not in user data.
> - `media` already exists with the upload-and-derivatives pipeline from docs/002 / architecture §14. This doc adds attachment tracking; it does not change media's own lifecycle.
> - Chapter content edits do not block on media-processor finishing variant generation. The chapter references the `media.id`; the renderer is responsible for falling back to `lowResUrl` or a placeholder if variants are not ready.
> - Comments, inline comments, bookmarks, and reading progress are **not** in this doc. See docs/016. Internal-link **resolution** is in docs/017; internal-link **node shape** is in this doc.

## Table Of Contents

- [1. Goal](#1-goal)
- [2. System Summary](#2-system-summary)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 Relevant Files](#31-relevant-files)
  - [3.2 Current Behavior](#32-current-behavior)
  - [3.3 Current Problems](#33-current-problems)
- [4. Target Model](#4-target-model)
  - [4.1 Resource Hierarchy](#41-resource-hierarchy)
  - [4.2 Recursive Chapter Table](#42-recursive-chapter-table)
  - [4.3 Chapter Lexical Content Schema](#43-chapter-lexical-content-schema)
  - [4.4 Book Cover And Media Attachments](#44-book-cover-and-media-attachments)
  - [4.5 Book Origin And Auto-Promotion](#45-book-origin-and-auto-promotion)
  - [4.6 Replace-Existing-Book Destructive Workflow](#46-replace-existing-book-destructive-workflow)
  - [4.7 Content IAM Wiring](#47-content-iam-wiring)
  - [4.8 HTTP API Surface](#48-http-api-surface)
- [5. Architecture Decisions](#5-architecture-decisions)
  - [5.1 Recursive Chapter, Not Section/Block Tables](#51-recursive-chapter-not-sectionblock-tables)
  - [5.2 Block IDs Live In Lexical JSON, Not As Rows](#52-block-ids-live-in-lexical-json-not-as-rows)
  - [5.3 One chapter-link Node, Resolved At Write Time](#53-one-chapter-link-node-resolved-at-write-time)
  - [5.4 Origin At Book Level, One-Way Promotion](#54-origin-at-book-level-one-way-promotion)
  - [5.5 Replace Is A Workflow, Not A Merge](#55-replace-is-a-workflow-not-a-merge)
  - [5.6 Attachments Are A Tracked Side-Effect Of References](#56-attachments-are-a-tracked-side-effect-of-references)
  - [5.7 Rejected Or Deferred Options](#57-rejected-or-deferred-options)
- [6. Implementation Strategy](#6-implementation-strategy)
- [7. Detailed Implementation Plan](#7-detailed-implementation-plan)
  - [7.1 Chapter Entity And Schema](#71-chapter-entity-and-schema)
  - [7.2 Lexical Content Validation](#72-lexical-content-validation)
  - [7.3 Media Attachments](#73-media-attachments)
  - [7.4 Book Origin And Promotion](#74-book-origin-and-promotion)
  - [7.5 Replace-Existing-Book Workflow](#75-replace-existing-book-workflow)
  - [7.6 Content IAM Permission And Role Updates](#76-content-iam-permission-and-role-updates)
  - [7.7 HTTP Routes And Presenters](#77-http-routes-and-presenters)
  - [7.8 Composition And Wiring](#78-composition-and-wiring)
- [8. Migration And Rollout](#8-migration-and-rollout)
- [9. Edge Cases And Failure Modes](#9-edge-cases-and-failure-modes)
- [10. Implementation Backlog](#10-implementation-backlog)
  - [BCM-A. Chapter Entity, Schema, And Repository](#bcm-a-chapter-entity-schema-and-repository)
  - [BCM-B. Lexical Content Validation](#bcm-b-lexical-content-validation)
  - [BCM-C. Media Attachments Tracking](#bcm-c-media-attachments-tracking)
  - [BCM-D. Book Origin And Auto-Promotion](#bcm-d-book-origin-and-auto-promotion)
  - [BCM-E. Replace-Existing-Book Workflow](#bcm-e-replace-existing-book-workflow)
  - [BCM-F. Content IAM Permissions And Built-in Roles](#bcm-f-content-iam-permissions-and-built-in-roles)
  - [BCM-G. HTTP Routes And Presenters](#bcm-g-http-routes-and-presenters)
  - [BCM-H. Documentation And Cleanup](#bcm-h-documentation-and-cleanup)
- [11. Future Backlog](#11-future-backlog)
- [12. Test And Verification Plan](#12-test-and-verification-plan)
- [13. Definition Of Done](#13-definition-of-done)
- [14. Final Model](#14-final-model)

## 1. Goal

Make the book a real authoring resource on this platform. A book is a recursive tree of chapters that hold typed Lexical content; chapters reference media through tracked attachments; the book carries an `origin` flag that distinguishes "this came from an EPUB import" from "this is platform-authored". Re-running an import against a book that has already been edited on the platform is rejected; replacing it is an explicit destructive workflow.

After this work lands:

- Authors can create a recursive chapter tree under a book, up to a configurable depth (default 4).
- Chapter content is a typed Lexical JSON document with stable block IDs that comments and inline comments can anchor to.
- Chapters can hold cross-chapter links (`chapter-link`) and unresolvable-link fallbacks (`broken-link`) — both are platform concepts; no raw EPUB href ever reaches D1.
- Books can hold a cover and chapters can embed media; both reference `media.id` via tracked attachments and require `media.attach` on the target.
- Books carry an `origin` that auto-flips from `imported` to `platform` on first content mutation; "replace existing book" is an explicit, audited destructive workflow, not a hook side-effect.
- Generic `PATCH /books/:id` and `PATCH /chapters/:id` cannot mutate lifecycle status (docs/012) and cannot mutate `origin` (this doc).

Non-goals:

- Comments, inline comments, bookmarks, and reading progress (see docs/016).
- The EPUB import worker itself (see docs/017).
- A general resource audit log (see docs/014). This doc lists audit triggers but does not implement the audit subsystem.
- Real-time collaborative editing of chapter content. Updates are last-writer-wins at the chapter row level; `updated_at` + an optimistic `version` column enables compare-and-set.
- Block-level IAM bindings. Permissions go up to chapter granularity; finer-grained bindings are explicitly rejected (see §5.2).

## 2. System Summary

Authoring flow:

```text
client
  -> POST /books { title }                       (already exists)
       responds with book { id, origin: "platform", status: "draft" }

  -> POST /books/{bookId}/chapters { title, parentChapterId?, orderIndex? }
       creates chapter row at depth = parent.depth + 1
       (or depth 1 when parentChapterId is null)
       responds with chapter { id, depth, parentChapterId, contentJson: <empty> }

  -> PATCH /chapters/{chapterId} { contentJson }
       Zod-validates contentJson against the Lexical schema in §4.3
       diffs media-reference nodes vs the previous content to update
         media_attachments rows
       enforces ContentPolicy.can(actor, "chapter.update", chapterRef)
       saves chapter row
       if book.origin = "imported" then book.origin <- "platform"
         (auto-promotion is atomic with the chapter save)

  -> POST /chapters/{chapterId}/publish        (lifecycle plugin)
  -> POST /chapters/{chapterId}/archive        (lifecycle plugin)
  -> DELETE /chapters/{chapterId}              (cascades to descendants)
```

Replace-existing-book flow:

```text
client
  -> POST /books/{bookId}:replace { newImportObjectKey, ... }
       starts a destructive workflow:
         - archives book{bookId} (status -> archived, replaced_by_book_id set)
         - creates book{newId}   (origin = "imported")
         - transfers all policy bindings from old book to new book
         - kicks off an EPUB import targeting newId         (docs/017)
       client polls book{newId} for import status
```

Chapter content lifecycle inside a request:

```text
PATCH /chapters/{id}
  http route
    -> validates input JSON with chapterUpdateBodySchema
    -> calls UpdateChapterUseCase.execute(...)

UpdateChapterUseCase
  -> chapterRepo.findById(id)
  -> chapterPolicy.assertCanUpdate(actor, chapter)
  -> chapter.update({ contentJson, title?, orderIndex?, parentChapterId? })
       (entity validates content schema, recomputes depth on parent change)
  -> attachmentDiffService.diff(prev.contentJson, next.contentJson)
       returns { added: media.id[], removed: media.id[] }
  -> for each added id: mediaPolicy.assertCanAttach(actor, media)
  -> updateChapterAndAttachmentsWorkflow.run({
       chapter,
       addedAttachments,
       removedAttachments,
       promoteBookFromImportedToPlatform?,
     })
       (single db.batch — chapter row + attachment rows + optional book.origin flip)
```

## 3. Current-State Findings

### 3.1 Relevant Files

- [src/domain/books/book.entity.ts](../src/domain/books/book.entity.ts) — current Book entity.
- [src/domain/books/book.repository.ts](../src/domain/books/book.repository.ts) — repository interface.
- [src/domain/books/book-create.workflow.ts](../src/domain/books/book-create.workflow.ts) — atomic book create + owner binding.
- [src/infrastructure/db/schema.ts](../src/infrastructure/db/schema.ts) — `books`, `media`, `content_*` tables.
- [src/infrastructure/repositories/drizzle-book.repository.ts](../src/infrastructure/repositories/drizzle-book.repository.ts)
- [src/infrastructure/repositories/drizzle-book-create.workflow.ts](../src/infrastructure/repositories/drizzle-book-create.workflow.ts)
- [src/domain/iam/content-permission.ts](../src/domain/iam/content-permission.ts) — permission catalog (currently includes `org.create_book`, `book.read`, `book.update`, etc.; no chapter permissions).
- [src/domain/iam/resource-loader.ts](../src/domain/iam/resource-loader.ts) — `bookResource(book)` exists; no `chapterResource`.
- [src/http/routes/books.routes.ts](../src/http/routes/books.routes.ts) — book CRUD + IAM mutation routes.
- [docs/009_book-resource-hierarchy-and-collaboration-plan.md](009_book-resource-hierarchy-and-collaboration-plan.md) — abandoned predecessor.
- [docs/012_content-lifecycle-plugin.md](012_content-lifecycle-plugin.md) — chapter is listed in §6.4 as a future adopter; this doc lands it.
- [`/home/quanghuy1242/pjs/payloadcms/src/utils/epubLexical.ts`](../../payloadcms/src/utils/epubLexical.ts) — only consulted to reuse Lexical node names where they already exist (`paragraph`, `heading`, `link`, `quote`, `list`, `listitem`, `image`).

### 3.2 Current Behavior

- A `book` has `id`, `orgId`, `title`, `createdByUserId`, `visibility`, `status`, `createdAt`, `updatedAt`. Nothing else. There is no `slug`, no `cover`, no `origin`, no bibliographic metadata.
- A book has **no chapter children**. There is no `chapters` table.
- `BUILT_IN_CONTENT_ROLES` carries `system:org.content_admin`, `system:book.owner`, `system:book.sharing_manager`, `system:book.editor`. No chapter-flavored built-ins.
- `media` already supports the upload-presign-process-derivatives pipeline. It has `owner`, `visibility`, `status`, `orgId`. There is no `media_attachments` table; the platform cannot answer "which chapter references this media" without scanning every chapter's content.
- IAM ancestry today: `chapter` is not a `ContentResourceType`. `resource-loader.ts` only produces ancestors `[{ type: "org", id: ... }]` for `book`. There is no `chapterResource(chapter)` helper.

### 3.3 Current Problems

- No way to author book content. The product is a book platform with no chapter table.
- No structural plan for what "section" or "block" means; the abandoned docs/009 used three separate tables for chapter/section/block. That is the wrong granularity for IAM (block-level bindings are useless) and the wrong granularity for storage (sub-chapter structure is a content-shape question, not a database-shape question).
- No way to link from one chapter to another. The old PayloadCMS solved this with an `epub-internal-link` Lexical node that stored the raw EPUB href and resolved at read time against `chapterSourceKey`. That model leaks importer internals into every reader; see docs/017 §3 for why it is being dropped.
- Re-importing an EPUB after manual edits is a tombstone-laden mess in PayloadCMS (`manualEditedAt` per chapter; a chapter that is ever edited locks out re-import forever). The new design must make this an explicit, all-or-nothing decision.
- Media references inside chapter content cannot be reverse-looked-up. Deleting a media that is still referenced today silently breaks chapters.

## 4. Target Model

### 4.1 Resource Hierarchy

```text
org
  book
    chapter (recursive — depth 1 … MAX_CHAPTER_DEPTH)
    media (already exists; cover + chapter-embedded references)
```

For IAM purposes a chapter resource ref carries its full ancestry from nearest-parent to org:

```ts
// in src/domain/iam/resource-loader.ts
export function chapterResource(chapter: Chapter): ContentResourceRef {
  return {
    type: "chapter",
    id: chapter.id,
    orgId: chapter.orgId,
    ancestors: [
      // walk up parent chapters in order, nearest first:
      ...chapter.ancestorChapterRefs(),     // [{ type: "chapter", id: parent.id }, ...]
      { type: "book", id: chapter.bookId },
      { type: "org", id: chapter.orgId },
    ],
  };
}
```

`ancestorChapterRefs()` is derived from the chapter row's materialized `ancestor_chapter_ids_json` column (§4.2). Walking parents one row at a time per request is rejected for read amplification reasons.

### 4.2 Recursive Chapter Table

Schema (Drizzle):

```ts
export const chapters = sqliteTable("chapters", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  bookId: text("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  parentChapterId: text("parent_chapter_id"),
  // materialized ancestry, nearest-first, JSON array of chapter IDs;
  // empty array when parentChapterId is null
  ancestorChapterIdsJson: text("ancestor_chapter_ids_json", { mode: "json" }).notNull().default("[]"),
  depth: integer("depth").notNull(),                // 1..MAX_CHAPTER_DEPTH
  orderIndex: integer("order_index").notNull(),     // dense unique per (bookId, parentChapterId)
  title: text("title").notNull(),
  slug: text("slug").notNull(),                     // unique per (bookId, parentChapterId)
  contentJson: text("content_json", { mode: "json" }).notNull(),
  // lifecycle plugin (docs/012)
  status: text("status").notNull().default("draft"),
  scheduledAt: integer("scheduled_at", { mode: "timestamp_ms" }),
  publishedAt: integer("published_at", { mode: "timestamp_ms" }),
  archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
  // optimistic concurrency on chapter content edits
  version: integer("version").notNull().default(1),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
  index("chapters_book_parent_order_idx").on(table.bookId, table.parentChapterId, table.orderIndex),
  uniqueIndex("chapters_book_parent_slug_unique_idx").on(table.bookId, table.parentChapterId, table.slug),
  index("chapters_book_status_idx").on(table.bookId, table.status),
  index("chapters_parent_idx").on(table.parentChapterId),
  index("chapters_scheduled_idx")
    .on(table.scheduledAt)
    .where(sql`${table.status} = 'scheduled'`),
]);
```

Configurable max depth:

- Constant `MAX_CHAPTER_DEPTH` in [src/shared/books/chapter-depth.ts](../src/shared/books/chapter-depth.ts). Default `4`.
- Read from `env.MAX_CHAPTER_DEPTH` (Zod-validated in [src/config/env.ts](../src/config/env.ts), default `4`, range `[1, 10]`).
- Enforced by the chapter entity's `create` and `move` methods. Repository never inserts a row that violates the bound; `chapter.move(newParent)` recomputes ancestry and rejects depth-overflow at the domain layer.

Move semantics:

- Changing `parentChapterId` recomputes `depth`, `ancestorChapterIdsJson`, and re-validates against `MAX_CHAPTER_DEPTH`.
- Moving a subtree atomically rewrites every descendant's `depth` and `ancestorChapterIdsJson`. This is done in the `move-chapter` workflow (see §7.1) and uses `db.batch(...)` in the infrastructure workflow port.
- Cross-book moves are rejected. Cross-org moves are rejected (already covered by ancestor-org check in Content IAM).
- Moving into a descendant of self is rejected as a cycle.

Delete semantics:

- `DELETE /chapters/{id}` cascades to all descendants by foreign-key (`ON DELETE CASCADE` on `parent_chapter_id` is **not** used — see §5.2 explanation; cascade is performed by the workflow itself in a single `db.batch(...)`). This keeps media-attachment cleanup explicit.
- Each cascade-deleted chapter contributes a removed-media-reference set; the workflow merges them and deletes the corresponding `media_attachments` rows.
- The cascade must verify `ContentPolicy.can(actor, "chapter.delete", chapterRef)` on the top deletion target only. Descendants inherit the decision via ancestry.

### 4.3 Chapter Lexical Content Schema

`chapter.contentJson` is a single Lexical JSON document. The platform validates the document shape at the API boundary with a Zod discriminated union before it ever reaches the entity. The runtime shape is intentionally restricted to a small set of nodes the renderer and editor both understand.

Top-level shape:

```ts
{
  root: {
    type: "root",
    children: Block[],
    version: 1
  }
}
```

Block union (`type` discriminator, all block nodes carry a stable `blockId`):

| `type` | Carried fields | Notes |
|---|---|---|
| `paragraph` | `blockId`, `direction`, `children: Inline[]` | Default text block. |
| `heading` | `blockId`, `tag` ∈ `h1…h6`, `direction`, `children: Inline[]` | Heading. `h1` is the chapter title slot in the renderer; the title row column is canonical for IAM/search. |
| `quote` | `blockId`, `children: Inline[]` | Blockquote. |
| `list` | `blockId`, `listType` ∈ `bullet`, `number`, `children: ListItem[]` | Lists. |
| `listitem` | `blockId`, `children: (Inline \| Block)[]` | Allowed only inside `list`. |
| `image` | `blockId`, `mediaId`, `alt`, `width?`, `height?`, `focalX?`, `focalY?` | Inline image referencing `media.id`. Tracked in `media_attachments`. |
| `horizontalrule` | `blockId` | Separator. |
| `code` | `blockId`, `language?`, `code` (string) | Code block. Stored verbatim. |
| `callout` | `blockId`, `tone` ∈ `info`, `warn`, `tip`, `children: Block[]` | Imported from EPUB callouts; platform-editable. |
| `footnote` | `blockId`, `noteId`, `children: Inline[]` | Footnote definition; referenced from inline `footnoteref`. |

Inline union:

| `type` | Carried fields | Notes |
|---|---|---|
| `text` | `text`, `format` (bitfield), `style?` | Standard Lexical text node. |
| `linebreak` | (none) | Hard break. |
| `link` | `url`, `target?`, `rel?`, `children: Inline[]` | External link. `url` is HTTP(S), `mailto:`, or `tel:`; validated by Zod. |
| `chapter-link` | `chapterId`, `anchor?` (string = target `blockId`), `children: Inline[]` | **Platform internal link.** `chapterId` is the resolved `chapters.id`. `anchor` references a `blockId` inside the target chapter. |
| `broken-link` | `originalHref`, `reason` ∈ `unresolved`, `cross-book`, `cross-org`, `target-deleted`, `children: Inline[]` | **Fallback for unresolvable cross-chapter links.** Visible in the editor (renderer should style it red). Carries `originalHref` for debugging only; readers should never click through. |
| `footnoteref` | `noteId`, `children: Inline[]` | Footnote reference; targets a `footnote` block with the same `noteId`. |

Validation rules enforced by the boundary schema in [src/http/schemas/chapter-content.schema.ts](../src/http/schemas/chapter-content.schema.ts):

- Every block node must carry a `blockId` that is a non-empty string ≤ 32 chars, matching `^[a-z0-9]+(?:-[a-z0-9]+)*$`. The entity ensures uniqueness *within* the chapter; collisions are normalized server-side (a colliding new id is replaced with `crypto.randomUUID().slice(0, 8)` before save).
- `chapter-link.chapterId` must reference an existing chapter row. Validation runs after Zod parsing as a cheap existence check by the use case (single SQL `IN` query batched across all `chapter-link` references in the new document).
- `chapter-link` whose target chapter is in a different book or different org becomes `broken-link { reason: "cross-book" | "cross-org" }` at write time. The use case rewrites the node before save; it does not reject the request, because a draft edit may legitimately reference a chapter that has since moved.
- `chapter-link.anchor`, when present, must be a `blockId` that exists in the target chapter's current content. If absent, the link still resolves; the renderer scrolls to the top of the target chapter.
- `image.mediaId` must reference a `media` row in the same org. Validated as a batched existence check (same pattern as `chapter-link`). Failed references become a `broken-link` analogue: the image node is rewritten to `image { mediaId: null, alt, reason: "media-deleted" }`. Renderer falls back to a placeholder.
- `code.code` is a plain string ≤ 64 KiB. Larger code blocks are rejected with `ValidationError`.
- The entire serialized document is ≤ 1 MiB after JSON.stringify. Larger documents are rejected with `ValidationError`. This bound prevents an attacker from filling D1 with multi-megabyte chapter rows; legitimate large chapters should be split.

Block IDs and inline comments:

- `blockId` is the stable handle inline comments anchor to. See docs/016. The platform must guarantee that an existing `blockId` is preserved across edits when the surrounding paragraph is still recognizable (heuristic: same `type` + at least one character of text overlap). New blocks created during a save get freshly generated `blockId`s.
- Inline comments are not part of `contentJson`. They live in their own table (docs/016) and reference `(chapterId, blockId, rangeStart, rangeEnd)`.

Diff for media attachments:

- Before save, the use case computes the set of `mediaId` values referenced by all `image` (and any future media-referencing node) blocks in the new `contentJson`. It compares against the same set extracted from the previous `contentJson`.
- `added` and `removed` sets are passed to the attachment workflow (§4.4) and persisted atomically with the chapter row.

### 4.4 Book Cover And Media Attachments

Book cover:

- `books.cover_media_id` (text, nullable, FK to `media.id` with `ON DELETE SET NULL`).
- Set/unset through `PATCH /books/{id} { coverMediaId }`. The use case asserts `media.attach` on the media plus `book.update` on the book.
- A non-null cover counts as one `media_attachments` row with `target_type = "book"`.

Media attachments table:

```ts
export const mediaAttachments = sqliteTable("media_attachments", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  mediaId: text("media_id").notNull().references(() => media.id, { onDelete: "restrict" }),
  targetType: text("target_type").notNull(),   // "book" | "chapter"
  targetId: text("target_id").notNull(),
  // for chapters: which block in the target carries the reference; null for book cover
  blockId: text("block_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
  uniqueIndex("media_attachments_unique_idx").on(
    table.mediaId,
    table.targetType,
    table.targetId,
    // blockId is part of the key; multiple blocks may reference the same media
    table.blockId,
  ),
  index("media_attachments_target_idx").on(table.targetType, table.targetId),
  index("media_attachments_media_idx").on(table.mediaId),
]);
```

Why this table exists:

1. Reverse lookup. Deleting a media row should fail when something references it (`ON DELETE RESTRICT` on `media_id`). Without this table, the only way to ask "is anything using this media?" is to scan every chapter's content. That is unaffordable.
2. Cascade decisions for media deletes. With the table, the operator/admin can see exactly which chapters/books hold a reference, and the API can return a structured `ConflictError` with details.
3. Audit trail for media usage growth over time.

Permission: `media.attach`

- New permission key in `CONTENT_PERMISSIONS` (see §4.7).
- Required on the **target** resource (the chapter or book) when adding a media reference. Authorization checks happen in the chapter/book update use cases, not in the media routes.
- The actor must also be able to `media.read` the media being attached. The actor does **not** need to own the media — a contributor can attach a colleague's media as long as they can read it.

Cascade rules:

- Deleting a chapter: workflow first deletes the chapter's `media_attachments` rows, then deletes the chapter row, in one `db.batch(...)`.
- Deleting a book: workflow cascades via `chapters` (whose `book_id` FK is `ON DELETE CASCADE`) but explicit attachment cleanup is performed first. Book attachments (cover row) are deleted in the same batch.
- Deleting a media: API returns `409 Conflict` with the list of `(targetType, targetId, blockId?)` references when the attachment table is non-empty. Operators must detach the references first. There is no automatic detach: a chapter referencing a missing media is a content corruption that must be visible.

Soft-delete vs hard-delete is deferred to the media domain; this doc only specifies the FK behavior.

### 4.5 Book Origin And Auto-Promotion

Add `origin` column to `books`:

```ts
// addition to books table:
origin: text("origin").notNull().default("platform"),         // "platform" | "imported"
originSourceImportId: text("origin_source_import_id"),         // FK to book_imports.id when origin = "imported"
replacedByBookId: text("replaced_by_book_id"),                 // see §4.6
```

Lifecycle:

| Event | Effect |
|---|---|
| `POST /books { title }` (platform-authored) | `origin = "platform"`. |
| Successful EPUB import (docs/017) creates the book | `origin = "imported"`, `originSourceImportId = book_imports.id`. |
| First mutation of any chapter under an `imported` book by any actor other than the importer system actor | atomically flip `books.origin` to `"platform"` in the same `db.batch(...)` as the chapter save. `originSourceImportId` is preserved as provenance. |
| Direct `PATCH /books/{id}` of non-content metadata (title, description, cover, language, isbn, etc.) | Allowed on both `imported` and `platform`. **Does not** flip `origin`. |

Why book-level, not per-chapter:

- One book can be in only one of two states. There is no useful "this chapter is imported and this one is platform-authored" mix.
- Once a single chapter is edited, the book has diverged from the imported source. Future re-imports of the same EPUB would have to reconcile per-chapter divergence — that is exactly the failure mode docs/payloadcms-* describes (`manualEditedAt` tombstones).

Restrictions on `imported` books:

- Content fields (`chapter.contentJson`, chapter tree shape, attachments) are read-only via the regular API. Use cases reject writes from non-system actors with `ConflictError("Imported book is read-only; promote it to platform-authored by replacing it with the chapter-replace endpoint or by an explicit promotion call")`.
- Metadata fields are editable (title, description, language, subjects, publisher, publicationDate, isbn, cover). Editing any of these does not promote.
- Explicit "promote without editing" call: `POST /books/{bookId}/promote-to-platform`. Requires `book.update`. Sets `origin = "platform"` and writes a `content_policy_events` row tagged `book.promote_to_platform`. This is the path for "I want to keep editing, but I haven't touched a chapter yet".
- The system actor running the EPUB import worker is exempt: it can write chapter content on an `imported` book until the import workflow marks itself completed.

Promotion atomicity:

- The auto-promotion path runs inside the `update-chapter-and-attachments` workflow's `db.batch(...)`. The batch contains: (a) chapter UPDATE, (b) added/removed attachment rows, (c) `UPDATE books SET origin = 'platform', updated_at = ... WHERE id = ? AND origin = 'imported'`.
- If the compare-and-set on `books.origin` returns 0 rows changed, the workflow logs but does not fail — the book might already have been promoted by a concurrent edit.

### 4.6 Replace-Existing-Book Destructive Workflow

Endpoint: `POST /books/{bookId}:replace`

Request body:

```ts
{
  newImportObjectKey: string,    // R2 key where the new EPUB was uploaded
  expectedBookVersion: number,   // optimistic guard against concurrent replace
  rationale?: string,            // free-form, recorded in policy event
}
```

Authorization: `book.update` *and* `book.import` (the import permission introduced in docs/017). This is deliberately heavier than `book.update` so a contributor cannot wipe a book by accident.

Workflow (single `db.batch(...)` in the workflow port, then queue dispatch):

1. Load old book; assert `version === expectedBookVersion`.
2. Generate new `bookId`.
3. Atomic batch:
   - INSERT new `books` row, same `orgId`, same metadata snapshot (title, description, language, isbn, …), `origin = "imported"`, `status = "draft"`, `cover_media_id = NULL` (the new import will set it).
   - UPDATE old book: `status = "archived"`, `archived_at = now`, `replaced_by_book_id = newBookId`, increment `version`.
   - COPY all `content_policy_bindings` rows whose `resource_type = "book" AND resource_id = oldId` to point at `newId`. Bindings on descendants (chapters) are not copied — the new book starts with no chapters until the import worker creates them, and a chapter binding on a no-longer-existing chapter would be orphaned.
   - INSERT `content_policy_events` row: `action = "book.replace"`, snapshot containing `{ oldBookId, newBookId, rationale }`.
4. Enqueue an EPUB import message targeting `newBookId` with `newImportObjectKey` (docs/017 §4 owns the worker side).
5. Respond `202 Accepted` with `{ newBookId, importId }`.

Idempotency:

- `Idempotency-Key` required. Replay returns the cached `{ newBookId, importId }`. See architecture §17.

Failure modes:

- New import fails: the old book stays archived. Operator runbook: either retry the import on `newBookId` or unarchive the old book (manual D1 operation, audited).
- Concurrent replace attempts: `expectedBookVersion` mismatch returns `409 Conflict`.

What the replace workflow does **not** do:

- It does not preserve inline comments, bookmarks, or reading progress from the old book. Those reference chapter IDs that no longer exist after the import. This is documented as expected loss; doc 016 reading-state and doc 016 comments both reference this boundary.
- It does not migrate chapter-level policy bindings. If a user wants per-chapter bindings on the new book, they must re-create them.

### 4.7 Content IAM Wiring

Permission key state in [src/domain/iam/content-permission.ts](../src/domain/iam/content-permission.ts) as of this doc's writing:

**Already present in `CONTENT_PERMISSIONS`** (no migration needed for the catalog row, but the codebase has no use case calling them yet):

| Key | Delegation class | Status |
|---|---|---|
| `chapter.read` | `ordinary` | Catalog entry exists; needs use case + route wiring. |
| `chapter.create` | `ordinary` | Catalog entry exists; needs use case + route wiring. |
| `chapter.update` | `ordinary` | Catalog entry exists; needs use case + route wiring. |
| `chapter.publish` | `ordinary` | Catalog entry exists; consumed via the lifecycle plugin (docs/012 §4.7). |
| `media.attach` | `ordinary` | Catalog entry exists; this doc lands the first consumer (chapter content update, book cover update). |

**Net-new permissions to add to `CONTENT_PERMISSIONS`**:

| Key | Delegation class | Description |
|---|---|---|
| `chapter.delete` | `ordinary` | Delete a chapter (cascades to descendants). |
| `book.import` | `ordinary` | Trigger an EPUB import; required for `POST /books/{bookId}/replace`. Defined here because the permission is consumed by this doc; the actual import worker lives in docs/017. |

**Vestigial keys to leave alone for this doc**: `section.update`, `block.comment`. The catalog rows exist from earlier scope (recursive `section`/`block` resources, now rejected — see §5.1). They are not used by any first-release code and can be removed in a separate cleanup migration; do **not** delete them as part of the 015 PR to avoid coupling cleanup with feature work.

`ContentResourceType` already includes `"chapter"`, `"section"`, `"block"`, `"comment"`. No `ContentResourceType` change is required. `"section"` and `"block"` remain in the union as no-op values (no resource loader, no policy decision, no row) and should be ignored by 015 implementation; the same cleanup migration that drops `section.update`/`block.comment` can also narrow the union.

Built-in role audit in `BUILT_IN_CONTENT_ROLES`:

- `system:book.owner` (protected) — **already carries** `chapter.read`, `chapter.create`, `chapter.update`, `chapter.publish`, `section.update`, `inline_comment.create`, `comment.create`, `comment.moderate`, `media.read`, `media.create`, `media.update`, `media.attach`, `media.delete`. Add `chapter.delete` and `book.import` to this role.
- `system:book.author` — **already carries** `chapter.read`, `chapter.create`, `chapter.update`, `section.update`, `inline_comment.create`, `comment.create`, `media.attach`. No change.
- `system:book.editor` — **already carries** `chapter.read`, `chapter.update`, `section.update`, `inline_comment.create`, `comment.create`, `media.attach`. No change in this doc. (Note: editor cannot create chapters by default in the current catalog. If product wants editors to create chapters, add `chapter.create` to this role — flag as an open decision in this PR.)
- `system:book.reviewer` — **already carries** read + comment perms. No change.
- `system:book.reader` — read-only. No change.
- `system:book.sharing_manager` — `book.manage_bindings` only. No change.
- `system:org.content_admin` (protected) — add `book.import` and `chapter.delete`. Other chapter-flavored keys are not on the org admin today; the role's design point is org-wide policy management, not direct chapter authorship. Confirm with the implementer before adding the chapter-authorship perms.
- New built-in role `system:chapter.editor` is **not** introduced. Chapter editorship is inherited from book role; tenants who want per-chapter roles use the existing tenant-defined role creation route on the chapter resource.

`resource-loader.ts` additions:

- `chapterResource(chapter)`: described in §4.1.
- `loadContentResource` ([src/domain/iam/resource-loader.ts](../src/domain/iam/resource-loader.ts) currently accepts only `{ type: "book" | "org" }`) is extended with a `chapter` branch that loads the chapter, its book, and its full ancestry in one query. Update the `ContentResourceInput` union accordingly.

`assertContentPermissionKey` continues to throw on unknown keys; the lint suite already catches missing keys.

### 4.8 HTTP API Surface

Route style follows the existing convention in [src/http/routes/books.routes.ts](../src/http/routes/books.routes.ts) (e.g. `/books/{bookId}/ownership-transfer`): **path-segment action names, not colon-prefixed sub-resources**. Every mutation route gets a matching constant in [src/shared/constants.ts](../src/shared/constants.ts) (e.g. `BOOK_REPLACE_ROUTE = "POST /books/{bookId}/replace"`) so idempotency snapshot keys stay consistent.

Books:

- `POST   /books` — existing, unchanged in this doc (covered by docs/007).
- `GET    /books` — existing.
- `GET    /books/{bookId}` — existing.
- `PATCH  /books/{bookId}` — extended to accept `coverMediaId`, `description`, `language`, `subjectsJson`, `publisher`, `publicationDate`, `isbn`. Cannot mutate `status` (docs/012). Cannot mutate `origin`, `replacedByBookId`, or content under an `imported` book.
- `DELETE /books/{bookId}` — existing; cascades to chapters via FK + workflow.
- `POST   /books/{bookId}/publish | unpublish | schedule | archive` — lifecycle plugin endpoints (docs/012).
- `POST   /books/{bookId}/promote-to-platform` — explicit origin promotion. Requires `book.update`.
- `POST   /books/{bookId}/replace` — destructive replace (§4.6). Requires `book.update` + `book.import`.

Chapters:

- `POST   /books/{bookId}/chapters` — create a top-level chapter (depth 1). Body: `{ title, slug?, orderIndex?, parentChapterId?, contentJson? }`. When `parentChapterId` is provided, the chapter is created as a child of that chapter; the server validates that the parent belongs to the same book and computes `depth`/`ancestorChapterIdsJson`. Default `contentJson` is an empty root with one `paragraph` block. (A single create endpoint covers both top-level and nested creation; no separate `/chapters/{parentChapterId}/children` endpoint is introduced.)
- `GET    /books/{bookId}/chapters?parentChapterId=<id-or-null>&recursive=false&limit=&cursor=` — list. When `parentChapterId` is omitted, lists top-level chapters (depth 1) of the book. When `recursive=true`, returns a flat list with `parentChapterId` for client-side tree building (capped at `MAX_CHAPTER_DEPTH` deep).
- `GET    /chapters/{chapterId}` — read a chapter (metadata + content).
- `PATCH  /chapters/{chapterId}` — update metadata, content, parent, or order. Reject move-into-self-descendant and reject cross-book moves.
- `DELETE /chapters/{chapterId}` — cascade-delete.
- `POST   /chapters/{chapterId}/publish | unpublish | schedule | archive` — lifecycle (docs/012).

Authorization is uniform: every route asserts the matching content permission against the chapter's `ContentResourceRef`. The book and org bindings inherit through ancestors automatically.

OpenAPI registration follows the existing pattern in [src/http/routes/books.routes.ts](../src/http/routes/books.routes.ts).

## 5. Architecture Decisions

### 5.1 Recursive Chapter, Not Section/Block Tables

The abandoned docs/009 modeled `book → chapter → section → block` as four separate tables. Rejected because:

- IAM-wise, the useful binding granularity is at most chapter. Section and block bindings exist nowhere in the product; they would be dead complexity in `ContentResourceRef.ancestors`.
- Storage-wise, blocks are the editor's internal data model. Persisting one row per Lexical block (paragraphs, headings, list items) at typical chapter sizes (100–500 blocks per chapter) explodes the row count without adding any read query that the JSON document could not serve.
- Product-wise, "section" was undefined in payloadcms — it was a TOC-depth artifact. With recursive chapter, the user can build their own hierarchy: a non-leaf chapter is just a chapter that has children and (optionally) intro content of its own.

A configurable max depth (default 4) protects against client misuse: book → part → chapter → subsection. Going deeper is a content-design smell.

### 5.2 Block IDs Live In Lexical JSON, Not As Rows

Inline comments and `chapter-link.anchor` both need a stable handle inside a chapter. The two options were:

- **Chosen:** `blockId` is a string property of every block in the Lexical JSON document. The chapter row's `contentJson` is the source of truth; comments reference `(chapterId, blockId)`.
- **Rejected:** a `blocks` table with one row per block. This forces every chapter edit to be a multi-row diff inside a transaction the platform does not have on D1; cascading effects on comments and links would have to be re-applied on every save. The performance and complexity cost is not justified by any read pattern.

If a block is removed by an edit, its inline comments become orphaned. Doc 016 §4.4 owns the cleanup decision (currently: mark the comment "orphaned" and surface it in the moderation queue; do not auto-delete).

### 5.3 One chapter-link Node, Resolved At Write Time

The old PayloadCMS used `epub-internal-link { epubHref: "../Text/chapter02.xhtml#s3" }` and resolved at read time by matching `epubHref` against the importer's `chapterSourceKey` format. Rejected because:

- The frontend has to know how `chapterSourceKey` is encoded.
- Re-renaming/reordering chapters breaks every link without any direct signal.
- Two node types (`epub-internal-link` + manual `chapter-link`) means two render paths and two failure modes.

Chosen: one node type `chapter-link { chapterId, anchor? }`. The platform editor's link picker writes it directly. The EPUB importer writes it after a two-pass resolution (docs/017). The renderer never has to parse a string key. Unresolvable links become `broken-link` — visible in the editor, never silently dropped.

### 5.4 Origin At Book Level, One-Way Promotion

Rejected: per-chapter `manualEditedAt` flag (Payload's solution). It produces tombstones that lock individual chapters out of re-import forever and leaves the book in a permanently mixed state.

Chosen: book-level `origin`. `imported → platform` is a one-way flip that happens automatically on first content mutation. After promotion, the book is fully platform-owned. The old import can still be referenced via `originSourceImportId` for provenance, but it is no longer the source of truth for any chapter.

This matches the product framing: the platform is the canonical surface; import is a side-loader.

### 5.5 Replace Is A Workflow, Not A Merge

Rejected: silent re-import that diffs chapter trees and merges where possible. Merge resolution is the single biggest source of confusion in any "import + edit" tool. There is no good UI for resolving content conflict on Lexical trees with embedded media references and inline comments.

Chosen: re-import on a platform-promoted book is impossible. The user has to call `POST /books/{bookId}/replace`. The replace workflow archives the old book, creates a new book, runs a fresh import, and forwards top-level book bindings. Per-chapter bindings, inline comments, bookmarks, and reading progress are intentionally not migrated — the new book has new chapter IDs.

This is brutal compared to merge, and that is the point. The brutality is what makes the model predictable.

### 5.6 Attachments Are A Tracked Side-Effect Of References

Rejected: media references inside chapter `contentJson` are the only record, scanned at delete time. This makes media deletion O(chapters per org), and there is no efficient way to answer "where is this image used".

Chosen: `media_attachments` table written by the chapter/book update workflow as part of the same `db.batch(...)` as the content save. The table is denormalized on top of `contentJson`. If the two drift (bug), `contentJson` wins for rendering and a daily reconciliation job rebuilds attachments — that reconciliation is **not** first-release work, but the contract supports it.

### 5.7 Rejected Or Deferred Options

- **Cross-org chapter links.** Rejected. `chapter-link` validation rewrites cross-org refs to `broken-link { reason: "cross-org" }`. There is no reason for a book in org A to deep-link into a book in org B; that would be a sharing-model anomaly.
- **Block-level lifecycle (publish parts of a chapter).** Deferred. Lifecycle plugin operates at chapter granularity. Inline drafting on a published chapter is in scope for a future "Level 2" lifecycle work, see docs/012 §11.1.
- **Chapter versioning / revision history.** Deferred. `chapters.version` is for optimistic concurrency only, not a revision log. See docs/012 §11.2.
- **Real-time collaboration (CRDT / OT) on chapter content.** Out of scope for the first release. Last-writer-wins with the optimistic `version` column is the contract; future migration to Y.js or similar is a separate doc.
- **Inline drafts (unpublished edits on a published chapter).** Out of scope. Edits go live immediately on save; lifecycle controls visibility of the whole chapter, not of edits.
- **Chapter passwords.** Removed. PayloadCMS had a per-chapter password gate (`chapters.password`, `hasPassword`, `passwordVersion`). The new IAM model represents "restricted readers" through Content IAM bindings + direct-share tokens. Password-as-content-gate is rejected.
- **Importing a book "in place" after it has been edited.** Rejected; use `:replace`.
- **Custom user-defined Lexical node types.** Rejected. The allowed-node list is closed and platform-defined. Plugins extending content shape are a v2 conversation.

## 6. Implementation Strategy

Phases:

1. **Schema + entity.** Land the `chapters` and `media_attachments` tables, add `cover_media_id`, `origin`, `origin_source_import_id`, `replaced_by_book_id` to `books`. Migrate.
2. **Chapter entity, repository, mappers, basic CRUD use cases.** No tree mutations yet — only `create` (depth 1), `read`, `update content`, `delete` (single chapter, no descendants).
3. **Recursive tree.** Add `parentChapterId`, `depth`, `ancestor_chapter_ids_json`. Implement create-as-child, move, delete-with-cascade, depth-overflow guard.
4. **Lexical content validation + media attachment diff.** Land the Zod schema, the diff helper, and the `update-chapter-and-attachments` workflow.
5. **Origin model + auto-promotion.** Wire the compare-and-set on `books.origin` into the chapter workflow batch. Add the `:promote-to-platform` endpoint.
6. **Replace-existing-book workflow.** Build the destructive replace path and the binding-copy logic. Defer the queue dispatch to docs/017 — until 017 lands, the replace endpoint can stage the new book and the import row, but mark the import status as `pending-worker-not-yet-built` and surface a `501 Not Implemented` for the actual processing.
7. **IAM additions.** Permission keys, built-in role updates, `chapterResource` loader. Land after phase 2 so chapter read/update routes are gated immediately.
8. **HTTP routes + presenters.** Land per-phase as the corresponding use cases exist.

Each phase ships behind no feature flag. The chapter table is empty until phase 2 routes are live; the `media_attachments` table is empty until phase 4 wires it up. Production rollout is one PR per phase, gated by `pnpm check`.

## 7. Detailed Implementation Plan

### 7.1 Chapter Entity And Schema

Current problem:

- No chapter entity, repository, mapper, or routes.

Target behavior:

- A `Chapter` domain entity class following the entity rules in [.claude/skills/content-api-architecture/SKILL.md](../.claude/skills/content-api-architecture/SKILL.md) — private constructor over `ChapterProps`, `static create`, `static reconstitute`, `toSnapshot`, getters, and `update`/`move` methods.

Implementation tasks:

- [ ] Add the `chapters` table from §4.2 to [src/infrastructure/db/schema.ts](../src/infrastructure/db/schema.ts).
- [ ] Generate the migration. Number it next-after-the-current head (the existing head is `0005_remove_legacy_authz`; this migration is `0006_chapter_and_attachments` or whatever number is current at PR time).
- [ ] `src/domain/books/chapter.entity.ts` with:
  - `ChapterProps` = full row snapshot (id, orgId, bookId, parentChapterId, ancestorChapterIds, depth, orderIndex, title, slug, contentJson, status, lifecycle timestamps, version, createdByUserId, createdAt, updatedAt).
  - `static create({ orgId, bookId, parentChapterId, parentAncestorChapterIds, parentDepth, title, slug, orderIndex, contentJson, createdByUserId })` — generates id, computes `depth = parentDepth + 1`, computes `ancestorChapterIds = [...parentAncestorChapterIds, parentChapterId]` (with `parentChapterId === null` producing depth 1 and empty ancestor list), defaults `contentJson` to an empty root + one blank `paragraph` block, defaults `status = "draft"`, sets `version = 1`.
  - `update({ title?, slug?, orderIndex?, contentJson? })` — recomputes `updatedAt`; does **not** change `parentChapterId` or `depth`.
  - `move({ newParentChapterId, newParentAncestorChapterIds, newParentDepth, newOrderIndex })` — validates against `MAX_CHAPTER_DEPTH`, validates no-cycle, sets the three updated fields, bumps `updatedAt`.
  - `ancestorChapterRefs(): { type: "chapter"; id: string }[]` — convenience for the resource loader.
- [ ] `src/domain/books/chapter.repository.ts` interface:
  - `findById(id)`, `findByBookAndId({ bookId, id })`, `listChildren({ bookId, parentChapterId, limit, cursor })`, `listAllInBook(bookId)` (capped, used for `recursive=true`).
  - `findAncestorPath({ bookId, parentChapterId })` returns `{ depth, ancestorChapterIds }` for create.
- [ ] Workflow port `src/domain/books/chapter-update-and-attachments.workflow.ts`:
  - `run({ chapter, addedMediaIds, removedMediaIds, promoteBookFromImported })` returns void; throws shared typed errors only. Implementation `src/infrastructure/repositories/drizzle-chapter-update-and-attachments.workflow.ts` uses `db.batch(...)`.
- [ ] Workflow port `src/domain/books/chapter-move.workflow.ts`:
  - `run({ chapter, descendantUpdates })` where `descendantUpdates` is a list of `(id, newDepth, newAncestorChapterIds)`. Implemented with `db.batch(...)`. Repository computes the descendants by reading rows whose `ancestorChapterIdsJson` contains the moved chapter id.
- [ ] Workflow port `src/domain/books/chapter-delete.workflow.ts`:
  - Atomic delete of one chapter + its descendants + every `media_attachments` row whose `targetType = "chapter"` and `targetId IN (deletedChapterIds)`.
- [ ] Mappers in `src/infrastructure/repositories/mappers/chapter.mapper.ts` (row ↔ entity).

Tests:

- New file `tests/chapters.create.test.ts` covers create-at-depth-1, create-at-depth-2-via-child-endpoint, depth-overflow rejection, slug uniqueness, order-index uniqueness.
- New file `tests/chapters.move.test.ts` covers move-to-new-parent recomputing descendants, depth-overflow on move, cycle rejection, cross-book rejection.
- New file `tests/chapters.delete.test.ts` covers cascade delete of descendants + attachments.

### 7.2 Lexical Content Validation

Current problem:

- No schema for what counts as valid chapter content. Any blob would be accepted.

Target behavior:

- `chapterContentSchema` (Zod) in [src/http/schemas/chapter-content.schema.ts](../src/http/schemas/chapter-content.schema.ts) implements the union in §4.3. Re-used by chapter create and chapter update routes.
- A pure helper `extractMediaIds(contentJson): string[]` lives in `src/domain/books/lexical/extract-media-ids.ts`; called by use cases for the attachment diff.
- A pure helper `extractChapterLinkRefs(contentJson): { chapterId: string, anchor?: string }[]` lives next to it; called to validate cross-chapter link targets.
- A pure helper `rewriteUnresolvedLinks(contentJson, resolutions): contentJson` lives next to it; called by the importer (docs/017) and by the chapter update use case when a referenced chapter no longer exists.
- A pure helper `normalizeBlockIds(prev, next): contentJson` lives next to it. Preserves existing `blockId`s by paragraph-heuristic and assigns fresh IDs to new blocks. See §4.3.

Implementation tasks:

- [ ] Implement the schema. `z` must come from `@hono/zod-openapi`.
- [ ] Implement the four helpers with unit tests in `tests/chapter-lexical.test.ts`.
- [ ] Add the boundary size cap (1 MiB after JSON.stringify; 64 KiB on `code.code`) as a Zod refinement.
- [ ] Wire the helpers into `UpdateChapterUseCase` (§7.1) so the attachment diff and link-rewrite happen before the workflow runs.

Tests:

- Schema rejects unknown node types.
- Schema rejects `image.mediaId` that does not match a UUID-like shape.
- Helpers correctly extract media IDs from nested blocks (list items, callouts, footnotes).
- `normalizeBlockIds` preserves a paragraph's blockId across an edit that only changes one character.

### 7.3 Media Attachments

Current problem:

- Media references in chapters are not tracked. Deleting a media silently breaks chapters.

Target behavior:

- `media_attachments` table from §4.4. Populated atomically with chapter content saves and book cover updates.
- Media delete fails with `409 Conflict` when attachments exist, returning the referencing targets.

Implementation tasks:

- [ ] Add the `media_attachments` table to [src/infrastructure/db/schema.ts](../src/infrastructure/db/schema.ts) in the same migration as the `chapters` table (one round-trip is cheaper than two).
- [ ] `src/domain/media/media-attachment.repository.ts` interface with `listByMedia(mediaId)`, `listByTarget({ targetType, targetId })`, and bulk insert/delete used by workflows.
- [ ] Drizzle implementation in `src/infrastructure/repositories/drizzle-media-attachment.repository.ts`.
- [ ] Extend `DeleteMediaUseCase` (currently in [src/application/media/delete-media.usecase.ts](../src/application/media/delete-media.usecase.ts)) to check attachments before delete and throw `ConflictError` with `details: { references: [{ targetType, targetId, blockId? }] }`.
- [ ] Extend `UpdateChapterUseCase` to compute the media-ID diff (added/removed) and pass it to the workflow.
- [ ] Add `UpdateBookCoverUseCase` (in `src/application/books/update-book-cover.usecase.ts`) used by the extended `PATCH /books/{id}` route.

Tests:

- `tests/media-attachments.test.ts` covers create-chapter-with-image, edit-chapter-removes-image, attachment-row-diff, delete-media-blocked-by-attachments.

### 7.4 Book Origin And Promotion

Current problem:

- Books have no `origin`; re-importing an edited book has no defined behavior.

Target behavior:

- `origin`, `originSourceImportId`, `replacedByBookId` columns on books.
- Auto-promotion on first content mutation; explicit promotion endpoint; metadata edits do not promote.
- Imported books reject content writes from non-system actors.

Implementation tasks:

- [ ] Add the three columns to `books` in the migration above.
- [ ] Extend `Book` entity:
  - `BookProps` gains `origin`, `originSourceImportId`, `replacedByBookId`, `archivedAt`, `version`.
  - `static create` defaults `origin = "platform"`.
  - `static createFromImport({ ..., importId })` defaults `origin = "imported"`, `originSourceImportId = importId`.
  - `markPromotedToPlatform()` flips origin in memory; raises `DomainError` if already promoted (idempotent path uses repository's compare-and-set instead, so the entity guard is defensive only).
  - `markReplacedBy(newBookId)` for §7.5.
- [ ] New use case `src/application/books/promote-book-to-platform.usecase.ts`: requires `book.update`, calls a workflow that compare-and-sets `origin = 'platform' WHERE id = ? AND origin = 'imported'`, writes a `content_policy_events` row tagged `book.promote_to_platform`, idempotent.
- [ ] Update `UpdateChapterUseCase` to detect when the parent book has `origin = "imported"` and pass `promoteBookFromImported: true` into the workflow, which appends the compare-and-set to its batch. Use case rejects content edits on imported books by non-system actors (see actor-type check below).
- [ ] Actor-type check: in `UpdateChapterUseCase`, if `actor.type !== "system"` and `book.origin === "imported"`, the use case proceeds (the workflow promotes the book atomically). If `actor.type === "system"` (the EPUB importer), the use case does **not** request promotion; the importer is allowed to edit imported content during the import window.
- [ ] Extend `PATCH /books/{id}` route to accept the new metadata fields (`coverMediaId`, `description`, `language`, `subjectsJson`, `publisher`, `publicationDate`, `isbn`). These never promote.

Tests:

- `tests/book-origin.test.ts`: imported book + user content edit → book.origin flips; imported book + user metadata edit → book.origin stays; explicit promote endpoint flips even without a content edit; system actor edit during import does not promote.

### 7.5 Replace-Existing-Book Workflow

Current problem:

- No way to re-upload a new EPUB version of an already-platform-promoted book.

Target behavior:

- `POST /books/{bookId}/replace` archives the old book, creates a new book, copies top-level bindings, kicks off an import.

Implementation tasks:

- [ ] Add `archived_at` and `replaced_by_book_id` columns to `books` (in the migration above).
- [ ] New workflow port `src/domain/books/book-replace.workflow.ts` and Drizzle implementation. Atomically: archive old book, insert new book, copy bindings, insert policy event.
- [ ] New use case `src/application/books/replace-book.usecase.ts`. Requires `book.update` + `book.import`. Validates `expectedBookVersion`. Generates new book id. Calls the workflow. Returns `{ newBookId, importId }`.
- [ ] New route `POST /books/{bookId}/replace` in [src/http/routes/books.routes.ts](../src/http/routes/books.routes.ts).
- [ ] Stub the queue dispatch until docs/017 lands: the use case writes the `book_imports` row with status `pending` and a TODO marker; the worker side comes from 017. The use case still returns `202 Accepted`.
- [ ] Idempotency-Key required. Replay returns the cached response.

Tests:

- `tests/book-replace.test.ts`: replace requires both permissions; replace copies book-level bindings; replace creates a new book row with `origin = "imported"`; replace archives the old book; concurrent replace by version mismatch returns 409.

### 7.6 Content IAM Permission And Role Updates

Current problem:

- No chapter permissions exist; `media.attach` and `book.import` are missing.

Target behavior:

- All permission keys from §4.7 land in `CONTENT_PERMISSIONS`; built-in roles get the new keys; `chapter` is added to `ContentResourceType`; `chapterResource` exists.

Implementation tasks:

- [ ] Add the keys to `CONTENT_PERMISSIONS` in [src/domain/iam/content-permission.ts](../src/domain/iam/content-permission.ts).
- [ ] Extend `ContentResourceType` to include `"chapter"`.
- [ ] Extend `BUILT_IN_CONTENT_ROLES` per §4.7.
- [ ] Implement `chapterResource(chapter)` in [src/domain/iam/resource-loader.ts](../src/domain/iam/resource-loader.ts). Re-use `chapter.ancestorChapterRefs()`.
- [ ] Extend `loadContentResource` to accept `{ type: "chapter", id }` and route to a chapter loader that returns book + ancestors.
- [ ] The migration must seed any new built-in role permissions on existing organizations through the existing `ContentRoleRepository.ensureSystemCatalog()` call path; no extra migration step is required because catalog reseeds happen lazily.

Tests:

- Existing IAM tests pass with the new keys.
- `tests/chapter-policy.test.ts`: inherited `book.editor` allows `chapter.update`; explicit `chapter.update` denial on a deeper chapter blocks an ancestor allow; cross-org chapter access is rejected.

### 7.7 HTTP Routes And Presenters

Current problem:

- No chapter routes; book routes are limited to title and IAM.

Target behavior:

- All routes in §4.8 exist, follow the architecture rules (validate → one use case `.execute(...)` → present), and have OpenAPI definitions.

Implementation tasks:

- [ ] Add `src/http/routes/chapters.routes.ts` with create-at-book, create-under-chapter, list, read, update, delete, lifecycle endpoints.
- [ ] Add `src/http/schemas/chapter.schema.ts` for request/response shapes. `contentJson` reuses `chapterContentSchema` from §7.2.
- [ ] Add `src/http/presenters/chapter.presenter.ts`.
- [ ] Extend [src/http/routes/books.routes.ts](../src/http/routes/books.routes.ts) with `:promote-to-platform`, `:replace`, and the extended `PATCH` payload.
- [ ] Extend `src/http/schemas/book.schema.ts` and `src/http/presenters/book.presenter.ts`.
- [ ] All routes require `bearerSecurity` and call `requireActor(c)`.

Tests:

- HTTP integration tests under `tests/`:
  - `tests/chapters.routes.test.ts` covers happy paths and 401/403/404/409.
  - `tests/books.replace.test.ts` covers the replace flow end-to-end (without the EPUB worker side).
  - `tests/books.update.test.ts` covers the extended PATCH payload.

### 7.8 Composition And Wiring

Current problem:

- The request container does not know about chapters, attachments, or the replace workflow.

Target behavior:

- [src/composition/create-request-container.ts](../src/composition/create-request-container.ts) wires all new repositories, workflows, and use cases per request.

Implementation tasks:

- [ ] Add `chapters` and `mediaAttachments` repository factories.
- [ ] Add the three chapter workflow factories.
- [ ] Add the new use cases under `container.books.*` and `container.chapters.*`.
- [ ] Keep the file under the architecture-lint complexity threshold (the route-registration / composition exception is documented in CLAUDE.md).

Tests:

- Existing container tests pass; new use cases are reachable from the request scope.

## 8. Migration And Rollout

Migration order:

1. Generate `drizzle/00NN_chapter_and_attachments.sql` containing:
   - `CREATE TABLE chapters ...`
   - `CREATE TABLE media_attachments ...`
   - `ALTER TABLE books ADD COLUMN cover_media_id TEXT REFERENCES media(id) ON DELETE SET NULL`
   - `ALTER TABLE books ADD COLUMN origin TEXT NOT NULL DEFAULT 'platform'`
   - `ALTER TABLE books ADD COLUMN origin_source_import_id TEXT`
   - `ALTER TABLE books ADD COLUMN replaced_by_book_id TEXT`
   - `ALTER TABLE books ADD COLUMN archived_at INTEGER`
   - `ALTER TABLE books ADD COLUMN version INTEGER NOT NULL DEFAULT 1`
   - `ALTER TABLE books ADD COLUMN description TEXT`
   - `ALTER TABLE books ADD COLUMN language TEXT`
   - `ALTER TABLE books ADD COLUMN subjects_json TEXT NOT NULL DEFAULT '[]'`
   - `ALTER TABLE books ADD COLUMN publisher TEXT`
   - `ALTER TABLE books ADD COLUMN publication_date TEXT`
   - `ALTER TABLE books ADD COLUMN isbn TEXT`
   - Indexes.
2. Apply locally; run `pnpm test`; apply remote via the existing CI pipeline.
3. Backfill: existing books have no chapters, so the migration is data-safe. `origin` defaults to `"platform"` for all existing rows (which is what they are — they were created through the platform CRUD, not imported).
4. Lifecycle plugin (docs/012) is a prerequisite for chapter publish/schedule routes. If 012 has not landed at PR time, ship chapter create/read/update/delete without the lifecycle endpoints and add them in a follow-up PR.

Rollback:

- The migration is additive (new tables + nullable columns). Rolling back to before this migration drops `chapters`, `media_attachments`, and the new book columns. No platform book in production today references any of them, so rollback is data-lossless on the day of deploy.
- After the chapter routes are in production, rolling back loses every chapter ever written. Decide intentionally; do not roll back as a casual hotfix.

Documentation:

- Update [README.md](../README.md) planning/status to reference docs/015.
- Update docs/007 references to chapters from "in progress" to "implemented in docs/015".
- Update docs/012 §6.4 (Chapter) from "future adopter" to "adopted via docs/015".

## 9. Edge Cases And Failure Modes

| Scenario | Expected handling |
|---|---|
| Create chapter at `parentDepth = MAX_CHAPTER_DEPTH` | `400 ValidationError` from entity guard. |
| Move chapter into a descendant of itself | `400 ValidationError` from entity guard. |
| Move chapter such that depth would exceed `MAX_CHAPTER_DEPTH` | `400 ValidationError`. |
| Delete a chapter that has children | Workflow cascades; respond `200 OK` with the deleted ids array in the response so the client can update its tree state. |
| Update chapter content with a `chapter-link` referencing a non-existent chapter id | Use case rewrites that node to `broken-link { reason: "unresolved" }` before save. Save still succeeds. |
| Update chapter content with a `chapter-link` referencing a chapter in a different book | Rewrite to `broken-link { reason: "cross-book" }`. |
| Update chapter content with a `chapter-link` referencing a chapter in a different org | Rewrite to `broken-link { reason: "cross-org" }`. |
| Update chapter content with an `image.mediaId` referencing a deleted media | Rewrite to `image { mediaId: null, alt, reason: "media-deleted" }`. |
| Update chapter content of an `imported` book by a non-system actor | Allowed. The book auto-promotes to `"platform"` atomically with the save. |
| Concurrent edits to the same chapter (`version` mismatch) | Use case throws `ConflictError("Chapter has been modified since you loaded it; reload and retry")`. The route returns 409. |
| Concurrent replace (`expectedBookVersion` mismatch) | `409 Conflict`. |
| Replace targeting an already-archived book | `409 Conflict`. Operators must unarchive in D1 if recovery is needed. |
| Delete a media that is referenced by a chapter via `media_attachments` | `409 Conflict` with `details.references`. Caller must detach first. |
| Imported book's import workflow crashes mid-way and never completes | `book.origin` stays `imported`; chapter rows already created by the worker are visible. The user can either `:replace` (loses what is there) or `:promote-to-platform` (takes ownership of the partial state). The replace + promote pair is the intended escape hatch; there is no automatic rollback. |
| Cross-cutting permission failure during a chapter content edit (actor can `chapter.update` but not `media.attach`) | Use case rejects with `403 Forbidden` and rolls back. No partial write. |
| Block IDs collide on a save (client sent duplicates) | `normalizeBlockIds` assigns fresh IDs to one of the colliding pair. Inline comments anchored to the renamed block are flagged as orphaned by the comments use case (docs/016). |
| `MAX_CHAPTER_DEPTH` is changed from 4 to 3 at the env level after data exists at depth 4 | Existing rows at depth 4 are not retroactively deleted. New creates and moves enforce the new bound. Existing depth-4 chapters can be updated and deleted normally. Document this trade-off in `env.ts` JSDoc. |
| Lifecycle action attempted on a chapter under an `imported` book | Allowed — lifecycle is independent of origin. Publishing an imported chapter does not promote the book. (Only content/structure mutations promote.) |
| A `chapter-link.anchor` points to a `blockId` that has been deleted from the target chapter | Use case rewrites the anchor to `undefined` (link still resolves; renderer scrolls to top). |

## 10. Implementation Backlog

### BCM-A. Chapter Entity, Schema, And Repository

Scope:

- `src/domain/books/chapter.entity.ts`
- `src/domain/books/chapter.repository.ts`
- `src/domain/books/chapter-update-and-attachments.workflow.ts`
- `src/domain/books/chapter-move.workflow.ts`
- `src/domain/books/chapter-delete.workflow.ts`
- `src/infrastructure/db/schema.ts`
- `src/infrastructure/repositories/drizzle-chapter.repository.ts`
- `src/infrastructure/repositories/drizzle-chapter-update-and-attachments.workflow.ts`
- `src/infrastructure/repositories/drizzle-chapter-move.workflow.ts`
- `src/infrastructure/repositories/drizzle-chapter-delete.workflow.ts`
- `src/infrastructure/repositories/mappers/chapter.mapper.ts`
- `drizzle/00NN_chapter_and_attachments.sql`
- `src/shared/books/chapter-depth.ts`

Tasks:

- [ ] Add the `chapters` table with all columns, indexes, and FK behavior from §4.2.
- [ ] Implement `Chapter` entity following entity rules; cover `create`, `move`, `update`, `toSnapshot`.
- [ ] Implement the three workflow ports with `db.batch(...)`.
- [ ] Implement repository methods `findById`, `findByBookAndId`, `listChildren`, `listAllInBook`, `findAncestorPath`.
- [ ] Add `MAX_CHAPTER_DEPTH` constant and env binding.

Acceptance criteria:

- Inserting a chapter at depth 1 succeeds; at depth `MAX_CHAPTER_DEPTH + 1` throws `ValidationError`.
- Moving a subtree updates every descendant's `depth` and `ancestorChapterIdsJson` in one batch.
- Deleting a chapter deletes its descendants and their `media_attachments` rows in one batch.

Tests:

- `corepack pnpm test tests/chapters.create.test.ts tests/chapters.move.test.ts tests/chapters.delete.test.ts`

### BCM-B. Lexical Content Validation

Scope:

- `src/http/schemas/chapter-content.schema.ts`
- `src/domain/books/lexical/extract-media-ids.ts`
- `src/domain/books/lexical/extract-chapter-link-refs.ts`
- `src/domain/books/lexical/rewrite-unresolved-links.ts`
- `src/domain/books/lexical/normalize-block-ids.ts`

Tasks:

- [ ] Implement the Zod discriminated union schema for all nodes in §4.3, including the 1 MiB document cap and 64 KiB code cap.
- [ ] Implement the four pure helpers with unit tests.
- [ ] Wire helpers into `UpdateChapterUseCase` and `CreateChapterUseCase`.

Acceptance criteria:

- A chapter with an unknown node type is rejected at the route boundary.
- Existing `blockId`s are preserved across an edit that does not restructure the document.
- A `chapter-link` to a non-existent chapter is silently rewritten to `broken-link { reason: "unresolved" }`.

Tests:

- `corepack pnpm test tests/chapter-lexical.test.ts`

### BCM-C. Media Attachments Tracking

Scope:

- `src/infrastructure/db/schema.ts` (`media_attachments` table)
- `src/domain/media/media-attachment.repository.ts`
- `src/infrastructure/repositories/drizzle-media-attachment.repository.ts`
- `src/infrastructure/repositories/mappers/media-attachment.mapper.ts`
- `src/application/media/delete-media.usecase.ts` (extended)
- `src/application/books/update-book-cover.usecase.ts` (new)
- `src/application/chapters/update-chapter.usecase.ts` (extended)

Tasks:

- [ ] Add the table and indexes from §4.4.
- [ ] Implement the repository and Drizzle adapter.
- [ ] Extend `DeleteMediaUseCase` to block on existing attachments with `ConflictError`.
- [ ] Wire attachment diff (added/removed) into the chapter update workflow batch.
- [ ] Implement the new book cover use case and route handler.

Acceptance criteria:

- Saving a chapter with an `image { mediaId }` block writes one `media_attachments` row.
- Removing the image block on the next save deletes the attachment row.
- Deleting a media that is still attached returns `409` and the list of references.

Tests:

- `corepack pnpm test tests/media-attachments.test.ts`

### BCM-D. Book Origin And Auto-Promotion

Scope:

- `src/infrastructure/db/schema.ts` (`books.origin`, `books.origin_source_import_id`, `books.archived_at`, `books.version`, bibliographic columns)
- `src/domain/books/book.entity.ts` (extended)
- `src/application/books/promote-book-to-platform.usecase.ts` (new)
- `src/application/chapters/update-chapter.usecase.ts` (extended for promotion)
- `src/http/routes/books.routes.ts` (`:promote-to-platform`, extended `PATCH`)

Tasks:

- [ ] Add the new book columns in the migration.
- [ ] Extend `Book` entity per §7.4. Update `static create` and add `static createFromImport`.
- [ ] Implement `PromoteBookToPlatformUseCase` and its route.
- [ ] Extend `UpdateChapterUseCase` so that when actor is not a system actor and book.origin is "imported", the workflow batch includes `UPDATE books SET origin = 'platform' WHERE id = ? AND origin = 'imported'`.
- [ ] Reject content writes from non-system actors on imported books that would not naturally promote (i.e., the entity guard catches metadata-only paths that should not flip origin; double-check by code review).

Acceptance criteria:

- Importer system actor edits an imported chapter → origin stays `"imported"`.
- User actor edits an imported chapter → origin flips to `"platform"` atomically.
- User actor calls `:promote-to-platform` on an imported book → origin flips even with no chapter edit.
- User actor edits only book metadata (title, description) → origin stays `"imported"`.

Tests:

- `corepack pnpm test tests/book-origin.test.ts`

### BCM-E. Replace-Existing-Book Workflow

Scope:

- `src/domain/books/book-replace.workflow.ts`
- `src/infrastructure/repositories/drizzle-book-replace.workflow.ts`
- `src/application/books/replace-book.usecase.ts`
- `src/http/routes/books.routes.ts` (`:replace`)
- `src/http/schemas/book.schema.ts`

Tasks:

- [ ] Implement the atomic workflow per §4.6.
- [ ] Implement the use case with `expectedBookVersion` check and `Idempotency-Key` enforcement.
- [ ] Implement the route; until docs/017 lands, the worker dispatch is a stub that writes a `book_imports` row in `pending` and returns 202.

Acceptance criteria:

- Replace requires both `book.update` and `book.import`; missing either returns 403.
- Replace copies book-level bindings, archives old book, creates new book with `origin = "imported"`.
- Replace is idempotent on the same `Idempotency-Key`.

Tests:

- `corepack pnpm test tests/book-replace.test.ts`

### BCM-F. Content IAM Permissions And Built-in Roles

Scope:

- `src/domain/iam/content-permission.ts`
- `src/domain/iam/resource-loader.ts`
- IAM test fixtures

Tasks:

- [ ] Add **net-new** permission keys per §4.7: `chapter.delete` (ordinary) and `book.import` (ordinary). The other chapter/comment/media.attach keys already exist in `CONTENT_PERMISSIONS`; do not redeclare.
- [ ] Append `chapter.delete` and `book.import` to `system:book.owner.permissions`.
- [ ] Append `book.import` and `chapter.delete` to `system:org.content_admin.permissions`.
- [ ] (Optional, decide with reviewer) Append `chapter.create` to `system:book.editor.permissions` if the product wants editors to author new chapters.
- [ ] Add `"chapter"` to the `ContentResourceInput` union in `resource-loader.ts` (the `ContentResourceType` union in `content-permission.ts` already includes `"chapter"`).
- [ ] Implement `chapterResource(chapter)` and extend `loadContentResource` with the chapter branch.
- [ ] Do **not** delete the vestigial `section.update` / `block.comment` catalog rows or remove `"section"`/`"block"` from `ContentResourceType` — that is a separate cleanup migration, not part of this PR.

Acceptance criteria:

- A user with the `system:book.author` role on a book can create, read, and update chapters under that book (the role already carries those perms).
- A user with the `system:book.owner` role can additionally delete chapters (via the new `chapter.delete` perm).
- A user with `chapter.update` denied on a deep chapter cannot update it even if the inherited book role allows.
- Cross-org chapter binding is rejected by the existing administration policy.

Tests:

- `corepack pnpm test tests/chapter-policy.test.ts`

### BCM-G. HTTP Routes And Presenters

Scope:

- `src/http/routes/chapters.routes.ts`
- `src/http/schemas/chapter.schema.ts`
- `src/http/presenters/chapter.presenter.ts`
- `src/composition/create-request-container.ts`

Tasks:

- [ ] Add all routes from §4.8.
- [ ] Add OpenAPI schemas and presenters.
- [ ] Wire the new repositories, workflows, and use cases into the request container.

Acceptance criteria:

- `corepack pnpm lint` passes (architecture lint passes on routes and schemas).
- `corepack pnpm test` includes the chapter HTTP tests.
- OpenAPI document includes all new routes and schemas.

Tests:

- `corepack pnpm test tests/chapters.routes.test.ts`

### BCM-H. Documentation And Cleanup

Scope:

- `README.md`
- `docs/007_content-iam-policy-binding-model.md`
- `docs/009_book-resource-hierarchy-and-collaboration-plan.md`
- `docs/012_content-lifecycle-plugin.md`

Tasks:

- [ ] Update README planning/status with `[015 — implemented]` (after the PRs ship).
- [ ] Update docs/007 chapter section from "pending" to "implemented in docs/015".
- [ ] Mark docs/009 as **ABANDONED** at the top, point to 015/016/017.
- [ ] Update docs/012 §6.4 (Chapter coverage matrix) to mark chapter as adopted.
- [ ] Update the `content-api-architecture` and `content-iam-usage` skills with chapter resource type and routes.

Acceptance criteria:

- README's planning section accurately reflects the new state.
- docs/009 makes it impossible for a future reader to think it is still authoritative.

Tests:

- Manual review.

## 11. Future Backlog

- **Inline drafts** (edit a published chapter without immediately changing what readers see). Lifecycle plugin §11.1 covers the underlying status-machine extension; this doc would extend the chapter resource with a `draft_content_json` column. Not first-release.
- **Chapter revisions / version history.** Lifecycle plugin §11.2. Separate doc.
- **Real-time collaborative editing on chapter content.** Y.js or similar. Separate doc.
- **Auto-detach of orphaned media references.** Today the chapter update use case rewrites broken `image` nodes to a fallback, but does not delete the underlying media. A periodic reconciliation worker could surface "media with zero attachments" for cleanup. Owned by future media-domain work.
- **Tenant-defined "chapter editor" roles** with a `system:chapter.editor` template that tenants can clone. Not needed in v1 because per-chapter bindings on the existing book editor role already work.
- **Block-level pinning for cross-chapter links.** Today `chapter-link.anchor` is just a `blockId` string; if the block is removed, the anchor is silently dropped. A future version could keep an immutable `anchor_alias` table mapping legacy anchor strings to current `blockId`s so old links survive block-id changes.
- **Bulk-import of a chapter tree from JSON.** Useful for migrations from other CMSes. Out of scope here; the EPUB import path (docs/017) is the only first-release importer.
- **Search index on chapter title + extracted text content.** The Lexical schema makes text extraction straightforward but the index target (D1 FTS, an external search service, etc.) is a separate decision.
- **Audit log integration** for the triggers listed in docs/014 §4. Owned by docs/014.

## 12. Test And Verification Plan

Run after each backlog item:

```bash
corepack pnpm lint
corepack pnpm check:dup
corepack pnpm typecheck
corepack pnpm test
corepack pnpm advise
```

Coverage targets:

- Entity unit tests: chapter create/move/update/cycle/depth-overflow.
- Schema unit tests: Lexical schema acceptance + rejection + boundary sizes.
- Helper unit tests: `extractMediaIds`, `extractChapterLinkRefs`, `rewriteUnresolvedLinks`, `normalizeBlockIds`.
- Workflow integration tests: chapter update + media attachment diff + optional origin flip in one D1 batch.
- HTTP integration tests:
  - `POST /books/{id}/chapters` happy path + 401/403/409.
  - `POST /chapters/{id}/children` happy path + depth-overflow 400.
  - `PATCH /chapters/{id}` updates content + diffs attachments + flips origin on imported book.
  - `DELETE /chapters/{id}` cascades.
  - `POST /books/{bookId}/promote-to-platform` flips origin once; idempotent on replay.
  - `POST /books/{bookId}/replace` requires both permissions, copies bindings, archives old book.
  - `PATCH /books/{id}` accepts new metadata fields; rejects status mutation; rejects origin mutation; rejects content fields when book is imported.
- IAM unit tests: chapter ancestry, denial precedence at deepest chapter level, cross-org rejection.
- Existing book and IAM tests must still pass.

Manual smoke (against `wrangler dev`):

- Create a book, add three nested chapters, attach an image to the deepest chapter, list the tree, delete the middle chapter, verify cascade and attachment cleanup.
- Run the import-stub path (replace endpoint without the worker) and verify the `book_imports` row is `pending`.

## 13. Definition Of Done

- All migrations in `drizzle/` apply cleanly to a fresh D1.
- `corepack pnpm check` passes on the final PR.
- `corepack pnpm advise` is green or only carries documented suppressions.
- All routes from §4.8 are reachable, OpenAPI-documented, and covered by Vitest integration tests.
- `media_attachments` is populated for every chapter content edit that mentions media.
- An imported book auto-promotes to `platform` on the first non-system content edit.
- `POST /books/{bookId}/replace` archives the old book, creates a new book with `origin = "imported"`, and copies book-level policy bindings.
- README.md, docs/007, docs/009, docs/012 are updated as described in BCM-H.
- The `content-api-architecture` and `content-iam-usage` skills are updated to include chapter.

## 14. Final Model

```text
org
  book (origin: platform|imported, optional cover_media_id, lifecycle-aware)
    chapter (recursive, depth ≤ MAX_CHAPTER_DEPTH, lifecycle-aware)
      contentJson — typed Lexical JSON with block IDs, chapter-link, broken-link
    media_attachments (target = book | chapter, FK media)
```

The book is the destination, not a pass-through for an EPUB. Chapters are a recursive tree because authoring books with parts and sub-sections is a normal case. Block IDs make inline comments and cross-chapter links durable without paying for a blocks table. Origin is at the book level because that is the granularity at which "this content has diverged from its imported source" is a meaningful claim. Replacement is loud and destructive because silent merge is the worst tooling failure mode in any import-edit cycle.

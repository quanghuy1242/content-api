# Book Interactions — Comments, Inline Comments, Bookmarks, Reading Progress

> Status: implementation-grade proposal — ready for handoff (depends on docs/015)
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
> - `docs/012_content-lifecycle-plugin.md`
> - `docs/015_book-content-model.md` — required prerequisite; chapters + Lexical block IDs come from here
> - `docs/payloadcms-schema-spec.md` — old `comments`, `reading-progress`, `bookmarks`
> - `docs/payloadcms-access-control-policy-spec.md` — old comment/reading rules, lessons learned
> - `.claude/skills/content-api-architecture/SKILL.md`
> - `.claude/skills/content-iam-usage/SKILL.md`
> - `/home/quanghuy1242/pjs/payloadcms/src/utils/comments.ts` — old comment utility (target validation, rate limit, edit window, parent rules)
> - `src/domain/iam/content-permission.ts`
> - `src/domain/iam/content-policy.ts`
> - `src/infrastructure/db/schema.ts`
>
> Related docs:
>
> - `docs/014_audit-service-stub.md` — moderation triggers come from here
> - `docs/015_book-content-model.md`
> - `docs/017_epub-import.md`
> - `docs/009_book-resource-hierarchy-and-collaboration-plan.md` — **ABANDONED**; this document supersedes its comments/inline-comments/bookmarks/reading-progress sections
>
> Assumptions:
>
> - Content IAM (docs/007) is operational; the new `comment.*` and `inline_comment.*` permissions integrate the same way `book.*` does.
> - Chapters with stable `blockId`s from docs/015 §4.3 are landed before any inline-comment work begins.
> - Comments are first-party content authored by end users (readers + reviewers). Moderation is admin-facing through a separate API surface.
> - Bookmarks and reading progress are user-private. They are deliberately **not** IAM-tracked resources; they are subject-scoped data stored in D1 and accessed only through hardcoded `actor.subject === row.userId` checks. `ContentPolicy.can(...)` is not on their hot path.
> - "Public comments" still requires an authenticated actor. Anonymous commenting is out of scope for the first release.
> - Rate limiting for comments uses D1-counted windows for the first release. A KV/Durable-Object backed limiter is a future refinement.
> - All mutation routes require `Idempotency-Key`. Soft-delete is the default for comments; reading progress and bookmarks are hard-deleted.

## Table Of Contents

- [1. Goal](#1-goal)
- [2. System Summary](#2-system-summary)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 Relevant Files](#31-relevant-files)
  - [3.2 Current Behavior](#32-current-behavior)
  - [3.3 Current Problems](#33-current-problems)
- [4. Target Model](#4-target-model)
  - [4.1 Comments And Inline Comments](#41-comments-and-inline-comments)
  - [4.2 Moderation Workflow](#42-moderation-workflow)
  - [4.3 Rate Limits And Edit Windows](#43-rate-limits-and-edit-windows)
  - [4.4 Block-Orphaning Behavior](#44-block-orphaning-behavior)
  - [4.5 Bookmarks](#45-bookmarks)
  - [4.6 Reading Progress](#46-reading-progress)
  - [4.7 Content IAM Wiring](#47-content-iam-wiring)
  - [4.8 HTTP API Surface](#48-http-api-surface)
- [5. Architecture Decisions](#5-architecture-decisions)
  - [5.1 Comments And Inline Comments Are Separate Resources](#51-comments-and-inline-comments-are-separate-resources)
  - [5.2 Two Policy Surfaces — Public And Moderation](#52-two-policy-surfaces--public-and-moderation)
  - [5.3 Reading State Is Not IAM-Tracked](#53-reading-state-is-not-iam-tracked)
  - [5.4 Soft-Delete Comments, Hard-Delete Read State](#54-soft-delete-comments-hard-delete-read-state)
  - [5.5 Block-Orphaning Is A Moderation Surface, Not An Auto-Delete](#55-block-orphaning-is-a-moderation-surface-not-an-auto-delete)
  - [5.6 Rate Limiting Lives In The Use Case](#56-rate-limiting-lives-in-the-use-case)
  - [5.7 Rejected Or Deferred Options](#57-rejected-or-deferred-options)
- [6. Implementation Strategy](#6-implementation-strategy)
- [7. Detailed Implementation Plan](#7-detailed-implementation-plan)
  - [7.1 Comments Schema And Entity](#71-comments-schema-and-entity)
  - [7.2 Inline Comments Schema And Entity](#72-inline-comments-schema-and-entity)
  - [7.3 Comment Use Cases](#73-comment-use-cases)
  - [7.4 Inline Comment Use Cases](#74-inline-comment-use-cases)
  - [7.5 Moderation Workflow](#75-moderation-workflow)
  - [7.6 Bookmarks Schema And Use Cases](#76-bookmarks-schema-and-use-cases)
  - [7.7 Reading Progress Schema And Use Cases](#77-reading-progress-schema-and-use-cases)
  - [7.8 IAM Permissions And Built-in Roles](#78-iam-permissions-and-built-in-roles)
  - [7.9 HTTP Routes And Presenters](#79-http-routes-and-presenters)
- [8. Migration And Rollout](#8-migration-and-rollout)
- [9. Edge Cases And Failure Modes](#9-edge-cases-and-failure-modes)
- [10. Implementation Backlog](#10-implementation-backlog)
  - [BIA-A. Comments Domain And Persistence](#bia-a-comments-domain-and-persistence)
  - [BIA-B. Inline Comments Domain And Persistence](#bia-b-inline-comments-domain-and-persistence)
  - [BIA-C. Comment And Inline Comment Use Cases](#bia-c-comment-and-inline-comment-use-cases)
  - [BIA-D. Moderation Use Cases](#bia-d-moderation-use-cases)
  - [BIA-E. Bookmarks](#bia-e-bookmarks)
  - [BIA-F. Reading Progress](#bia-f-reading-progress)
  - [BIA-G. Content IAM Permission And Role Updates](#bia-g-content-iam-permission-and-role-updates)
  - [BIA-H. HTTP Routes And Presenters](#bia-h-http-routes-and-presenters)
  - [BIA-I. Block Orphaning Hook From Chapter Updates](#bia-i-block-orphaning-hook-from-chapter-updates)
- [11. Future Backlog](#11-future-backlog)
- [12. Test And Verification Plan](#12-test-and-verification-plan)
- [13. Definition Of Done](#13-definition-of-done)
- [14. Final Model](#14-final-model)

## 1. Goal

Land the four user-activity surfaces on top of the book content model from docs/015:

- **Comments** on chapters (and, optionally, on books for "leave a note on this book" use cases).
- **Inline comments** anchored to a specific block + character range inside a chapter.
- **Bookmarks** of books or specific chapters.
- **Reading progress** per (user, book, chapter).

Two of these (comments, inline comments) are first-class IAM-tracked content; two (bookmarks, reading progress) are user-private state with hardcoded ownership checks.

Concrete outcomes:

- A reader on a published chapter can leave a top-level comment, reply once, and edit their own comment within a window.
- A collaborator on a chapter can drop an inline comment on a specific block range; the comment survives ordinary edits as long as the block remains.
- Moderation surfaces ("approve", "reject", "soft-delete") live in a separate API that requires the `comment.moderate` permission.
- A reader can bookmark a chapter and the system records their reading progress, both private to that reader.
- Public listing endpoints expose only approved + non-deleted comments by default; moderation endpoints can list everything.

Non-goals:

- Anonymous commenting.
- Notifications, mentions, reactions.
- Threaded conversations more than one level deep.
- Cross-book bookmarks or progress aggregation analytics.
- General audit logging (see docs/014 stub).

## 2. System Summary

Comment write flow:

```text
client -> POST /chapters/{id}/comments { content, parentCommentId? }
  -> require content:write
  -> ContentPolicy.can(actor, "comment.create", chapterRef)
  -> chapter must be readable (chapter.read via inherited binding)
  -> rate-limit check (5/target/10min, 20/global/hour)
  -> validate content (1..550 chars, trimmed, no HTML)
  -> parent rules (parent exists, same target, top-level, status="approved")
  -> insert row with status="pending" (default) — moderation toggles below
```

Inline comment write flow:

```text
client -> POST /chapters/{id}/inline-comments {
            content, blockId, rangeStart, rangeEnd, parentInlineCommentId?
          }
  -> require content:write
  -> ContentPolicy.can(actor, "inline_comment.create", chapterRef)
  -> validate blockId exists in chapter.contentJson
  -> validate rangeStart < rangeEnd, both within block plain-text length
  -> insert row with status="open"
```

Bookmark write flow:

```text
client -> POST /bookmarks { targetType: "chapter"|"book", targetId }
  -> require content:read
  -> resolve target, ensure ContentPolicy.can(actor, "<target>.read", ref)
  -> hard upsert: (actor.subject, targetType, targetId) is unique
```

Reading progress write flow:

```text
client -> PUT /chapters/{id}/reading-progress { progress: 0..100 }
  -> require content:read
  -> resolve chapter, ensure ContentPolicy.can(actor, "chapter.read", chapterRef)
  -> upsert by (actor.subject, bookId, chapterId)
  -> if progress >= 100 and completedAt is null, set completedAt = now
```

Moderation flow:

```text
admin -> POST /comments/{commentId}/approve
admin -> POST /comments/{commentId}/reject { reason? }
admin -> DELETE /comments/{commentId}              (soft-delete)
admin -> POST /comments/{commentId}/reset-to-pending  (rare; tightly restricted)
```

All comment mutations check `comment.moderate`. Public list and create endpoints are separate (`/chapters/{id}/comments`); moderation list/mutate endpoints live under `/comments/...` and require workspace tokens.

## 3. Current-State Findings

### 3.1 Relevant Files

- [src/domain/iam/content-permission.ts](../src/domain/iam/content-permission.ts) — `CONTENT_PERMISSIONS` and `BUILT_IN_CONTENT_ROLES`. Currently includes a `comment.*` namespace at the **type** level but the permissions are not yet wired into roles or routes; `inline_comment.*` keys are present in type unions but not in `CONTENT_PERMISSIONS`. This doc lands the actual catalog entries and bindings.
- [src/infrastructure/db/schema.ts](../src/infrastructure/db/schema.ts) — current schema. Has `users`, no `comments`, no `inline_comments`, no `bookmarks`, no `reading_progress`.
- [src/domain/iam/resource-loader.ts](../src/domain/iam/resource-loader.ts) — needs `commentResource` and `inlineCommentResource` helpers.
- [/home/quanghuy1242/pjs/payloadcms/src/utils/comments.ts](../../payloadcms/src/utils/comments.ts) — old commenting rules (5/10m, 20/h, 550-char body, 5-hour edit window, immutable parent fields, target validation). Only used here as a behavior reference; the implementation is reworked from scratch.
- [docs/payloadcms-access-control-policy-spec.md §7](payloadcms-access-control-policy-spec.md) — documents the public-vs-moderation split that we are following.

### 3.2 Current Behavior

- The repo has no commenting, no inline commenting, no bookmarks, no reading progress.
- PayloadCMS had:
  - `comments` collection admin-only at the framework level, with a separate utility module driving the public API (5/10m + 20/h rate limit; 5-hour edit window; parent must be top-level + approved).
  - `bookmarks` collection with `(user, contentType, target)` and the same `ownerAccess('user')` pattern.
  - `reading-progress` collection keyed on `(user, book, chapter)` with progress 0..100.

### 3.3 Current Problems

- The split between "framework-collection-CRUD" and "public-utility-API" in PayloadCMS produced two parallel behaviors for the same data. New design must unify "user comments" through use cases and keep "moderation" as a separate route surface that targets the same rows.
- Block-level anchoring for inline comments was never implemented in PayloadCMS (it didn't have a block model). docs/015 introduces stable `blockId` strings; this doc lands the inline-comment table that uses them.
- PayloadCMS's `reading-progress` and `bookmarks` used `ownerAccess('user')` — generic and lossy. The new design hardcodes `actor.subject === row.userId` checks and explicitly excludes these tables from ContentPolicy evaluation, removing a class of "did I forget a binding check?" bugs.
- There is no place for "moderation queue" today. The new design uses a `comments` listing endpoint with a `status` filter that requires `comment.moderate`.

## 4. Target Model

### 4.1 Comments And Inline Comments

Comments table:

```ts
export const comments = sqliteTable("comments", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  bookId: text("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  // every comment targets a chapter; book-level comments are a future ext
  chapterId: text("chapter_id").notNull().references(() => chapters.id, { onDelete: "cascade" }),
  authorUserId: text("author_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  content: text("content").notNull(),
  status: text("status").notNull().default("pending"),  // pending | approved | rejected
  parentCommentId: text("parent_comment_id"),
  moderatedAt: integer("moderated_at", { mode: "timestamp_ms" }),
  moderatedByUserId: text("moderated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  rejectionReason: text("rejection_reason"),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  deletedByUserId: text("deleted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
  index("comments_chapter_status_idx").on(table.chapterId, table.status, table.createdAt),
  index("comments_author_idx").on(table.authorUserId, table.createdAt),
  index("comments_parent_idx").on(table.parentCommentId),
  index("comments_rate_limit_idx").on(table.authorUserId, table.chapterId, table.createdAt),
]);
```

Inline comments table:

```ts
export const inlineComments = sqliteTable("inline_comments", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  bookId: text("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  chapterId: text("chapter_id").notNull().references(() => chapters.id, { onDelete: "cascade" }),
  authorUserId: text("author_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  // Anchor — see docs/015 §4.3 for blockId provenance
  blockId: text("block_id").notNull(),
  rangeStart: integer("range_start").notNull(),  // character offset in block plain text
  rangeEnd: integer("range_end").notNull(),
  content: text("content").notNull(),
  status: text("status").notNull().default("open"),  // open | resolved | rejected | orphaned
  parentInlineCommentId: text("parent_inline_comment_id"),
  moderatedAt: integer("moderated_at", { mode: "timestamp_ms" }),
  moderatedByUserId: text("moderated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
  resolvedByUserId: text("resolved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  orphanedAt: integer("orphaned_at", { mode: "timestamp_ms" }),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  deletedByUserId: text("deleted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
  index("inline_comments_chapter_status_idx").on(table.chapterId, table.status),
  index("inline_comments_block_idx").on(table.chapterId, table.blockId),
  index("inline_comments_author_idx").on(table.authorUserId, table.createdAt),
  index("inline_comments_parent_idx").on(table.parentInlineCommentId),
]);
```

Differences from regular comments:

- Inline comments are author-collaboration tools, not reader feedback. They default to `status = "open"` and have a `resolve` transition rather than `approve/reject`.
- A reader-only token without an inline-comment binding cannot see open inline comments — the public chapter read endpoint must filter by inline-comment permission.
- Inline comments do **not** support nested replies more than one level deep, same as regular comments.

Authoring constraints:

- Top-level comments: `parentCommentId IS NULL`. Reply: `parentCommentId` references an approved top-level comment on the same chapter. Replies-to-replies are rejected.
- Inline comment threading uses the same one-level rule on `parentInlineCommentId`; replies are scoped to the same chapter + block (the range is inherited from the root for display purposes).
- `content` is 1..550 chars, server-trimmed, stored as raw text. No Lexical, no HTML. Rendering is the client's job.

### 4.2 Moderation Workflow

States and transitions:

```text
                +--------+    moderator approve     +----------+
new comment --> | pending| ----------------------> | approved |
                +--------+                          +----------+
                    |                                    |
                    | moderator reject                   | moderator reject
                    v                                    v
                +----------+    moderator reset    +----------+
                | rejected| <--------------------- | rejected |
                +----------+    (tightly restricted)
                    ^
                    | author or moderator soft-delete (sets deletedAt)
```

Rules:

- `pending → approved`: requires `comment.moderate`. Sets `moderatedAt = now`, `moderatedByUserId = actor.subject`.
- `pending → rejected` or `approved → rejected`: same permission. Optional `rejectionReason`.
- `rejected → pending`: requires `comment.moderate` and the actor must be a direct organization content administrator. This path exists for false-positive recovery and is explicitly audited.
- `* → soft-deleted` (sets `deletedAt`): the author can soft-delete their own row within the edit window; a moderator can soft-delete any row.
- `soft-deleted → undeleted`: not supported. If recovery is needed, an operator restores the row by direct D1 manipulation, and that operation should later be audited (docs/014).

Inline comments use a different state machine:

```text
new -> open -> resolved
            \-> rejected
            \-> orphaned   (chapter edit removed the anchored block)
```

- `open → resolved`: any actor with `inline_comment.create` on the chapter (i.e., a collaborator) can resolve open comments. Sets `resolvedAt = now`, `resolvedByUserId = actor.subject`. Rationale: inline comments are working-doc artifacts; making "resolve" admin-only would defeat the workflow.
- `open → rejected`: requires `inline_comment.moderate`. Used for spam or off-topic comments.
- `* → orphaned`: set by the chapter content update use case (§4.4) when the anchored `blockId` disappears. Never set directly by users.
- `open → soft-delete`: author within edit window; moderator any time.

### 4.3 Rate Limits And Edit Windows

Limits (carry-over from PayloadCMS rationale, recorded here as canonical):

| Limit | Window | Scope |
|---|---|---|
| 5 comments | 10 minutes | (author, chapter) |
| 20 comments | 60 minutes | (author, *) |
| 5 inline comments | 10 minutes | (author, chapter) |
| 50 inline comments | 60 minutes | (author, *) |

Enforced by counting rows where `created_at >= now - window` and the relevant `author_user_id` (+ `chapter_id`) match. The `comments_rate_limit_idx` index covers the per-chapter case; the per-actor case uses the existing `comments_author_idx`. Same for inline comments.

A future migration to a KV/Durable Object counter is in §11. The D1-counted approach is correct for the first release because comment write volume is low and a missed limit costs almost nothing.

Edit window:

- 5 hours from `createdAt`. Authors can update `content` within the window. After the window, edits are rejected.
- Editable while `status` is `pending` or `approved`. Editing a `rejected` comment is rejected.
- Soft-deleted comments cannot be edited.
- Immutable fields after create: `authorUserId`, `chapterId`, `bookId`, `parentCommentId`.

Inline comments use the same 5-hour window. `blockId`, `rangeStart`, `rangeEnd`, `parentInlineCommentId`, `chapterId` are immutable.

### 4.4 Block-Orphaning Behavior

When a chapter content update removes a block (its `blockId` is no longer present in the new `contentJson`), any inline comments anchored to that block need to be handled.

Decision: **flag as orphaned, do not delete**. Specifically:

1. The `UpdateChapterUseCase` (docs/015 §7.3) computes the set of removed `blockId`s by diffing the old vs new content.
2. The use case asks the inline-comment repository to mark all open inline comments on the chapter whose `blockId IN removedBlockIds` as `status = "orphaned"`, setting `orphanedAt = now`.
3. The orphan transition happens in a separate write **after** the chapter update succeeds. This avoids enlarging the chapter update batch and means an inline-comment write failure does not roll back the chapter edit.
4. Orphaned comments remain visible to moderators in `GET /comments?status=orphaned`. The renderer should not display orphaned comments to readers.

A regular comment is not affected by chapter edits because it anchors to the chapter, not a block. The only chapter-edit-relevant cascade for regular comments is when the chapter itself is deleted, which cascades via FK.

### 4.5 Bookmarks

Table:

```ts
export const bookmarks = sqliteTable("bookmarks", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orgId: text("org_id").notNull(),      // denormalized for fast list scoping
  targetType: text("target_type").notNull(),  // "book" | "chapter"
  targetId: text("target_id").notNull(),
  bookId: text("book_id").notNull(),     // always set; for chapter bookmarks = chapter.bookId
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
  uniqueIndex("bookmarks_user_target_unique_idx").on(table.userId, table.targetType, table.targetId),
  index("bookmarks_user_book_idx").on(table.userId, table.bookId),
]);
```

Access:

- All routes require an authenticated `user` actor (workspace or direct-share). M2M service accounts cannot read or write bookmarks. System actors cannot — these tables are user-owned by definition.
- Authorization is hardcoded `actor.subject === row.userId`. `ContentPolicy.can(...)` is not used. This is the entire point of §5.3.
- Before creating a bookmark, the use case must resolve the target and verify `ContentPolicy.can(actor, "<targetType>.read", ref)` so a user cannot bookmark a chapter they cannot read. This **is** an IAM call, but on the bookmarked content, not on the bookmark itself.

Soft-delete vs hard-delete: bookmarks are **hard-deleted**. Users delete and re-create freely.

### 4.6 Reading Progress

Table:

```ts
export const readingProgress = sqliteTable("reading_progress", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orgId: text("org_id").notNull(),
  bookId: text("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  chapterId: text("chapter_id").notNull().references(() => chapters.id, { onDelete: "cascade" }),
  progress: real("progress").notNull().default(0),   // 0..100
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  lastReadAt: integer("last_read_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
  uniqueIndex("reading_progress_user_chapter_unique_idx").on(table.userId, table.chapterId),
  index("reading_progress_user_book_idx").on(table.userId, table.bookId, table.lastReadAt),
]);
```

Access:

- Same rules as bookmarks: user-only, hardcoded `actor.subject === row.userId`, no IAM evaluation on the row itself.
- Before upsert, verify `ContentPolicy.can(actor, "chapter.read", chapterRef)` on the target chapter.

Upsert semantics:

- `PUT /chapters/{chapterId}/reading-progress { progress }` upserts a single row keyed on (`userId`, `chapterId`). `progress` is monotonic: an upsert with a smaller value than the stored value is silently ignored (returns the stored value). Forcing progress backwards is a `POST /chapters/{chapterId}/reading-progress/reset` action that is admin-only via `comment.moderate` (no separate `reading_progress.moderate`).
- When `progress >= 100`, `completedAt` is set on the upsert; lowering progress later does not clear `completedAt` (a completion is sticky).
- `lastReadAt` is set on every upsert regardless of progress change.

Aggregate read views:

- `GET /books/{id}/reading-progress` lists the actor's progress across the book's chapters.
- `GET /users/me/reading-progress?limit=20&cursor=...` lists by `lastReadAt desc` across all books the actor has read.
- No cross-user aggregation in the first release.

### 4.7 Content IAM Wiring

Permission catalog state in [src/domain/iam/content-permission.ts](../src/domain/iam/content-permission.ts) as of this doc's writing:

**Already present** (catalog row exists; this doc lands the first real use cases that call them):

| Key | Current delegation class | This doc's required class | Description |
|---|---|---|---|
| `comment.create` | `ordinary` | `ordinary` (unchanged) | Post a comment on a chapter. |
| `comment.moderate` | `ordinary` | **`policy_management` — change required** | Approve, reject, reset-to-pending, soft-delete other comments. |
| `inline_comment.create` | `ordinary` | `ordinary` (unchanged) | Drop or reply to inline comments; resolve open inline comments. |

The `comment.moderate` delegation class is upgraded by this doc's migration from `ordinary` to `policy_management`. Rationale: moderation actions are policy-class — they affect content visibility for other users — and direct-share tokens (which cannot hold `content:share`) must not be able to hold them. The migration script must also re-derive any tenant role whose `derived_delegation_class` includes `comment.moderate`; the existing `deriveDelegationClass` helper (`src/domain/iam/content-permission.ts:295`) already computes the highest class on read, so persisted role rows are not affected — only newly created roles will pick up the higher class on save.

**Net-new permissions to add**:

| Key | Delegation class | Description |
|---|---|---|
| `comment.read` | `ordinary` | Read comments on a chapter (filters by `status = "approved"` for non-moderators; see §5.2). |
| `comment.update` | `ordinary` | Edit own comment within the window. |
| `comment.delete` | `ordinary` | Soft-delete own comment within the window. |
| `inline_comment.read` | `ordinary` | Read inline comments on a chapter. |
| `inline_comment.update` | `ordinary` | Edit own inline comment within the window. |
| `inline_comment.delete` | `ordinary` | Soft-delete own inline comment within the window. |
| `inline_comment.moderate` | `policy_management` | Reject inline comments. |

**Vestigial key to leave alone**: `block.comment`. The catalog row exists from earlier scope (per-block IAM, rejected by docs/015 §5.2). Not used; do not remove as part of this PR.

Notes:

- `comment.moderate` and `inline_comment.moderate` are `policy_management` — not platform admin, but elevated enough that direct-share tokens cannot hold them (direct-share tokens lack `content:share` scope which is required for `policy_management` actions; the policy evaluator already rejects this combination).
- `*.read` is generally redundant for collaborators (the inherited `chapter.read` already permits comment reads in our model — see §5.2), but is included so a tenant can build a "read-only commenter" role that can leave comments but cannot read other private content.

Built-in role audit:

- `system:book.owner` — **already carries** `comment.create`, `comment.moderate`, `inline_comment.create`. Add the seven net-new keys (`comment.read`, `comment.update`, `comment.delete`, `inline_comment.read`, `inline_comment.update`, `inline_comment.delete`, `inline_comment.moderate`).
- `system:book.author` — **already carries** `comment.create`, `inline_comment.create`. Add `comment.read`, `comment.update`, `comment.delete`, `inline_comment.read`, `inline_comment.update`, `inline_comment.delete`.
- `system:book.editor` — **already carries** `comment.create`, `inline_comment.create`. Same additions as `system:book.author`.
- `system:book.reviewer` — **already carries** `comment.create`, `inline_comment.create`. Add `comment.read`, `inline_comment.read`. Do **not** add update/delete (reviewers cannot edit their own comments after the window; same default as the rest, but reviewers do not need the `*.update`/`*.delete` capabilities for collaboration since they are commenters, not authors of comments-as-work-product).
- `system:book.reader` — **already carries** `book.read`, `chapter.read`, `media.read`. Add `comment.read`, `inline_comment.read`. The reader role does not gain create perms; tenants who want a "reader-plus-comment" role can create one.
- `system:org.content_admin` — add all net-new keys plus the `*.moderate` ones (`comment.moderate` is already on it via the earlier 007 design? — verify; if missing, add). Confirm with the implementer that org admin holds moderation.

A new built-in role `system:book.commenter` is **not** introduced; tenants can compose one from the existing primitives.

Resource loaders in [src/domain/iam/resource-loader.ts](../src/domain/iam/resource-loader.ts):

- `commentResource(comment, chapter, book)` returns ref with ancestors `[chapter, ...chapter.ancestors..., book, org]`.
- `inlineCommentResource(inline, chapter, book)` returns the same shape.
- These are only used by moderation routes that bind directly to a comment/inline-comment id; ordinary comment create/read/update use the **chapter** ref because the relevant permission keys live on the chapter resource (a binding allowing `comment.create` on a book/chapter cascades to all comments on that chapter without per-row bindings being created).

### 4.8 HTTP API Surface

Route style follows the existing convention in [src/http/routes/books.routes.ts](../src/http/routes/books.routes.ts) (e.g. `/books/{bookId}/ownership-transfer`): **path-segment action names, not colon-prefixed sub-resources**. Every mutation route gets a matching constant in [src/shared/constants.ts](../src/shared/constants.ts) for idempotency snapshot keys.

Public (reader/contributor) comment routes:

- `POST /chapters/{chapterId}/comments` — create. Body: `{ content, parentCommentId? }`. Returns the created comment with `status = "pending"` (or `"approved"` if the platform is configured to auto-approve via a future tenant policy).
- `GET /chapters/{chapterId}/comments?status=approved&limit=20&cursor=...` — list. Default `status=approved`, hides soft-deleted. Threaded shape: top-level rows with `replies: [...]` flattened to depth 1.
- `PATCH /comments/{commentId}` — edit (author-only, within edit window).
- `DELETE /comments/{commentId}` — soft-delete (author or moderator).

Public inline-comment routes:

- `POST /chapters/{chapterId}/inline-comments` — create. Body: `{ content, blockId, rangeStart, rangeEnd, parentInlineCommentId? }`.
- `GET /chapters/{chapterId}/inline-comments?status=open&blockId=...` — list with filters.
- `PATCH /inline-comments/{inlineCommentId}` — edit (author-only, within window).
- `DELETE /inline-comments/{inlineCommentId}` — soft-delete (author or moderator).
- `POST /inline-comments/{inlineCommentId}/resolve` — mark resolved.

Moderation routes (require workspace token + `comment.moderate` or `inline_comment.moderate`):

- `GET /chapters/{chapterId}/comments?status=pending|rejected|all&includeDeleted=true` — moderation list.
- `POST /comments/{commentId}/approve`
- `POST /comments/{commentId}/reject` — body `{ reason? }`
- `POST /comments/{commentId}/reset-to-pending` — direct org content admin only
- `GET /chapters/{chapterId}/inline-comments?status=rejected|orphaned`
- `POST /inline-comments/{inlineCommentId}/reject`

Bookmarks:

- `POST /bookmarks` — body `{ targetType, targetId, note? }`.
- `GET /bookmarks?targetType=...&bookId=...&limit=...&cursor=...` — list own bookmarks.
- `DELETE /bookmarks/{bookmarkId}` — hard-delete own bookmark.

Reading progress:

- `PUT /chapters/{chapterId}/reading-progress` — upsert with progress.
- `GET /chapters/{chapterId}/reading-progress` — read actor's progress on this chapter (or 404 if never read).
- `GET /books/{bookId}/reading-progress` — list actor's progress across all readable chapters of the book.
- `GET /users/me/reading-progress?limit=...&cursor=...` — list across all books.
- `POST /chapters/{chapterId}/reading-progress/reset` — admin-only force-reset (requires `comment.moderate` as a stand-in for "elevated user-data action" until a dedicated permission is needed).

All mutation routes require `Idempotency-Key`. All routes are OpenAPI-registered.

## 5. Architecture Decisions

### 5.1 Comments And Inline Comments Are Separate Resources

Inline comments are not "comments with extra fields". They have a different state machine (`open → resolved`), a different access pattern (collaboration vs reader feedback), a different rate-limit envelope, and a different orphaning behavior. Merging them into one table and one set of use cases would produce twelve "if inline-mode then …" branches and is rejected.

The shared author/edit-window/soft-delete behavior lives in shared use-case helpers under `src/application/comments/_shared/` (not in a base class — composition over inheritance).

### 5.2 Two Policy Surfaces — Public And Moderation

Comments are first-class user-generated content. The public API (`POST /chapters/{id}/comments`) is gated by the chapter's content read/write permissions plus comment-specific permissions. The moderation API is gated by `comment.moderate`. These two surfaces are deliberately **separate routes**, not flags on the same route, because:

- Auditing is clearer: a moderation action always lives at `/comments/{id}:<action>`, never inside `PATCH /comments/{id}`.
- OpenAPI schemas for "public commenter" and "moderator" diverge in the fields they can write (e.g., the public route never accepts `status`).
- It is easier to add per-tenant moderation policies later (e.g., auto-approve for tenants with low spam volume) without changing the public route's contract.

The lesson from PayloadCMS is in the access-control spec §7: "Do not model comments as plain CRUD." Two surfaces, one table.

### 5.3 Reading State Is Not IAM-Tracked

Bookmarks and reading progress are subject-private. They are never shared, never delegated, never inherited. Pushing them through Content IAM would:

- Require a `reading_progress` `ContentResourceType` whose only ever-true binding is to the subject themselves.
- Force every read to load the resource and run `ContentPolicy.can(...)`, even though the answer is always "yes iff `actor.subject === row.userId`".
- Risk silent vulnerabilities if a future binding is added by mistake.

Hardcoding `actor.subject === row.userId` in the use case is correct here. The cost is that the architecture lint rule "use cases must call ContentPolicy.can(...)" does not apply to these use cases; this is allowed because the rule's intent is satisfied by the harder ownership check.

The use case still asks `ContentPolicy.can(actor, "chapter.read", chapterRef)` on the **chapter being progressed/bookmarked** — that is an IAM call on a different resource, and it stays.

### 5.4 Soft-Delete Comments, Hard-Delete Read State

Comments are content. Deleting them is a moderation event that should be reversible (or at least visible to moderators). Reading state is ephemeral; deleting a bookmark or progress row is a user-initiated reset with no archival value. Hard-delete keeps the table small.

### 5.5 Block-Orphaning Is A Moderation Surface, Not An Auto-Delete

When a block is removed from a chapter, the inline comments anchored to it become orphaned. Three options were considered:

- **Auto-delete (rejected).** Silently destroys collaboration artifacts. Authors lose context for ongoing reviews.
- **Auto-rebase (rejected).** Attempting to re-anchor a comment to a nearby block heuristically. Too lossy; almost always wrong.
- **Mark orphaned (chosen).** The comment stays. The renderer hides it for readers. The moderation UI lists orphaned inline comments so a collaborator can resolve them explicitly.

The orphan transition is a one-way move; "unorphan" is not supported, because the next edit may move the block back temporarily without it being the same conceptual anchor.

### 5.6 Rate Limiting Lives In The Use Case

The use case counts D1 rows in a recent window before insert. This is fine for low-volume writes (low single-digit per second per tenant). A future Durable Object or KV counter (see §11) is the natural next step if write volume grows.

Putting rate limiting in middleware is rejected because:

- The middleware would need to know per-route limits.
- The middleware does not have actor permissions or target context, so it cannot distinguish "moderator backfilling 30 approvals" from "spammer leaving 30 comments".

### 5.7 Rejected Or Deferred Options

- **Per-tenant configurable rate limits.** Deferred. First-release limits are constants.
- **Per-tenant auto-approve toggle.** Deferred. First-release default is `status = "pending"` and the route requires explicit moderation. Tenants who want auto-approve can implement it by binding `comment.moderate` to a system service account that polls and approves; that is a workaround, not a clean solution, but it unblocks the use case without committing to the toggle.
- **Anonymous commenting.** Out of scope for the first release.
- **Mentions, notifications, reactions.** Future, separate doc.
- **Multi-level threading.** Deferred. The product can ship with one-level threading.
- **Book-level comments** (a comment that lives on the book, not on a chapter). Deferred. The schema can accept it via a future migration adding `targetType` to the comments table; for now every comment must target a chapter.
- **Comment Lexical content.** Rejected for the first release. Comments are plain text 1..550 chars. Lexical-bodied comments add validation cost without product justification.
- **Aggregate analytics on reading progress.** Out of scope (the product is not analytics-first).
- **Cross-organization sharing of reading lists.** Out of scope.

## 6. Implementation Strategy

Phases:

1. Schema. Land all four tables in one migration. Default values + indexes from §4.
2. Comments domain + repository + mappers + use cases. Public surface only.
3. Inline comments domain + repository + mappers + use cases. Public surface only.
4. Moderation routes for both comment types.
5. Bookmarks + reading progress (smaller surface, ships last since it does not block authoring).
6. Block-orphaning wiring into `UpdateChapterUseCase`. This is a small change but depends on the inline-comment repository existing first.
7. IAM permission/role updates + resource loaders.

Each phase has its own PR. The block-orphan hook (phase 6) can be wired with a temporary no-op implementation in earlier phases if inline-comments lands after chapter content edits ship.

## 7. Detailed Implementation Plan

### 7.1 Comments Schema And Entity

Current problem:

- No `comments` table; no `Comment` domain entity.

Target behavior:

- The `comments` table from §4.1.
- A `Comment` domain entity with author/edit-window/soft-delete behavior.

Implementation tasks:

- [ ] Add the `comments` table to [src/infrastructure/db/schema.ts](../src/infrastructure/db/schema.ts).
- [ ] `src/domain/comments/comment.entity.ts`:
  - `CommentProps` — full row snapshot.
  - `static create({ orgId, bookId, chapterId, authorUserId, content, parentCommentId? })` — defaults `status = "pending"`, sets timestamps.
  - `updateContent({ content })` — validates length and edit window (5 hours from `createdAt`); rejects if `status === "rejected"` or `deletedAt != null`.
  - `approve(actor)`, `reject(actor, reason?)`, `resetToPending(actor)` — state transitions with validations.
  - `softDelete(actor)` — sets `deletedAt`, `deletedByUserId`.
  - `toSnapshot()`.
- [ ] `src/domain/comments/comment.repository.ts`:
  - `findById(id)`, `findApprovedThread({ chapterId, parentCommentId, limit, cursor })`, `listByStatus(...)`, `countAuthorWindow({ authorUserId, chapterId?, sinceMs })` for rate limit, `save(comment)`.
- [ ] `src/infrastructure/repositories/drizzle-comment.repository.ts`.
- [ ] `src/infrastructure/repositories/mappers/comment.mapper.ts`.

Tests:

- `tests/comments.entity.test.ts` covers entity state machine and edit window.
- `tests/comments.repo.test.ts` covers rate-limit count helper and threaded listing.

### 7.2 Inline Comments Schema And Entity

Current problem:

- No `inline_comments` table; no entity.

Target behavior:

- The `inline_comments` table from §4.1 with the `open → resolved | rejected | orphaned` state machine.

Implementation tasks:

- [ ] Add the table.
- [ ] `src/domain/comments/inline-comment.entity.ts`:
  - `static create({ ..., blockId, rangeStart, rangeEnd })` — defaults `status = "open"`.
  - `updateContent({ content })` — edit window + content size.
  - `resolve(actor)`, `reject(actor)`, `markOrphaned()` — state transitions. `markOrphaned()` accepts no actor because it is invoked by the chapter update use case as a system effect.
  - `softDelete(actor)`.
  - `toSnapshot()`.
- [ ] `src/domain/comments/inline-comment.repository.ts`:
  - `findById`, `listByChapter({ chapterId, status?, blockId? })`, `markOpenInBlocksAsOrphaned({ chapterId, blockIds })` — used by chapter update.
  - `countAuthorWindow({ authorUserId, chapterId?, sinceMs })`.
- [ ] Drizzle adapter, mapper.

Tests:

- `tests/inline-comments.entity.test.ts`.
- `tests/inline-comments.repo.test.ts` covers the bulk orphan path.

### 7.3 Comment Use Cases

Current problem:

- No use cases.

Target behavior:

- The full public surface in §4.8 backed by use cases.

Implementation tasks:

- [ ] `src/application/comments/create-comment.usecase.ts`:
  - Inputs: `{ actor, chapterId, content, parentCommentId? }`.
  - Loads chapter (and book for ancestry); asserts `comment.create` on chapter.
  - Validates content (trim, 1..550, no HTML — strip; in the first release, reject `<` characters with a clear validation error rather than auto-escape).
  - Validates parent rules (top-level + approved + same chapter + same book).
  - Calls rate-limit helper.
  - Inserts row.
  - Idempotent via `Idempotency-Key`.
- [ ] `src/application/comments/list-public-comments.usecase.ts`:
  - Loads chapter; asserts `comment.read` (or inherited chapter.read).
  - Returns approved + non-deleted rows + first-level replies.
- [ ] `src/application/comments/update-own-comment.usecase.ts`:
  - Loads comment; asserts `actor.subject === comment.authorUserId` AND `comment.update` on chapter.
  - Calls `comment.updateContent(...)`.
- [ ] `src/application/comments/soft-delete-comment.usecase.ts`:
  - Author path: requires within window + own row.
  - Moderator path: requires `comment.moderate`.

Tests:

- `tests/comments.usecases.test.ts` covers happy paths, rate limit, edit window, parent rules.

### 7.4 Inline Comment Use Cases

Implementation tasks:

- [ ] `create-inline-comment.usecase.ts`: validates `blockId` existence in `chapter.contentJson`, validates range bounds against the block's plain-text length (helper in `src/domain/books/lexical/extract-block-text.ts`).
- [ ] `list-inline-comments.usecase.ts`: filters by status + blockId.
- [ ] `update-own-inline-comment.usecase.ts`.
- [ ] `resolve-inline-comment.usecase.ts`: requires `inline_comment.create` on the chapter (rationale: any collaborator can resolve).
- [ ] `soft-delete-inline-comment.usecase.ts`.

Tests:

- `tests/inline-comments.usecases.test.ts`.

### 7.5 Moderation Workflow

Implementation tasks:

- [ ] `approve-comment.usecase.ts`, `reject-comment.usecase.ts`, `reset-comment-to-pending.usecase.ts`, `moderator-soft-delete-comment.usecase.ts`. All require `comment.moderate`. `reset-to-pending` additionally requires the actor be a direct organization content administrator (re-use the existing `ContentAdministrationPolicy` check used for protected delegation in IAM).
- [ ] `reject-inline-comment.usecase.ts`.
- [ ] Each use case writes a `content_policy_events` row tagged with the moderation action, snapshot containing `{ commentId, fromStatus, toStatus, reason? }`. This is the only audit signal until docs/014 is implemented.

Tests:

- `tests/comments.moderation.test.ts` covers each transition and the policy-events write.

### 7.6 Bookmarks Schema And Use Cases

Implementation tasks:

- [ ] Add the table.
- [ ] `src/domain/reading/bookmark.entity.ts` (small entity; `static create(...)`, `toSnapshot()`).
- [ ] `src/domain/reading/bookmark.repository.ts`: `findByUserAndTarget`, `listByUser({ userId, bookId?, targetType?, limit, cursor })`, `save`, `delete`.
- [ ] Drizzle adapter, mapper.
- [ ] `src/application/reading/create-bookmark.usecase.ts` — resolves target, asserts target read permission, inserts row. Re-creating an existing bookmark is treated as idempotent.
- [ ] `src/application/reading/list-bookmarks.usecase.ts` — hardcoded `actor.subject` scope.
- [ ] `src/application/reading/delete-bookmark.usecase.ts` — hard-delete; requires `actor.subject === row.userId`.

Tests:

- `tests/bookmarks.test.ts` covers create/list/delete + permission rejection (cannot read target → cannot bookmark).

### 7.7 Reading Progress Schema And Use Cases

Implementation tasks:

- [ ] Add the table.
- [ ] `src/domain/reading/reading-progress.entity.ts` with `upsert({ progress })` honoring the monotonic rule and `lastReadAt` update.
- [ ] `src/domain/reading/reading-progress.repository.ts`.
- [ ] `src/application/reading/upsert-reading-progress.usecase.ts` — hardcoded subject, monotonic.
- [ ] `src/application/reading/get-reading-progress.usecase.ts`.
- [ ] `src/application/reading/list-book-progress.usecase.ts` — actor's progress across a book.
- [ ] `src/application/reading/list-user-progress.usecase.ts` — actor's progress across all books, cursor-paginated.
- [ ] `src/application/reading/reset-reading-progress.usecase.ts` — admin-only via `comment.moderate` (stand-in until a dedicated permission is needed).

Tests:

- `tests/reading-progress.test.ts` covers upsert monotonicity, completion sticky behavior, M2M rejection.

### 7.8 IAM Permissions And Built-in Roles

Implementation tasks:

- [ ] Add new permission keys per §4.7.
- [ ] Update built-in role permission lists.
- [ ] Implement `commentResource(...)` and `inlineCommentResource(...)` in `resource-loader.ts`.
- [ ] Add the new IAM test fixtures covering inheritance from chapter to comment.

Tests:

- `tests/comment-policy.test.ts`: inherited `book.editor` allows `comment.create` on a chapter; direct denial on `comment.create` at chapter level blocks; cross-org rejection.

### 7.9 HTTP Routes And Presenters

Implementation tasks:

- [ ] Add `src/http/routes/comments.routes.ts` (mounts under `/chapters/{id}/comments` and `/comments/{id}` for moderation).
- [ ] Add `src/http/routes/inline-comments.routes.ts`.
- [ ] Add `src/http/routes/bookmarks.routes.ts`.
- [ ] Add `src/http/routes/reading-progress.routes.ts`.
- [ ] Add corresponding schemas under `src/http/schemas/`.
- [ ] Add presenters under `src/http/presenters/`.
- [ ] Wire into composition.

Tests:

- HTTP integration tests under `tests/`.

## 8. Migration And Rollout

Migration order:

1. Generate `drizzle/00NN_book_interactions.sql` containing the four new tables.
2. Apply locally; run tests; apply remote.
3. Backfill: none. All tables start empty.

Documentation:

- Update [README.md](../README.md) to point at docs/016.
- Update docs/007 §8.3 (Comments) / §8.5 (Bookmarks/Reading) to "implemented in docs/016".
- Confirm in docs/009 that it is now abandoned.
- Update the `content-iam-usage` skill to mention the new permission keys.

## 9. Edge Cases And Failure Modes

| Scenario | Expected handling |
|---|---|
| Reply targets a `rejected` parent | `400 ValidationError` — "Replies require an approved parent". |
| Reply targets a parent on a different chapter | `400 ValidationError`. |
| Reply targets a reply (depth > 1) | `400 ValidationError`. |
| Inline comment range outside block text length | `400 ValidationError`. |
| Inline comment on a non-existent block | `400 ValidationError`. |
| Author hits rate limit | `429 RateLimitError` with `Retry-After`. |
| Author edits comment after 5 hours | `403 Forbidden — Edit window has expired`. |
| Author edits a soft-deleted comment | `404 Not Found` (do not reveal soft-deletion state to author by error class; same behavior as a missing row). |
| Moderator resets `rejected → pending` without being a direct org content admin | `403 Forbidden`. |
| Chapter delete cascades to comments | DB FK does the cascade; the orphan pass for inline comments is unnecessary because the inline comments cascade too. |
| Chapter update removes a block with open inline comments | After the chapter update commits, the inline-comment repository marks those comments orphaned. If the orphan write fails, the chapter update is **not** rolled back; the orphan write is retried by a small bounded-retry helper in the use case (3 attempts, exponential backoff). Persistent failure is logged but does not surface to the chapter-update caller. |
| Moderator attempts to moderate a comment on a chapter they cannot read | `403 Forbidden`. Moderation requires both `comment.moderate` and inherited `chapter.read`. |
| User attempts to bookmark a chapter they cannot read | `403 Forbidden`. |
| Direct-share user attempts to use `comment.moderate` | Rejected at the scope layer (direct-share tokens cannot hold `content:share`, which is required for `policy_management` permissions). |
| Service account attempts to create a comment | `403 Forbidden`. Comments require a user actor. |
| Service account attempts to bookmark or update progress | `403 Forbidden`. |
| Anonymous request to any of these routes | `401 Unauthorized`. |
| Two concurrent upserts of reading progress | The unique index makes one INSERT succeed and the other gets caught at the use-case level as an existence collision; the use case retries as an UPDATE. The monotonic rule means concurrent progresses settle on the maximum. |
| User unread-reset attempt while not an admin | `403 Forbidden`. |
| Imported book (docs/015 §4.5) has chapters that are still being created when a reader tries to comment | Allowed iff the chapter is in `status = "published"`. Pending chapters are not readable, so comment creation fails at the read check. |

## 10. Implementation Backlog

### BIA-A. Comments Domain And Persistence

Scope:

- `src/infrastructure/db/schema.ts` (`comments` table)
- `src/domain/comments/comment.entity.ts`
- `src/domain/comments/comment.repository.ts`
- `src/infrastructure/repositories/drizzle-comment.repository.ts`
- `src/infrastructure/repositories/mappers/comment.mapper.ts`
- `drizzle/00NN_book_interactions.sql`

Tasks:

- [ ] Migration adds `comments` table from §4.1.
- [ ] Entity implements state transitions and edit-window guard.
- [ ] Repository implements list-approved-thread, count-author-window, save.

Acceptance criteria:

- Entity rejects updates after 5 hours.
- Rate-limit count query returns 5 for a window with 5 rows and 6 for 6.

Tests:

- `corepack pnpm test tests/comments.entity.test.ts tests/comments.repo.test.ts`

### BIA-B. Inline Comments Domain And Persistence

Scope:

- `src/infrastructure/db/schema.ts` (`inline_comments` table)
- `src/domain/comments/inline-comment.entity.ts`
- `src/domain/comments/inline-comment.repository.ts`
- `src/infrastructure/repositories/drizzle-inline-comment.repository.ts`
- `src/infrastructure/repositories/mappers/inline-comment.mapper.ts`

Tasks:

- [ ] Migration adds the table from §4.1.
- [ ] Entity implements `resolve`/`reject`/`markOrphaned`/`softDelete`.
- [ ] Repository implements list-by-chapter, mark-open-in-blocks-as-orphaned.

Acceptance criteria:

- `markOpenInBlocksAsOrphaned` sets `status = "orphaned"` and `orphaned_at` for all `open` inline comments matching the given blockIds.

Tests:

- `corepack pnpm test tests/inline-comments.entity.test.ts tests/inline-comments.repo.test.ts`

### BIA-C. Comment And Inline Comment Use Cases

Scope:

- `src/application/comments/_shared/*`
- `src/application/comments/{create,list-public,update-own,soft-delete}-comment.usecase.ts`
- `src/application/comments/{create,list,update-own,resolve,soft-delete}-inline-comment.usecase.ts`
- `src/domain/books/lexical/extract-block-text.ts`

Tasks:

- [ ] Implement all eight use cases.
- [ ] Implement `extract-block-text` helper used for inline range validation.
- [ ] Implement the rate-limit helper shared by both comment types.

Acceptance criteria:

- Author hitting the per-chapter window: 6th comment in 10 minutes returns 429.
- Reply to a rejected parent returns 400.
- Inline comment on a non-existent block returns 400.

Tests:

- `corepack pnpm test tests/comments.usecases.test.ts tests/inline-comments.usecases.test.ts`

### BIA-D. Moderation Use Cases

Scope:

- `src/application/comments/moderation/{approve,reject,reset-to-pending,moderator-soft-delete}-comment.usecase.ts`
- `src/application/comments/moderation/{reject}-inline-comment.usecase.ts`

Tasks:

- [ ] Implement all use cases.
- [ ] Each writes a `content_policy_events` row.
- [ ] `reset-to-pending` requires direct organization content administrator.

Acceptance criteria:

- Moderation transitions emit policy events.
- `reset-to-pending` is rejected for a binding-derived `comment.moderate` holder who is not a direct org admin.

Tests:

- `corepack pnpm test tests/comments.moderation.test.ts`

### BIA-E. Bookmarks

Scope:

- `src/infrastructure/db/schema.ts` (`bookmarks` table)
- `src/domain/reading/bookmark.entity.ts`
- `src/domain/reading/bookmark.repository.ts`
- `src/infrastructure/repositories/drizzle-bookmark.repository.ts`
- `src/infrastructure/repositories/mappers/bookmark.mapper.ts`
- `src/application/reading/{create,list,delete}-bookmark.usecase.ts`

Tasks:

- [ ] Implement domain + persistence.
- [ ] Use cases enforce `actor.subject === row.userId` after-create.
- [ ] Create rejects if `ContentPolicy.can(actor, "<targetType>.read", ref)` is false.

Acceptance criteria:

- User A cannot list or delete user B's bookmarks.
- M2M actor receives 403 on every route.

Tests:

- `corepack pnpm test tests/bookmarks.test.ts`

### BIA-F. Reading Progress

Scope:

- `src/infrastructure/db/schema.ts` (`reading_progress` table)
- `src/domain/reading/reading-progress.entity.ts`
- `src/domain/reading/reading-progress.repository.ts`
- `src/infrastructure/repositories/drizzle-reading-progress.repository.ts`
- `src/infrastructure/repositories/mappers/reading-progress.mapper.ts`
- `src/application/reading/{upsert,get,list-book,list-user,reset}-reading-progress.usecase.ts`

Tasks:

- [ ] Implement domain + persistence.
- [ ] Upsert is monotonic and sticky on completion.
- [ ] Reset requires `comment.moderate`.

Acceptance criteria:

- Upsert with lower value than stored returns stored value.
- Progress >= 100 sets `completedAt`; subsequent lower upsert keeps `completedAt`.

Tests:

- `corepack pnpm test tests/reading-progress.test.ts`

### BIA-G. Content IAM Permission And Role Updates

Scope:

- `src/domain/iam/content-permission.ts`
- `src/domain/iam/resource-loader.ts`
- migration that upgrades the persisted `delegation_class` of `comment.moderate`

Tasks:

- [ ] Add **net-new** permission keys per §4.7: `comment.read`, `comment.update`, `comment.delete`, `inline_comment.read`, `inline_comment.update`, `inline_comment.delete`, `inline_comment.moderate`. (Already in `CONTENT_PERMISSIONS`: `comment.create`, `comment.moderate`, `inline_comment.create`. Do not redeclare.)
- [ ] Upgrade `comment.moderate.delegationClass` from `"ordinary"` to `"policy_management"` in the code constant; ship a migration that updates the persisted `content_permissions.delegation_class` row.
- [ ] Append the seven net-new keys to `system:book.owner.permissions` and `system:book.author.permissions` / `system:book.editor.permissions` per §4.7.
- [ ] Append `comment.read` and `inline_comment.read` to `system:book.reviewer` and `system:book.reader`.
- [ ] Verify `system:org.content_admin` carries `comment.moderate` and `inline_comment.moderate`; add if missing.
- [ ] Implement `commentResource` and `inlineCommentResource`.

Acceptance criteria:

- Existing IAM tests pass.
- A direct-share token (no `content:share` scope) cannot be granted any role that carries `comment.moderate` (the policy evaluator rejects the combination because the upgraded delegation class is now `policy_management`).
- New tests cover the chapter → comment inheritance path.

Tests:

- `corepack pnpm test tests/comment-policy.test.ts`

### BIA-H. HTTP Routes And Presenters

Scope:

- `src/http/routes/comments.routes.ts`
- `src/http/routes/inline-comments.routes.ts`
- `src/http/routes/bookmarks.routes.ts`
- `src/http/routes/reading-progress.routes.ts`
- corresponding schemas + presenters
- `src/composition/create-request-container.ts`

Tasks:

- [ ] Implement OpenAPI routes per §4.8.
- [ ] Wire into the composition container.
- [ ] Pass `Idempotency-Key` requirement to all mutation routes.

Acceptance criteria:

- `corepack pnpm lint` passes (architecture lint).
- OpenAPI document includes all new routes.

Tests:

- `corepack pnpm test tests/{comments,inline-comments,bookmarks,reading-progress}.routes.test.ts`

### BIA-I. Block Orphaning Hook From Chapter Updates

Scope:

- `src/application/chapters/update-chapter.usecase.ts` (extended)

Tasks:

- [ ] Compute removed block IDs from the chapter content diff (helper exists in docs/015 §7.2).
- [ ] After the chapter update commits, call `inlineCommentRepo.markOpenInBlocksAsOrphaned({ chapterId, blockIds })`.
- [ ] Wrap the orphan call in a bounded retry helper.

Acceptance criteria:

- Removing a block via chapter edit marks its open inline comments as orphaned.
- Chapter update succeeds even if the orphan write fails on first attempt and is retried.

Tests:

- `corepack pnpm test tests/chapter-update-orphaning.test.ts`

## 11. Future Backlog

- **KV / Durable Object rate limiter.** Replace the D1-counted rate limit when write volume requires it.
- **Per-tenant moderation policy (auto-approve, hold-for-keyword, etc.).** Owned by a future moderation-config doc.
- **Mentions, notifications, reactions.** Separate doc.
- **Multi-level threading.** Schema-compatible (the `parent_comment_id` chain already supports it); the use cases would need to drop the "parent must be top-level" check and the list endpoint would need to tree-build.
- **Book-level comments.** Add `target_type` column and accept `book` as a target.
- **Lexical-bodied comments** with limited inline marks. Adds validation cost; punt until a product need.
- **Cross-user reading lists / public bookmarks.** Out of scope.
- **Aggregate analytics** (e.g., "what percent of users finish this book"). Operator dashboard, separate doc.
- **Audit log integration** for moderation actions and inline-comment orphan events. Owned by docs/014.

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

- Entity tests for each state machine and edit-window.
- Repository tests for rate-limit count and orphan-bulk-update.
- Use-case tests:
  - happy paths;
  - parent rules (rejected, wrong chapter, depth > 1);
  - rate-limit;
  - edit window;
  - cannot-read-target → cannot-comment;
  - moderator on un-readable chapter → 403;
  - direct-share token cannot moderate;
  - service account cannot comment or bookmark;
  - reading progress monotonicity + completion stickiness;
  - block orphan cascade after chapter edit.
- HTTP integration tests cover the OpenAPI surface and `Idempotency-Key` replay.

Manual smoke (against `wrangler dev`):

- Sign in as a reader, comment, reply, edit, soft-delete.
- Sign in as a moderator, list pending, approve, reject, reset-to-pending (verify org-admin requirement).
- Sign in as a collaborator, drop an inline comment; edit chapter to remove the anchored block; verify the inline comment shows as orphaned in the moderation list.
- Sign in as a reader, bookmark a chapter; read it; verify progress upsert and completion sticky.

## 13. Definition Of Done

- All four tables exist; the migration applies to a fresh D1.
- All public and moderation routes from §4.8 are reachable, OpenAPI-documented, and Vitest-integrated.
- `comment.moderate` and `inline_comment.moderate` are policy-management class and are enforced at the route + use case level.
- Bookmarks and reading progress are subject-scoped, never IAM-evaluated on the row, and rejected for M2M / system actors.
- Removing a block from a chapter atomically (logically; via the bounded retry helper) marks affected open inline comments as orphaned.
- `corepack pnpm check` passes.
- `corepack pnpm advise` is green or carries documented suppressions only.
- README.md, docs/007, docs/009, the `content-iam-usage` skill are updated.

## 14. Final Model

```text
chapter (docs/015)
  comment        (IAM-tracked; status pending|approved|rejected; soft-delete; one-level threading)
  inline_comment (IAM-tracked; status open|resolved|rejected|orphaned; anchored to chapter.blockId + range)

(user, book, chapter)
  reading_progress (subject-private; monotonic; sticky completedAt)

(user, target)
  bookmark         (subject-private; hard-delete)
```

Comments and inline comments are first-class content with two separate policy surfaces (public + moderation). Reading state is subject-private with hardcoded ownership checks and never crosses Content IAM evaluation for the row itself. The block-orphan path is the only cross-resource cascade introduced by this doc — and it is explicit, retriable, and visible to moderators.

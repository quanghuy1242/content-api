# Book Resource Hierarchy And Collaboration Plan

> **Status: ABANDONED — superseded by docs/015, docs/016, and docs/017.**
>
> Date: 2026-05-24 (original); abandoned 2026-05-25.
>
> Why abandoned: the descendant-hierarchy design here was reconsidered. The new docs replace this plan with:
>
> - `docs/015_book-content-model.md` — recursive chapters, Lexical content schema (block IDs, `chapter-link`, `broken-link`, media nodes), `media_attachments`, `book.origin` model, "replace existing book" destructive workflow. **Replaces sections 6.1, 6.4, 8 (BKH-B, BKH-C), and 9 of this doc.**
> - `docs/016_book-interactions.md` — comments + inline comments (IAM-tracked), bookmarks + reading progress (subject-private; not IAM-tracked). **Replaces sections 6.3 and 8 (BKH-D) of this doc.**
> - `docs/017_epub-import.md` — EPUB import as a sibling Cloudflare Worker, two-pass walk using docs/015's link-node contract, `book_imports` table, `book.import` permission. **Replaces the import-related notes scattered through this doc.**
>
> Carry-over: the BKH-A work (book root, `POST /books`, atomic owner binding) shipped from this plan and remains valid. Its acceptance criteria are covered as the current state of [src/domain/books/book.entity.ts](../src/domain/books/book.entity.ts) and [src/http/routes/books.routes.ts](../src/http/routes/books.routes.ts); no further work tracked here.
>
> Do not implement from this document. Read the three replacement docs instead. The original content below is kept for archival reference only.
>
> Original scope:
>
> - `/home/quanghuy1242/pjs/content-api`
> - Future book, chapter, section, block, comment, inline-comment, bookmark, reading-progress, media-attachment, and recommendation resources
>
> Original source docs:
>
> - `docs/006_migrate-auther-to-id.md`
> - `docs/007_content-iam-policy-binding-model.md`
> - `docs/payloadcms-schema-spec.md`
> - `docs/payloadcms-access-control-policy-spec.md`
> - `/home/quanghuy1242/pjs/auth/docs/010_organization-teams-oauth-flow.md`
>
> Original related docs:
>
> - `docs/003_entity-classes-and-oxlint-arch-linting.md`
> - `docs/008_review-last-commit-006-007.md`
>
> Original verification:
>
> - BKH-A: `corepack pnpm check` passed with 75 Vitest tests; `corepack pnpm advise` passed with documented suppressions only; `git diff --check` passed.

## Table Of Contents

- [1. Goal](#1-goal)
- [2. Current State](#2-current-state)
- [3. Target Model](#3-target-model)
- [4. Architecture Decisions](#4-architecture-decisions)
- [5. Implementation Strategy](#5-implementation-strategy)
- [6. Detailed Implementation Plan](#6-detailed-implementation-plan)
  - [6.1 Resource Model](#61-resource-model)
  - [6.2 Content IAM Wiring](#62-content-iam-wiring)
  - [6.3 Comments, Bookmarks, And Reading State](#63-comments-bookmarks-and-reading-state)
  - [6.4 Media Attachments](#64-media-attachments)
- [7. Edge Cases And Failure Modes](#7-edge-cases-and-failure-modes)
- [8. Implementation Backlog](#8-implementation-backlog)
- [9. Test And Verification Plan](#9-test-and-verification-plan)
- [10. Definition Of Done](#10-definition-of-done)
- [11. Final Model](#11-final-model)

## 1. Goal

Implement the full book collaboration resource system as a separate batch on top of the Content IAM substrate from `docs/007_content-iam-policy-binding-model.md`.

This plan began because the IAM implementation intentionally stopped at:

- `books` as the first persisted IAM resource boundary;
- organization/book policy bindings, denials, role composition, ownership transfer, and audit events;
- local policy evaluation over the existing `org -> book` ancestry.

The current batch now implements the book product root described in BKH-A. The remaining work must add concrete descendant resources and their inheritance chain without changing the already implemented identity, scope, and Content IAM contracts.

## 2. Current State

Implemented today:

- `src/domain/books/book.entity.ts`
- `src/domain/books/book.repository.ts`
- `src/domain/books/book-create.workflow.ts`
- `src/application/books/*.usecase.ts`
- `src/http/routes/books.routes.ts`
- `src/infrastructure/repositories/drizzle-book-create.workflow.ts`
- `src/infrastructure/repositories/drizzle-book.repository.ts`
- `src/domain/iam/content-resource.ts`
- `src/domain/iam/content-policy.ts`
- `src/application/content-iam/*.usecase.ts`
- `src/http/routes/content-iam.routes.ts`

The currently implemented product hierarchy is:

```text
org -> book
```

The book table now backs product routes for creation (`POST /books`), list, read, and update. `orgId` is inferred from the actor token (same pattern as posts and categories). Book creation atomically seeds a direct owner binding and enforces `org.create_book`. The remaining gap is below the book root: there are still no chapter/section/block tables, no comment or bookmark tables, and no descendant list/read/update product workflows.

## 3. Target Model

The next batch should implement this resource hierarchy:

```text
org
  -> book
      -> chapter
          -> section
              -> block
                  -> inline_comment
          -> comment
      -> bookmark
      -> reading_progress
      -> media_attachment
```

Content IAM inheritance must work through `ContentResourceRef.ancestors`:

- a binding on `org:org_1` may grant bounded organization capabilities only inside `org_1`;
- a binding on `book:book_1` may grant ordinary content capabilities to descendants of that book;
- chapter/section/block-level denials apply to descendants only when `appliesToDescendants = true`;
- direct-share tokens can use only direct ordinary user bindings on loaded resources or descendants;
- policy mutations still require matching workspace context and `content:share`.

## 4. Architecture Decisions

Use one explicit resource pattern per collection:

- `src/domain/<resource>/<resource>.entity.ts`
- `src/domain/<resource>/<resource>.repository.ts`
- `src/application/<resource>/*.usecase.ts`
- `src/http/schemas/<resource>.schema.ts`
- `src/http/presenters/<resource>.presenter.ts`
- `src/http/routes/<resource>.routes.ts`
- `src/infrastructure/repositories/drizzle-<resource>.repository.ts`
- `src/infrastructure/repositories/mappers/<resource>.mapper.ts`

Do not put product-resource creation inside Content IAM use cases. Content IAM decides whether an actor has `org.create_book`, `chapter.create`, `comment.create`, or `media.attach`; resource use cases own the actual product rows.

Rejected for this batch:

- adding a network policy service;
- moving book/chapter permissions into `id`;
- creating wildcard/global Content IAM bindings;
- building generic `entries` abstractions instead of documented book resources.

## 5. Implementation Strategy

Sequence the work in small, reviewable slices:

1. Add book creation/list/read/update routes using `org.create_book`, `book.read`, and `book.update`.
2. Add chapters with `book -> chapter` ancestry and `chapter.create`, `chapter.read`, `chapter.update`, `chapter.publish`.
3. Add sections and blocks with deterministic ordering and parent integrity checks.
4. Add comments and inline comments after read access rules are stable.
5. Add bookmarks and reading progress as user-private state guarded by resource readability.
6. Add media attachments after chapter/section/block references exist.

Each slice must include D1 migration, repository, mapper, use cases, routes, OpenAPI schemas, and tests.

## 6. Detailed Implementation Plan

### 6.1 Resource Model

Implementation tasks:

- [ ] Add `chapters`, `sections`, `blocks`, `comments`, `inline_comments`, `bookmarks`, `reading_progress`, and `media_attachments` tables in `src/infrastructure/db/schema.ts`.
- [ ] Generate a new Drizzle migration under `drizzle/`.
- [ ] Add class-based entities following `docs/003_entity-classes-and-oxlint-arch-linting.md`.
- [ ] Add repositories and mappers for each table.
- [ ] Add resource loaders that return exact `ContentResourceRef` ancestry pairs, not independent `type IN (...)` and `id IN (...)` predicates.

Tests:

- `pnpm lint`
- `pnpm typecheck`
- D1-backed API tests for parent lookup and ancestry.

### 6.2 Content IAM Wiring

Implementation tasks:

- [x] Add book create use case requiring `content:write` and local `org.create_book`; `orgId` is derived from the actor token (same pattern as posts and categories), route is `POST /books`.
- [x] Add book read/update/list use cases using `ContentPolicy.can(...)` and `ContentPolicy.canMany(...)`.
- [ ] Add chapter/section/block mutations using inherited book or direct descendant permissions.
- [ ] Ensure direct-share actors cannot create books (no organization context in token) but can perform ordinary work inside a shared subtree when local policy allows it.
- [x] Keep Content IAM mutation routes separate from product resource routes.

Tests:

- organization author can create a book via `POST /books`;
- direct-share reader (no org context in token) cannot create a book;
- book editor can update descendants;
- explicit denial on a section overrides inherited book editor access.

### 6.3 Comments, Bookmarks, And Reading State

Implementation tasks:

- [ ] Gate comments and inline comments by readability of the target chapter/block plus `comment.create` or `inline_comment.create`.
- [ ] Add moderation routes using `comment.moderate`.
- [ ] Store bookmarks and reading progress as user-scoped rows keyed by `users.id = id.sub`.
- [ ] Prevent a user from reading or mutating another user's private reading state unless an explicit admin workflow is later designed.

Tests:

- reader can comment on a readable chapter;
- denial blocks comment creation;
- bookmark list is scoped to the actor subject;
- direct-share user can create ordinary comments only on shared resources.

### 6.4 Media Attachments

Implementation tasks:

- [ ] Add attachment rows linking media to book/chapter/section/block resources.
- [ ] Require `media.attach` on the target resource and normal media ownership/read rules.
- [ ] Preserve existing upload and variant serving behavior.

Tests:

- editor with `media.attach` can attach owned media;
- reader cannot attach media;
- attached private media is readable through target resource access.

## 7. Edge Cases And Failure Modes

- Parent deleted or archived: descendant mutation must reject or follow the documented archive cascade.
- Resource moves between parents: recompute ancestry and reject cross-organization moves.
- Duplicate ordering keys: use deterministic conflict handling and idempotent create tests.
- Expired binding regrant: existing Content IAM cleanup behavior must continue to permit regrant.
- Denial on ancestor: applies only to descendants when the denial row says so.
- Direct-share token with `content:share`: authentication rejects it before resource logic.

## 8. Implementation Backlog

### BKH-A. Book Product Routes

Tasks:

- [x] Add `src/application/books/create-book.usecase.ts`.
- [x] Add book list/read/update routes.
- [x] Seed owner binding atomically with book create.

Acceptance criteria:

- Organization author can create a private draft book.
- Created book has exactly one direct `system:book.owner` binding.

### BKH-B. Chapter And Section Hierarchy

Tasks:

- [ ] Add chapter and section entities, repositories, mappers, routes, and migrations.
- [ ] Add ancestry loaders for `book -> chapter -> section`.

Acceptance criteria:

- Inherited book permissions authorize chapter and section operations.
- Wrong organization ancestry cannot be constructed.

### BKH-C. Blocks And Inline Comments

Tasks:

- [ ] Add ordered block persistence.
- [ ] Add inline comment anchors to a block and range.

Acceptance criteria:

- Block updates require `section.update`.
- Inline comments require `inline_comment.create`.

### BKH-D. Reading Features

Tasks:

- [ ] Add comments, bookmarks, and reading progress.
- [ ] Gate all read-state APIs by actor subject and target readability.

Acceptance criteria:

- Users cannot enumerate or mutate another user's private reading state.

## 9. Test And Verification Plan

Run after every slice:

```bash
pnpm lint
pnpm check:dup
pnpm typecheck
pnpm test
pnpm advise
```

Add API tests for:

- route-level OAuth scopes;
- direct-share ordinary access;
- workspace/team inheritance;
- denial precedence;
- `ContentPolicy.canMany(...)` list filtering;
- idempotency across concrete resource paths;
- archived/deleted parent edge cases.

## 10. Definition Of Done

- The documented hierarchy resources exist as domain entities, repositories, mappers, routes, schemas, presenters, and tests.
- Book creation (`POST /books`) is wired to `org.create_book`, infers `orgId` from the actor token, and creates an owner binding atomically.
- Chapter/section/block/comment/bookmark/read-progress routes use local Content IAM decisions and do not query `id` on hot paths.
- Direct-share behavior matches docs 006, 007, and auth docs 010.
- README and docs 007 are updated from "substrate only" to the implemented product-resource coverage.

## 11. Final Model

The current batch delivers the Content IAM substrate and the BKH-A book product root. The remaining work turns that root into the full collaborative hierarchy without weakening the `id` boundary or introducing platform-global policy shortcuts.

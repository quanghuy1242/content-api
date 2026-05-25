# EPUB Import Pipeline

> Status: implementation-grade proposal — review amendments applied (depends on docs/015)
>
> Date: 2026-05-25
>
> Scope:
>
> - `/home/quanghuy1242/pjs/content-api`
> - `/home/quanghuy1242/pjs/content-api/workers/epub-processor/` — new Worker sibling to `workers/media-processor/`
>
> Source docs:
>
> - `docs/architecture.md` — §14 media pipeline pattern reused for archive upload; §19 queue contract; §22 import boundaries
> - `docs/002_media-upload-flow.md`
> - `docs/007_content-iam-policy-binding-model.md`
> - `docs/012_content-lifecycle-plugin.md`
> - `docs/015_book-content-model.md` — required prerequisite; consumes the chapter table, Lexical schema, `chapter-link`/`broken-link` nodes, and `book.origin` model from here
> - `docs/016_book-interactions.md` — affected by replace-existing-book (comment/reading-state loss)
> - `docs/payloadcms-schema-spec.md` — old book/chapter import metadata being dropped
> - `docs/payloadcms-access-control-policy-spec.md`
> - `.claude/skills/content-api-architecture/SKILL.md`
> - `.claude/skills/content-iam-usage/SKILL.md`
> - `/home/quanghuy1242/pjs/payloadcms/src/utils/epubPipeline.ts` — old browser pipeline; reference only
> - `/home/quanghuy1242/pjs/payloadcms/src/utils/epubImport.ts` — old browser helpers; reference only
> - `/home/quanghuy1242/pjs/payloadcms/src/utils/epubLexical.ts` — old HTML→Lexical conversion; rules are reusable, the browser DOM dependency is not
> - `/home/quanghuy1242/pjs/payloadcms/docs/internal-link-impl-plan.md` — link-resolution problem definition; this doc replaces the solution
> - `src/infrastructure/db/schema.ts`
> - `src/infrastructure/storage/r2-object-storage.ts`
> - `workers/media-processor/src/index.ts` — pattern reference; the EPUB processor follows the same shape
>
> Related docs:
>
> - `docs/014_audit-service-stub.md`
> - `docs/015_book-content-model.md`
> - `docs/016_book-interactions.md`
> - `docs/018_review-batch-015-017.md` — review findings and amendment rationale
> - `docs/009_book-resource-hierarchy-and-collaboration-plan.md` — **ABANDONED**; this doc absorbs the EPUB import scope
>
> Assumptions:
>
> - The book content model (docs/015) is implemented before this doc lands. In particular: recursive chapters, the Lexical schema with `chapter-link`/`broken-link`/`image`/`broken-image` nodes, `media_attachments`, `book.origin`, derived-count dispatch, the `book.import` permission, and the lifecycle-CAS guarded `/replace` archive workflow.
> - The new EPUB worker is a sibling Cloudflare Worker under `workers/epub-processor/`. It shares D1, R2, Images, and Queues with the API Worker. It does not import API application/domain/infrastructure modules wholesale; reusable validation and media constants required by both deployment units are promoted to `src/shared/**`, while import execution adapters live inside the worker.
> - Cloudflare Workers Queues, R2, R2 object-create event notifications, and `DecompressionStream` are available. The EPUB streaming parse uses `DecompressionStream("deflate-raw")` to inflate ZIP entries; `epubjs` is **not** used (it depends on browser globals).
> - Browsers upload the `.epub` archive to R2 via the same presigned PUT URL pattern as media uploads (architecture §14). The Worker does not see the archive bytes through the HTTP request.
> - HTML→Lexical conversion runs in the Worker using a pure-JS HTML parser (`htmlparser2`). The conversion logic mirrors `epubLexical.ts` but operates on `htmlparser2` token streams instead of DOM nodes.
> - The Worker has a 30-second CPU budget per invocation by default. Long imports are split across many short Queue messages, each processing a small bounded amount of work. See §4.7.
> - The R2 archive object is deleted after a successful import. On failure, it is retained for operator inspection for 30 days, then GC'd by a scheduled cleanup.
> - There is no first-release UI for the import. The MVP exposes the API surface, and the platform client (later) builds a progress UI on top.

## Table Of Contents

- [1. Goal](#1-goal)
- [2. System Summary](#2-system-summary)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 Relevant Files](#31-relevant-files)
  - [3.2 Current Behavior In PayloadCMS](#32-current-behavior-in-payloadcms)
  - [3.3 What Is Carried Over And What Is Dropped](#33-what-is-carried-over-and-what-is-dropped)
- [4. Target Model](#4-target-model)
  - [4.1 End-To-End Flow](#41-end-to-end-flow)
  - [4.2 book_imports And book_import_items Tables](#42-book_imports-and-book_import_items-tables)
  - [4.3 R2 Layout And Upload Contract](#43-r2-layout-and-upload-contract)
  - [4.4 Queue Contract](#44-queue-contract)
  - [4.5 EPUB Streaming Parse](#45-epub-streaming-parse)
  - [4.6 HTML To Lexical Conversion](#46-html-to-lexical-conversion)
  - [4.7 Two-Pass Walk And Chapter Creation](#47-two-pass-walk-and-chapter-creation)
  - [4.8 Image Extraction And Media Reuse](#48-image-extraction-and-media-reuse)
  - [4.9 Resume And Cancel](#49-resume-and-cancel)
  - [4.10 Content IAM Wiring](#410-content-iam-wiring)
  - [4.11 HTTP API Surface](#411-http-api-surface)
- [5. Architecture Decisions](#5-architecture-decisions)
  - [5.1 Server-Side Streaming Parse, Not Browser](#51-server-side-streaming-parse-not-browser)
  - [5.2 Separate Worker Under workers/epub-processor/](#52-separate-worker-under-workersepub-processor)
  - [5.3 Resolve Links At Import Time, Not Read Time](#53-resolve-links-at-import-time-not-read-time)
  - [5.4 book_imports Is The Operational Source Of Truth](#54-book_imports-is-the-operational-source-of-truth)
  - [5.5 Queue Step Function, Not One Big Worker Run](#55-queue-step-function-not-one-big-worker-run)
  - [5.6 Reuse Existing Media Pipeline](#56-reuse-existing-media-pipeline)
  - [5.7 No Resume Of A Crashed Import](#57-no-resume-of-a-crashed-import)
  - [5.8 Rejected Or Deferred Options](#58-rejected-or-deferred-options)
- [6. Implementation Strategy](#6-implementation-strategy)
- [7. Detailed Implementation Plan](#7-detailed-implementation-plan)
  - [7.1 book_imports And book_import_items Schema And Repository](#71-book_imports-and-book_import_items-schema-and-repository)
  - [7.2 Start-Import HTTP Surface](#72-start-import-http-surface)
  - [7.3 R2 Event Wiring](#73-r2-event-wiring)
  - [7.4 Worker Skeleton](#74-worker-skeleton)
  - [7.5 EPUB Container And OPF Parsing](#75-epub-container-and-opf-parsing)
  - [7.6 Spine Walk And Chapter Skeleton Insert](#76-spine-walk-and-chapter-skeleton-insert)
  - [7.7 HTML To Lexical Conversion And Link Resolution](#77-html-to-lexical-conversion-and-link-resolution)
  - [7.8 Image Extraction Workflow](#78-image-extraction-workflow)
  - [7.9 Cancel / Retry / Cleanup](#79-cancel--retry--cleanup)
  - [7.10 Composition And Wiring](#710-composition-and-wiring)
- [8. Migration And Rollout](#8-migration-and-rollout)
- [9. Edge Cases And Failure Modes](#9-edge-cases-and-failure-modes)
- [10. Implementation Backlog](#10-implementation-backlog)
  - [EPI-A. book_imports And book_import_items Schema And Repository](#epi-a-book_imports-and-book_import_items-schema-and-repository)
  - [EPI-B. Start-Import HTTP And Presigned URL](#epi-b-start-import-http-and-presigned-url)
  - [EPI-C. EPUB Processor Worker Skeleton](#epi-c-epub-processor-worker-skeleton)
  - [EPI-D. Streaming ZIP And EPUB Container Parser](#epi-d-streaming-zip-and-epub-container-parser)
  - [EPI-E. Spine Walk And Chapter Skeleton Insert](#epi-e-spine-walk-and-chapter-skeleton-insert)
  - [EPI-F. HTML To Lexical Conversion And Link Resolution](#epi-f-html-to-lexical-conversion-and-link-resolution)
  - [EPI-G. Image Extraction Workflow](#epi-g-image-extraction-workflow)
  - [EPI-H. Cancel Retry And Cleanup](#epi-h-cancel-retry-and-cleanup)
  - [EPI-I. Wire /replace To Import](#epi-i-wire-replace-to-import)
- [11. Future Backlog](#11-future-backlog)
- [12. Test And Verification Plan](#12-test-and-verification-plan)
- [13. Definition Of Done](#13-definition-of-done)
- [14. Final Model](#14-final-model)

## 1. Goal

Replace the old browser-side EPUB pipeline with a Cloudflare Worker that runs on a streamed copy of the `.epub` in R2. The browser uploads the archive, an R2 event kicks off a queue, and the worker walks the archive in small bounded steps, creating chapters, attaching media, and resolving cross-chapter links through an import-specific execution path that shares the platform's validation contracts.

The product framing from previous discussion: the platform is the canonical home for books. Import is a side-loader. Imports produce books that look identical to platform-authored books and that, on first edit, get promoted to platform-native (docs/015 §4.5). Re-importing into an already-edited book is rejected; replacing is an explicit destructive workflow (docs/015 §4.6) that this doc wires up at the end.

Concrete outcomes:

- A workspace user with `org.import_book` can upload an `.epub` for a new book and get back an `importId`; `book.import` is used for replacement/import operations against an existing book. The worker creates chapters and media references asynchronously. Progress is observable via `GET /book-imports/{importId}`.
- Internal EPUB hrefs (`../Text/chapter02.xhtml#s3`) are resolved into `chapter-link { chapterId, anchor? }` Lexical nodes during import. Unresolvable links become `broken-link`. No raw EPUB href is persisted past the import.
- Embedded images are uploaded to R2 as media originals; the existing media-processor (docs/002) generates derivatives. Each image reference in chapter content is a `media_attachments` row.
- The `POST /books/{bookId}/replace` workflow from docs/015 §4.6 enqueues an import targeting the new book id.

Non-goals:

- A general document-import framework. Other formats (PDF, DOCX) are separate docs.
- Real-time progress streaming (SSE / Durable Object channel). The MVP is poll-based.
- Resumption of a crashed import mid-run. The first release fails the import, and the user can `/replace` to retry. See §5.7.
- Browser-side parsing. Removed entirely.

## 2. System Summary

```text
client
  -> POST /book-imports { archiveContentLength, replaceBookId? }
        responds with { importId, uploadUrl, expiresAt, archiveObjectKey }
        creates book_imports row in status "pending-upload"
        (replaceBookId is set when invoked via /books/{bookId}/replace)

client PUT (archive bytes) -> uploadUrl   (R2 presigned URL, no Worker hop)

R2 object-create event
  -> queue: epub-processing
  -> workers/epub-processor/ Worker

  step 1: parse-container
    open archive (Range reads + DecompressionStream)
    find OPF; extract metadata + spine + manifest
    write parsed metadata to book row (or create the book if replace flow)
    write immutable manifest + normalized spine item rows
    enqueue step 2 per chapter spine item

  step 2: chapter-skeleton (one message per spine item)
    insert chapters row with empty contentJson + transient spineHref
    record per-chapter import item mappings
    enqueue step 3 per chapter

  step 3: chapter-content (one message per chapter)
    fetch chapter XHTML from archive
    parse HTML, extract images
    upload images to R2 (media originals), wait for media-processor to write derivatives is NOT required;
      chapter references use mediaId immediately
    convert HTML to Lexical state
    rewrite chapter-link nodes using completed item mappings
    write chapter through import-specific workflow, including media_attachments

  step 4: finalize
    when all chapters complete, mark book_imports completed
    delete the archive R2 object
    leave the already-created book lifecycle status as "draft"; docs/012 owns subsequent lifecycle transitions
    enqueue one derived-count rollup for docs/015 metrics

GET /book-imports/{importId} -> { status, completedChapters, totalChapters, ... }
  (progress is calculated from book_import_items)
```

## 3. Current-State Findings

### 3.1 Relevant Files

- [`/home/quanghuy1242/pjs/payloadcms/src/utils/epubPipeline.ts`](../../payloadcms/src/utils/epubPipeline.ts) — 1556 LOC browser pipeline. Iterates spine, sanitizes HTML, uploads images, batches chapters, manages retries. Marked "BROWSER-ONLY MODULE" at the top.
- [`/home/quanghuy1242/pjs/payloadcms/src/utils/epubImport.ts`](../../payloadcms/src/utils/epubImport.ts) — 951 LOC helpers (HTML sanitization, TOC resolution, asset paths, hash/filename utilities).
- [`/home/quanghuy1242/pjs/payloadcms/src/utils/epubLexical.ts`](../../payloadcms/src/utils/epubLexical.ts) — 1117 LOC HTML-to-Lexical conversion. The author marked it "runtime-agnostic" but it still uses `DOMParser` constructor. The transformation rules (block grouping, footnote extraction, heading normalization, callout detection) are runtime-agnostic; the I/O is not.
- [`/home/quanghuy1242/pjs/payloadcms/docs/internal-link-impl-plan.md`](../../payloadcms/docs/internal-link-impl-plan.md) — the source of the link-resolution model we are replacing.
- [src/infrastructure/storage/r2-object-storage.ts](../src/infrastructure/storage/r2-object-storage.ts) — existing R2 wrapper. Supports `get/put/head/delete`. Range reads are exposed via R2's `get(key, { range })` API which the wrapper extends.
- [workers/media-processor/src/index.ts](../workers/media-processor/src/index.ts) — pattern reference for the new Worker.
- [src/config/env.ts](../src/config/env.ts) — env validation; gets new entries for archive upload (`MAX_EPUB_ARCHIVE_BYTES`, `EPUB_ARCHIVE_UPLOAD_URL_TTL_SECONDS`).

### 3.2 Current Behavior In PayloadCMS

The old pipeline runs entirely in the user's browser tab:

1. User picks an `.epub` file.
2. Browser opens the archive with `epubjs`, reads metadata, walks the spine.
3. For each chapter:
   - sanitizes HTML;
   - uploads images via REST (`POST /api/media`);
   - converts HTML to Lexical;
   - posts the chapter (`POST /api/chapters`) with `chapterSourceKey`, `chapterSourceHash`, `importBatchId`.
4. Final patch on the book sets `importStatus: "ready"`, `chapterCount`, etc.

Cross-chapter links become an `epub-internal-link` Lexical node storing the raw EPUB href; resolution is deferred to read-time on the frontend.

Re-import behavior: a `chapterSourceKey + sourceHash + importBatchId` match resumes a partial import. A chapter with `manualEditedAt` is permanently skipped.

### 3.3 What Is Carried Over And What Is Dropped

Carried (with adjustments):

- **Spine = chapter mapping.** One spine item produces one or more chapter rows. The new system can split a spine item into a recursive chapter sub-tree when the TOC indicates (see §4.7); this is an upgrade over the old one-spine = one-chapter rule.
- **HTML sanitization rules.** Drop `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`. Restrict link protocols to `http:`, `https:`, `mailto:`, `tel:`. Block-tag set and div-normalization rules reused.
- **Footnote extraction.** The old `epub-footnote-ref`/`epub-footnote-def` feature is reproduced in the new Lexical schema (docs/015 §4.3) as `footnoteref` (inline) + `footnote` (block).
- **Callout extraction.** Reproduced as the `callout` block in docs/015.
- **Heading normalization** (collapse repeat heading levels, ensure each chapter has a sensible h1).
- **Image extraction** (`<img>` and SVG `<image>` tags), MIME allowlist, alt-text derivation, stable filename hashing.

Dropped:

- Browser dependency on `epubjs`, `DOMParser`, `URL.createObjectURL`, `canvas`.
- `chapterSourceKey`, `chapterSourceHash`, `manualEditedAt`, `importBatchId` columns on `chapters`. Replaced by `book_imports` rows + a transient spineHref index that exists only while the import is running (see §4.7).
- The `epub-internal-link` Lexical node. Replaced by `chapter-link` + `broken-link` (docs/015 §4.3).
- Re-import-in-place. Replaced by `POST /books/{bookId}/replace` (docs/015 §4.6).
- `chapterSourceHash` / `lastImportedAt` / `importErrorSummary` / `importFailureLog` on the book row. Equivalent fields live on `book_imports`.

## 4. Target Model

### 4.1 End-To-End Flow

```text
1. Client requests an import slot:
   POST /book-imports { archiveContentLength, replaceBookId? }
   -> new-book mode requires content:write + org.import_book on the workspace organization
   -> replace mode is initiated through /books/{bookId}/replace and requires
      book.update + book.import + book.archive (docs/015)
   -> replacement starts only if docs/015 atomically archives the loaded
      predecessor under its expected lifecycle status/version guards;
      stale predecessor state returns 409 before an import row is created
   -> creates book_imports row, status = "pending-upload"
   -> generates archiveObjectKey = "book-imports/{importId}/archive.epub"
   -> returns presigned PUT URL (TTL = 15 minutes by default)

2. Client uploads archive bytes to R2 (out-of-band, no Worker traffic).

3. R2 emits an object-created event for prefix "book-imports/" and suffix
   "/archive.epub" to the "epub-processing" queue.

4. Worker step 1 (parse-container):
   - look up book_imports row by archiveObjectKey
   - if status != "pending-upload", ack and skip
   - update status = "parsing"
   - Range-read the archive's End-Of-Central-Directory record, then the
     central directory, then META-INF/container.xml, then the OPF
   - extract metadata (title, language, isbn, subjects, publication date,
     publisher), spine, manifest
   - if importMode == "new-book":
       create the book with origin = "imported", status = "draft"
   - if importMode == "replace":
       (the book has already been created by /books/{bookId}/replace; just
       update metadata fields from the OPF where they are still defaulted)
   - write an immutable parsed manifest/index object to R2 at
       book-imports/{importId}/manifest.json
   - insert one book_import_items row per spine item with a stable item key
   - enqueue one "chapter-skeleton" message per spine item
   - update status = "processing-skeletons"

5. Worker step 2 (chapter-skeleton, per spine):
   - load the immutable manifest and its own book_import_items row
   - read the spine item from R2 (HTML/XHTML body, Range-read by its central-dir entry)
   - extract chapter title heuristically (first h1 / h2; fallback to TOC title)
   - decide whether to split this spine item into a recursive sub-tree:
       if TOC nests below this spine item with header IDs that exist in
       the HTML, split by heading; otherwise produce one chapter row.
   - for each chapter slot produced, insert a chapters row with:
       contentJson = empty paragraph
       parent chapter pointer determined by TOC nesting (top of spine =
         direct child of book; deeper TOC entries = children of higher
         chapter slot from the same spine item)
   - insert child chapter-item rows keyed by source fragment/heading and
     record each produced chapter id on its own row
   - mark this item completed idempotently; when all skeleton items are complete,
     status = "processing-content" and enqueue one chapter-content message
     per produced chapter

6. Worker step 3 (chapter-content, per chapter):
   - load the chapter item containing the chapter id, spineHref and heading range
   - re-Range-read the same XHTML body (the central-dir entry is cached
     on the book_imports row to avoid a second container parse)
   - extract the HTML subtree for this chapter (the whole spine item, or
     a heading-bounded range)
   - sanitize HTML
   - extract images:
       for each <img>/SVG <image>:
         resolve the asset path against the spineHref
         look up content-type from the manifest
         skip if not in MIME allowlist
         compute stable hash; check media by sourceHash (see §4.8)
         if not present: create a pending media row + upload the asset
           bytes via the existing media upload code path (Range-read the
           asset from R2 -> PUT to media R2 key)
         rewrite the <img>/<image> to data-lexical-upload-id = mediaId
   - convert HTML to Lexical using the htmlparser2-based converter
   - rewrite link nodes:
       for each <a href="..."> that targets a chapter inside the book:
         resolve href against completed book_import_items rows
         emit { type: "chapter-link", chapterId, anchor? }
       unresolvable cross-spine references => { type: "broken-link" }
       external links (http/https/mailto/tel) => { type: "link" }
   - call the import-specific chapter-content workflow as the importer
     service account; it runs the shared chapter/Lexical/media validation,
     writes media_attachments atomically and verifies this active import owns
     the target chapter
   - mark this content item complete idempotently
   - if all chapters done, enqueue "finalize"

7. Worker step 4 (finalize):
   - delete the archive R2 object
   - delete the manifest object (or retain it for 7 days for debugging,
     configurable; default delete)
   - enqueue one book derived-count rollup through docs/015 §4.9
   - status = "completed", finished_at = now
```

The whole pipeline is queue-driven. There is no single long-running Worker invocation.

### 4.2 book_imports And book_import_items Tables

```ts
export const bookImports = sqliteTable("book_imports", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  bookId: text("book_id"),            // null until step 1 creates it (new-book flow);
                                      // set immediately for replace flow
  importMode: text("import_mode").notNull(),    // "new-book" | "replace"
  replacedBookId: text("replaced_book_id"),     // for replace flow, the archived prior book
  initiatedByUserId: text("initiated_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  source: text("source").notNull().default("epub"),
  archiveObjectKey: text("archive_object_key").notNull(),
  archiveContentLength: integer("archive_content_length").notNull(),
  archiveSourceHash: text("archive_source_hash"),    // populated by worker after archive read
  archiveUploadExpiresAt: integer("archive_upload_expires_at", { mode: "timestamp_ms" }).notNull(),
  status: text("status").notNull().default("pending-upload"),
  // status enum:
  //   pending-upload | parsing | processing-skeletons | processing-content |
  //   finalizing | completed | failed | cancelled | upload-expired
  totalSpineItems: integer("total_spine_items"),
  totalChapters: integer("total_chapters"),
  manifestObjectKey: text("manifest_object_key"), // immutable parsed index in R2 during processing
  errorSummary: text("error_summary"),
  errorLogObjectKey: text("error_log_object_key"),  // R2 key for the verbose log
  rationale: text("rationale"),       // free-form, from the start-import call
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  cancelRequestedAt: integer("cancel_requested_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
  uniqueIndex("book_imports_archive_object_key_unique_idx").on(table.archiveObjectKey),
  index("book_imports_book_idx").on(table.bookId, table.createdAt),
  index("book_imports_status_expiry_idx").on(table.status, table.archiveUploadExpiresAt),
  index("book_imports_initiator_idx").on(table.initiatedByUserId, table.createdAt),
]);

export const bookImportItems = sqliteTable("book_import_items", {
  id: text("id").primaryKey(),
  importId: text("import_id").notNull().references(() => bookImports.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),                    // "spine" | "chapter" | "image"
  itemKey: text("item_key").notNull(),             // stable spine/fragment/asset key
  parentItemId: text("parent_item_id"),
  chapterId: text("chapter_id").references(() => chapters.id, { onDelete: "set null" }),
  status: text("status").notNull().default("pending"), // pending | processing | completed | failed
  detailJson: text("detail_json", { mode: "json" }),   // bounded per-item resolution metadata
  errorSummary: text("error_summary"),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
  uniqueIndex("book_import_items_import_key_unique_idx").on(table.importId, table.kind, table.itemKey),
  index("book_import_items_import_status_idx").on(table.importId, table.kind, table.status),
]);
```

Rationale for column choices:

- `manifestObjectKey` points to an immutable parsed manifest/index object needed for link resolution only during processing. It is not mutated by parallel jobs and is removed or expired after completion.
- `book_import_items` records per-spine, per-chapter and per-image state. Queue handlers claim and complete only their own item rows; progress is computed from item rows rather than concurrent increments or mutation of one shared JSON blob.
- `errorLogObjectKey` keeps verbose worker logs out of D1. The summary is short.
- `archiveSourceHash` lets a future enhancement dedup repeated imports of the same file (the user uploaded the exact same archive twice); for the first release it is recorded but not used for dedup.
- The cancel mechanism is cooperative: step messages check `cancel_requested_at` before doing significant work and abort the import when set.

### 4.3 R2 Layout And Upload Contract

Archive object keys:

```text
book-imports/{importId}/archive.epub
```

Constraints:

- `archive_content_length` ≤ `MAX_EPUB_ARCHIVE_BYTES` (default 100 MiB; configurable via env). Larger archives are rejected at the start-import call.
- Expanded archive bytes across all entries ≤ `MAX_EPUB_EXPANDED_BYTES`; any single expanded entry ≤ `MAX_EPUB_ENTRY_BYTES`.
- Central-directory entries, generated chapters and imported images are bounded by `MAX_EPUB_ENTRIES`, `MAX_IMPORT_CHAPTERS` and `MAX_IMPORT_IMAGES`.
- Entry paths are normalized and rejected if absolute, contain `..` traversal, contain NUL bytes, or resolve outside the archive namespace.
- Reject entries whose compressed-to-expanded ratio exceeds `MAX_EPUB_COMPRESSION_RATIO`, and bound XML/XHTML token/node depth and text sizes before Lexical conversion.
- `Content-Type` for the presigned PUT URL is fixed at `application/epub+zip`.
- Upload TTL: 15 minutes (env-configurable). Expired pending-upload rows are GC'd by a scheduled worker step (§4.9).

R2 event notification:

```bash
wrangler r2 bucket notification create content-api-media \
  --event-type object-create \
  --queue epub-processing \
  --prefix "book-imports/" \
  --suffix "/archive.epub"
```

This shares the existing `content-api-media` bucket. A separate bucket is rejected to keep operations simple; the prefix isolation is sufficient.

### 4.4 Queue Contract

Two queues:

- `epub-processing` — receives R2 object-create events for the archive upload.
- `epub-step` — internal step queue the worker uses to schedule chapter-skeleton, chapter-content, finalize, and cancel-cleanup messages.

Step message schema (versioned, validated with Zod in [`workers/epub-processor/src/queue-message.schema.ts`](../workers/epub-processor/src/queue-message.schema.ts)):

```ts
type EpubStepMessage =
  | { type: "parse-container"; v: 1; importId: string }
  | { type: "chapter-skeleton"; v: 1; importId: string; spineIndex: number }
  | { type: "chapter-content"; v: 1; importId: string; chapterId: string }
  | { type: "finalize"; v: 1; importId: string }
  | { type: "cancel-cleanup"; v: 1; importId: string };
```

Messages include `importId` to allow status compare-and-set updates and to support cooperative cancel.

Idempotency: every step handler claims its `book_import_items` row using compare-and-set and writes completion back to that row. Duplicate messages see `completed` and acknowledge without repeating content writes. Chapter content completion is keyed by `(importId, chapter item)` rather than treating an ordinary chapter version as an import idempotency token.

Retry/DLQ: queue configured with `max_retries = 3` and a dead-letter queue `epub-processing-dlq`. After three retries, the step handler writes the failure to `book_imports.errorLogObjectKey` and updates status to `failed`.

### 4.5 EPUB Streaming Parse

EPUB is a ZIP archive with a fixed structure:

```text
mimetype                      (uncompressed; "application/epub+zip")
META-INF/container.xml        (points to the OPF file)
OEBPS/content.opf             (or another path; the OPF)
OEBPS/Text/*.xhtml            (spine items)
OEBPS/Images/*.{jpg,png,...}  (media assets)
OEBPS/Styles/*.css            (ignored)
toc.ncx or nav.xhtml          (TOC; format depends on EPUB version)
```

Streaming-parse strategy:

1. Read the End-Of-Central-Directory record at the end of the file (`R2.head(key)` to get content length, then `R2.get(key, { range: [length - 65557, length - 1] })` covers the maximum EOCD size with comment).
2. Walk the central directory to build a name → `(localHeaderOffset, compressedSize, compressionMethod, crc32)` map. Write it once into the immutable R2 manifest referenced by `book_imports.manifestObjectKey` so step 2 and step 3 do not re-read the central directory.
3. To read a single entry, Range-read its local header + data; decompress with `DecompressionStream("deflate-raw")` for deflate (compression method 8) or pass through for stored (method 0). Reject other compression methods.
4. Parse `META-INF/container.xml` with a tiny XML reader to find `rootfile.full-path` (the OPF path).
5. Parse the OPF with the same XML reader. Extract `<metadata>` (title, language, etc.), `<manifest>` (id → href + media-type), `<spine>` (ordered list of manifest item refs). Also extract the TOC reference (nav or NCX).
6. Parse the TOC. Recursive `navPoint` (NCX) or `<li><a href>` (nav) structure produces a tree of `{ href, title, children }`.

Implementation lives in [`workers/epub-processor/src/epub-archive.ts`](../workers/epub-processor/src/epub-archive.ts). The XML parser is a tiny purpose-built one (`workers/epub-processor/src/xml.ts`); using a heavyweight library here is rejected because EPUB metadata XML is well-formed and small.

### 4.6 HTML To Lexical Conversion

Conversion runs inside the chapter-content step. It produces a `contentJson` that conforms to docs/015 §4.3.

Implementation lives in [`workers/epub-processor/src/html-to-lexical.ts`](../workers/epub-processor/src/html-to-lexical.ts). Uses `htmlparser2` as the parser (pure JS, no DOM, runs in Workers). The conversion is a depth-first walk over the parser token stream:

- Top-level block tags (`<p>`, `<h1..h6>`, `<blockquote>`, `<ul>`, `<ol>`, `<li>`, `<pre>`, `<hr>`, `<figure>`) produce block nodes.
- Inline tags (`<strong>`, `<em>`, `<b>`, `<i>`, `<u>`, `<s>`, `<code>`, `<sub>`, `<sup>`, `<a>`) produce inline nodes with format bits.
- `<br>` produces `linebreak`.
- `<img>` and SVG `<image>` produce `image { mediaId }` (mediaId comes from the image extraction step §4.8).
- `<a href="...">`:
  - external (http/https/mailto/tel) → `link { url }`
  - relative EPUB href → resolve against completed `book_import_items` chapter mappings (next section)
  - `#fragment-only` → still emit as `link` with `url: "#" + fragment` for in-page navigation; renderer is responsible (the chapter page sets `id` attributes on headings from `blockId`).
- `<aside class="callout">` or aria-role `note` → `callout { tone }` (tone inferred from class name; defaults to `info`).
- Footnotes (any EPUB-flavored footnote markup) → `footnote` block + `footnoteref` inline. The footnote extraction algorithm copies the rules from the old `epubLexical.ts` `collectFootnoteDefinitions` / `convertHtmlToChapterLexicalState` flow.

Block IDs:

- The converter assigns `blockId = crypto.randomUUID().slice(0, 8)` to every block as it produces them. These IDs are durable across edits per docs/015 §4.3.
- For each `<h*>` whose id attribute existed in the HTML, store the mapping `(spineHref + "#" + originalId) → blockId` on that chapter item's bounded `detailJson`. This is used by link resolution to set `anchor`; jobs never update shared index JSON.

Sanitization rules (carried over from the old browser code, runtime-agnostic):

- Drop `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, `<input>`, `<button>`.
- Strip event handler attributes (`on*`).
- Strip `style` attributes (the editor controls styling).
- Normalize whitespace and collapse `<div>` wrappers that are not list items, table cells, or callouts.
- Reject `javascript:` and `data:` link protocols.

Conversion errors:

- Malformed HTML inside a spine item produces a `broken-link` node where the bad inline element was; the rest of the chapter still converts. The error is logged to the import's error-log R2 object.
- A spine item whose conversion yields an empty document (all blocks empty after sanitization) becomes a chapter with one `paragraph` block carrying `"(Empty chapter)"` as fallback content.

### 4.7 Two-Pass Walk And Chapter Creation

Pass 1 — skeletons. For each spine item:

1. Read the XHTML body.
2. Decide whether to split this spine item into a recursive chapter tree:
   - Inspect the TOC for entries whose href starts with this spine item's href + `#anchor`.
   - If two or more such entries exist and their fragment IDs exist as element IDs in the HTML body, split the spine item along those boundaries.
   - Otherwise produce one chapter row for the whole spine item.
3. For each chapter slot produced, decide a depth and parent:
   - Top-level spine entry → parent is the book (depth 1).
   - TOC-derived sub-chapter → parent is the preceding chapter slot from the same spine item at one shallower depth.
   - Cap depth at `MAX_CHAPTER_DEPTH` (docs/015 §4.2). Entries deeper than the cap are collapsed into the deepest allowed parent (they become in-page anchors via blockId, not separate chapters).
4. Insert chapter rows with empty content through the import-specific chapter-create workflow. `createdByUserId` is the import initiator; importer execution identity is not represented as a fake user. The order index is monotonic per parent.

The decision in step 2 is the upgrade over the old one-spine = one-chapter rule. A typical Manning IT book has chapters like "Chapter 3" (one spine file) with TOC nesting "3.1", "3.2", "3.2.1". The new importer recognizes those and creates the recursive structure.

Pass 2 — content. Per chapter:

1. Re-read the spine item (or the substring between the chapter's heading IDs if it was split).
2. Extract images (§4.8) and convert HTML to Lexical (§4.6).
3. Resolve `<a>` cross-references using the immutable parsed manifest plus completed `book_import_items` chapter mappings:
   - Resolve target spine + fragment.
   - Look up the chapter id by `(spineHref, fragment)` in the chapter index.
   - If the fragment maps to a `blockId` in the target item detail, set `anchor = blockId`.
   - Emit `chapter-link { chapterId, anchor? }`.
   - Cross-spine references that target a spine item that produced no chapter → `broken-link`.
4. Call `WriteImportedChapterContentWorkflow.run({ actor: epubImporterServiceAccount, importId, chapterId, contentJson })`. The workflow verifies the active import owns the target book/chapter, reuses docs/015's Lexical/media validation and attachment write rules, and does not trigger imported-to-platform promotion.

### 4.8 Image Extraction And Media Reuse

For each image element in chapter HTML:

1. Resolve the asset path relative to the spine item's href (e.g., spine `OEBPS/Text/ch01.xhtml` + img `../Images/cover.png` → `OEBPS/Images/cover.png`).
2. Look up the asset in the OPF manifest by href to get its `media-type`.
3. Reject if the media type is not in `MEDIA_UPLOAD_ALLOWED_MIME_TYPES` (currently `image/png`, `image/jpeg`, `image/jpg`).
4. Compute the stable hash of the asset bytes (Range-read once into a buffer; SHA-256). Store the hash on the media row's metadata for dedup.
5. Look up an existing media row in the same org with the same hash. If found, reuse its `id` for the chapter reference; do not create a new media row.
6. If not found, create a media row through `CreateImportedMediaWorkflow`, which accepts the active importer execution and records the import initiator as media owner/creator; upload bytes to the media R2 key and let the existing `media-processor` Worker generate derivatives.
7. Replace the `<img>` element's `src` with a data-lexical attribute so the converter (§4.6) emits the `image { mediaId, alt, … }` node.
8. The chapter's `media_attachments` rows are written when `WriteImportedChapterContentWorkflow` runs (per docs/015 §4.4).

The worker does **not** wait for media-processor to finish. Renderers fall back to a placeholder until the variants are ready.

Owner of the created media: the import initiator's user ID. The import-specific workflow authorizes execution only for an active import and its target book rather than granting the importer broad media/content administration (see §4.10).

### 4.9 Resume And Cancel

Cancel:

- `POST /book-imports/{importId}/cancel` sets `cancel_requested_at = now`. Status becomes `cancelled` once the in-flight step finishes and observes the flag.
- Already-completed imports cannot be cancelled.
- Cancelled imports leave their partial state in place: chapters that were already created stay (the user may still want them). To fully roll back, the user calls `POST /books/{bookId}/replace` with a fresh archive or `DELETE /books/{id}`.

Retry:

- `POST /book-imports/{id}:retry` is **not** implemented in the first release. A failed import cannot be resumed; the user uploads a fresh archive via a new `POST /book-imports`.
- This is a deliberate choice. Building robust resume requires careful state machine semantics for "what does the partial state look like and how do we tell which steps need redoing". The first release accepts that a failed import is dead and the user must start over.

Cleanup:

- A scheduled cleanup runs every 15 minutes (using the existing cron worker or a new sibling). It performs:
  - Expire `pending-upload` rows whose `archive_upload_expires_at < now`: set status `upload-expired`, delete the archive R2 object if it exists.
  - Delete archive objects for `failed`/`cancelled`/`upload-expired` imports older than 30 days.
  - Delete immutable manifest objects from terminal imports older than 7 days (only the `errorLogObjectKey` is needed for diagnostics beyond that point).

### 4.10 Content IAM Wiring

Permissions consumed by this doc:

- `org.import_book` — **net-new ordinary permission** for starting a new-book import when no book resource exists yet. Add it to `system:org.content_admin`; tenant workspace roles may be granted it deliberately.
- `book.import` — book-scoped ordinary permission described in docs/015 §4.7; required for replacement/import operations against an existing book.
- `book.update` and `book.archive` — additionally required by `POST /books/{bookId}/replace` because replacement copies metadata and performs the docs/012 archive transition.

Importer execution actor:

- The worker authenticates as a `service_account` actor with `clientId = "epub-importer"` and the importing organization id. It is durable across long-running queue work; the initiating user's short-lived token is never replayed by a worker.
- Do **not** bind `system:org.content_admin` to this service account. That role grants IAM and ownership-management capabilities unrelated to import and is not assignable to a service account under the implemented administration policy.
- Import-specific workflows use an `ImportExecutionPolicy` guard: the actor must be the configured importer service account, `book_imports.id` must be active and match the actor organization, and every affected book/chapter/media operation must belong to that import target. This is the worker's narrowly bounded authorization path.
- `createdByUserId` on every chapter/media row is the import initiator's user id; execution identity remains the service account in import history and any future general audit.

Direct-share tokens cannot start an import: new-book import requires workspace organization context, and replacement remains a destructive owner/editor workflow rather than a read-share capability.

### 4.11 HTTP API Surface

- `POST   /book-imports` — start a new-book import.
  - Body: `{ archiveContentLength: number, rationale?: string }`.
  - Requires `org.import_book` on the actor's organization.
  - Creates the `book_imports` row; returns `{ importId, archiveObjectKey, uploadUrl, expiresAt }`.
  - The book is **not** created yet; step 1 of the worker creates it after the OPF is parsed.
  - `Idempotency-Key` required.

- `POST   /books/{bookId}/replace` — wired here. (Schema/use case defined in docs/015 §4.6.)
  - On success, creates a `book_imports` row with `importMode = "replace"`, `bookId = newBookId`, `replacedBookId = oldBookId`.
  - Returns `{ newBookId, importId, archiveObjectKey, uploadUrl, expiresAt }`.
  - Requires `book.update`, `book.import` and `book.archive` as specified by docs/015.
  - Returns `409` without creating the replacement import when docs/015's predecessor lifecycle/version CAS no longer matches.

- `GET    /book-imports/{importId}` — status + progress.
  - Requires `book.read` on the target book (or the initiator's own row if the book has not been created yet).
  - Returns status and counts calculated from `book_import_items`; never exposes `manifestObjectKey` or per-item internal parsing details.

- `GET    /books/{bookId}/imports` — list imports for a book.
  - Requires `book.read`.
  - Paginated.

- `POST   /book-imports/{importId}/cancel` — request cancellation.
  - Requires `book.import` on the target book (if any) or `org.import_book` for a new-book import owned by the initiator's organization.
  - Returns the updated row.

Route style follows the existing convention in [src/http/routes/books.routes.ts](../src/http/routes/books.routes.ts) (path-segment action names, not colon-prefixed sub-resources). Every mutation route gets a matching constant in [src/shared/constants.ts](../src/shared/constants.ts) (e.g. `BOOK_IMPORT_CANCEL_ROUTE = "POST /book-imports/{importId}/cancel"`) so idempotency snapshot keys stay consistent. All routes follow the existing OpenAPI + bearer + idempotency patterns.

## 5. Architecture Decisions

### 5.1 Server-Side Streaming Parse, Not Browser

Two prior models existed:

- **PayloadCMS browser pipeline.** The user's tab must stay open the entire time; quality of the result depends on browser state; client can spoof Lexical content; large books exceed browser memory and crash silently. Rejected.
- **Server-buffered parse.** Worker reads the whole archive into memory and parses. Rejected because Workers have a 128 MiB memory cap and a typical large EPUB (100 MiB+) plus parser intermediates would not fit. Even where it would fit, streaming is cheaper.

Chosen: streamed parse. The Worker Range-reads the ZIP central directory once, then Range-reads each spine item just-in-time. Memory footprint stays small (≤ a few MiB at a time).

### 5.2 Separate Worker Under workers/epub-processor/

Architecture rule from the skill: "new cron, queue, scheduled, or processor Workers go under `workers/<name>/`, never inside `src/`". The EPUB processor is a queue consumer with its own bindings and CI deploy target. Separating it from the main API Worker also keeps the API Worker's binary small (no XML parser, no `htmlparser2`, no large stream-decompression code).

### 5.3 Resolve Links At Import Time, Not Read Time

The PayloadCMS model stored raw EPUB hrefs in Lexical and resolved them at render time on the frontend against `chapterSourceKey`. Drawbacks documented in [`payloadcms/docs/internal-link-impl-plan.md`](../../payloadcms/docs/internal-link-impl-plan.md): frontend has to know the importer's key format; chapter renames silently break links; basename collisions force ambiguous fallback matching.

Chosen: resolve to `chapter-link { chapterId }` during pass 2 of the import (§4.7). The Lexical document persisted in D1 contains real chapter IDs. The renderer never parses any importer-specific string. Unresolvable links become `broken-link`, visible in the editor.

### 5.4 book_imports Is The Operational Source Of Truth

The PayloadCMS schema put import bookkeeping onto the book row itself (`importStatus`, `importTotalChapters`, `lastImportedAt`, `importErrorSummary`, `importFailureLog`, etc.) and onto every chapter (`chapterSourceKey`, `chapterSourceHash`, `importBatchId`, `manualEditedAt`). This conflates two lifecycles.

Chosen: a dedicated `book_imports` table plus normalized `book_import_items` rows that live next to `books`. Books are durable artifacts; imports are events with their own lifecycle. A book may have many `book_imports` rows over time (failed attempts, the successful one, retries via `/replace`). Chapter rows know nothing about import state, and parallel jobs never update one shared scratch document.

### 5.5 Queue Step Function, Not One Big Worker Run

Workers have a 30-second CPU budget per invocation by default. A 500-chapter book cannot finish in 30 seconds. Three patterns considered:

- **Long-running Durable Object.** Rejected — adds complexity, and the value (real-time progress channel) is not first-release.
- **One Worker invocation that streams through everything.** Rejected — fragile; one slow chapter aborts the whole import.
- **Queue step function.** Chosen. Each step processes one bounded unit (parse-container, one chapter skeleton, one chapter content). Failures retry per-step. Progress is observable by reading `book_imports` rows.

### 5.6 Reuse Existing Media Pipeline

Image extraction creates media rows through an import-specific media workflow and PUTs bytes to R2 through the existing object-storage adapter. The existing `media-processor` Worker picks up the R2 object-create event and generates derivatives. Derivative generation is reused; interactive user-owned media creation is not incorrectly reused for service-account import execution.

The importer does not wait for derivatives. Chapter content references `mediaId` immediately; the renderer falls back to the low-res placeholder if derivatives are not yet ready.

### 5.7 No Resume Of A Crashed Import

A robust resume implementation would need:

- A recovery algorithm that can decide which completed item rows may be retained and which content/media rows must be rebuilt after the root failure.
- User-visible retry semantics for partial books and for replacement flows whose predecessor is already archived.
- A UI for the user to see "this import is stuck on chapter X" and to push past it.

That is at least a separate doc's worth of complexity. The first release ships without it; a failed import marks `status = failed` and the user starts a fresh import (or invokes `/replace`). This is a deliberate first-release boundary; see §11 for the future resume design.

### 5.8 Rejected Or Deferred Options

- **SSE / Durable Object progress channel.** Useful for the eventual UI but not required for MVP. Polling `GET /book-imports/{importId}` is sufficient.
- **Multi-archive batch import.** Out of scope.
- **PDF / DOCX import.** Separate docs.
- **In-place re-import on a `platform`-origin book.** Rejected. `/replace` is the only path.
- **In-place re-import on an `imported`-origin book.** Considered. A user might want to re-upload a corrected EPUB before they have edited anything. Rejected for the first release because the `/replace` flow already covers this with one extra API call, and the in-place semantics would need to define how chapter rows that were already created are reconciled with the new spine. Defer to a future doc.
- **Cancel mid-step.** The cancel mechanism is between steps, not within. A step that has started uploading images for a 50-image chapter will finish that step before observing the cancel flag. Acceptable.
- **Server-side EPUB validation (EPUBCheck).** Rejected for the first release. The importer accepts whatever produces valid HTML and ignores the rest with logged warnings. Strict validation can be added later if user reports demand it.
- **One mutable `scratchIndexJson` document on `book_imports`.** Rejected after review: concurrent step jobs would overwrite each other's index/counter updates. Use an immutable manifest object plus normalized `book_import_items`.

## 6. Implementation Strategy

Phases:

1. `book_imports` + `book_import_items` tables, repositories and start-import HTTP surface. Returns presigned URLs; no Worker yet. Allows the client integration to be built and end-to-end-tested against a stubbed worker.
2. Worker skeleton + container parsing. Worker reads the archive, parses OPF, writes an immutable manifest object plus `book_import_items`, sets status `parsing → processing-skeletons`, enqueues per-spine messages but does no chapter work.
3. Chapter skeleton step. Worker creates chapter rows for the simple case (one spine = one chapter, no recursion). Sets status `processing-content`.
4. HTML→Lexical conversion (no images, no links). Worker fills chapter content.
5. Image extraction and media reuse. Import-specific media workflow creates initiator-owned media; the existing derivative processor remains reused.
6. Link resolution. Worker rewrites `<a>` cross-chapter references into `chapter-link`/`broken-link`.
7. Recursive chapter splitting (TOC-driven). The single-row-per-spine simple case becomes the fallback when TOC nesting cannot be matched.
8. Cancel + cleanup + scheduled GC.
9. Wire `POST /books/{bookId}/replace` (docs/015 §4.6) to enqueue an import via this pipeline.

Each phase is a separate PR. Up to phase 6 the importer produces working but plain content; phases 7+ are improvements.

## 7. Detailed Implementation Plan

### 7.1 book_imports And book_import_items Schema And Repository

Current problem:

- No tables for import lifecycle or concurrency-safe per-item execution state.

Target behavior:

- The `book_imports` and `book_import_items` tables from §4.2 plus repositories + workflow ports for atomic status and item-claim transitions.

Implementation tasks:

- [ ] Add the table to [src/infrastructure/db/schema.ts](../src/infrastructure/db/schema.ts).
- [ ] Add migration `drizzle/00NN_book_imports.sql` with both import tables and indexes.
- [ ] `src/domain/imports/book-import.entity.ts` — class entity covering root state transitions in §4.2 (`markUploaded`, `beginParse`, `recordSpineTotals`, `beginSkeletons`, `beginContent`, `markFinalized`, `markFailed`, `markCancelled`, `requestCancel`); per-step completion lives on `book_import_items`, not increment methods on the root row.
- [ ] `src/domain/imports/book-import.repository.ts`.
- [ ] `src/domain/imports/book-import-status.workflow.ts` — port for compare-and-set updates (so worker steps cannot accidentally race).
- [ ] `src/domain/imports/book-import-item.repository.ts` and item-claim/complete workflow — each queue message owns one idempotent item row.
- [ ] `src/infrastructure/repositories/drizzle-book-import.repository.ts`.
- [ ] `src/infrastructure/repositories/drizzle-book-import-status.workflow.ts`.
- [ ] `src/infrastructure/repositories/mappers/book-import.mapper.ts`.

Tests:

- `tests/book-imports.entity.test.ts` covers transitions + invalid transitions.
- `tests/book-imports.repo.test.ts` covers compare-and-set on status and duplicate/out-of-order item completion.

### 7.2 Start-Import HTTP Surface

Current problem:

- No way to start an import.

Target behavior:

- `POST /book-imports`, `GET /book-imports/{importId}`, `GET /books/{bookId}/imports`, `POST /book-imports/{importId}/cancel`.

Implementation tasks:

- [ ] `src/application/imports/start-book-import.usecase.ts` — generates importId, archiveObjectKey, presigns a PUT URL via the existing `R2PresignedUrlSigner`, writes the row.
- [ ] `src/application/imports/get-book-import.usecase.ts`.
- [ ] `src/application/imports/list-book-imports.usecase.ts`.
- [ ] `src/application/imports/cancel-book-import.usecase.ts`.
- [ ] `src/http/routes/book-imports.routes.ts`.
- [ ] `src/http/schemas/book-import.schema.ts`.
- [ ] `src/http/presenters/book-import.presenter.ts`.
- [ ] Wire into composition.

Acceptance criteria:

- Workspace user with `org.import_book` can request a new-book presigned URL; replacement authorization remains book-scoped.
- Direct-share token is rejected.
- Idempotency-Key replay returns the same upload URL until it has been used.

Tests:

- `tests/book-imports.routes.test.ts`.

### 7.3 R2 Event Wiring

Tasks:

- [ ] Update `wrangler.jsonc` (main API Worker) **only if** R2 event notifications are configured there; otherwise the notification creation is an operator task documented in [README.md](../README.md). Add the new queue + notification definitions to README's "Create remote resources" section.
- [ ] Create the queue: `wrangler queues create epub-processing`.
- [ ] Add the R2 notification rule (prefix `book-imports/`, suffix `/archive.epub`, queue `epub-processing`).
- [ ] Create the step queue: `wrangler queues create epub-step`.
- [ ] Create the DLQ: `wrangler queues create epub-processing-dlq`.

Acceptance criteria:

- `wrangler dev` against the new Worker can simulate object-create events via `wrangler queues send`.

### 7.4 Worker Skeleton

Current problem:

- No Worker exists for EPUB processing.

Target behavior:

- `workers/epub-processor/` exists, mirrors the shape of `workers/media-processor/`, and routes incoming queue messages to step handlers.

Implementation tasks:

- [ ] Create `workers/epub-processor/` with `wrangler.jsonc`, `tsconfig.json`, `src/`.
- [ ] `workers/epub-processor/src/config.ts` — Zod env parser (bindings DB, MEDIA_R2, IMAGES, EPUB_STEP_QUEUE, AUTH-related vars for the service-account actor authentication).
- [ ] `workers/epub-processor/src/index.ts` — Worker default export with `queue(batch, env, ctx)` handler that dispatches by `batch.queue` (epub-processing vs epub-step) and by message `type`.
- [ ] `workers/epub-processor/src/queue-message.schema.ts` — Zod schemas for `EpubStepMessage`.
- [ ] `workers/epub-processor/src/actor.ts` — constructs the `service_account` actor with `clientId = "epub-importer"` and the importing org's `orgId`.
- [ ] `workers/epub-processor/src/import-execution.ts` — allows that service account to mutate only active import-owned targets, without a broad organization-admin IAM binding.

The handler dispatches:

```ts
switch (msg.type) {
  case "parse-container":   await handleParseContainer(...); break;
  case "chapter-skeleton":  await handleChapterSkeleton(...); break;
  case "chapter-content":   await handleChapterContent(...); break;
  case "finalize":          await handleFinalize(...); break;
  case "cancel-cleanup":    await handleCancelCleanup(...); break;
}
```

Each handler:

1. Loads the `book_imports` row.
2. Checks `cancel_requested_at`; if set, transitions to `cancelled` and acks the message.
3. Performs its work.
4. Acks on success or retries on transient failure; on the third retry, marks the import `failed` and writes the error to `errorLogObjectKey`.

Tests:

- `tests/epub-processor.dispatch.test.ts` — fake `MessageBatch` covers dispatch + cancel observation.

### 7.5 EPUB Container And OPF Parsing

Implementation tasks:

- [ ] `workers/epub-processor/src/epub-archive.ts` — central-dir parser, entry Range-reader, decompressor.
- [ ] `workers/epub-processor/src/xml.ts` — tiny XML parser (token-stream).
- [ ] `workers/epub-processor/src/opf.ts` — extracts metadata + manifest + spine.
- [ ] `workers/epub-processor/src/toc.ts` — parses NCX (EPUB 2) and nav.xhtml (EPUB 3) into a normalized tree.
- [ ] `workers/epub-processor/src/handlers/parse-container.ts` — step 1 handler. Calls archive, OPF, TOC parsers; updates book row metadata or creates the book; writes immutable manifest object and spine item rows; enqueues skeleton messages.
- [ ] Enforce the archive, expansion, entry, path-traversal, compression-ratio and parser ceilings from §4.3 before creating content rows.

Acceptance criteria:

- The parser handles deflate (method 8) and stored (method 0) entries. Other compression methods cause a failed import with a clear error.
- Malformed XML produces a failed import with the OPF path quoted in the error summary.

Tests:

- `tests/epub-archive.test.ts` — fixtures: minimal EPUB 2, minimal EPUB 3, EPUB with deflate, EPUB with stored, EPUB with both compression methods.

### 7.6 Spine Walk And Chapter Skeleton Insert

Implementation tasks:

- [ ] `workers/epub-processor/src/handlers/chapter-skeleton.ts` — step 2 handler.
- [ ] `workers/epub-processor/src/spine-splitter.ts` — decides whether to split a spine item by TOC nesting + heading IDs.
- [ ] Use `CreateImportedChapterWorkflow` with shared chapter validation from docs/015 to insert skeleton rows. The workflow enforces `MAX_CHAPTER_DEPTH`, initiator attribution and active-import target ownership; if TOC nesting is deeper, the splitter collapses to the deepest allowed depth.
- [ ] Store produced chapter IDs and anchor mapping on normalized item rows; no parallel mutation of shared index JSON.

Acceptance criteria:

- A simple one-chapter-per-spine book produces a flat tree of chapters at depth 1.
- A book with 3.1/3.2 TOC nesting under a single spine item produces depth-2 chapters.
- A book whose TOC nests deeper than `MAX_CHAPTER_DEPTH` collapses gracefully (no error).

Tests:

- `tests/spine-splitter.test.ts` — table-driven tests on the splitter.
- `tests/chapter-skeleton.handler.test.ts` — integration test using the in-process D1 + a synthetic spine.

### 7.7 HTML To Lexical Conversion And Link Resolution

Implementation tasks:

- [ ] `workers/epub-processor/src/html-to-lexical.ts` — converter using `htmlparser2`.
- [ ] `workers/epub-processor/src/sanitize.ts` — sanitization rules.
- [ ] `workers/epub-processor/src/link-resolver.ts` — given a raw EPUB href + normalized completed item mappings, returns a `chapter-link` / `broken-link` / `link` decision.
- [ ] `workers/epub-processor/src/handlers/chapter-content.ts` — step 3 handler. Pulls chapter HTML, runs sanitize → image-extract (§7.8) → html-to-lexical → link-resolver → calls the import-specific chapter-content workflow as the importer service account.

Acceptance criteria:

- Cross-chapter links within the same book resolve to `chapter-link { chapterId }`.
- Cross-chapter links whose target spine produced no chapter become `broken-link { reason: "unresolved" }`.
- External links remain as `link { url }`.
- Footnotes survive the round-trip and produce `footnote` + `footnoteref` pairs.

Tests:

- `tests/html-to-lexical.test.ts` — table-driven on small HTML snippets.
- `tests/chapter-content.handler.test.ts` — integration test using a fixture EPUB.

### 7.8 Image Extraction Workflow

Implementation tasks:

- [ ] `workers/epub-processor/src/image-extractor.ts` — extracts `<img>`/SVG `<image>` from chapter HTML, resolves paths, hashes bytes, dedupes against existing media.
- [ ] The image extractor uses `CreateImportedMediaWorkflow` to make an initiator-owned media row under the active import execution guard, then writes bytes through the existing `R2ObjectStorage` adapter.
- [ ] The chapter-content handler invokes the image extractor before HTML→Lexical, so the converter sees `data-lexical-upload-id` attributes when emitting nodes.

Acceptance criteria:

- A chapter with two `<img>` references creates two media rows (or reuses existing rows by hash) and one `media_attachments` row per image after the chapter is saved.
- Unsupported MIME types are skipped with a logged warning; the chapter still imports.

Tests:

- `tests/image-extractor.test.ts`.

### 7.9 Cancel / Retry / Cleanup

Implementation tasks:

- [ ] Cancel: the step handlers check `cancel_requested_at` on every entry; the `CancelBookImportUseCase` sets the flag and (optionally) enqueues a `cancel-cleanup` message to delete the archive immediately rather than waiting for the next scheduled cleanup.
- [ ] Retry: explicitly not implemented in the first release. Document this in the use case.
- [ ] Scheduled cleanup: add a step to the existing cron worker (or create `workers/imports-cleanup/`) that:
  - expires `pending-upload` rows past their TTL;
  - deletes archive objects for terminal-state imports older than 30 days;
  - deletes immutable manifest objects from terminal imports older than 7 days.

Acceptance criteria:

- Cancelling a `processing-content` import causes the next step to abort and the import to land in `cancelled`.
- An archive uploaded without a valid authorized `book_imports` row (impossible in normal flow, but defensive) is GC'd by the cleanup pass when no row references its key.

Tests:

- `tests/book-imports.cancel.test.ts`.
- `tests/imports-cleanup.test.ts`.

### 7.10 Composition And Wiring

Implementation tasks:

- [ ] Wire the new use cases into the main API Worker's request container.
- [ ] Wire the Worker's per-step container construction in `workers/epub-processor/src/index.ts`. The Worker constructs its own minimal container (D1 + repositories + use cases) and **does not** reuse the API Worker's `createRequestContainer`, because that container is request-scoped and HTTP-aware.
- [ ] Confirm `corepack pnpm lint` passes — the Worker keeps import execution services/adapters under its own deployment unit and imports only deliberately shared pure contracts/constants from `src/shared/**`, not API application/domain/infrastructure or HTTP code.

Acceptance criteria:

- Both Workers (`content-api`, `content-api-epub-processor`) deploy from the same CI workflow with their own `wrangler.jsonc`.

Tests:

- Smoke deploy in CI.

## 8. Migration And Rollout

Migration order:

1. Generate `drizzle/00NN_book_imports.sql` adding `book_imports`, `book_import_items` and their indexes.
2. Backfill: none. New table starts empty.
3. Apply locally; run `pnpm test`; apply remote via CI.

Cloudflare resources to create (operator one-time, documented in [README.md](../README.md)):

```bash
wrangler queues create epub-processing
wrangler queues create epub-processing-dlq
wrangler queues create epub-step

wrangler r2 bucket notification create content-api-media \
  --event-type object-create \
  --queue epub-processing \
  --prefix "book-imports/" \
  --suffix "/archive.epub"
```

CI deploy ordering:

1. Apply D1 migrations.
2. Deploy the API Worker (start-import endpoint is live; presigned URLs work; no Worker on the other end yet — uploads succeed, R2 events fire, but the queue has no consumer until step 4).
3. Deploy the EPUB processor Worker.
4. Deploy the media-processor Worker (unchanged; just included in the existing pipeline).

Add `content-api-epub-processor` to the CI deploy step in `.github/workflows/ci-deploy.yml`.

Rollback:

- The new tables and Workers are additive. Rolling back drops the queue consumer; in-flight imports stall in `processing-*` until a re-deploy or are GC'd by cleanup. Already-completed imports are unaffected.

Documentation:

- Update [README.md](../README.md) to document the new queues, the R2 notification, and the new Worker.
- Update docs/007 mentions of book imports to point at docs/017.
- Confirm in docs/009 that this work has been absorbed into 017.
- Update the `content-iam-usage` skill with `org.import_book`, `book.import` and the narrowly guarded importer service-account execution path.

## 9. Edge Cases And Failure Modes

| Scenario | Expected handling |
|---|---|
| `archiveContentLength` exceeds `MAX_EPUB_ARCHIVE_BYTES` | Start-import returns `400 ValidationError`. |
| Archive exceeds expanded-byte, entry-count, per-entry, path, compression-ratio or parser limits | Import fails before content rows are created, with a bounded validation error summary retained on `book_imports`. |
| Upload timeout (TTL expired before R2 PUT) | Status stays `pending-upload` until cleanup, then `upload-expired`. The user starts a fresh import. |
| Archive is not a valid ZIP / EPUB | Step 1 marks the import `failed` with `errorSummary = "Invalid EPUB container"`. The archive R2 object is retained for 30 days for operator inspection. |
| OPF references a manifest entry that does not exist in the archive | Step 1 marks the import `failed`. |
| TOC references a fragment ID that does not exist in any spine item | Skeleton splitter falls back to one-chapter-per-spine for that spine. Logged as a warning. |
| Spine item produces zero blocks after sanitization | Chapter content becomes `[{ paragraph, blockId: "...", children: [{ text: "(Empty chapter)" }] }]`. |
| Cross-chapter link target was collapsed into a parent during depth-cap | Resolver maps to the parent chapter with `anchor = blockId` of the heading that originally would have been the chapter root. Best-effort. |
| Image references an asset that is missing from the archive | The `<img>` becomes `broken-image { alt, reason: "media-missing" }`. Logged. Chapter still imports. |
| Image MIME not in allowlist (e.g., GIF) | Image is dropped; replaced with a text fallback in the alt position. Logged. |
| Two spine items reference the same image asset | Second extraction finds the existing media by hash and reuses it. One media row, two attachments. |
| The same archive is uploaded twice (same hash) | The first import runs to completion. The second import (different `importId`, different R2 key) runs independently and produces a duplicate book. Dedup by archive hash is not in scope for the first release; the operator response is "the user shouldn't double-upload". |
| Import created the book but the worker crashed before finalize | Status stays non-terminal until cleanup marks the import `failed`; ordinary content edits return `409 Import in progress` before terminal recovery. After failure, the user can explicitly promote partial content or replace/delete it. |
| Worker step retries 3 times and fails | Step writes the error to `errorLogObjectKey`; status `failed`. |
| User calls `:cancel` while step 3 is mid-way through a chapter | Step finishes that chapter, then the next step pickup observes the cancel flag and transitions to `cancelled`. Previously-created chapters stay. |
| User starts a new-book import without `org.import_book`, or replacement without required book permissions | `403 Forbidden`. |
| Direct-share token tries to start an import | `403 Forbidden`; new-book import requires workspace organization authority and replacement is not share-reader authority. |
| Importer service account is absent or attempts work outside the active import target | Step fails with an authorization error; do not provision it with `system:org.content_admin` as a workaround. |
| Replace import races with a manual chapter edit on the new book | Normal content edit returns `409 Import in progress`; importer-owned content cannot silently overwrite accepted human edits. |
| `/replace` races with a lifecycle transition on the predecessor book | The docs/015 archive CAS returns `409`; no replacement book or replacement import is created from stale predecessor state. |
| A failed import on a `/replace` flow | The old book is still archived. Operator runbook: either perform an explicit lifecycle recovery or call `/replace` again with a fixed archive. |
| Queue messages duplicated (Cloudflare at-least-once delivery) | Each step handler compare-and-set claims its normalized `book_import_items` row; completed items acknowledge duplicate delivery without repeating writes, and finalization derives completion from item states. |
| Worker invocation exceeds 30s CPU budget on a single chapter | Cloudflare aborts the invocation; the queue retries. Handlers should be small enough that this never happens; if it does (very large chapter HTML), the chapter ends up in the failed state after retries. A future enhancement would split chapter-content step further. |

## 10. Implementation Backlog

### EPI-A. book_imports And book_import_items Schema And Repository

Scope:

- `src/infrastructure/db/schema.ts` (`book_imports`, `book_import_items` tables)
- `src/domain/imports/*`
- `src/infrastructure/repositories/drizzle-book-import.repository.ts`
- `src/infrastructure/repositories/drizzle-book-import-status.workflow.ts`
- `src/infrastructure/repositories/mappers/book-import.mapper.ts`
- `drizzle/00NN_book_imports.sql`

Tasks:

- [ ] Add both tables + indexes from §4.2.
- [ ] Implement entity + import/item repositories + CAS workflow ports.
- [ ] Unit tests for entity transitions and CAS workflow.

Acceptance criteria:

- Repository can find by id, find by archive object key, list by book, list by initiator.
- Workflow ports refuse an invalid status transition and duplicate item completion is idempotent.

Tests:

- `corepack pnpm test tests/book-imports.entity.test.ts tests/book-imports.repo.test.ts`

### EPI-B. Start-Import HTTP And Presigned URL

Scope:

- `src/application/imports/*.usecase.ts`
- `src/http/routes/book-imports.routes.ts`
- `src/http/schemas/book-import.schema.ts`
- `src/http/presenters/book-import.presenter.ts`
- `src/composition/create-request-container.ts`

Tasks:

- [ ] Implement start/get/list/cancel use cases.
- [ ] Implement routes per §4.11.
- [ ] Wire into composition.
- [ ] `MAX_EPUB_ARCHIVE_BYTES`, `EPUB_ARCHIVE_UPLOAD_URL_TTL_SECONDS` in env.

Acceptance criteria:

- Workspace user with `org.import_book` can request a new-book upload URL.
- Direct-share token returns 403.
- Status route returns calculated item progress without internal manifest/item detail.

Tests:

- `corepack pnpm test tests/book-imports.routes.test.ts`

### EPI-C. EPUB Processor Worker Skeleton

Scope:

- `workers/epub-processor/`

Tasks:

- [ ] Create the Worker directory, `wrangler.jsonc`, `tsconfig.json`.
- [ ] Implement queue dispatch with `EpubStepMessage` schema.
- [ ] Implement cancel observation across all handlers.
- [ ] Configure DLQ.

Acceptance criteria:

- Sending a `parse-container` message against an unknown `importId` acks and logs.
- Sending a `parse-container` message against a cancelled import transitions to `cancelled`.

Tests:

- `corepack pnpm test tests/epub-processor.dispatch.test.ts`

### EPI-D. Streaming ZIP And EPUB Container Parser

Scope:

- `workers/epub-processor/src/epub-archive.ts`
- `workers/epub-processor/src/xml.ts`
- `workers/epub-processor/src/opf.ts`
- `workers/epub-processor/src/toc.ts`

Tasks:

- [ ] Implement central-dir parsing, Range-read decompression, OPF parser, TOC parser and all bounded extraction/security checks in §4.3.
- [ ] Reject unsupported compression methods with a clear error.
- [ ] Handle EPUB 2 (NCX) and EPUB 3 (nav.xhtml) TOC.

Acceptance criteria:

- Fixture EPUB 2 and EPUB 3 archives parse correctly to (metadata, manifest, spine, toc).
- Corrupt archive produces a `failed` import with a quoted byte offset in `errorSummary`.

Tests:

- `corepack pnpm test tests/epub-archive.test.ts`

### EPI-E. Spine Walk And Chapter Skeleton Insert

Scope:

- `workers/epub-processor/src/handlers/chapter-skeleton.ts`
- `workers/epub-processor/src/spine-splitter.ts`

Tasks:

- [ ] Implement the splitter from §4.7.
- [ ] Implement the handler through the import-specific chapter-create workflow and normalized item rows.

Acceptance criteria:

- Plain spine → flat depth-1 chapters.
- TOC-nested spine → recursive chapters up to `MAX_CHAPTER_DEPTH`.
- Deeper-than-cap TOC nesting collapses without error.

Tests:

- `corepack pnpm test tests/spine-splitter.test.ts tests/chapter-skeleton.handler.test.ts`

### EPI-F. HTML To Lexical Conversion And Link Resolution

Scope:

- `workers/epub-processor/src/html-to-lexical.ts`
- `workers/epub-processor/src/sanitize.ts`
- `workers/epub-processor/src/link-resolver.ts`
- `workers/epub-processor/src/handlers/chapter-content.ts`

Tasks:

- [ ] Implement HTML→Lexical conversion using `htmlparser2`.
- [ ] Implement sanitization rules from §4.6.
- [ ] Implement link resolution against completed normalized chapter-item mappings.
- [ ] Implement footnote extraction.
- [ ] Wire the chapter-content handler to call `WriteImportedChapterContentWorkflow` as the importer service account.

Acceptance criteria:

- Cross-chapter links produce `chapter-link { chapterId, anchor? }` with correct ids.
- Unresolvable internal hrefs produce `broken-link { reason: "unresolved" }`.
- Footnotes survive a round-trip through the converter.

Tests:

- `corepack pnpm test tests/html-to-lexical.test.ts tests/chapter-content.handler.test.ts`

### EPI-G. Image Extraction Workflow

Scope:

- `workers/epub-processor/src/image-extractor.ts`

Tasks:

- [ ] Resolve asset paths, MIME-check, hash, dedup against existing media through the bounded import-specific media workflow.
- [ ] Upload bytes via existing `R2ObjectStorage` adapter.
- [ ] Mark normalized image-item completion idempotently.
- [ ] Rewrite `<img>` elements before HTML→Lexical.

Acceptance criteria:

- One asset referenced from two chapters produces one media row and two attachments.
- Unsupported MIME asset is dropped; chapter content still saves.

Tests:

- `corepack pnpm test tests/image-extractor.test.ts`

### EPI-H. Cancel Retry And Cleanup

Scope:

- `src/application/imports/cancel-book-import.usecase.ts`
- `workers/imports-cleanup/` (or extension to an existing cron worker)

Tasks:

- [ ] Implement cancel use case.
- [ ] Implement scheduled cleanup logic.

Acceptance criteria:

- Cancel during `processing-content` transitions to `cancelled` after the next step boundary.
- Expired `pending-upload` rows are GC'd 15 minutes after TTL.

Tests:

- `corepack pnpm test tests/book-imports.cancel.test.ts tests/imports-cleanup.test.ts`

### EPI-I. Wire /replace To Import

Scope:

- `src/application/books/replace-book.usecase.ts` (extension)

Tasks:

- [ ] Replace the docs/015 stub that wrote a `book_imports` row in `pending-worker-not-yet-built` with a real call to start an import (mode `"replace"`).
- [ ] The use case returns `{ newBookId, importId, uploadUrl, expiresAt, archiveObjectKey }` so the client can upload the new archive.
- [ ] Preserve docs/015's lifecycle/version guarded predecessor archive: a zero-row archive result returns `409` before any replacement import is enqueued.
- [ ] Update docs/015 §7.5 status to reflect that the stub is now connected.

Acceptance criteria:

- `POST /books/{bookId}/replace` returns a presigned URL; uploading the archive starts the import; the new book is filled in.
- `POST /books/{bookId}/replace` requires `book.update`, `book.import` and `book.archive`.
- `POST /books/{bookId}/replace` returns `409` and creates no replacement import when its predecessor lifecycle CAS is stale.

Tests:

- `corepack pnpm test tests/books.replace-via-import.test.ts`

## 11. Future Backlog

- **Resume of a crashed import.** Recovery policy over normalized item rows and already-created content/media. Separate doc.
- **SSE / Durable Object progress channel.** Real-time UI without polling.
- **PDF and DOCX importers.** Each is its own format; they could share `book_imports` lifecycle and the chapter-skeleton pattern.
- **In-place re-import on an unedited imported book.** Convenience over `/replace`.
- **EPUBCheck-style validation.** Surface structural problems to the user before the import runs.
- **Dedup by archive hash.** Recognize that this archive was already imported; offer to link or skip.
- **Importer extensibility plugin.** A `Source` interface that tenants implement to bring custom archive types.
- **Cached progress projection** if counting normalized item rows becomes expensive for very large imports. It must be derived from item rows, not a concurrent shared-counter source of truth.
- **Audit log integration** for import lifecycle events. Owned by docs/014.
- **Tenant-tunable importer settings** (`MAX_CHAPTER_DEPTH`, allow-list of inline tags, footnote formats) per org.

## 12. Test And Verification Plan

Run after each backlog item:

```bash
corepack pnpm lint
corepack pnpm check:dup
corepack pnpm typecheck
corepack pnpm test
corepack pnpm advise
```

Fixture EPUB archives committed under `tests/fixtures/epub/`:

- `epub-2-simple.epub` — 3 chapters, plain text, one image.
- `epub-3-simple.epub` — same content, EPUB 3 nav.xhtml.
- `epub-2-deflate.epub` — uses deflate compression for entries.
- `epub-2-stored.epub` — uses stored entries.
- `epub-2-nested-toc.epub` — single spine item, TOC nests 3 levels (tests recursive chapter splitting).
- `epub-2-cross-links.epub` — chapters cross-link each other (tests `chapter-link` resolution).
- `epub-2-broken-link.epub` — a chapter links to a non-existent spine href (tests `broken-link` fallback).
- `epub-2-malformed-html.epub` — chapter HTML has unclosed tags (tests sanitizer resilience).
- `epub-2-unsupported-image.epub` — chapter embeds a GIF (tests MIME drop path).
- `epub-2-large.epub` — 50 chapters with realistic content sizes (tests performance, not correctness).

Coverage targets:

- ZIP parser: fixture matrix above.
- ZIP safety: expanded-size, per-entry, entry-count, compression-ratio and traversal-limit failure fixtures.
- OPF parser: EPUB 2 vs EPUB 3 metadata extraction.
- TOC parser: NCX vs nav.xhtml; flat vs nested.
- Sanitizer: rejects script/style/iframe/object/embed/form/input; strips on* handlers and `style`; keeps allowed text formatting.
- HTML→Lexical: round-trip preserves footnotes, callouts, lists, headings, images.
- Link resolver: maps to correct chapter id from item rows, anchors map to correct block id, unresolvable to broken-link.
- Image extractor: dedup by hash, MIME allowlist, attachment row creation after the import-specific chapter workflow.
- Queue idempotency: duplicate/out-of-order messages cannot overwrite content or progress from completed item rows.
- Cancel: terminates between steps; partial state preserved.
- Cleanup: expires pending uploads; deletes orphaned archives; deletes expired manifest objects.

Manual smoke (against `wrangler dev` + local D1 + miniflare R2):

- Run `wrangler dev` for the API Worker.
- Run `wrangler dev` for the EPUB processor Worker in a second terminal.
- `POST /book-imports` to obtain an upload URL.
- `curl -X PUT` the fixture EPUB to the upload URL.
- Watch the processor Worker logs as it walks the archive.
- Poll `GET /book-imports/{importId}` until status is `completed`.
- Verify `GET /books/{newBookId}/chapters?recursive=true` returns the expected tree.
- Open one chapter via `GET /chapters/{id}` and confirm content contains `chapter-link` nodes with real chapter IDs.

## 13. Definition Of Done

- `book_imports` table exists; the migration applies to a fresh D1.
- `book_import_items` provides concurrency-safe item execution and status/progress is derived without shared JSON/counter mutation.
- `POST /book-imports`, `GET /book-imports/{importId}`, `GET /books/{bookId}/imports`, `POST /book-imports/{importId}/cancel` are reachable, OpenAPI-documented, and Vitest-integrated.
- `workers/epub-processor/` deploys via CI as a sibling Worker.
- The fixture EPUB matrix imports end-to-end through `wrangler dev`.
- `chapter-link` and `broken-link` nodes appear in imported chapter content with real chapter IDs; no raw EPUB href is persisted in D1.
- Embedded images become initiator-owned media rows through an import-specific workflow plus `media_attachments`; the existing media-processor generates derivatives without modification.
- `POST /books/{bookId}/replace` (docs/015 §4.6) is wired to enqueue an import via this pipeline.
- `/replace` preserves docs/015's lifecycle/version archive CAS and enqueues no replacement import when the predecessor state is stale.
- The EPUB importer service account passes `ImportExecutionPolicy` only for active import-owned targets and has no `system:org.content_admin` binding.
- Active imports reject ordinary editor content writes, and successful finalization schedules the derived-count rollup without mutating book lifecycle status.
- `corepack pnpm check` passes.
- `corepack pnpm advise` is green or carries documented suppressions only.
- README.md, docs/007, docs/009 abandoned status, the `content-iam-usage` skill all reflect the new state.

## 14. Final Model

```text
client                browser uploads .epub bytes
  |                               |
  v                               v
POST /book-imports            R2 (book-imports/{importId}/archive.epub)
  -> book_imports row             |
  -> presigned PUT URL            v
                              R2 object-create event
                                  |
                                  v
                            epub-processing queue
                                  |
                                  v
                       workers/epub-processor/
                                  |
                step 1: parse-container
                step 2: chapter-skeleton (per spine item)
                step 3: chapter-content (per chapter)
                step 4: finalize
                                  |
                                  v
                         book + chapter + media rows
                            (origin = imported)
                         normalized import item states
                         derived-count rollup queued
                                  |
                  first non-system content edit
                                  |
                                  v
                          book.origin = platform
```

The platform is the canonical home for books. EPUB import is a side service that produces books indistinguishable from platform-authored ones after completion. The Worker streams the archive from R2 under bounded extraction limits, walks the spine and TOC through normalized idempotent item rows, resolves cross-chapter links at import time, and reuses media derivative processing through an import-specific creation path. Ordinary editing is blocked during active import; the first later edit promotes the book. Re-uploading a new version is an explicit destructive workflow through the same pipeline.

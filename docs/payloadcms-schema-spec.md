# PayloadCMS Collection Schema Specification

Source repository: `quanghuy1242/payloadcms`  
Scope: Payload collection/global configuration extracted from the repo's `src/collections/*` files and `src/globals/Homepage.ts`.

## Scope And Notes

This document covers the application-defined Payload collections and global:

- `users`
- `media`
- `books`
- `chapters`
- `posts`
- `categories`
- `grant-mirror`
- `deferred-grants`
- `reading-progress`
- `bookmarks`
- `comments`
- `homepage` global

Excluded:

- Payload-generated internal collections such as preferences, locks, versions, and generated GraphQL helper types.
- Implementation details inside utility files unless referenced by collection hooks/access config.

## Collection Summary

| Collection | Purpose | Drafts | Hidden Admin | Main Ownership Field |
|---|---:|---:|---:|---|
| `users` | Auther-backed Payload user records | No | No | Self/admin |
| `media` | Image uploads with R2 optimization metadata | No | No | `owner` |
| `books` | Manual or EPUB-imported books | Yes | No | `createdBy` |
| `chapters` | Book chapters with Lexical content and password gating | Yes | Yes | `createdBy` |
| `posts` | Blog posts with rich text, categories, tags, SEO | Yes | No | `author` |
| `categories` | Slugged post categories | No | No | `createdBy` |
| `grant-mirror` | Local Auther grant read model | No | Yes | Internal |
| `deferred-grants` | Deferred grant/revocation queue read model | No | Yes | Internal |
| `reading-progress` | Per-user book/chapter progress | No | Yes | `user` |
| `bookmarks` | Per-user book/chapter bookmarks | No | Yes | `user` |
| `comments` | Admin-managed comment moderation table | No | No | `author` |
| `homepage` | Public homepage global content | N/A | N/A | Admin/email-gated |

---

# 1. `users`

## Purpose

Auther SSO-backed Payload users. Local password login is disabled. Payload users are provisioned/linked from external identity.

## Collection Config

| Property | Value |
|---|---|
| `slug` | `users` |
| Admin title | `email` |
| Auth | enabled |
| API keys | `useAPIKey: true` |
| Local strategy | disabled |
| Auth strategy | `betterAuthStrategy` |
| Token expiration | `86400` seconds |

## Access

| Operation | Rule |
|---|---|
| Create | `adminAccess` |
| Read | `authenticatedAccess` |
| Update | `adminOrSelfAccess` |
| Delete | `adminAccess` |

## Hooks

| Hook | Handlers |
|---|---|
| `beforeValidate` | `usersBeforeValidateHook` |
| `beforeChange` | `usersBeforeChangeHook` |
| `afterOperation` | `usersAfterOperationHook` |

## Fields

| Field | Type | Required | Unique | Index | Access / Notes |
|---|---:|---:|---:|---:|---|
| `email` | `email` | Yes | Yes | No | Readable by admin or self |
| `fullName` | `text` | Yes | No | No | Display/user name |
| `avatar` | `upload -> media` | No | No | No | Read authenticated; update admin/self |
| `bio` | `richText` | No | No | No | Lexical editor; read authenticated; update admin/self |
| `role` | `select` | Yes | No | No | Default `user`; options `admin`, `user`; admin-only field access |
| `betterAuthUserId` | `text` | No | Yes | Yes | Read-only external identity ID; admin-readable |

## Rich Text Features

`bio` uses a Lexical editor with:

- Root features
- Paragraph
- Underline
- Bold
- Italic
- Headings `h1`-`h4`
- Fixed toolbar
- Inline toolbar
- Horizontal rule

---

# 2. `media`

## Purpose

Image upload collection backed by R2. Uploads generate low-resolution placeholders, optimized WebP versions, and responsive variants.

## Collection Config

| Property | Value |
|---|---|
| `slug` | `media` |
| Admin title | `filename` |
| Default columns | `filename`, `alt`, `updatedAt` |
| Admin list component | `/components/admin/media/MediaGridView` |
| Admin pagination | default `50`, limits `24`, `50`, `100`, `200` |

## Access

| Operation | Rule |
|---|---|
| Create | `authenticatedAccess` |
| Read | `publishedMediaReadAccess` |
| Update | `ownerAccess('owner')` |
| Delete | `ownerAccess('owner')` |

## Hooks

| Hook | Handlers / Behavior |
|---|---|
| `beforeValidate` | `enforceOwnershipHook('owner')` |
| `afterChange` | On create, generate low-res placeholder, optimized 1920px WebP, and responsive variants |
| `afterDelete` | Delete optimized and responsive R2 variant keys |

## Upload Config

| Property | Value |
|---|---|
| MIME types | `image/png`, `image/jpeg`, `image/jpg` |
| Local storage | disabled |
| Crop | disabled |
| Focal point | enabled |

## Fields

| Field | Type | Required | Hidden | Notes |
|---|---:|---:|---:|---|
| `alt` | `text` | Yes | No | Alt text for accessibility |
| `lowResUrl` | `textarea` | No | Yes | Base64 20px blur placeholder |
| `optimizedUrl` | `text` | No | Yes | 1920px WebP optimized image URL |
| `owner` | `relationship -> users` | Yes | No | Sidebar, read-only |

## Generated/Upload Fields From Payload

Payload upload collections also expose generated upload metadata such as:

- `url`
- `thumbnailURL`
- `filename`
- `mimeType`
- `filesize`
- `width`
- `height`
- `focalX`
- `focalY`

## Image Pipeline

On create:

1. Generate low-res base64 placeholder.
2. Generate optimized WebP.
3. Generate 6 responsive variants.
4. Store R2 variants.
5. Patch media document with generated URLs when available.

On delete:

1. Resolve original storage key.
2. Delete optimized variant.
3. Delete all responsive variants.

---

# 3. `books`

## Purpose

Books support manual authoring and EPUB import lifecycle management. Books can be public or private and have Auther-backed grant controls.

## Collection Config

| Property | Value |
|---|---|
| `slug` | `books` |
| Admin title | `title` |
| Default columns | `title`, `origin`, `importStatus`, `syncStatus`, `updatedAt` |
| Drafts | enabled |
| Autosave | `5000ms` |
| List view | `/components/admin/books/BooksListView` |
| Edit controls | Delete, chapter list, access panel, reconcile grants, EPUB download, preview |

## Access

| Operation | Rule |
|---|---|
| Create | `authenticatedAccess` |
| Read | `publicBooksReadAccess` |
| Update | `ownerAccess('createdBy')` |
| Delete | `bookDeleteAccess` |

## Hooks

| Hook | Handlers |
|---|---|
| `beforeValidate` | `enforceOwnershipHook('createdBy')`, `createRandomizedSlugHook('title', { localeField: 'language', defaultLocale: 'en' })` |
| `beforeChange` | `applyBookImportLifecycleHook` |
| `afterChange` | `booksCachePurgeAfterChangeHook` |
| `beforeDelete` | `enforceBookHasNoChaptersBeforeDelete` |
| `afterDelete` | `booksAfterDeleteGrantMirrorHook`, `booksCachePurgeAfterDeleteHook` |

## Fields

| Field | Type | Required | Unique | Index | Default | Notes |
|---|---:|---:|---:|---:|---:|---|
| `title` | `text` | Yes | No | No | - | Book title |
| `author` | `text` | No | No | No | - | Author string |
| `description` | `textarea` | No | No | No | - | Synopsis/blurb |
| `language` | `text` | No | No | No | - | BCP 47 tag |
| `publisher` | `text` | No | No | No | - | Sidebar |
| `publicationDate` | `date` | No | No | No | - | Sidebar |
| `isbn` | `text` | No | No | Yes | - | Primary ISBN or EPUB identifier |
| `subjects` | `array` | No | No | No | - | Array of `subject` text rows |
| `chapterCount` | `number` | No | No | No | - | Read-only sidebar |
| `totalWordCount` | `number` | No | No | No | - | Read-only sidebar |
| `epubVersion` | `select` | No | No | No | - | Options `2`, `3`; read-only |
| `slug` | `text` | Yes | Yes | Yes | - | Immutable slug validation |
| `cover` | `upload -> media` | No | No | No | - | Cover image |
| `origin` | `select` | Yes | No | No | `manual` | Derived from `BOOK_ORIGINS` |
| `sourceType` | `select` | Yes | No | No | `manual` | Derived from `BOOK_SOURCE_TYPES` |
| `visibility` | `select` | Yes | No | No | `public` | Options `public`, `private` |
| `sourceId` | `text` | No | No | Yes | - | External/source identifier |
| `sourceHash` | `text` | No | No | Yes | - | Source content hash |
| `sourceVersion` | `text` | No | No | No | - | Source version |
| `syncStatus` | `select` | Yes | No | No | `clean` | Derived from `BOOK_SYNC_STATUSES` |
| `importBatchId` | `text` | No | No | Yes | - | Current import batch |
| `importStatus` | `select` | Yes | No | No | `idle` | Derived from `BOOK_IMPORT_STATUSES` |
| `importTotalChapters` | `number` | No | No | No | - | Import progress |
| `importCompletedChapters` | `number` | No | No | No | - | Import progress |
| `importStartedAt` | `date` | No | No | No | - | Import lifecycle |
| `importFinishedAt` | `date` | No | No | No | - | Import lifecycle |
| `importFailedAt` | `date` | No | No | No | - | Import lifecycle |
| `lastImportedAt` | `date` | No | No | No | - | Import lifecycle |
| `importErrorSummary` | `textarea` | No | No | No | - | Populated on failed import |
| `importFailureLog` | `array` | No | No | No | - | Read-only failure records |
| `createdBy` | `relationship -> users` | Yes | No | No | - | Read-only owner |

## `subjects` Array Fields

| Field | Type | Required |
|---|---:|---:|
| `subject` | `text` | Yes |

## `importFailureLog` Array Fields

| Field | Type | Required |
|---|---:|---:|
| `chapterIndex` | `number` | Yes |
| `chapterTitle` | `text` | Yes |
| `error` | `text` | Yes |
| `timestamp` | `date` | Yes |

---

# 4. `chapters`

## Purpose

Chapters belong to books, have draft/autosave content, support EPUB import metadata, unique per-book order, and optional password protection.

## Collection Config

| Property | Value |
|---|---|
| `slug` | `chapters` |
| Admin hidden | Yes |
| Admin title | `title` |
| Default columns | `title`, `book`, `order`, `_status`, `updatedAt` |
| Drafts | enabled |
| Autosave | `5000ms` |
| List view | `/components/admin/chapters/ChaptersListView` |
| Edit controls | `/components/admin/chapters/ChapterEditAccessNotice` |

## Access

| Operation | Rule |
|---|---|
| Create | `authenticatedAccess` |
| Read | `chaptersReadAccess` |
| Update | `ownerAccess('createdBy')` |
| Delete | `ownerAccess('createdBy')` |

## Hooks

| Hook | Handlers |
|---|---|
| `beforeValidate` | `enforceOwnershipHook('createdBy')`, `createSlugHook('title')` |
| `beforeChange` | `syncChapterPasswordStateHook`, `enforceChapterBookOwnershipHook`, `enforceUniqueChapterOrderHook` |
| `afterChange` | `chaptersCachePurgeAfterChangeHook` |
| `afterDelete` | `chaptersCachePurgeAfterDeleteHook` |
| `afterRead` | `applyChapterPasswordReadStateHook` |

## Fields

| Field | Type | Required | Index | Default | Access / Notes |
|---|---:|---:|---:|---:|---|
| `title` | `text` | Yes | No | - | Chapter title |
| `book` | `relationship -> books` | Yes | Yes | - | Parent book |
| `order` | `number` | Yes | Yes | - | Min `1`; unique per book enforced by hook |
| `slug` | `text` | Yes | Yes | - | Sidebar |
| `chapterSourceKey` | `text` | No | Yes | - | EPUB/import source key |
| `chapterSourceHash` | `text` | No | Yes | - | EPUB/import content hash |
| `importBatchId` | `text` | No | Yes | - | Import batch |
| `manualEditedAt` | `date` | No | No | - | Manual edit marker |
| `chapterWordCount` | `number` | No | No | - | Read-only sidebar |
| `content` | `richText` | Yes | No | - | `createChapterLexicalEditor()`; read gated by `chapterContentReadAccess` |
| `password` | `text` | No | No | - | Optional; read/create/update authenticated field access |
| `hasPassword` | `checkbox` | No | No | `false` | Read-only; auto-set |
| `passwordVersion` | `number` | No | No | `0` | Read-hidden; increments when password changes |
| `createdBy` | `relationship -> users` | Yes | No | - | Read-only owner |

---

# 5. `posts`

## Purpose

Blog post collection with rich text, drafts/autosave, category relationship, tags, media cover image, immutable slug, and owner-based author access.

## Collection Config

| Property | Value |
|---|---|
| `slug` | `posts` |
| Admin title | `title` |
| Default columns | `title`, `category`, `author`, `_status`, `updatedAt` |
| Drafts | enabled |
| Autosave | `5000ms` |
| Edit controls | `/components/admin/PreviewOnBlogButton` |

## Access

| Operation | Rule |
|---|---|
| Create | `authenticatedAccess` |
| Read | `postsReadAccess` |
| Update | `ownerAccess('author')` |
| Delete | `ownerAccess('author')` |

## Hooks

| Hook | Handlers |
|---|---|
| `beforeValidate` | `enforceOwnershipHook('author')`, `createRandomizedSlugHook('title')` |

## Fields

| Field | Type | Required | Unique | Index | Notes |
|---|---:|---:|---:|---:|---|
| `title` | `text` | Yes | No | No | Post title |
| `slug` | `text` | No | Yes | Yes | Auto-generated; immutable slug validation |
| `excerpt` | `textarea` | No | No | No | Post excerpt |
| `content` | `richText` | Yes | No | No | Lexical editor with custom features |
| `coverImage` | `upload -> media` | No | No | No | Cover image |
| `author` | `relationship -> users` | Yes | No | No | Owner field |
| `category` | `relationship -> categories` | Yes | No | No | Required category |
| `tags` | `array` | No | No | No | Array of `tag` text rows |

## `tags` Array Fields

| Field | Type | Required |
|---|---:|---:|
| `tag` | `text` | No |

## Rich Text Features

`content` uses a Lexical editor with:

- Root features
- Paragraph
- Underline
- Bold
- Italic
- Headings `h1`-`h4`
- Fixed toolbar
- Inline toolbar
- Horizontal rule
- YouTube embed feature
- Experimental table feature
- Code block feature with languages:
  - JavaScript
  - TypeScript
  - TSX
  - JSX
  - HTML
  - CSS
  - Python
  - Bash
  - JSON
  - Plain text

---

# 6. `categories`

## Purpose

Slugged categories for posts, including description, image, and ownership.

## Collection Config

| Property | Value |
|---|---|
| `slug` | `categories` |
| Admin title | `name` |

## Access

| Operation | Rule |
|---|---|
| Create | `authenticatedAccess` |
| Read | `authenticatedAccess` |
| Update | `ownerAccess('createdBy')` |
| Delete | `ownerAccess('createdBy')` |

## Hooks

| Hook | Handlers |
|---|---|
| `beforeValidate` | `enforceOwnershipHook('createdBy')`, `createSlugHook('name')` |

## Fields

| Field | Type | Required | Unique | Index | Notes |
|---|---:|---:|---:|---:|---|
| `name` | `text` | Yes | No | No | Category name |
| `slug` | `text` | No | Yes | Yes | Auto-generated; immutable slug validation |
| `description` | `textarea` | Yes | No | No | Category description |
| `image` | `upload -> media` | Yes | No | No | Required category image |
| `createdBy` | `relationship -> users` | Yes | No | No | Read-only owner |

---

# 7. `grant-mirror`

## Purpose

Internal local read model mirroring Auther grant tuples for fast Payload access filtering.

## Collection Config

| Property | Value |
|---|---|
| `slug` | `grant-mirror` |
| Admin hidden | Yes |
| Admin title | `autherTupleId` |
| Default columns | `payloadUserId`, `entityType`, `entityId`, `relation`, `syncStatus`, `syncedAt` |

## Access

All operations are admin-only:

| Operation | Rule |
|---|---|
| Create | `adminAccess` |
| Read | `adminAccess` |
| Update | `adminAccess` |
| Delete | `adminAccess` |

## Indexes

| Fields | Purpose |
|---|---|
| `payloadUserId`, `entityType`, `syncStatus` | Primary read-time query |
| `sourceSubjectType`, `payloadUserId` | Group-member removal query |
| `syncStatus`, `syncedAt` | Reconciliation/staleness scan |

## Constants

| Constant | Values |
|---|---|
| `GRANT_MIRROR_ENTITY_TYPES` | `book`, `chapter`, `comment` |
| `GRANT_MIRROR_SOURCE_SUBJECT_TYPES` | `user`, `group` |
| `GRANT_MIRROR_SYNC_STATUSES` | `active`, `revoked`, `pending` |

## Fields

| Field | Type | Required | Index | Default | Notes |
|---|---:|---:|---:|---:|---|
| `autherTupleId` | `text` | Yes | Yes | - | Stable tuple ID; idempotency key |
| `payloadUserId` | `relationship -> users` | Yes | Yes | - | Local Payload user |
| `entityType` | `select` | Yes | No | - | `book`, `chapter`, `comment` |
| `entityId` | `text` | Yes | No | - | Payload entity ID as string |
| `relation` | `text` | Yes | No | - | Auther relation name |
| `sourceSubjectType` | `select` | Yes | No | - | `user` or `group` |
| `requiresLiveCheck` | `checkbox` | No | No | `false` | True when Auther condition/Lua exists |
| `syncStatus` | `select` | Yes | No | `active` | `active`, `revoked`, `pending` |
| `syncedAt` | `date` | Yes | No | - | Last sync timestamp |

---

# 8. `deferred-grants`

## Purpose

Internal queue/read model for grant events that arrive before the target Payload user exists. Also stores revocation tombstones to guard against out-of-order events.

## Collection Config

| Property | Value |
|---|---|
| `slug` | `deferred-grants` |
| Admin hidden | Yes |
| Admin title | `tupleId` |
| Default columns | `betterAuthUserId`, `tupleId`, `entityType`, `entityId`, `status`, `createdAt` |

## Access

All operations are admin-only:

| Operation | Rule |
|---|---|
| Create | `adminAccess` |
| Read | `adminAccess` |
| Update | `adminAccess` |
| Delete | `adminAccess` |

## Fields

| Field | Type | Required | Index | Default | Notes |
|---|---:|---:|---:|---:|---|
| `betterAuthUserId` | `text` | Yes | Yes | - | External user ID from grant event |
| `tupleId` | `text` | Yes | Yes | - | Auther tuple ID |
| `entityType` | `text` | Yes | No | - | Target entity type |
| `entityId` | `text` | Yes | No | - | Target entity ID |
| `relation` | `text` | Yes | No | - | Relation name |
| `sourceSubjectType` | `select` | Yes | No | - | `user` or `group` |
| `hasCondition` | `checkbox` | No | No | `false` | Whether grant has a condition |
| `status` | `select` | Yes | Yes | `pending` | `pending`, `processed`, `expired` |
| `processedAt` | `date` | No | No | - | Read-only processed timestamp |
| `type` | `select` | No | Yes | `grant` | `grant` or `revocation_tombstone` |

---

# 9. `reading-progress`

## Purpose

Tracks per-user reading progress for a book/chapter pair.

## Collection Config

| Property | Value |
|---|---|
| `slug` | `reading-progress` |
| Admin hidden | Yes |
| Admin title | `id` |

## Access

| Operation | Rule |
|---|---|
| Create | `authenticatedAccess` |
| Read | `ownerAccess('user')` |
| Update | `ownerAccess('user')` |
| Delete | `ownerAccess('user')` |

## Hooks

| Hook | Handlers |
|---|---|
| `beforeValidate` | `enforceOwnershipHook('user')` |
| `beforeChange` | `readingProgressBeforeChangeHook` |

## Fields

| Field | Type | Required | Index | Default | Notes |
|---|---:|---:|---:|---:|---|
| `user` | `relationship -> users` | Yes | Yes | - | Progress owner |
| `book` | `relationship -> books` | Yes | Yes | - | Book |
| `chapter` | `relationship -> chapters` | Yes | Yes | - | Chapter |
| `progress` | `number` | No | No | `0` | Min `0`, max `100` |
| `completedAt` | `date` | No | No | - | Completion timestamp |

---

# 10. `bookmarks`

## Purpose

Per-user bookmarks for either books or chapters.

## Collection Config

| Property | Value |
|---|---|
| `slug` | `bookmarks` |
| Admin hidden | Yes |
| Admin title | `id` |

## Access

| Operation | Rule |
|---|---|
| Create | `authenticatedAccess` |
| Read | `ownerAccess('user')` |
| Update | `ownerAccess('user')` |
| Delete | `ownerAccess('user')` |

## Hooks

| Hook | Handlers |
|---|---|
| `beforeValidate` | `enforceOwnershipHook('user')` |
| `beforeChange` | `bookmarksBeforeChangeHook` |

## Fields

| Field | Type | Required | Index | Notes |
|---|---:|---:|---:|---|
| `user` | `relationship -> users` | Yes | Yes | Bookmark owner |
| `contentType` | `select` | Yes | No | `chapter` or `book` |
| `chapter` | `relationship -> chapters` | No | No | Shown when `contentType === 'chapter'` |
| `book` | `relationship -> books` | No | No | Shown when `contentType === 'book'` |

---

# 11. `comments`

## Purpose

Comment moderation collection. The public comment APIs are implemented separately; collection access is admin-only.

## Collection Config

| Property | Value |
|---|---|
| `slug` | `comments` |
| Admin title | `content` |
| Default columns | `status`, `author`, `chapter`, `post`, `parentComment`, `createdAt`, `updatedAt`, `deletedAt` |

## Access

All collection operations are admin-only:

| Operation | Rule |
|---|---|
| Create | `adminAccess` |
| Read | `adminAccess` |
| Update | `adminAccess` |
| Delete | `adminAccess` |

## Hooks

| Hook | Handlers |
|---|---|
| `beforeValidate` | `commentsBeforeValidateHook` |
| `beforeChange` | `commentsBeforeChangeHook` |

## Statuses

`COMMENT_STATUSES` are mapped into select options. The README describes moderation as pending/approve/reject style behavior.

## Indexes

| Fields |
|---|
| `chapter`, `status`, `createdAt` |
| `post`, `status`, `createdAt` |
| `chapter`, `author`, `status`, `createdAt` |
| `post`, `author`, `status`, `createdAt` |
| `status`, `createdAt` |
| `author`, `createdAt` |
| `chapter`, `author`, `createdAt` |
| `post`, `author`, `createdAt` |

## Fields

| Field | Type | Required | Index | Notes |
|---|---:|---:|---:|---|
| `chapter` | `relationship -> chapters` | No | Yes | Read-only |
| `post` | `relationship -> posts` | No | Yes | Read-only |
| `author` | `relationship -> users` | Yes | Yes | Read-only |
| `content` | `textarea` | Yes | No | Comment body |
| `status` | `select` | Yes | Yes | Default `pending` |
| `parentComment` | `relationship -> comments` | No | Yes | Read-only parent thread |
| `moderatedAt` | `date` | No | No | Read-only |
| `moderatedBy` | `relationship -> users` | No | Yes | Read-only |
| `deletedAt` | `date` | No | No | Read-only soft-delete timestamp |
| `deletedBy` | `relationship -> users` | No | Yes | Read-only deleter |

---

# 12. `homepage` Global

## Purpose

Global homepage content.

## Global Config

| Property | Value |
|---|---|
| `slug` | `homepage` |

## Access

| Operation | Rule |
|---|---|
| Read | `publicReadAccess` |
| Update | `adminOrEmailContains('quanghuy1242')` |

## Fields

| Field | Type | Required | Notes |
|---|---:|---:|---|
| `header` | `text` | Yes | Homepage header |
| `subHeader` | `text` | No | Homepage subheading |
| `imageBanner` | `upload -> media` | No | Banner image |

---

# Payload Config Summary

## Registered Collections

The main Payload config registers these collections:

```ts
[Users, Media, Books, Chapters, Posts, Categories, GrantMirror, DeferredGrants, ReadingProgress, Bookmarks, Comments]
```

## Registered Globals

```ts
[Homepage]
```

## Plugins And Storage

| Feature | Config |
|---|---|
| Database | SQLite adapter with Turso/libSQL connection and local fallback |
| Storage | R2 storage plugin for `media` |
| SEO | SEO plugin for `posts` and `homepage`, using `media` as uploads collection |
| GraphQL | Custom queries and mutations enabled |
| Admin auth user | `Users.slug` |

## API Shape

Payload exposes generated REST and GraphQL APIs for the configured collections. The repo also defines custom GraphQL operations for:

- Similar posts
- Preview tokens
- Reading progress
- Bookmarks
- Comments
- EPUB export manifest/chunk
- Chapter password unlock
- EPUB generation

---

# Cross-Cutting Patterns

## Ownership

Several collections use ownership hooks and owner-based access:

| Collection | Owner Field |
|---|---|
| `media` | `owner` |
| `books` | `createdBy` |
| `chapters` | `createdBy` |
| `posts` | `author` |
| `categories` | `createdBy` |
| `reading-progress` | `user` |
| `bookmarks` | `user` |

## Drafts

Draft/autosave collections:

| Collection | Autosave |
|---|---|
| `books` | `5000ms` |
| `chapters` | `5000ms` |
| `posts` | `5000ms` |

## Slugs

Slug generation/validation appears in:

| Collection | Slug Hook |
|---|---|
| `books` | randomized slug from `title`, locale-aware |
| `chapters` | slug from `title` |
| `posts` | randomized slug from `title` |
| `categories` | slug from `name` |

## Rich Text

Rich text appears in:

| Collection | Field | Editor |
|---|---|---|
| `users` | `bio` | Lexical with common formatting features |
| `chapters` | `content` | Custom chapter Lexical editor |
| `posts` | `content` | Lexical with YouTube, tables, code blocks |

## Internal Collections

These collections are internal/admin-only:

- `grant-mirror`
- `deferred-grants`
- `reading-progress`
- `bookmarks`
- `comments` collection access is admin-only, though public comment APIs exist separately.

---

# Suggested Mapping To New CMS API Design

If reimplementing this Payload schema in a Hono/D1/Drizzle backend, suggested domain modules are:

| Payload Collection | New Domain Module |
|---|---|
| `users` | `identity/users` |
| `media` | `media` |
| `books` | `books` |
| `chapters` | `chapters` |
| `posts` | `posts` |
| `categories` | `taxonomy/categories` |
| `grant-mirror` | `authz/grants` or `authz/relationship-mirror` |
| `deferred-grants` | `authz/deferred-events` |
| `reading-progress` | `reading/progress` |
| `bookmarks` | `reading/bookmarks` |
| `comments` | `comments/moderation` |
| `homepage` | `globals/homepage` |

Recommended implementation priority:

1. `users`
2. `media`
3. `categories`
4. `posts`
5. `books`
6. `chapters`
7. `comments`
8. `reading-progress`
9. `bookmarks`
10. `grant-mirror`
11. `deferred-grants`
12. `homepage`

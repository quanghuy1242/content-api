# PayloadCMS Access Control Policy Specification

Source repository: `quanghuy1242/payloadcms`  
Scope: application-defined Payload collections, global config, access utilities, and access-relevant hooks.

## Purpose

Document the access control behavior currently encoded in Payload collection configs and utility hooks so it can be ported into the new Hono/D1/ReBAC architecture without losing important authorization semantics.

This document focuses on:

- Collection-level create/read/update/delete access.
- Field-level access.
- Ownership enforcement hooks.
- Read filters for public/private content.
- Grant mirror behavior.
- Comment and chapter password edge cases.
- Migration recommendations for the new architecture.

## Sources Reviewed

Primary collection/global configs:

```txt
src/collections/Users.ts
src/collections/Media.ts
src/collections/Books.ts
src/collections/Chapters.ts
src/collections/Posts.ts
src/collections/Categories.ts
src/collections/Comments.ts
src/collections/GrantMirror.ts
src/collections/DeferredGrants.ts
src/collections/ReadingProgress.ts
src/collections/Bookmarks.ts
src/globals/Homepage.ts
```

Primary access utilities:

```txt
src/utils/access.ts
src/utils/access-shared.ts
src/utils/ownership.ts
src/utils/books.ts
src/utils/comments.ts
src/utils/chapterPasswordHooks.ts
```

## High-Level Policy Model

The current Payload app uses these access patterns:

| Pattern | Meaning |
|---|---|
| Public read | Anonymous users can read selected public/published content. |
| Authenticated read/write | Any logged-in Payload user can perform the operation. |
| Admin-only | Only users with `role === 'admin'` can perform the operation. |
| Owner-only | Admins can do it; otherwise the document must point to the current user through an owner field. |
| Public + owner + grant read | Public documents are visible to anonymous users; private documents require owner or Auther grant mirror access. |
| Field-level privacy | Some fields are hidden or restricted even when the document is readable. |
| Hook-enforced ownership | Owner fields are assigned/preserved by hooks, not trusted from client input. |
| Hook-enforced invariants | Some destructive operations or state changes are blocked by hooks. |

## Core Access Helpers

## `isAdminUser`

```ts
user?.role === 'admin'
```

Admin users bypass most collection-level ownership checks.

## `authenticatedAccess`

Allows access when:

```txt
user is admin
OR user has a normalized id
```

Used for ordinary authenticated operations.

## `adminAccess`

Allows access only when:

```txt
user.role === 'admin'
```

## `ownerAccess(field)`

Allows access when:

```txt
user is admin
OR document[field] equals current user id
```

For list operations, Payload receives a `where` filter:

```ts
{ [field]: { equals: userId } }
```

## `adminOrSelfAccess`

Allows access when:

```txt
user is admin
OR target user id equals current user id
```

Used for users updating themselves.

## `adminOrEmailContains(substring)`

Allows access when:

```txt
user is admin
OR user.email contains configured substring
```

Used by the `homepage` global update policy.

## `enforceOwnershipHook(fieldName)`

Before validation:

```txt
On create:
  set data[fieldName] = current user id

On update:
  preserve original owner if one exists
  otherwise set owner to current user id
```

This prevents clients from assigning arbitrary owners.

## Collection Policy Matrix

| Collection | Create | Read | Update | Delete |
|---|---|---|---|---|
| `users` | Admin | Authenticated | Admin or self | Admin |
| `media` | Authenticated | `publishedMediaReadAccess` | Owner/admin | Owner/admin |
| `books` | Authenticated | `publicBooksReadAccess` | Owner/admin | Owner/admin + no chapters |
| `chapters` | Authenticated | `chaptersReadAccess` | Owner/admin | Owner/admin |
| `posts` | Authenticated | `postsReadAccess` | Owner/admin | Owner/admin |
| `categories` | Authenticated | Authenticated | Owner/admin | Owner/admin |
| `comments` | Admin | Admin | Admin | Admin |
| `grant-mirror` | Admin | Admin | Admin | Admin |
| `deferred-grants` | Admin | Admin | Admin | Admin |
| `reading-progress` | Authenticated | Owner/admin | Owner/admin | Owner/admin |
| `bookmarks` | Authenticated | Owner/admin | Owner/admin | Owner/admin |
| `homepage` global | N/A | Public | Admin or email contains `quanghuy1242` | N/A |

---

# 1. Users

## Collection Access

| Operation | Policy |
|---|---|
| Create | Admin only |
| Read | Authenticated users |
| Update | Admin or self |
| Delete | Admin only |

## Field Access

| Field | Access |
|---|---|
| `email` | Read by admin or self |
| `avatar` | Read by authenticated users; update by admin or self |
| `bio` | Read by authenticated users; update by admin or self |
| `role` | Create/read/update by admin only |
| `betterAuthUserId` | Read by admin only; admin UI read-only |

## Hooks Affecting Access

### `usersBeforeValidateHook`

Non-admin users cannot set their own role.

Behavior:

```txt
On create by non-admin:
  force role = 'user'

On update by non-admin:
  preserve original role or fallback to 'user'
```

### `usersBeforeChangeHook`

Creates or preserves Better Auth identity linkage.

Important behavior:

```txt
On user create:
  if betterAuthUserId is missing, attempts to provision Better Auth user.

On update:
  preserves existing betterAuthUserId if present.
```

### `usersAfterOperationHook`

After user creation, drains deferred grants for the new Better Auth user.

## Migration Notes

Recommended new architecture mapping:

```txt
UserPolicy.canCreate      -> admin only
UserPolicy.canRead        -> authenticated
UserPolicy.canUpdate      -> admin or self
UserPolicy.canDelete      -> admin only
UserPolicy.canManageRole  -> admin only
```

Keep role assignment server-controlled.

---

# 2. Media

## Collection Access

| Operation | Policy |
|---|---|
| Create | Authenticated |
| Read | `publishedMediaReadAccess` |
| Update | Owner/admin via `owner` |
| Delete | Owner/admin via `owner` |

## Ownership

`beforeValidate` uses:

```txt
enforceOwnershipHook('owner')
```

So:

```txt
On create:
  owner = current user id

On update:
  owner cannot be changed by client input
```

## Read Policy: `publishedMediaReadAccess`

Admin:

```txt
admin can read all media
```

Owner:

```txt
media owner can read own media
```

Referenced media:

A media document is readable when it is referenced by readable content:

```txt
posts.coverImage
posts.meta.image
posts.content rich text references
categories.image
books.cover
users.avatar
homepage.imageBanner
```

Fallback:

```txt
if anonymous and not referenced -> deny
if authenticated and not referenced -> owner filter
```

## Important Nuance

When Payload calls the read access function without a specific `data` or `id`, the function returns `true`.

That means list-level media reads may be broader than individual record reads depending on how Payload invokes access for the request.

Recommendation for the new architecture:

```txt
Do not copy this blindly.
Make media list access explicit:
  admin -> all
  owner -> own media
  public -> only public/ready/referenced media
```

## Hooks Affecting Access/Side Effects

### `afterChange`

On create, media variants are generated:

```txt
lowResUrl
optimizedUrl
responsive variants
```

### `afterDelete`

Deletes optimized/responsive R2 variants.

## Migration Notes

Use the newer media visibility model:

```txt
originals: always private
variants: private by default
public variants: explicit publish action
```

Recommended policy methods:

```ts
MediaPolicy.canCreate(actor)
MediaPolicy.canRead(actor | null, media)
MediaPolicy.canUpdate(actor, media)
MediaPolicy.canDelete(actor, media)
MediaPolicy.canPublish(actor, media)
MediaPolicy.canUnpublish(actor, media)
```

---

# 3. Books

## Collection Access

| Operation | Policy |
|---|---|
| Create | Authenticated |
| Read | `publicBooksReadAccess` |
| Update | Owner/admin via `createdBy` |
| Delete | Owner/admin + no chapters |

## Ownership

`beforeValidate` uses:

```txt
enforceOwnershipHook('createdBy')
```

## Read Policy: `publicBooksReadAccess`

Admin:

```txt
admin can read all books
```

Anonymous:

```txt
visibility = public
AND _status = published
```

Authenticated non-admin:

```txt
book is public + published
OR book.createdBy = current user
OR user has active GrantMirror access to private book
```

Auther grant mirror behavior:

```txt
grant-mirror rows are queried for:
  payloadUserId = current user
  entityType = 'book'
  syncStatus = 'active'
```

Grant rows can be:

```txt
unconditional:
  grant is trusted from local mirror

requiresLiveCheck:
  call Auther check-permission batch if session token exists
  fail closed when token is missing
```

Wildcard grant:

```txt
entityId = '*'
```

If approved, user can read all private books.

## Delete Policy: `bookDeleteAccess`

A book can be deleted only when:

```txt
requester owns the book or is admin
AND book has zero chapters
```

There is also a `beforeDelete` hook that enforces the no-chapters rule.

## Hooks Affecting Access/Side Effects

| Hook | Behavior |
|---|---|
| `enforceOwnershipHook('createdBy')` | Assigns/preserves owner |
| `createRandomizedSlugHook` | Generates slug |
| `applyBookImportLifecycleHook` | Controls import timestamps/status |
| `enforceBookHasNoChaptersBeforeDelete` | Blocks delete if chapters exist |
| `booksAfterDeleteGrantMirrorHook` | Revokes grant mirror rows for deleted book |
| cache purge hooks | Purge book caches after change/delete |

## Migration Notes

Recommended policy methods:

```ts
BookPolicy.canCreate(actor)
BookPolicy.canRead(actor | null, book)
BookPolicy.canUpdate(actor, book)
BookPolicy.canDelete(actor, book, chapterCount)
BookPolicy.canManageGrants(actor, book)
```

The read policy should become:

```txt
public published book -> anonymous allowed
owner -> allowed
admin -> allowed
active relationship/grant -> allowed
conditioned grant -> live check or fail closed
```

---

# 4. Chapters

## Collection Access

| Operation | Policy |
|---|---|
| Create | Authenticated |
| Read | `chaptersReadAccess` |
| Update | Owner/admin via `createdBy` |
| Delete | Owner/admin via `createdBy` |

## Ownership

`beforeValidate` uses:

```txt
enforceOwnershipHook('createdBy')
```

## Read Policy: `chaptersReadAccess`

Admin:

```txt
admin can read all chapters
```

Anonymous:

```txt
book.visibility = public
AND chapter._status = published
```

Authenticated non-admin:

```txt
chapter belongs to public published book
OR chapter.createdBy = current user
OR user has active grant mirror access to parent private book
```

Private book grants reuse the same GrantMirror private book read logic as books.

## Field-Level Access: `content`

`content` uses:

```txt
chapterContentReadAccess
```

Behavior:

```txt
authenticated users:
  allowed to read content field

anonymous users:
  must pass canReadChapterContentForRequest
  this can include chapter password proof
```

## Important Nuance

The field-level chapter content password gate allows any authenticated user through the field-level check.

Collection-level read still limits private chapters, but for public password-protected chapters, authenticated users may bypass the password field gate.

Recommendation for new architecture:

```txt
Decide whether chapter password should apply to all readers or anonymous readers only.
Do not accidentally preserve this if it is not intended.
```

## Password Hooks

### `syncChapterPasswordStateHook`

Before change:

```txt
hashes new password
clears password when empty string supplied
sets hasPassword
increments passwordVersion when password changes
```

### `applyChapterPasswordReadStateHook`

After read:

```txt
hides raw password
hides passwordVersion
derives hasPassword from storage
```

## Other Hooks Affecting Access/Invariants

| Hook | Behavior |
|---|---|
| `enforceChapterBookOwnershipHook` | Non-admin can only assign chapter to a book they own |
| `enforceUniqueChapterOrderHook` | Unique order per book |
| cache purge hooks | Purge chapter/book route caches |

## Migration Notes

Recommended policy methods:

```ts
ChapterPolicy.canCreate(actor, book)
ChapterPolicy.canRead(actor | null, chapter, book)
ChapterPolicy.canReadContent(actor | null, chapter, proof)
ChapterPolicy.canUpdate(actor, chapter)
ChapterPolicy.canDelete(actor, chapter)
```

Separate collection-level read from content-level password access.

---

# 5. Posts

## Collection Access

| Operation | Policy |
|---|---|
| Create | Authenticated |
| Read | `postsReadAccess` |
| Update | Owner/admin via `author` |
| Delete | Owner/admin via `author` |

## Ownership

`beforeValidate` uses:

```txt
enforceOwnershipHook('author')
```

## Read Policy: `postsReadAccess`

Anonymous:

```txt
_status = published
```

Admin:

```txt
can read all posts
```

Authenticated non-admin:

```txt
post.author = current user
OR _status = published
```

## Hooks Affecting Access/Side Effects

```txt
enforceOwnershipHook('author')
createRandomizedSlugHook('title')
validateImmutableSlug
```

## Migration Notes

Recommended policy methods:

```ts
PostPolicy.canCreate(actor)
PostPolicy.canRead(actor | null, post)
PostPolicy.canUpdate(actor, post)
PostPolicy.canDelete(actor, post)
PostPolicy.canPublish(actor, post)
PostPolicy.canUnpublish(actor, post)
```

Read behavior:

```txt
published -> public
draft -> author/admin only
```

Publishing should be an explicit use case.

---

# 6. Categories

## Collection Access

| Operation | Policy |
|---|---|
| Create | Authenticated |
| Read | Authenticated |
| Update | Owner/admin via `createdBy` |
| Delete | Owner/admin via `createdBy` |

## Ownership

`beforeValidate` uses:

```txt
enforceOwnershipHook('createdBy')
```

## Hooks

```txt
createSlugHook('name')
validateImmutableSlug
```

## Migration Notes

Categories are a good generic CRUD candidate if the same access policy is preserved.

Recommended policy:

```txt
create -> authenticated
read -> authenticated
update/delete -> owner or admin
```

If categories need to be public because posts are public, revisit this rule.

---

# 7. Comments

## Collection Access

Payload collection access is admin-only:

| Operation | Policy |
|---|---|
| Create | Admin |
| Read | Admin |
| Update | Admin |
| Delete | Admin |

## Important Nuance

The collection itself is admin-only, but the repo also contains public/comment-facing utility logic. Public comment APIs are implemented outside the Payload collection access layer.

Do not infer that only admins can comment in the product. Instead:

```txt
Payload collection CRUD:
  admin-only moderation backend

Public comment API:
  custom API layer with separate policy logic
```

## Comment Statuses

```txt
pending
approved
rejected
```

## Public Comment Logic In Utilities

### Target validation

A comment must target exactly one of:

```txt
chapter
post
```

Not both, not neither.

### Chapter target readability

To comment on a chapter:

```txt
target chapter must exist
requester must be able to read the chapter through collection access
chapter password proof must pass when required
```

### Post target readability

To comment on a post:

```txt
post must be published
```

### Parent comment rules

For replies:

```txt
parent comment must exist
parent must target same chapter/post
parent must be top-level
parent must be approved
replies-to-replies are not supported
```

### User role

There are two helper variants:

```txt
assertCommentCreateRole:
  user must exist
  user.role must be 'user'

assertAuthenticatedCommentUser:
  user must exist and have normalized id
```

The stricter helper excludes admins from commenting through the public interface.

### Content validation

```txt
content must be string
content is trimmed
content cannot be empty
content max length = 550
```

### Rate limits

```txt
5 comments per target per 10 minutes
20 comments globally per hour
```

### Edit/delete ownership

A comment author can modify their own comment only.

Edit window:

```txt
5 hours after creation
```

Editable statuses:

```txt
pending
approved
```

Deleted comments cannot be edited.

### Update immutability

The following are immutable after creation:

```txt
author
chapter
post
parentComment
```

### Moderation fields

When status changes away from pending:

```txt
moderatedAt is set
moderatedBy is set to current user when available
```

When status resets to pending:

```txt
moderatedAt = null
moderatedBy = null
```

Reset to pending is tightly restricted.

## Migration Notes

Recommended split:

```txt
CommentModerationPolicy
  admin moderation operations

CommentPublicPolicy
  create/edit/delete own comments
  target readability
  parent validation
  rate limit
```

Recommended use cases:

```txt
CreateCommentUseCase
ListCommentsUseCase
EditOwnCommentUseCase
DeleteOwnCommentUseCase
ModerateCommentUseCase
```

Do not expose raw admin collection CRUD as the public comment API.

---

# 8. Grant Mirror

## Collection Access

All operations are admin-only:

```txt
create/read/update/delete -> admin
```

## Purpose

`grant-mirror` is an internal read model for Auther grants.

It supports fast local access filtering for private books/chapters.

## Important Fields

```txt
payloadUserId
entityType
entityId
relation
sourceSubjectType
requiresLiveCheck
syncStatus
syncedAt
```

## Access Semantics

Only active rows participate in access:

```txt
syncStatus = active
```

Rows with `requiresLiveCheck = true` require a live Auther batch permission check if a session token is available.

If the live check cannot run:

```txt
conditioned grant fails closed
```

## Migration Notes

This maps naturally to your new ReBAC/relationship system:

```txt
GrantMirror -> RelationshipRepository / GrantProjectionRepository
```

Do not treat it as user-editable data.

Recommended actor access:

```txt
system actor -> create/update/delete projection rows
admin -> inspect/debug
ordinary users -> no direct access
```

---

# 9. Deferred Grants

## Collection Access

All operations are admin-only:

```txt
create/read/update/delete -> admin
```

## Purpose

Internal queue/read model for grant events that arrive before the target Payload user exists.

Also stores revocation tombstones.

## Important Fields

```txt
betterAuthUserId
tupleId
entityType
entityId
relation
sourceSubjectType
hasCondition
status
processedAt
type
```

## Statuses

```txt
pending
processed
expired
```

## Types

```txt
grant
revocation_tombstone
```

## Migration Notes

In the new architecture, this should become an internal event/projection module:

```txt
AuthzDeferredGrantRepository
ProcessDeferredGrantUseCase
DrainDeferredGrantsForUserUseCase
```

Do not expose CRUD to normal users.

---

# 10. Reading Progress

## Collection Access

| Operation | Policy |
|---|---|
| Create | Authenticated |
| Read | Owner/admin via `user` |
| Update | Owner/admin via `user` |
| Delete | Owner/admin via `user` |

## Ownership

`beforeValidate` uses:

```txt
enforceOwnershipHook('user')
```

So the client cannot write progress for another user.

## Hooks

```txt
readingProgressBeforeChangeHook
```

Access-relevant intent:

```txt
progress is owned per user
book/chapter relationship must be coherent
completion timestamp may be managed automatically
```

## Migration Notes

Good candidate for generic CRUD with owner policy plus use-case-level validation.

Recommended policy:

```txt
create -> authenticated, server assigns user
read/update/delete -> owner or admin
```

---

# 11. Bookmarks

## Collection Access

| Operation | Policy |
|---|---|
| Create | Authenticated |
| Read | Owner/admin via `user` |
| Update | Owner/admin via `user` |
| Delete | Owner/admin via `user` |

## Ownership

`beforeValidate` uses:

```txt
enforceOwnershipHook('user')
```

## Content Target

Bookmark can target either:

```txt
book
chapter
```

depending on:

```txt
contentType = book | chapter
```

## Hooks

```txt
bookmarksBeforeChangeHook
```

Access-relevant intent:

```txt
bookmark target must match contentType
bookmark belongs to current user
```

## Migration Notes

Good candidate for generic CRUD with owner policy plus target validation.

Recommended policy:

```txt
create -> authenticated, server assigns user
read/update/delete -> owner or admin
```

---

# 12. Homepage Global

## Global Access

| Operation | Policy |
|---|---|
| Read | Public |
| Update | Admin or email contains `quanghuy1242` |

## Migration Notes

Treat as a singleton/global content resource.

Recommended policy:

```ts
HomepagePolicy.canRead(actor | null) -> true
HomepagePolicy.canUpdate(actor) -> admin OR configured maintainer email/domain
```

Avoid hardcoding personal email substrings directly in business logic. Prefer env/config:

```txt
HOMEPAGE_EDITOR_EMAIL_ALLOWLIST
```

---

# Cross-Cutting Security Observations

## 1. Owner Fields Are Server-Controlled

Current Payload hooks prevent clients from taking ownership of resources.

Preserve this in the new architecture:

```txt
Do not accept owner/createdBy/author/user from request body for owned resources.
Use actor.id inside use cases.
```

## 2. Draft/Published Visibility Is Central

Current public read rules rely heavily on:

```txt
_status = published
```

For the new architecture, model this explicitly:

```txt
draft -> owner/admin only
published -> public or grant-based depending on resource visibility
```

## 3. Books And Chapters Share Private Access

Private book grants unlock:

```txt
private books
chapters belonging to private books
```

This should become a reusable policy path:

```txt
BookPolicy.canRead
ChapterPolicy.canRead delegates to BookPolicy/private grant logic
```

## 4. GrantMirror Is A Projection, Not Source Of Truth

Current app mirrors Auther grants locally for read performance.

New architecture should preserve the distinction:

```txt
relationship/grant projection table = local read model
canonical grant source = external authz system or new relationship writer
```

## 5. Chapter Password Logic Needs Product Decision

Current field-level behavior:

```txt
authenticated users can read chapter content field
anonymous users may need password proof
```

Decide whether the intended rule is:

```txt
password protects from anonymous users only
```

or:

```txt
password protects from all non-owner readers
```

This affects the new `ChapterPolicy.canReadContent`.

## 6. Media Read Policy Should Be Tightened

Current Payload media read logic is reference-based and may be permissive for list reads.

Recommended new rule:

```txt
media original:
  private/system only

media variant:
  public only when media visibility is public and ready
  otherwise authenticated + policy check

media list:
  admin all
  owner own
  public only public/ready media
```

## 7. Comments Need Separate Public API Policy

Current `comments` collection is admin-only, while public comment behavior lives in utilities.

Do not model comments as plain CRUD.

Use explicit use cases for:

```txt
create public comment
edit own comment
delete own comment
list public comments
moderate comment
```

## Suggested New Architecture Policy Modules

```txt
domain/authz/
  actor.ts
  relationship.repository.ts
  assert-allowed.ts

domain/users/
  user.policy.ts

domain/media/
  media.policy.ts

domain/books/
  book.policy.ts

domain/chapters/
  chapter.policy.ts
  chapter-password.policy.ts

domain/posts/
  post.policy.ts

domain/categories/
  category.policy.ts

domain/comments/
  comment-public.policy.ts
  comment-moderation.policy.ts

domain/reading/
  reading-progress.policy.ts
  bookmark.policy.ts

domain/homepage/
  homepage.policy.ts

domain/authz-projections/
  grant-mirror.policy.ts
  deferred-grant.policy.ts
```

## Suggested Policy Method Matrix

| Module | Methods |
|---|---|
| `UserPolicy` | `canCreate`, `canRead`, `canUpdate`, `canDelete`, `canManageRole` |
| `MediaPolicy` | `canCreate`, `canRead`, `canUpdate`, `canDelete`, `canPublish`, `canUnpublish`, `canReadOriginal` |
| `BookPolicy` | `canCreate`, `canRead`, `canUpdate`, `canDelete`, `canManageGrants` |
| `ChapterPolicy` | `canCreate`, `canRead`, `canReadContent`, `canUpdate`, `canDelete` |
| `PostPolicy` | `canCreate`, `canRead`, `canUpdate`, `canDelete`, `canPublish`, `canUnpublish` |
| `CategoryPolicy` | `canCreate`, `canRead`, `canUpdate`, `canDelete` |
| `CommentPublicPolicy` | `canCreate`, `canEditOwn`, `canDeleteOwn`, `canReadThread` |
| `CommentModerationPolicy` | `canModerate`, `canAdminRead`, `canAdminDelete` |
| `ReadingProgressPolicy` | `canCreate`, `canRead`, `canUpdate`, `canDelete` |
| `BookmarkPolicy` | `canCreate`, `canRead`, `canUpdate`, `canDelete` |
| `HomepagePolicy` | `canRead`, `canUpdate` |
| `GrantProjectionPolicy` | `canInspect`, `canMutateProjection` |

## Payload Hook To New Architecture Mapping

| Payload Hook/Access | New Architecture Home |
|---|---|
| `authenticatedAccess` | middleware/auth + policy checks |
| `adminAccess` | policy helper `actor.type === user && actor.role === admin` |
| `ownerAccess(field)` | module policy ownership check |
| `enforceOwnershipHook` | create/update use cases assign owner from actor |
| `publicBooksReadAccess` | `BookPolicy.canRead` + repository filters |
| `chaptersReadAccess` | `ChapterPolicy.canRead` |
| `postsReadAccess` | `PostPolicy.canRead` |
| `publishedMediaReadAccess` | replace with stricter `MediaPolicy.canRead` |
| `bookDeleteAccess` | `BookPolicy.canDelete` + chapter count check |
| `enforceChapterBookOwnershipHook` | `CreateChapterUseCase` / `UpdateChapterUseCase` |
| `chapterContentReadAccess` | `ChapterPolicy.canReadContent` |
| comment utility assertions | `CommentPublicPolicy` + comment use cases |
| GrantMirror access | internal/system-only projection policies |

## Implementation Priority

Recommended policy implementation order:

```txt
1. Actor model and role helpers
2. UserPolicy
3. MediaPolicy
4. BookPolicy
5. ChapterPolicy
6. PostPolicy
7. CategoryPolicy
8. CommentPublicPolicy + CommentModerationPolicy
9. ReadingProgressPolicy
10. BookmarkPolicy
11. GrantProjectionPolicy
12. HomepagePolicy
```

## Open Questions To Resolve Before Porting

1. Should chapter passwords apply to authenticated users, or only anonymous readers?
2. Should media referenced by a public document automatically become publicly readable?
3. Should categories remain authenticated-only, or become public because public posts reference them?
4. Should public comments allow admins to comment from the public interface, or only normal users?
5. Should private book access be represented by external Auther grants, local ReBAC relationships, or both?
6. Should public media URLs be permanent, versioned, or revocable through cache purge?

## Final Recommendation

Port the Payload access model as explicit policy objects and use cases.

Do not port Payload hooks directly as scattered route/repository logic.

The most important access rules to preserve are:

```txt
server-assigned ownership
admin bypass for management operations
public published reads for posts/books/chapters
private book grant mirror access
chapter content password gating
media owner/public/reference read behavior, but tightened
comment public API separate from admin collection access
internal grant/deferred-grant collections admin/system only
```

The most important rules to reconsider are:

```txt
media list read permissiveness
chapter password bypass for authenticated users
categories authenticated-only read
homepage update allowlist hardcoded by email substring
```
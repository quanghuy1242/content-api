# 011 — Post-006/007 Gap Fixes and Follow-up Architectural Decisions

Full codebase audit against docs 006 (Migrate Auther → `id`), 007 (Content IAM Policy Binding Model), and `~/pjs/auth/docs/010` (`id` token contract). All Auther-era fields were already removed in the prior three fix batches. Three residual bugs were found and fixed, followed by two architectural decisions on route organization and category access model.

---

## Audit scope

| Area | Status |
|---|---|
| No `better_auth_user_id` anywhere in schema/entities | ✅ Clean |
| No `token_use` JWT claim handling | ✅ Clean |
| No JWT-role-derived `role` on actor | ✅ Clean — `UserActor.role` reads from local `users.role` DB field |
| Post/media/category entities reference `users.id` FK | ✅ Clean |
| All write use cases use Content IAM (`contentPolicy.can`) | ✅ Clean |
| All create use cases use `requireOwnedContentCreateContext` + atomic owner binding | ✅ Clean |
| `workers/media-processor` not broken by auth changes | ✅ Clean — operates as a background worker with no actor context |
| Auth token shapes match `id` contract (workspace/direct-share/M2M) | ✅ Clean |

---

## Bug 1 — `postToUpdateRow` included immutable `author` field

**File:** `src/infrastructure/repositories/mappers/post.mapper.ts`

`postToUpdateRow` was including `author: snapshot.author` in every SQL `UPDATE SET` clause. `author` is set at creation time and is never part of `UpdatePostProps`; it cannot change after creation. Including it was harmless but semantically wrong — it silently overwrote the column with its own current value on every save, and it meant any future refactor that made `author` nullable would accidentally null it out.

**Fix:** Removed `author` from the returned object in `postToUpdateRow`.

---

## Bug 2 — `presentMedia` leaked internal R2 storage keys

**File:** `src/http/presenters/media.presenter.ts`

`presentMedia` spread the full `media.toSnapshot()` object into the response:

```ts
const response = {
  ...snapshot,  // ← included originalKey and variantKeys
  ...
};
```

`MediaProps` (and therefore `toSnapshot()`) contains `originalKey` (the R2 object key for the original upload) and `variantKeys` (R2 keys for each processed variant). These are internal infrastructure identifiers that should never leave the API boundary. They were not in `mediaResponseSchema`, but because spread is untyped at runtime the extra keys were included in the serialized JSON response.

**Fix:** Replaced the spread with an explicit field-by-field construction that exactly matches `mediaResponseSchema`. `originalKey` and `variantKeys` are now never present in API responses.

---

## Bug 3 — Dead visibility predicate code in `DrizzlePostRepository.findMany`

**Files:**
- `src/infrastructure/repositories/drizzle-post.repository.ts`
- `src/domain/posts/post.repository.ts`
- `src/application/posts/list-posts.usecase.ts`

`PostRepository.findMany` accepted three parameters (`actorId`, `includeDrafts`, `includeAll`) that were holdovers from the pre-IAM authz model where the DB query itself filtered by actor ownership. After the Content IAM migration, `ListPostsUseCase` always calls `findMany` with `actorId: null, includeAll: true`, which causes the visibility predicate block to be dead code — it is never entered. The `or(...)` + `eq(posts.author, actorId)` SQL condition was never evaluated.

**Fix:**
1. Removed `actorId`, `includeDrafts`, `includeAll` from `PostRepository.findMany` interface.
2. Removed the visibility predicate block from `DrizzlePostRepository.findMany`.
3. Removed the now-unused `or` and `SQL` imports from `drizzle-orm`.
4. Updated `ListPostsUseCase` to call `findMany({ limit, cursor })` only.

The IAM filtering that replaced this remains correctly in `ListPostsUseCase.execute` via `contentPolicy.canMany`.

---

## `workers/media-processor` — confirmed not broken

The media processor worker handles R2 upload-complete events directly via a queue binding. It uses `DrizzleMediaRepository` and `ProcessMediaUploadUseCase` with no actor context. It has its own `wrangler.jsonc`, its own `DB`/`MEDIA_R2`/`IMAGES` bindings, and no dependency on `authenticate-bearer-token` or any auth middleware. The 006/007 changes do not affect it.

---

## Decision 1 — Book IAM routes belong under `/books`, not `/content-iam`

### Problem

The eight book IAM endpoints (`policy-bindings`, `policy-denials`, `ownership-transfer`, `policy-events`) were registered in `content-iam.routes.ts` alongside the org-scoped IAM routes, even though their URLs were already correctly nested under `/books/{bookId}/...`.

### Decision

Resource IAM management belongs under the resource's own route file. This follows the GCP Cloud IAM convention where `projects.getIamPolicy` / `projects.setIamPolicy` live under the Projects resource, not in a separate IAM service. The book IAM routes have been moved into `books.routes.ts`.

### Scope rule going forward

| Resource | IAM routes? | Location |
|---|---|---|
| Organization | ✅ org-level bindings/denials/roles/events | `content-iam.routes.ts` |
| Book | ✅ per-resource bindings/denials/ownership/events | `books.routes.ts` |
| Post | ❌ single-owner, no per-resource IAM surface | — |
| Category | ❌ org-role-managed, see Decision 2 | — |
| Media | ⏳ deferred (complex book-media IAM intersection) | — |

`content-iam.routes.ts` is now purely org-scoped: role CRUD and org-level bindings/denials/events. No resource-specific routes live there.

---

## Decision 2 — Categories are org-owned, not user-owned

### Problem

`CreateCategoryUseCase` was creating a `system:category.owner` binding for the creator of each category, making categories behave like user-owned resources (post-style). This was incorrect because:

1. **Categories are org-global.** Within an org, category names are unique. The taxonomy belongs to the org, not to any individual user.
2. **The ownership model produced inconsistent access.** Alice creates "Technology" → Alice is the owner → Bob cannot edit "Technology" even as a fellow org author. Org authors should collectively manage the shared taxonomy.
3. **Per-category IAM management routes would be redundant.** Unlike books (explicitly collaborative with co-author/editor roles), there is no meaningful "per-category sharing" use case.

### Decision

Categories are managed exclusively through org-level roles. No per-category IAM binding is created on creation.

**`system:org.author`** now includes `category.read`, `category.update`, `category.delete` in addition to the existing create permissions. Org authors collectively own the category taxonomy.

**`system:category.owner`** is preserved in `BUILT_IN_CONTENT_ROLES` to avoid orphaning any historical bindings in production, but it is no longer assigned on category creation. New code must not create bindings for this role. A future cleanup migration can remove historical bindings if desired.

**`createdBy` on the `Category` entity** is an audit field only — it records who created the category for traceability, but grants no additional access. It is documented as such in the type definition.

### Access matrix after this change

| Actor | category.read | category.update | category.delete |
|---|---|---|---|
| `system:org.content_admin` binding | ✅ | ✅ | ✅ |
| `system:org.author` binding | ✅ | ✅ | ✅ |
| No org binding | ❌ | ❌ | ❌ |

### Files changed

- `src/domain/iam/content-permission.ts` — added category permissions to `system:org.author`; deprecated comment on `system:category.owner`
- `src/domain/categories/category-create.workflow.ts` — removed `ownerBinding` and `event` params; interface now has `create` and `createWithIdempotency` only
- `src/infrastructure/repositories/drizzle-category-create.workflow.ts` — simplified to insert category row only (no binding or event)
- `src/application/categories/create-category.usecase.ts` — removed `createDirectOwnerBinding` / `createOwnerAssignedEvent` usage; renamed `ownerId` → `createdById` to reflect audit semantics
- `src/domain/categories/category.entity.ts` — JSDoc on `createdBy` clarifying it is audit-only
- `tests/api.test.ts` — removed `binding-category-owner` seed fixture; renamed the related test to reflect the org-role model

---

## What was intentionally NOT changed

- **`list-categories.usecase.ts` and `get-category.usecase.ts`** still run `contentPolicy.canMany/can` with `category.read`. The check mechanism is unchanged; only the source of the permission grant moved from per-category bindings to org-level role bindings.
- **Media IAM routes** — deferred. Media can be attached to books, and the correct IAM model for media-attached-to-book (does book read imply media read?) is not yet settled. Will be addressed when doc 009 (book resource hierarchy) is finalized.
- **Post IAM routes** — deliberately absent. Posts are single-author resources; the existing `system:post.owner` per-post binding model is correct.

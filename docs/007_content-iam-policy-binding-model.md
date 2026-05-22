# Content IAM Policy Binding Model

> Status: implementation-grade proposal
>
> Date: 2026-05-22
>
> Scope:
>
> - `/home/quanghuy1242/pjs/content-api` — design and implement content-owned authorization for books, chapters, sections, comments, media, and related reading features.
> - `/home/quanghuy1242/pjs/auth` — prerequisite identity/token contract only: stable teams, team membership, `team_ids`, M2M client identity, org-scoped tokens.
>
> Source docs:
>
> - `docs/architecture.md`
> - `docs/payloadcms-schema-spec.md`
> - `docs/payloadcms-access-control-policy-spec.md`
> - `docs/006_migrate-auther-to-id.md`
> - `/home/quanghuy1242/pjs/auth/docs/010_organization-teams-oauth-flow.md`
> - `/home/quanghuy1242/pjs/payloadcms/src/utils/access.ts`
> - `/home/quanghuy1242/pjs/payloadcms/src/utils/grantMirror.ts`
> - `/home/quanghuy1242/pjs/payloadcms/src/utils/comments.ts`
> - `/home/quanghuy1242/pjs/payloadcms/src/utils/chapterPasswords.ts`
> - `/home/quanghuy1242/pjs/payloadcms/src/collections/Books.ts`
> - `/home/quanghuy1242/pjs/payloadcms/src/collections/Chapters.ts`
> - `/home/quanghuy1242/pjs/payloadcms/src/collections/Comments.ts`
> - `/home/quanghuy1242/pjs/payloadcms/src/collections/Media.ts`
>
> Related docs:
>
> - `/home/quanghuy1242/pjs/auth/docs/005_oauth2-oidc-integration-guide.md`
> - `/home/quanghuy1242/pjs/auth/docs/006_resource-server-jwt-guide.md`
> - `/home/quanghuy1242/pjs/auth/docs/008_legacy-auth-flow-analysis.md`
>
> Assumptions:
>
> - `id` stays a generic Better Auth-aligned identity/OAuth service, not a content authorization service.
> - `id` will provide stable team IDs and `team_ids` in user access tokens for the active organization.
> - `content-api` owns concrete content resources and therefore owns final object authorization.
> - Book collaboration is a primary product requirement, not a later edge case.

## Table Of Contents

- [1. Goal](#1-goal)
- [2. System Summary](#2-system-summary)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 PayloadCMS Authorization Is Real But Scattered](#31-payloadcms-authorization-is-real-but-scattered)
  - [3.2 Content API Current Authorization](#32-content-api-current-authorization)
  - [3.3 `id` Current And Planned Contract](#33-id-current-and-planned-contract)
  - [3.4 Product Requirements From The Book System](#34-product-requirements-from-the-book-system)
- [4. Target Model](#4-target-model)
  - [4.1 Ownership Boundaries](#41-ownership-boundaries)
  - [4.2 Resource Hierarchy](#42-resource-hierarchy)
  - [4.3 Principals](#43-principals)
  - [4.4 Roles And Permissions](#44-roles-and-permissions)
  - [4.5 Policy Bindings](#45-policy-bindings)
  - [4.6 Policy Evaluation](#46-policy-evaluation)
- [5. Architecture Decisions](#5-architecture-decisions)
  - [5.1 Call This Content IAM, Not ReBAC](#51-call-this-content-iam-not-rebac)
  - [5.2 Keep Role Semantics In Content API Code](#52-keep-role-semantics-in-content-api-code)
  - [5.3 Store Bindings Locally, Not In `id`](#53-store-bindings-locally-not-in-id)
  - [5.4 Use Teams As Principals, Not Orgs](#54-use-teams-as-principals-not-orgs)
  - [5.5 Avoid Cross-Request Policy Caches](#55-avoid-cross-request-policy-caches)
  - [5.6 Keep Billing Separate From IAM](#56-keep-billing-separate-from-iam)
- [6. Proposed Data Model](#6-proposed-data-model)
  - [6.1 `content_policy_bindings`](#61-content_policy_bindings)
  - [6.2 `content_policy_events`](#62-content_policy_events)
  - [6.3 Resource Tables](#63-resource-tables)
  - [6.4 Local User Projection](#64-local-user-projection)
- [7. Content Policy API Shape](#7-content-policy-api-shape)
  - [7.1 Actor Shape](#71-actor-shape)
  - [7.2 Resource Reference Shape](#72-resource-reference-shape)
  - [7.3 Evaluator Methods](#73-evaluator-methods)
  - [7.4 List Filtering](#74-list-filtering)
- [8. Detailed Product Coverage](#8-detailed-product-coverage)
  - [8.1 Books](#81-books)
  - [8.2 Chapters, Sections, And Blocks](#82-chapters-sections-and-blocks)
  - [8.3 Comments And Inline Comments](#83-comments-and-inline-comments)
  - [8.4 Media](#84-media)
  - [8.5 Bookmarks And Reading Progress](#85-bookmarks-and-reading-progress)
  - [8.6 Recommendations](#86-recommendations)
  - [8.7 Chapter Locks And Passwords](#87-chapter-locks-and-passwords)
- [9. Implementation Strategy](#9-implementation-strategy)
- [10. Migration And Rollout](#10-migration-and-rollout)
- [11. Edge Cases And Failure Modes](#11-edge-cases-and-failure-modes)
- [12. Implementation Backlog](#12-implementation-backlog)
  - [IAM-A. Finalize `id` Token Inputs](#iam-a-finalize-id-token-inputs)
  - [IAM-B. Add Content IAM Domain Model](#iam-b-add-content-iam-domain-model)
  - [IAM-C. Add Persistence And Migrations](#iam-c-add-persistence-and-migrations)
  - [IAM-D. Add ContentPolicy Evaluator](#iam-d-add-contentpolicy-evaluator)
  - [IAM-E. Replace Relationship/Grant Mirror Usage](#iam-e-replace-relationshipgrant-mirror-usage)
  - [IAM-F. Add Book/Chapter Resource Model](#iam-f-add-bookchapter-resource-model)
  - [IAM-G. Add Tests And Verification](#iam-g-add-tests-and-verification)
- [13. Future Backlog](#13-future-backlog)
- [14. Definition Of Done](#14-definition-of-done)
- [15. Final Model](#15-final-model)

## 1. Goal

Design and implement a Content IAM model for `content-api` that can support serious book collaboration:

- author teams;
- editors;
- reviewers;
- beta readers;
- service-account importers;
- private media;
- nested chapters/sections/blocks;
- comments and inline comments;
- sharing at book/chapter/resource levels;
- request-time final authorization without querying `id`.

This replaces the Auther-era mirror-grant idea with content-owned policy bindings. `id` provides identity facts and coarse OAuth scopes. `content-api` owns content roles, concrete bindings, inheritance, and final authorization decisions.

## 2. System Summary

Target request flow:

```text
client
  -> obtains id access token with:
       aud = https://content-api.quanghuy.dev
       org_id = org_1
       scope = api:read api:write
       sub = user_1
       team_ids = [team_authors, team_editors]

content-api route
  -> verify JWT issuer/audience/org/scope
  -> load target resource and ancestry
  -> build actor:
       user:user_1
       team:team_authors
       team:team_editors
  -> ContentPolicy.can(actor, "chapter.update", chapterRef)
  -> repository mutation only after policy passes
```

The policy evaluator uses local D1 tables and local role semantics. It does not call `id` on hot paths.

## 3. Current-State Findings

### 3.1 PayloadCMS Authorization Is Real But Scattered

The PayloadCMS app shows the product complexity that `content-api` needs to absorb cleanly.

Observed access surfaces:

- `/home/quanghuy1242/pjs/payloadcms/src/utils/access.ts`
  - public/private books;
  - chapter read access;
  - owner checks;
  - grant mirror lookup;
  - media read access;
  - request-local grant cache.
- `/home/quanghuy1242/pjs/payloadcms/src/utils/grantMirror.ts`
  - Auther grant projection;
  - group expansion;
  - live permission batch checks;
  - reconciliation;
  - deferred grants.
- `/home/quanghuy1242/pjs/payloadcms/src/utils/comments.ts`
  - comment target readability;
  - comment ownership;
  - edit window;
  - rate limits;
  - moderation state.
- `/home/quanghuy1242/pjs/payloadcms/src/utils/chapterPasswords.ts`
  - chapter password hashes;
  - proof token creation;
  - proof verification;
  - password version invalidation.
- `/home/quanghuy1242/pjs/payloadcms/src/collections/Books.ts`
  - owner-only mutation;
  - public/private visibility;
  - grant access panel;
  - import lifecycle.
- `/home/quanghuy1242/pjs/payloadcms/src/collections/Chapters.ts`
  - chapter ownership;
  - book ownership validation;
  - password-gated content field access.
- `/home/quanghuy1242/pjs/payloadcms/src/collections/Media.ts`
  - owner-only mutation;
  - public/reference-based read behavior.

Conclusion: PayloadCMS did not fail because the rules are fake. It scattered real policy logic across framework hooks, collection access callbacks, GraphQL resolvers, and mirror utilities. `content-api` should centralize the vocabulary and decision path.

### 3.2 Content API Current Authorization

Current `content-api` resources use:

- local `users` table;
- `relationships` table for ReBAC-like facts;
- `grant_mirror` and `deferred_grants` tables from the Auther/PayloadCMS port;
- resource policies such as `PostPolicy`, `MediaPolicy`, and `CategoryPolicy`;
- owner relationships created during resource create workflows.

This is enough for blog-like resources, but not enough for book collaboration because:

- `relationships` is generic but not framed as IAM bindings;
- grant mirror is a projection from an external service, not source of truth;
- no explicit role/permission catalog exists;
- no resource hierarchy/inheritance exists;
- no team principal exists yet;
- no policy audit event model exists.

### 3.3 `id` Current And Planned Contract

Current `id` already provides:

- Better Auth users;
- organizations;
- organization members;
- OAuth clients;
- resource servers;
- JWT/JWKS;
- resource-bound access tokens.

The staged update in `/home/quanghuy1242/pjs/auth/docs/010_organization-teams-oauth-flow.md` plans:

- Better Auth teams as stable principal IDs;
- user token `team_ids` for teams in the active `org_id`;
- M2M principal identity from `azp` or `client_id`;
- resource APIs owning concrete grants and final object decisions.

That is the correct boundary for Content IAM.

`content-api` still needs these `id` contract details to be firm before implementation:

- product OAuth scopes must be bound to a resource server so generic scope names do not collide across APIs;
- user access tokens should include only teams inside the active `org_id`;
- `team_ids` overflow should fail token issuance rather than silently omitting teams;
- org-scoped M2M tokens must include `org_id`;
- old access tokens keep old `team_ids` until expiry.

### 3.4 Product Requirements From The Book System

The model must support:

- books as the central resource;
- nested chapters, sections, and blocks;
- comments on chapters and possibly nested comments;
- inline comments tied to a block or selected range;
- private media attached to book/chapter/section content;
- bookmarks;
- reading progress;
- recommendations;
- chapter locks/passwords or future access-pass equivalents;
- sharing books and chapters with users or teams;
- ghost writers, reviewers, editors, translators, media teams, and beta readers;
- service accounts for import/export/media processing;
- all books belonging to an organization while access is delegated to many teams.

## 4. Target Model

### 4.1 Ownership Boundaries

`id` owns:

```text
users
organizations
teams
team membership
OAuth clients
resource server audiences
JWT signing and JWKS
token claim contract
coarse OAuth scopes
```

`content-api` owns:

```text
books
chapters
sections
blocks
comments
inline comments
media
bookmarks
reading progress
recommendations
content role semantics
role -> permission mapping
content_policy_bindings
content_policy_events
resource hierarchy/inheritance
ContentPolicy.can(...)
```

### 4.2 Resource Hierarchy

First-class hierarchy:

```text
org
  book
    chapter
      section
        section
          block
      comment
      inline_comment
    media
```

Resource refs should carry ancestry explicitly:

```ts
type ResourceRef = {
  type: "chapter";
  id: string;
  orgId: string;
  ancestors: [
    { type: "book"; id: string },
    { type: "org"; id: string },
  ];
};
```

The policy evaluator should not recursively query parent resources. Use cases should load the resource and provide ancestry so policy lookup stays bounded.

### 4.3 Principals

Supported principals:

```text
user
team
service_account
```

Principal sources:

- `user` uses `id` `sub`.
- `team` uses Better Auth `team.id` from `team_ids`.
- `service_account` uses OAuth client ID from `azp` or `client_id`.

Books belong to an org, not to a team. Teams are collaboration/access units inside the org.

### 4.4 Roles And Permissions

`content-api` should define executable role semantics in code. This is long-term acceptable and matches Auth0-style API development: the identity provider issues trusted scopes/claims; the API owns its business authorization.

Example permission keys:

```ts
type ContentPermission =
  | "book.read"
  | "book.update"
  | "book.delete"
  | "book.manage_bindings"
  | "chapter.read"
  | "chapter.create"
  | "chapter.update"
  | "chapter.publish"
  | "section.update"
  | "block.comment"
  | "inline_comment.create"
  | "comment.moderate"
  | "media.read"
  | "media.create"
  | "media.attach"
  | "media.delete";
```

Example role mapping:

```ts
const CONTENT_ROLE_PERMISSIONS = {
  "book.owner": [
    "book.read",
    "book.update",
    "book.delete",
    "book.manage_bindings",
    "chapter.read",
    "chapter.create",
    "chapter.update",
    "chapter.publish",
    "section.update",
    "inline_comment.create",
    "comment.moderate",
    "media.read",
    "media.create",
    "media.attach",
    "media.delete",
  ],
  "book.editor": [
    "book.read",
    "book.update",
    "chapter.read",
    "chapter.create",
    "chapter.update",
    "section.update",
    "inline_comment.create",
    "media.read",
    "media.create",
    "media.attach",
  ],
  "book.reviewer": [
    "book.read",
    "chapter.read",
    "inline_comment.create",
  ],
  "book.reader": [
    "book.read",
    "chapter.read",
    "media.read",
  ],
} as const;
```

These constants are security-sensitive code. Changing them should go through code review and tests.

### 4.5 Policy Bindings

Bindings are active authorization state:

```text
principal has role on resource
```

Examples:

```text
team:team_authors has book.owner on book:book_1
team:team_editors has book.editor on book:book_1
team:team_reviewers has book.reviewer on chapter:chapter_4
user:user_1 has book.reader on book:book_1
service_account:client_importer has book.editor on book:book_1
```

Use the term `binding`, not `grant_mirror`. A binding is current state. Grant/revoke are events.

### 4.6 Policy Evaluation

Decision pipeline:

```text
1. Verify JWT issuer/audience/expiration.
2. Verify org_id matches resource org.
3. Verify required coarse OAuth scope.
4. Load target resource and ancestry.
5. Build principal candidates from actor:
   - user:sub
   - team:team_ids[]
   - service_account:client_id
6. Query content_policy_bindings for all candidate principals and resource ancestry.
7. Expand roles to permissions in code.
8. Apply content gates:
   - status/draft/published
   - visibility
   - lock/password proof
   - soft delete
   - comment edit window/rate limit where relevant
9. Allow or deny.
```

One object check should need at most one indexed policy-binding query after the resource is loaded.

## 5. Architecture Decisions

### 5.1 Call This Content IAM, Not ReBAC

The model borrows ReBAC tuple mechanics, but the product model is IAM:

```text
principal -> role -> permission -> resource
```

Use names:

- Content IAM
- ContentPolicy
- PolicyBinding
- PolicyEvent
- principal
- resource
- role
- permission

Avoid:

- grant mirror
- deferred grant
- Auther relationship
- generic ReBAC as the product-facing name

### 5.2 Keep Role Semantics In Content API Code

Recommended long-term approach:

- `content-api` source code defines `CONTENT_ROLE_PERMISSIONS`.
- `id` only needs OAuth scopes and team identity.
- Any `id` vocabulary UI is coordination/display, not the executable source of truth for content object decisions.

Rationale:

- Content authorization is product code and needs tests.
- A UI change in `id` must not silently change content access.
- This matches Auth0-style APIs: scopes are configured in the auth provider, but API code defines business rules.

### 5.3 Store Bindings Locally, Not In `id`

Concrete bindings belong next to concrete resources.

Rejected:

- Store `team has editor on book` in `id`.
- Query `id` during `ContentPolicy.can(...)`.
- Mirror an external grant system.

Rationale:

- `id` does not own books, chapters, sections, media, or comments.
- Local D1 checks avoid hot-path network calls.
- Local bindings avoid the Auther projection/reconciliation problem.

### 5.4 Use Teams As Principals, Not Orgs

Org is the tenant/workspace boundary. Team is the collaboration/access unit.

Do not make every team an org:

- people belong to multiple teams;
- multiple teams collaborate on the same book;
- billing, clients, resource servers, and workspace administration need one stable org boundary;
- teams can be renamed/archived/merged without changing tenant ownership.

### 5.5 Avoid Cross-Request Policy Caches

Use:

- D1 indexes;
- one-query binding checks;
- request-local memoization;
- batch `canMany` methods for lists.

Do not use KV for active policy state in the first implementation. Authorization cache invalidation is riskier than the expected D1 lookup cost.

### 5.6 Keep Billing Separate From IAM

IAM answers:

```text
Can this principal do this action on this resource?
```

Billing answers:

```text
Who owns/pays for this usage?
```

Keep billing at org level first. Add attribution fields such as `created_by_team_id` or usage events later. Do not make groups separate tenants just to track cost.

## 6. Proposed Data Model

### 6.1 `content_policy_bindings`

Drizzle sketch:

```ts
export const contentPolicyBindings = sqliteTable(
  "content_policy_bindings",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    role: text("role").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    createdByType: text("created_by_type").notNull(),
    createdById: text("created_by_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("content_policy_bindings_unique_idx").on(
      table.orgId,
      table.principalType,
      table.principalId,
      table.role,
      table.resourceType,
      table.resourceId,
    ),
    index("content_policy_bindings_principal_idx").on(
      table.orgId,
      table.principalType,
      table.principalId,
      table.resourceType,
      table.resourceId,
    ),
    index("content_policy_bindings_resource_idx").on(
      table.orgId,
      table.resourceType,
      table.resourceId,
      table.role,
    ),
    index("content_policy_bindings_expiry_idx").on(table.expiresAt),
  ],
);
```

Rules:

- `principal_type` is `user`, `team`, or `service_account`.
- `role` is one of the code-defined content role keys.
- role keys are immutable once used by bindings; if a role is removed or replaced, ship a binding migration first.
- `org_id` must match the resource's org.
- expired bindings are ignored.
- revocation deletes the active binding and writes an event.

### 6.2 `content_policy_events`

Append-only audit:

```ts
export const contentPolicyEvents = sqliteTable("content_policy_events", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  bindingId: text("binding_id"),
  action: text("action").notNull(),
  principalType: text("principal_type").notNull(),
  principalId: text("principal_id").notNull(),
  role: text("role").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id").notNull(),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id").notNull(),
  reason: text("reason"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});
```

Actions:

```text
binding.created
binding.revoked
binding.expired
binding.updated
```

Audit events are required from day one because sharing changes are security-sensitive.

### 6.3 Resource Tables

Book-system tables should include org and ownership fields:

```text
books
  id
  org_id
  created_by_user_id
  created_by_team_id nullable
  visibility
  status

chapters
  id
  org_id
  book_id
  parent_chapter_id nullable if needed
  created_by_user_id
  status

sections
  id
  org_id
  book_id
  chapter_id
  parent_section_id nullable
  order

content_blocks
  id
  org_id
  book_id
  chapter_id
  section_id nullable
  block_key
```

Direct owner fields are not a replacement for Content IAM. They are useful for defaults, audit, filtering, and bootstrapping owner bindings.

### 6.4 Local User Projection

`content-api` still needs local user/profile data for authorship and presentation. The Content IAM implementation should decide before real data exists:

- set `users.id = id.sub`; or
- keep separate local IDs and rename `better_auth_user_id` to `identity_subject`.

The first option simplifies bindings because `principal_id` for `user` equals the local user ID.

## 7. Content Policy API Shape

### 7.1 Actor Shape

```ts
export type ContentActor =
  | {
      type: "user";
      subject: string;
      organizationId: string;
      scopes: readonly string[];
      teamIds: readonly string[];
    }
  | {
      type: "service_account";
      clientId: string;
      organizationId: string;
      scopes: readonly string[];
    };
```

No actor is global admin by default. Admin behavior must come from explicit scope plus binding or a deliberate platform-admin path.

### 7.2 Resource Reference Shape

```ts
export type ContentResourceRef = {
  type: "org" | "book" | "chapter" | "section" | "block" | "media" | "comment";
  id: string;
  orgId: string;
  ancestors: readonly {
    type: "org" | "book" | "chapter" | "section";
    id: string;
  }[];
};
```

Use cases should provide ancestry after loading resources. This prevents unbounded policy graph traversal.

### 7.3 Evaluator Methods

```ts
export interface ContentPolicy {
  can(params: {
    actor: ContentActor | null;
    permission: ContentPermission;
    resource: ContentResourceRef;
  }): Promise<boolean>;

  canMany(params: {
    actor: ContentActor | null;
    permission: ContentPermission;
    resources: readonly ContentResourceRef[];
  }): Promise<Map<string, boolean>>;
}
```

Repository support:

```ts
export interface PolicyBindingRepository {
  hasAnyActiveBinding(params: {
    orgId: string;
    principals: readonly PrincipalRef[];
    roles: readonly ContentRole[];
    resources: readonly ResourceBindingRef[];
    now: Date;
  }): Promise<boolean>;

  findAllowedResourceIds(params: {
    orgId: string;
    principals: readonly PrincipalRef[];
    roles: readonly ContentRole[];
    resourceType: string;
    candidateResourceIds: readonly string[];
    now: Date;
  }): Promise<ReadonlySet<string>>;
}
```

### 7.4 List Filtering

List endpoints must avoid N+1 checks.

Patterns:

- public/published resources can be filtered directly by resource fields;
- owned resources can be filtered by `created_by_user_id`;
- private/shared resources should use one binding query to get allowed IDs;
- `ContentPolicy.canMany` should handle batch decisions for already-loaded results.

Do not call `ContentPolicy.can(...)` in a loop that performs one D1 query per item.

## 8. Detailed Product Coverage

### 8.1 Books

Book policy examples:

```text
book.read:
  public + published
  OR actor has book.reader/editor/owner on book
  OR actor has org-level content role if introduced later

book.update:
  scope includes api:write/content:write
  AND actor has book.editor or book.owner on book

book.manage_bindings:
  scope includes api:write/content:write
  AND actor has book.owner on book
```

On book create:

- create book row;
- create owner binding for actor or selected team in the same D1 batch/workflow;
- write `binding.created` event.

### 8.2 Chapters, Sections, And Blocks

Chapters inherit from book unless overridden:

```text
chapter.update:
  direct chapter role grants
  OR inherited book.editor/book.owner
```

Sections and blocks inherit from chapter and book:

```text
block.comment:
  direct block permission
  OR section/chapter/book reviewer/editor/owner
```

Nested sections should be represented with `parent_section_id`. The policy evaluator receives ancestry; it does not calculate the tree on its own.

### 8.3 Comments And Inline Comments

Comment creation:

- requires readable target;
- requires comment permission such as `comment.create` or `inline_comment.create`;
- enforces rate limits and status rules separately.

Comment update/delete:

- author can edit within edit window if not deleted;
- moderators can moderate if they have `comment.moderate`;
- soft delete records `deleted_by`.

Inline comments should target a stable content location:

```text
block_id
anchor_key or lexical node key
range_json nullable
```

Avoid designing inline comments around raw text offsets only; content edits can invalidate them.

### 8.4 Media

Media is private by default.

Media read should be allowed when:

- actor can read the parent book/chapter/section that references the media;
- actor owns/manages the media;
- media is explicitly public, if that state exists.

Media manage should require:

- `media.create`, `media.attach`, or `media.delete`;
- relevant book/chapter editor/owner role.

R2 buckets should remain private. Public serving should go through API routes that evaluate policy.

### 8.5 Bookmarks And Reading Progress

Bookmarks and reading progress are mostly owner-only:

```text
user can read/update/delete own progress
service account cannot read user progress unless explicit export/admin path exists
teams do not inherit a member's private progress
```

IAM gates target readability, but personal data ownership remains direct:

```text
can create progress:
  actor can read chapter
  AND progress.user_id == actor.subject
```

### 8.6 Recommendations

Recommendation generation should only recommend resources the actor can read.

Recommendation storage may be:

- user-scoped;
- org-scoped;
- derived and regenerated.

Content IAM should not be overloaded for recommendation ranking. It only gates target visibility.

### 8.7 Chapter Locks And Passwords

PayloadCMS has password-locked chapters. For the new system, keep this separate from IAM:

```text
IAM/public read passes
AND chapter lock gate passes
```

A password proof is an extra content gate, not a role binding.

Long-term alternatives:

- signed share links;
- temporary access passes;
- reader group bindings;
- invite-based access.

Raw chapter passwords are acceptable only if the product explicitly wants that reader experience.

## 9. Implementation Strategy

Recommended phases:

1. Finish `id` token migration from [docs/006_migrate-auther-to-id.md](docs/006_migrate-auther-to-id.md).
2. Add Content IAM domain model and persistence.
3. Replace `relationships` usage for new book resources.
4. Remove `grant_mirror` and `deferred_grants` once no routes depend on them.
5. Build book/chapter/section resources on top of Content IAM.
6. Add list filtering and batch authorization before exposing large book lists.

Do not implement a network policy API first. Keep `ContentPolicy` inside `content-api`.

## 10. Migration And Rollout

Because there is no production data yet, prefer schema cleanup over compatibility layers:

- remove Auther mirror concepts when Content IAM replaces them;
- create fresh migrations for Content IAM tables;
- update docs before data import;
- avoid dual-writing old relationships and new bindings unless needed for an incremental PR.

Rollout order:

1. `id` supports teams and `team_ids`.
2. `content-api` actor can parse teams.
3. `content-api` adds binding tables/events.
4. new book resources create owner bindings.
5. old `relationships`, `grant_mirror`, and `deferred_grants` are deleted or deprecated.

## 11. Edge Cases And Failure Modes

| Scenario | Expected behavior |
|---|---|
| Token has old `team_ids` after team removal | Access may continue until JWT expiry unless high-risk introspection is added. New/refresh tokens omit removed team. |
| Binding removed while access token remains valid | Deny on next request because bindings are local and checked at request time. |
| Role key removed from code while bindings reference it | Treat as inactive/denied; migration must remove or replace bindings. |
| Binding references team from another org | Reject on create; ignore/deny if corrupted. |
| M2M token lacks `org_id` for org resource | Reject with `403`. |
| User has `api:write` but no object binding | Reject with `403`. |
| Public book has locked chapter | Public/read IAM can pass, but lock gate may still deny content field. |
| List endpoint has many private resources | Use binding ID query and batch policy, not per-row checks. |
| D1 query fails during policy check | Fail closed. |
| Binding expires | Ignore for authorization; optionally sweep or write expiration event asynchronously. |

## 12. Implementation Backlog

### IAM-A. Finalize `id` Token Inputs

Scope:

- `/home/quanghuy1242/pjs/auth/docs/010_organization-teams-oauth-flow.md`
- `docs/006_migrate-auther-to-id.md`

Tasks:

- [ ] Ensure user tokens include `team_ids` for active `org_id`.
- [ ] Ensure M2M tokens expose stable `azp` or `client_id`.
- [ ] Make product OAuth scopes resource-server-bound in `id`.
- [ ] Define `team_ids` cap/overflow behavior in `id`: fail token issuance for the active org rather than truncating.
- [ ] Require `org_id` on org-scoped M2M access tokens.

Acceptance criteria:

- `content-api` can build user/team/service-account principals without querying `id`.

Tests:

- `id` token tests for `team_ids`.
- `content-api` auth tests for parsing token claims.

### IAM-B. Add Content IAM Domain Model

Scope:

- `src/domain/iam/`
- `src/domain/authz/actor.ts`

Tasks:

- [ ] Add `ContentPermission` and `ContentRole` constants.
- [ ] Add role-to-permission mapping.
- [ ] Add `PolicyBinding` entity.
- [ ] Add `PolicyEvent` entity.
- [ ] Add repository interfaces.

Acceptance criteria:

- Role semantics live in code and are testable.
- No dependency on `id` runtime for role expansion.

Tests:

- unit tests for role-to-permission mapping.

### IAM-C. Add Persistence And Migrations

Scope:

- `src/infrastructure/db/schema.ts`
- `drizzle`
- `src/infrastructure/repositories/`
- `src/infrastructure/repositories/mappers/`

Tasks:

- [ ] Add `content_policy_bindings`.
- [ ] Add `content_policy_events`.
- [ ] Add repositories and mappers.
- [ ] Use `CrudAdapter` for common writes.
- [ ] Use workflow repository for atomic resource + owner binding creation.

Acceptance criteria:

- Binding create/revoke is persisted and audited.
- Unique constraints prevent duplicate active bindings.

Tests:

- repository tests through Vitest worker pool.

### IAM-D. Add ContentPolicy Evaluator

Scope:

- `src/domain/iam/content-policy.ts`
- `src/application/**` use cases that require authorization

Tasks:

- [ ] Implement `can`.
- [ ] Implement `canMany`.
- [ ] Implement principal expansion from actor.
- [ ] Implement resource ancestry lookup inputs.
- [ ] Add request-local memoization in composition layer only if needed.

Acceptance criteria:

- One object check uses bounded indexed D1 queries.
- List endpoints can batch policy checks.

Tests:

- direct user binding allows.
- team binding allows.
- service account binding allows.
- missing binding denies.
- expired binding denies.
- ancestor book binding allows chapter permission.

### IAM-E. Replace Relationship/Grant Mirror Usage

Scope:

- `src/domain/authz/relationship*`
- `src/application/relationships/*`
- `src/application/grant-mirror/*`
- `src/application/deferred-grants/*`
- routes and schemas for authz admin resources

Tasks:

- [ ] Stop using `relationships` for new content ownership.
- [ ] Remove or deprecate `grant_mirror` and `deferred_grants`.
- [ ] Replace authz-admin routes with policy-binding management routes if needed.
- [ ] Update README implemented scope.

Acceptance criteria:

- Auther mirror concepts no longer define product authorization.

Tests:

- `pnpm lint`
- `pnpm check:dup`
- `pnpm typecheck`
- `pnpm test`

### IAM-F. Add Book/Chapter Resource Model

Scope:

- `src/domain/books/`
- `src/domain/chapters/`
- `src/domain/sections/`
- `src/application/books/`
- `src/application/chapters/`
- `src/http/routes/`

Tasks:

- [ ] Add book entity/repository/use cases.
- [ ] Add chapter entity/repository/use cases.
- [ ] Add section/block model after chapter foundation.
- [ ] Create owner binding on book create.
- [ ] Use `ContentPolicy` for update/delete/share/read-private operations.

Acceptance criteria:

- Book collaboration can be expressed with team/user/service-account bindings.

Tests:

- book owner can manage bindings.
- editor can update book/chapter.
- reviewer can create inline comment but not update chapter.
- reader can read but not update.

### IAM-G. Add Tests And Verification

Scope:

- `tests/api.test.ts`
- new focused tests for IAM repositories and policies

Tasks:

- [ ] Add policy evaluator tests.
- [ ] Add route integration tests for book/chapter authorization.
- [ ] Add list filtering tests.
- [ ] Add audit event tests.

Acceptance criteria:

- `pnpm check` passes.
- `pnpm advise` is clean or suppressions are justified.

Tests:

- `pnpm check`
- `pnpm advise`

## 13. Future Backlog

- Custom roles through admin UI.
- Policy simulation UI for content resources.
- Group/team merge operation.
- Group budgets/quotas and usage attribution.
- Share links/access passes.
- Optional token introspection for high-risk admin paths.
- Policy event streaming for audit exports.
- Deny policies if allow-only bindings prove insufficient.

## 14. Definition Of Done

- Content IAM tables and repositories exist.
- Content role/permission constants exist in code with tests.
- `ContentPolicy.can` and `canMany` exist.
- User/team/service-account principals are supported.
- Book owner/editor/reviewer/reader behavior is expressible through bindings.
- Resource ancestry is passed to policy checks.
- Binding create/revoke writes audit events.
- No hot-path request to `id` is needed for object authorization.
- Auther mirror/deferred grant concepts are removed or explicitly deprecated.
- README planning/status list is updated.
- `pnpm check` passes after implementation.

## 15. Final Model

```text
id
  generic identity and OAuth:
    users
    orgs
    teams
    clients
    resource audiences
    JWT/JWKS
    coarse scopes
    token claims: sub, org_id, team_ids, azp/client_id

content-api
  product authorization:
    content roles and permissions in code
    content_policy_bindings
    content_policy_events
    resource hierarchy
    ContentPolicy.can(...)
```

This gives the book ecosystem a serious authorization foundation without turning `id` into a custom content policy service.

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
> - Permission keys are implemented by `content-api` code, while roles, role-permission composition, bindings, and explicit denials are Content IAM data.
> - The first Content IAM implementation includes deny exceptions but does not include CEL or arbitrary policy expressions.

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
  - [4.4 Permission Contract And Dynamic Roles](#44-permission-contract-and-dynamic-roles)
  - [4.5 Policy Bindings](#45-policy-bindings)
  - [4.6 Policy Denials](#46-policy-denials)
  - [4.7 Policy Evaluation](#47-policy-evaluation)
- [5. Architecture Decisions](#5-architecture-decisions)
  - [5.1 Call This Content IAM, Not ReBAC](#51-call-this-content-iam-not-rebac)
  - [5.2 Keep Permission Keys In Code And Compose Roles In Data](#52-keep-permission-keys-in-code-and-compose-roles-in-data)
  - [5.3 Store Bindings Locally, Not In `id`](#53-store-bindings-locally-not-in-id)
  - [5.4 Use Teams As Principals, Not Orgs](#54-use-teams-as-principals-not-orgs)
  - [5.5 Avoid Cross-Request Policy Caches](#55-avoid-cross-request-policy-caches)
  - [5.6 Keep Billing Separate From IAM](#56-keep-billing-separate-from-iam)
  - [5.7 Include Denials But Defer CEL](#57-include-denials-but-defer-cel)
- [6. Proposed Data Model](#6-proposed-data-model)
  - [6.1 `content_permissions`](#61-content_permissions)
  - [6.2 `content_roles` And `content_role_permissions`](#62-content_roles-and-content_role_permissions)
  - [6.3 `content_policy_bindings`](#63-content_policy_bindings)
  - [6.4 `content_policy_denials`](#64-content_policy_denials)
  - [6.5 `content_policy_events`](#65-content_policy_events)
  - [6.6 Resource Tables](#66-resource-tables)
  - [6.7 Local User Projection](#67-local-user-projection)
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

This replaces the Auther-era mirror-grant idea with content-owned IAM state. `id` provides identity facts and coarse OAuth scopes. `content-api` owns implemented permission keys, DB-backed roles and role composition, bindings, deny exceptions, inheritance, and final authorization decisions.

## 2. System Summary

Target request flow:

```text
client
  -> obtains id access token with:
       aud = https://content-api.quanghuy.dev
       org_id = org_1
       scope = content:read content:write
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

The policy evaluator uses local D1 tables and local policy semantics. It does not call `id` on hot paths.

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

PayloadCMS does not cover explicit negative exceptions. Its grant mirror returns active additive grants and marks a source grant `revoked` only when that grant is removed. A user who inherits a grant from a group cannot be denied one permission while remaining in that group through the mirror model.

Auther's conditioned tuple behavior is also not deny-overrides-allow. A failed Lua condition rejects that tuple, but another matching direct or group tuple may still allow the same permission. Content IAM must therefore model denial precedence explicitly if it supports this case.

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
- resource-server-bound OAuth scopes through `oauthResourceScope`;
- optional org-scoped M2M eligibility through `oauthClientOrganizationGrant`;
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
content_policy_denials
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

### 4.4 Permission Contract And Dynamic Roles

`content-api` code defines the set of permission keys that have implemented meaning. A database row cannot invent a new protected operation; a use case must actually invoke a permission key:

```ts
type ContentPermissionKey =
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

These permission keys should also be seeded or registered in `content_permissions` so role-management APIs can validate input and expose the supported capability catalog.

Roles and role-to-permission mappings should be stored in D1:

```text
content_permissions
  book.read
  book.update
  chapter.read
  chapter.update
  chapter.publish
  inline_comment.create
  media.attach

content_roles
  book.owner
  book.editor
  book.reviewer
  book.reader
  sensitivity_reader

content_role_permissions
  book.editor -> book.read
  book.editor -> book.update
  book.editor -> chapter.read
  book.editor -> chapter.update
  book.editor -> media.attach
  sensitivity_reader -> book.read
  sensitivity_reader -> chapter.read
  sensitivity_reader -> inline_comment.create
```

Built-in roles can be seeded and protected from deletion. Organization-managed roles may be added through Content IAM APIs without changing evaluator code, but they can only compose permission keys implemented and registered by `content-api`.

Ownership and mutability boundary:

| Concept | Location | Dynamic? | Example |
|---|---|---|---|
| OAuth capability gates | `id` scope catalog | Configured in `id` | `content:read`, `content:write`, `content:share` |
| Route/use-case scope requirement | `content-api` code | Deployment change | update routes require `content:write` |
| Implemented permission keys | `content-api` code plus seeded registry | New code plus seed migration | `chapter.update` |
| Roles | `content-api` D1 | Yes | `book.editor`, `sensitivity_reader` |
| Role-permission mappings | `content-api` D1 | Yes, over supported permissions | `book.editor -> chapter.update` |
| Bindings and denials | `content-api` D1 | Yes | team allow, user exception deny |
| Evaluation and precedence | `content-api` code | Deployment change | denial overrides allow |

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

### 4.6 Policy Denials

The first Content IAM implementation should support explicit negative exceptions:

```text
team:team_editors has book.editor on book:book_1
user:user_t is a member of team:team_editors
user:user_t is denied chapter.update on book:book_1 descendants
```

A denial targets a permission rather than a negative role:

```text
principal is denied permission on resource, optionally including descendants
```

This supports suspension or exceptional restriction without changing team membership or creating artificial teams. Denials are security-sensitive, must be audited, and must be manageable only by an actor permitted to manage bindings on the resource.

Denial rules:

- an applicable denial overrides a permission gained through any direct or team binding;
- a denial inherited from an ancestor applies to descendants only when `applies_to_descendants` is true;
- a descendant allow cannot override an inherited denial in v1;
- restoring access requires deleting, expiring, or narrowing the denial;
- denials do not make public content private from anonymous access; blocking public-content consumption is a separate product control.

### 4.7 Policy Evaluation

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
6. Query active content_policy_denials for all candidate principals, permission, and resource ancestry.
7. If any applicable denial matches, deny.
8. Query active content_policy_bindings and role-permission mappings for all candidate principals and resource ancestry.
9. Require an applicable binding whose DB-composed role contains the requested code-supported permission.
10. Apply content gates:
   - status/draft/published
   - visibility
   - lock/password proof
   - soft delete
   - comment edit window/rate limit where relevant
11. Allow or deny.
```

One object check should use bounded indexed D1 reads after the resource is loaded: an applicable-denial lookup and an applicable-allow lookup joined to role permissions. `canMany` should batch both sides for list endpoints.

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

### 5.2 Keep Permission Keys In Code And Compose Roles In Data

Recommended long-term approach:

- `content-api` code invokes implemented permission keys such as `chapter.update`.
- `content_permissions` registers those code-supported keys for validation and administration.
- `content_roles` and `content_role_permissions` compose permissions dynamically in D1.
- `id` only needs OAuth scopes and team identity.

Rationale:

- Code must define an operation before any role can grant it.
- Role composition is product administration state and should not require deploying code whenever an editor/reviewer variant is needed.
- The permission registry gives DB relationships validation without allowing invented backend behavior.
- `id` scope changes must not silently change content role composition.

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
- bounded indexed denial and allow queries;
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

### 5.7 Include Denials But Defer CEL

Decision:

- include first-class permission-level denials in the first Content IAM implementation;
- do not add CEL, Lua, or arbitrary conditional expressions in v1.

Rationale:

- individual negative exceptions are already a concrete collaboration requirement;
- deny precedence can be deterministic and indexed;
- arbitrary conditions require a larger policy language contract, list-filtering strategy, authoring safety model, simulation UX, and audit explanation path;
- PayloadCMS and Auther did not provide deny-overrides-allow semantics that can simply be carried forward.

## 6. Proposed Data Model

### 6.1 `content_permissions`

`content_permissions` is the registry of policy operations that application code actually enforces:

```ts
export const contentPermissions = sqliteTable("content_permissions", {
  key: text("key").primaryKey(),
  description: text("description").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
```

Rules:

- keys such as `chapter.update` and `media.attach` are seeded from code-supported permissions;
- role-management APIs may only reference enabled permission rows;
- adding a permission row alone does not add application behavior; code must enforce that permission key first;
- disabling a permission fails closed for roles that reference it.

### 6.2 `content_roles` And `content_role_permissions`

Roles are locally managed bundles of implemented permissions:

```ts
export const contentRoles = sqliteTable(
  "content_roles",
  {
    id: text("id").primaryKey(),
    namespaceId: text("namespace_id").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    assignableResourceType: text("assignable_resource_type").notNull(),
    builtIn: integer("built_in", { mode: "boolean" }).notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("content_roles_namespace_key_idx").on(table.namespaceId, table.key),
  ],
);

export const contentRolePermissions = sqliteTable(
  "content_role_permissions",
  {
    roleId: text("role_id").notNull(),
    permissionKey: text("permission_key").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("content_role_permissions_unique_idx").on(
      table.roleId,
      table.permissionKey,
    ),
  ],
);
```

Rules:

- `namespace_id = "system"` identifies built-in/system role templates; organization roles use their organization ID, avoiding nullable uniqueness behavior in SQLite;
- built-in role definitions are seeded and cannot be silently modified or deleted through tenant APIs;
- custom roles may compose only registered enabled permissions;
- roles referenced by active bindings should be disabled rather than deleted, or migrated in one controlled workflow;
- changing a role's permission composition changes all active bindings that reference it immediately, so mutations require binding-management authority and an audit event;
- `assignable_resource_type` prevents assigning a book role to an incompatible resource type.

### 6.3 `content_policy_bindings`

Drizzle sketch:

```ts
export const contentPolicyBindings = sqliteTable(
  "content_policy_bindings",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    roleId: text("role_id").notNull(),
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
      table.roleId,
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
      table.roleId,
    ),
    index("content_policy_bindings_expiry_idx").on(table.expiresAt),
  ],
);
```

Rules:

- `principal_type` is `user`, `team`, or `service_account`.
- `role_id` references an enabled local content role compatible with `resource_type`.
- `org_id` must match the resource's org.
- expired bindings are ignored.
- revocation deletes the active binding and writes an event.
- recreating an expired binding must delete or replace the expired active-state row in the same authorized workflow so the uniqueness constraint does not block re-granting access.

### 6.4 `content_policy_denials`

Denials subtract an implemented permission for a principal on a resource or subtree:

```ts
export const contentPolicyDenials = sqliteTable(
  "content_policy_denials",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    permissionKey: text("permission_key").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    appliesToDescendants: integer("applies_to_descendants", { mode: "boolean" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    reason: text("reason"),
    createdByType: text("created_by_type").notNull(),
    createdById: text("created_by_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("content_policy_denials_unique_idx").on(
      table.orgId,
      table.principalType,
      table.principalId,
      table.permissionKey,
      table.resourceType,
      table.resourceId,
    ),
    index("content_policy_denials_lookup_idx").on(
      table.orgId,
      table.principalType,
      table.principalId,
      table.permissionKey,
      table.resourceType,
      table.resourceId,
    ),
  ],
);
```

Rules:

- `permission_key` must be an enabled `content_permissions` row;
- an active matching denial wins over direct, team-derived, and service-account allow bindings;
- denial expiry removes the negative exception without changing the original role binding;
- revocation deletes the active denial and writes an event; recreating an expired denial replaces or deletes the expired row in the same workflow;
- create, update, expire, and revoke operations write policy events.

### 6.5 `content_policy_events`

Append-only audit:

```ts
export const contentPolicyEvents = sqliteTable("content_policy_events", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  action: text("action").notNull(),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id").notNull(),
  reason: text("reason"),
  snapshotJson: text("snapshot_json"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});
```

Actions:

```text
binding.created
binding.revoked
binding.expired
denial.created
denial.revoked
denial.expired
role.created
role.permissions_updated
role.disabled
```

Audit events are required from day one because sharing, role composition, and negative exceptions are security-sensitive.

### 6.6 Resource Tables

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

### 6.7 Local User Projection

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
    permission: ContentPermissionKey;
    resource: ContentResourceRef;
  }): Promise<boolean>;

  canMany(params: {
    actor: ContentActor | null;
    permission: ContentPermissionKey;
    resources: readonly ContentResourceRef[];
  }): Promise<Map<string, boolean>>;
}
```

Repository support:

```ts
export interface PolicyBindingRepository {
  hasAllowedPermission(params: {
    orgId: string;
    principals: readonly PrincipalRef[];
    permission: ContentPermissionKey;
    resources: readonly ResourceBindingRef[];
    now: Date;
  }): Promise<boolean>;

  findAllowedResourceIds(params: {
    orgId: string;
    principals: readonly PrincipalRef[];
    permission: ContentPermissionKey;
    resourceType: string;
    candidateResourceIds: readonly string[];
    now: Date;
  }): Promise<ReadonlySet<string>>;
}

export interface PolicyDenialRepository {
  hasActiveDenial(params: {
    orgId: string;
    principals: readonly PrincipalRef[];
    permission: ContentPermissionKey;
    resources: readonly ResourceBindingRef[];
    now: Date;
  }): Promise<boolean>;

  findDeniedResourceIds(params: {
    orgId: string;
    principals: readonly PrincipalRef[];
    permission: ContentPermissionKey;
    resources: readonly ContentResourceRef[];
    now: Date;
  }): Promise<ReadonlySet<string>>;
}
```

### 7.4 List Filtering

List endpoints must avoid N+1 checks.

Patterns:

- public/published resources can be filtered directly by resource fields;
- owned resources can be filtered by `created_by_user_id`;
- private/shared resources should use batched binding and denial queries to calculate `allowedIds - deniedIds`;
- `ContentPolicy.canMany` should handle batch allow/deny decisions for already-loaded results.

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
  scope includes content:write
  AND an applicable role binding includes book.update
  AND no applicable book.update denial exists

book.manage_bindings:
  scope includes content:share
  AND an applicable role binding includes book.manage_bindings
  AND no applicable book.manage_bindings denial exists
```

On book create:

- create book row;
- create owner binding for actor or selected team in the same D1 batch/workflow;
- write `binding.created` event.

### 8.2 Chapters, Sections, And Blocks

Chapters inherit from book unless overridden:

```text
chapter.update:
  allow from a direct chapter role or an inherited book role containing chapter.update
  AND no direct or inherited chapter.update denial
```

Sections and blocks inherit from chapter and book:

```text
block.comment:
  allow from a direct or inherited role containing block.comment
  AND no applicable block.comment denial
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
2. Add Content IAM permission registry, role composition, binding, denial, and audit persistence.
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
3. `content-api` seeds supported permissions and built-in role definitions.
4. `content-api` adds bindings, denials, and audit events.
5. new book resources create owner bindings.
6. old `relationships`, `grant_mirror`, and `deferred_grants` are deleted or deprecated.

## 11. Edge Cases And Failure Modes

| Scenario | Expected behavior |
|---|---|
| Token has old `team_ids` after team removal | Access may continue until JWT expiry unless high-risk introspection is added. New/refresh tokens omit removed team. |
| Binding removed while access token remains valid | Deny on next request because bindings are local and checked at request time. |
| Role disabled while bindings reference it | Treat its bindings as inactive; retain audit history and migrate/re-enable deliberately. |
| Permission registry row is disabled while a role references it | Treat that permission as unavailable and fail closed. |
| Binding references team from another org | Reject on create; ignore/deny if corrupted. |
| M2M token lacks `org_id` for org resource | Reject with `403`. |
| User has `content:write` but no object binding | Reject with `403`. |
| Team role grants permission but user has matching denial | Deny; user denial overrides the team allow. |
| User receives the permission from a second team after a denial | Deny; denial overrides all applicable allows. |
| Denial exists on a parent resource with descendant application | Deny descendant operation even if a child role allows it. |
| An administrator wants context-dependent access | Not expressible through CEL in v1; use roles/bindings/denials or plan a policy-language extension. |
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
- [ ] Configure coarse `content:read`, `content:write`, and `content:share` scopes as resource-server-bound scopes in `id` through `oauthResourceScope`.
- [ ] Define `team_ids` cap/overflow behavior in `id`: fail token issuance for the active org rather than truncating.
- [ ] Require `org_id` on org-scoped M2M access tokens, backed by `oauthClientOrganizationGrant` if that M2M flow is enabled.

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

- [ ] Add code-supported `ContentPermissionKey` constants.
- [ ] Add `ContentPermission`, `ContentRole`, `PolicyBinding`, `PolicyDenial`, and `PolicyEvent` entities.
- [ ] Add use-case contracts for managing roles, role permissions, bindings, and denials.
- [ ] Add repository interfaces.

Acceptance criteria:

- Permission keys checked by application code are explicit and testable.
- Role composition and deny exceptions are owned by `content-api`, not `id`.
- No CEL/arbitrary condition engine is part of the first implementation.

Tests:

- unit tests for supported permission-key validation.
- unit tests for denial precedence rules.

### IAM-C. Add Persistence And Migrations

Scope:

- `src/infrastructure/db/schema.ts`
- `drizzle`
- `src/infrastructure/repositories/`
- `src/infrastructure/repositories/mappers/`

Tasks:

- [ ] Add `content_permissions`.
- [ ] Add `content_roles`.
- [ ] Add `content_role_permissions`.
- [ ] Add `content_policy_bindings`.
- [ ] Add `content_policy_denials`.
- [ ] Add `content_policy_events`.
- [ ] Add repositories and mappers.
- [ ] Use `CrudAdapter` for common writes.
- [ ] Use workflow repository for atomic resource + owner binding creation.

Acceptance criteria:

- Permission seeds and built-in roles can be installed deterministically.
- Role-composition, binding, and denial changes are persisted and audited.
- Unique constraints prevent duplicate active bindings.
- Unique constraints prevent duplicate active denials.

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
- [ ] Resolve applicable denials before allow bindings.
- [ ] Resolve role permissions from local D1 role composition.
- [ ] Add request-local memoization in composition layer only if needed.

Acceptance criteria:

- One object check uses bounded indexed D1 denial and allow queries.
- List endpoints can batch allow and deny policy checks.
- Applicable denials override every applicable allow source.

Tests:

- direct user binding allows.
- team binding allows.
- service account binding allows.
- missing binding denies.
- expired binding denies.
- ancestor book binding allows chapter permission.
- updating a role composition changes authorization for existing bindings and records an audit event.
- direct user denial overrides team role permission.
- denial overrides permission received from multiple teams.
- inherited parent denial overrides descendant allow.
- expired denial no longer overrides an allow.

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
- [ ] Add list filtering tests that subtract denied resources from allowed resources.
- [ ] Add role-composition management tests.
- [ ] Add denial and audit event tests.

Acceptance criteria:

- `pnpm check` passes.
- `pnpm advise` is clean or suppressions are justified.

Tests:

- `pnpm check`
- `pnpm advise`

## 13. Future Backlog

- Custom role and denial management UI over the first-batch Content IAM APIs.
- Policy simulation UI for content resources.
- Group/team merge operation.
- Group budgets/quotas and usage attribution.
- Share links/access passes.
- Optional token introspection for high-risk admin paths.
- Policy event streaming for audit exports.
- Optional condition language such as CEL only after concrete conditional-policy requirements and list-filtering behavior are designed.

## 14. Definition Of Done

- Content IAM tables and repositories exist.
- Code-supported permission keys and their registry seed exist with tests.
- DB-backed roles and role-permission mappings exist.
- DB-backed permission denials exist and override applicable allows.
- `ContentPolicy.can` and `canMany` exist.
- User/team/service-account principals are supported.
- Book owner/editor/reviewer/reader behavior is expressible through bindings.
- Resource ancestry is passed to policy checks.
- Role composition, binding, and denial changes write audit events.
- No hot-path request to `id` is needed for object authorization.
- No CEL or arbitrary condition runtime is included in the first implementation.
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
    implemented permission keys in code and local registry
    content_roles and content_role_permissions
    content_policy_bindings
    content_policy_denials
    content_policy_events
    resource hierarchy
    ContentPolicy.can(...)
```

This gives the book ecosystem a serious authorization foundation without turning `id` into a custom content policy service.

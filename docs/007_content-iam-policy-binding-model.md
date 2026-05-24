# Content IAM Policy Binding Model

> Status: IAM substrate, book product root, and legacy authz cleanup implemented; descendant resource hierarchy remains in progress in `docs/009_book-resource-hierarchy-and-collaboration-plan.md`
>
> Date: 2026-05-23
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
> - Ordinary Content IAM administration is resource-scoped. The first implementation does not expose platform-global or wildcard content bindings.
> - `id` user access tokens will expire after 15 minutes; an already-issued `team_ids` claim may therefore be stale for at most 15 minutes, while refresh or new issuance reflects current membership.
> - Direct user sharing to an external collaborator or reader must not require turning that person into an organization/team member; the token contract must support direct-user-bound resource access without team-derived authority.
>
> Implementation notes:
>
> - Implemented Content IAM tables, repositories, policies, workflows, OpenAPI routes, and `id` principal-validation adapter in `content-api`.
> - Permission keys and protected built-in roles are code-owned and seeded through `ContentRoleRepository.ensureSystemCatalog()` during IAM management workflows.
> - Book and organization binding/denial routes, organization role-management routes, org-admin bootstrap/delegation, and book ownership transfer are resource-scoped; no global/wildcard endpoint exists.
> - The generated `0003_content_iam_policy` migration adds Content IAM persistence, books, and the `users.id = id.sub` identity cleanup. `0002_media_upload_flow` metadata is now represented in Drizzle's journal before `0003`.
> - `0004_content_iam_guards` enforces one bootstrap reservation per organization, stale role-update conflicts, disabled-role/binding lifecycle consistency, final-admin protection, and per-actor/resource denied-event rate limiting; rejected-event recording also removes rows beyond the retention window.
> - The public bootstrap operation is single-use per organization after that reservation is committed; a future operational recovery mechanism must remain separately controlled and audited.
> - Protected sharing-manager assignment/revocation requires direct owner or direct organization content-admin authority; tenant-defined roles cannot cross organization namespaces.
> - The book binding list route implements `view=direct|effective`, and organization administrator delegation/revocation uses `/organizations/{orgId}/content-admins[/{bindingId}]`.
> - Legacy Auther mirror/deferred-grant/relationship routes and tables are removed by `0005_remove_legacy_authz`; product ownership now uses row owner fields or Content IAM.
> - Tests cover `id` token shapes, projection non-destruction, denial precedence, direct-share restrictions, protected delegation, principal validation, tenant isolation, effective binding explanations, mutation idempotency, and concurrent write invariants.
> - Book product routes now create private drafts under `org.create_book`, atomically seed a direct owner binding, support qualified service-account imports with an explicit user owner, and enforce local policy on private reads and updates; descendant product resources remain pending.

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
  - [4.8 Resource-Level Administration And Delegation](#48-resource-level-administration-and-delegation)
- [5. Architecture Decisions](#5-architecture-decisions)
  - [5.1 Call This Content IAM, Not ReBAC](#51-call-this-content-iam-not-rebac)
  - [5.2 Keep Permission Keys In Code And Compose Roles In Data](#52-keep-permission-keys-in-code-and-compose-roles-in-data)
  - [5.3 Store Bindings Locally, Not In `id`](#53-store-bindings-locally-not-in-id)
  - [5.4 Use Teams As Principals, Not Orgs](#54-use-teams-as-principals-not-orgs)
  - [5.5 Avoid Cross-Request Policy Caches](#55-avoid-cross-request-policy-caches)
  - [5.6 Keep Billing Separate From IAM](#56-keep-billing-separate-from-iam)
  - [5.7 Include Denials But Defer CEL](#57-include-denials-but-defer-cel)
  - [5.8 Make Resource-Level IAM The Public Administration Model](#58-make-resource-level-iam-the-public-administration-model)
  - [5.9 Separate Sharing, Ownership Transfer, And Role Administration](#59-separate-sharing-ownership-transfer-and-role-administration)
  - [5.10 Restrict Team And Service-Account Security Administration In V1](#510-restrict-team-and-service-account-security-administration-in-v1)
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
  - [7.5 Management Use-Case Contracts](#75-management-use-case-contracts)
  - [7.6 HTTP API Contract](#76-http-api-contract)
  - [7.7 Mutation Authorization Algorithm](#77-mutation-authorization-algorithm)
  - [7.8 Principal Validation Against `id`](#78-principal-validation-against-id)
  - [7.9 Audit, Idempotency, And Concurrency](#79-audit-idempotency-and-concurrency)
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
  - [IAM-E. Add Resource-Scoped Management APIs](#iam-e-add-resource-scoped-management-apis)
  - [IAM-F. Replace Relationship/Grant Mirror Usage](#iam-f-replace-relationshipgrant-mirror-usage)
  - [IAM-G. Add Book/Chapter Resource Model](#iam-g-add-bookchapter-resource-model)
  - [IAM-H. Add Tests And Verification](#iam-h-add-tests-and-verification)
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

First-release boundary:

- normal collaboration is configured on a concrete book, chapter, section, block, comment, or media resource;
- an organization-level Content IAM administrator can manage policy only inside that organization;
- a book owner manages that book subtree, not every resource in the organization;
- no platform-global/wildcard content binding API exists in v1;
- no network policy service and no Content IAM plugin in `id` are introduced.

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

Policy administration follows the same resource boundary:

```text
owner of book_1
  -> may share book_1 and its descendants under delegation rules
  -> may not grant rights on book_2 or at org/platform scope

direct user org content administrator on org_1
  -> may administer resources within org_1
  -> may not administer org_2 or a platform-global namespace
```

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

The updated proposal in `/home/quanghuy1242/pjs/auth/docs/010_organization-teams-oauth-flow.md` plans:

- Better Auth teams as stable principal IDs;
- user token `team_ids` for teams in the active `org_id`;
- a uniform 15-minute lifetime for user access tokens;
- stale `team_ids` persisting for at most that 15-minute user-token lifetime, with refresh/new issuance reflecting current membership;
- M2M principal identity from `azp` or `client_id`;
- resource-server-bound OAuth scopes through `oauthResourceScope`;
- org-scoped M2M eligibility through `oauthClientOrganizationGrant` for content access;
- resource APIs owning concrete grants and final object decisions.

That is the correct boundary for Content IAM.

`content-api` still needs these `id` contract details to be firm before implementation:

- product OAuth scopes must be bound to a resource server so generic scope names do not collide across APIs;
- user access tokens should include only teams inside the active `org_id`;
- `team_ids` overflow should fail token issuance rather than silently omitting teams;
- org-scoped M2M tokens must include `org_id`;
- old user access tokens keep old `team_ids` until their 15-minute expiry;
- M2M revocation/lifetime behavior must be decided before service accounts can perform security-state mutations, because the current planned M2M lifetime remains separate from the 15-minute user-token SLA.

The current `org_id` requirement also needs one correction for social/private sharing. A book owner must be able to grant an ordinary direct-user role to an external reader, reviewer, or collaborator without making that person an organization member. Recommended token contract:

- workspace user token: includes `sub`, `org_id`, and `team_ids`; may carry `content:read`, `content:write`, and `content:share`; enables organization/team-derived policy evaluation and policy administration when locally authorized;
- direct-share user token: includes `sub`, no `org_id`, and `team_ids = []`; may carry only `content:read` and/or `content:write`, never `content:share`; enables only concrete direct-user ordinary bindings after the resource is loaded;
- selection of workspace versus direct-share context is explicit at OAuth authorization/consent time, never a fallback after a workspace authorization failure;
- refresh/new issuance preserves the selected direct-share context; any `id`-internal consent/reference marker that distinguishes it from workspace consent is not an `org_id` claim and must never be emitted to `content-api`;
- Content IAM mutation routes, organization-wide operations, and any team-derived access require a workspace token with matching `org_id`;
- `id` must not query or know concrete book bindings in order to issue a direct-share token.

`id.resourceServer.organizationId` identifies the administrator of the OAuth audience and scope catalog, not the tenant boundary of every book reachable through that API. Token `org_id`, when present, is workspace authority context; the loaded content resource's `org_id` is the tenancy boundary used by Content IAM.

This requires a corresponding refinement to the `id` token guide and the migration verifier plan before implementation; otherwise the design would force every private-book reader into the publishing organization.

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

`org` is the highest regular Content IAM resource boundary. An organization-scoped binding is not a platform-global grant: it applies only to descendants whose `org_id` matches that concrete organization. The first release must not support `resource_type = "global"`, wildcard organization IDs, or an endpoint that grants authority across organizations.

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

User evaluation modes:

- when a user token has matching `org_id`, candidate principals include `user:sub` and asserted `team:team_ids[]`;
- when a direct-share user token has no `org_id`, `team_ids = []`, and only read/write scopes, candidate principals include only `user:sub` and may satisfy ordinary direct-user bindings on a concrete resource;
- `team_ids = []` alone does not classify a token as direct-share, because a workspace token may represent a user with no teams; classification uses absence of `org_id`;
- a direct-share actor with a suitable direct ordinary binding may perform ordinary operations inside an already shared subtree, including locally permitted chapter/section/comment/inline-comment/media creation or update;
- a token without matching `org_id` cannot obtain organization-level authority, use team bindings, create new top-level books under an org, or call Content IAM mutation routes;
- a token carrying a different `org_id` than the loaded resource is rejected rather than downgraded to direct-share mode.

### 4.4 Permission Contract And Dynamic Roles

`content-api` code defines the set of permission keys that have implemented meaning. A database row cannot invent a new protected operation; a use case must actually invoke a permission key:

```ts
type ContentPermissionKey =
  | "org.create_book"
  | "org.manage_bindings"
  | "org.manage_roles"
  | "book.read"
  | "book.update"
  | "book.delete"
  | "book.manage_bindings"
  | "book.transfer_ownership"
  | "chapter.read"
  | "chapter.create"
  | "chapter.update"
  | "chapter.publish"
  | "section.update"
  | "block.comment"
  | "inline_comment.create"
  | "comment.create"
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
  org.create_book
  org.manage_bindings
  org.manage_roles
  book.read
  book.update
  book.manage_bindings
  book.transfer_ownership
  chapter.read
  chapter.update
  chapter.publish
  inline_comment.create
  media.attach

content_roles
  org.content_admin
  org.author
  book.owner
  book.sharing_manager
  book.author
  book.editor
  book.reviewer
  book.reader
  sensitivity_reader

content_role_permissions
  org.content_admin -> org.manage_bindings
  org.content_admin -> org.manage_roles
  org.content_admin -> org.create_book
  org.content_admin -> book.manage_bindings
  org.content_admin -> book.transfer_ownership
  org.author -> org.create_book
  book.owner -> book.manage_bindings
  book.owner -> book.transfer_ownership
  book.sharing_manager -> book.manage_bindings
  book.editor -> book.read
  book.editor -> book.update
  book.editor -> chapter.read
  book.editor -> chapter.update
  book.editor -> media.attach
  sensitivity_reader -> book.read
  sensitivity_reader -> chapter.read
  sensitivity_reader -> inline_comment.create
```

Required protected/system role seed intent:

| Built-in role | Binding resource | Initial permissions | Notes |
|---|---|---|---|
| `org.content_admin` | `org` | `org.manage_bindings`, `org.manage_roles`, `org.create_book`, `book.manage_bindings`, `book.transfer_ownership` | Administers IAM inside one org; does not automatically read or edit private book contents. |
| `org.author` | `org` | `org.create_book` | Permits creation of a new book; normal access to existing books remains resource-scoped. |
| `book.owner` | `book` | `book.read`, `book.update`, `book.delete`, `book.manage_bindings`, `book.transfer_ownership`, `chapter.read`, `chapter.create`, `chapter.update`, `chapter.publish`, `section.update`, `inline_comment.create`, `comment.create`, `comment.moderate`, `media.read`, `media.create`, `media.attach`, `media.delete` | Single direct-user owner only. |
| `book.sharing_manager` | `book` | `book.manage_bindings` | Security-state role; grant an ordinary editor/reader role separately if content operation access is also required. |
| `book.author` | `book` | `book.read`, `book.update`, `chapter.read`, `chapter.create`, `chapter.update`, `section.update`, `inline_comment.create`, `comment.create`, `media.read`, `media.create`, `media.attach` | Collaborating writer without ownership, publish, delete, or sharing authority. |
| `book.editor` | `book` | `book.read`, `book.update`, `chapter.read`, `chapter.update`, `section.update`, `inline_comment.create`, `comment.create`, `media.read`, `media.attach` | Editorial work; no publish/delete/share authority. |
| `book.reviewer` | `book` | `book.read`, `chapter.read`, `inline_comment.create`, `comment.create`, `media.read` | Review/comments only. |
| `book.reader` | `book` | `book.read`, `chapter.read`, `media.read` | Private read access only. |

Built-in roles can be seeded and protected from deletion. In v1, sensitive roles such as `org.content_admin`, `book.owner`, and `book.sharing_manager` are protected built-ins whose permission composition is not tenant-editable. Organization-managed roles may be added through Content IAM APIs without changing evaluator code, but they may compose only enabled `ordinary` permission keys implemented and registered by `content-api`.

Permissions also have a code-defined delegation class:

| Delegation class | Examples | Mutation rule |
|---|---|---|
| `ordinary` | `book.read`, `chapter.update`, `media.attach` | A resource binding manager may grant compatible roles containing only these permissions. |
| `policy_management` | `book.manage_bindings` | Assignable only to a direct user by an existing direct owner or organization Content IAM administrator. |
| `ownership_transfer` | `book.transfer_ownership` | Exercised through the dedicated ownership-transfer workflow; never assigned by ordinary binding create. |
| `organization_admin` | `org.manage_bindings`, `org.manage_roles` | Assignable only through organization bootstrap/admin delegation workflows to a direct user. |

This classification is seeded from code with `content_permissions`; it is not editable as tenant data. A role's derived class is still calculated from its permission rows for validation, but v1 rejects creation or replacement of an organization-managed role when the result is not `ordinary`. Security-state delegation therefore occurs only through protected built-in roles and dedicated workflows.

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
user:user_owner has book.owner on book:book_1
team:team_authors has book.author on book:book_1
team:team_editors has book.editor on book:book_1
team:team_reviewers has book.reviewer on chapter:chapter_4
user:user_1 has book.reader on book:book_1
service_account:client_importer has book.editor on book:book_1
user:user_org_admin has org.content_admin on org:org_1
```

Use the term `binding`, not `grant_mirror`. A binding is current state. Grant/revoke are events.

Binding-scope invariants:

- ordinary sharing writes a binding on one concrete resource and may affect only that resource and descendants through defined inheritance;
- a book owner can create and revoke bindings only on that book subtree;
- only the controlled organization-admin path can create or revoke an `org` binding;
- `book.owner` is a direct-user-only, single-accountable-owner role in v1;
- ordinary collaboration roles may be assigned to users, teams, or service accounts;
- no binding may target a wildcard or platform-global resource.

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
2. If token has `org_id`, verify it matches resource org; reject a mismatched organization context.
3. Verify required coarse OAuth scope.
4. Load target resource and ancestry.
5. Build principal candidates from actor:
   - user:sub always for user actors
   - team:team_ids[] only when the token has matching org_id
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

### 4.8 Resource-Level Administration And Delegation

Content IAM is managed at the resource being shared:

```text
org:org_1
  administrative boundary; direct-user org Content IAM administrators only

book:book_1
  principal collaboration boundary; owner and authorized sharing managers manage ordinary access

chapter/section/block/media
  narrower exception sharing or denial boundary under an authorized book subtree
```

Authority matrix:

| Existing authority on the target ancestry | Allowed mutation | Not allowed |
|---|---|---|
| Direct `book.owner` on `book_1` | Add/revoke ordinary roles or denials in `book_1` subtree; designate a direct-user sharing manager; perform dedicated ownership transfer | Create org binding; grant `book.owner` through binding API; change organization roles; affect another book |
| Direct user holding `book.manage_bindings` without ownership | Add/revoke ordinary collaborator roles and denials in its authorized book subtree | Grant management/ownership/admin authority; alter role composition |
| Direct `org.content_admin` on `org_1` | Manage organization role composition, manage descendant bindings, invoke ownership recovery/transfer inside `org_1` | Affect another organization or platform-global policy |
| Team/service-account ordinary role | Operate on content according to role | Mutate bindings, denials, ownership, or role composition in v1 |

The resource-level model is deliberate: an editor or sharing manager for one book cannot become an administrator of unrelated books. Organization administration remains possible, but it is an explicit `org` resource binding rather than an unbounded global bypass.

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

### 5.8 Make Resource-Level IAM The Public Administration Model

Decision:

- public Content IAM mutation routes are nested under a concrete `org`, `book`, or descendant resource;
- book-level bindings are the normal collaboration path;
- chapter/section/block/media bindings exist for narrower exceptions and do not replace book ownership;
- organization bindings exist only for bounded Content IAM administration and organization-level capabilities that cannot target an existing book, such as `org.create_book`;
- v1 does not use an ordinary organization binding to grant blanket read/update/share permission over every book; those collaborations remain book/resource scoped;
- no v1 endpoint lists or mutates bindings across all organizations, and no v1 binding targets a global or wildcard resource.

This is analogous to a resource hierarchy IAM model: permission inherited from `org:org_1` may affect books inside `org_1`, and permission on `book:book_1` may affect descendants of that book, but neither crosses its resource ancestry boundary.

Rejected:

- a single admin-only `/policy-bindings` collection accepting any organization/resource pair;
- platform-global owner bindings;
- treating OAuth scope possession as global binding authority.

### 5.9 Separate Sharing, Ownership Transfer, And Role Administration

These are different security operations and must not share an unrestricted endpoint:

| Operation | Required local permission | API/workflow rule |
|---|---|---|
| Grant/revoke ordinary reader/editor/reviewer/author binding | `book.manage_bindings` on target ancestry | Resource-scoped binding endpoint; proposed role must be `ordinary`. |
| Create/revoke a permission denial for ordinary work | `book.manage_bindings` on target ancestry | Resource-scoped denial endpoint; cannot deny ownership/admin recovery in v1. |
| Delegate `book.manage_bindings` | Direct `book.owner` or direct `org.content_admin` | Direct-user target only; requested role may contain `policy_management` but not owner/org-admin permissions. |
| Transfer `book.owner` | `book.transfer_ownership` from current direct owner or direct `org.content_admin` | Dedicated atomic ownership transfer; ordinary binding API rejects `book.owner`. |
| Create/update organization-defined role composition | Direct `org.content_admin` with `org.manage_roles` | Organization role endpoint; v1 composition is limited to `ordinary` permissions. |
| Create/revoke organization Content IAM administrator | Existing direct `org.content_admin`, or trusted bootstrap/recovery workflow | Dedicated direct-user-only operation; never a book-level mutation. |

The initial book creator receives the single direct-user `book.owner` binding in the same atomic workflow as book creation. Other authors are collaborators, even if they have extensive editorial permissions. This preserves a clear accountable owner and makes transfer reviewable.

### 5.10 Restrict Team And Service-Account Security Administration In V1

User access tokens may carry stale `team_ids` for at most the 15-minute lifetime defined by `id`. M2M tokens have a separate revocation/lifetime decision and may remain usable longer. Security-state mutation should not silently accept either risk.

V1 decision:

- teams and service accounts may receive `ordinary` content-operation roles;
- teams and service accounts must not receive roles containing `book.manage_bindings`, `book.transfer_ownership`, `org.manage_bindings`, or `org.manage_roles`;
- policy-management, ownership-transfer, and organization-admin bindings may target direct users only;
- write-time calls to `id` validate target principal identity and organization membership, but ordinary `ContentPolicy.can(...)` remains local and performs no `id` network call.

Later relaxation requires an explicit security decision: either accept the stated stale-identity/revocation SLA for sensitive mutations or define a live `id` membership/client-status verification contract. Token introspection by itself is not assumed to provide current team membership.

## 6. Proposed Data Model

### 6.1 `content_permissions`

`content_permissions` is the registry of policy operations that application code actually enforces:

```ts
export const contentPermissions = sqliteTable("content_permissions", {
  key: text("key").primaryKey(),
  description: text("description").notNull(),
  delegationClass: text("delegation_class").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
```

Rules:

- keys such as `chapter.update` and `media.attach` are seeded from code-supported permissions;
- `delegation_class` is seeded from code as `ordinary`, `policy_management`, `ownership_transfer`, or `organization_admin` and is not editable through tenant APIs;
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
    version: integer("version").notNull(),
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
- built-in role definitions are seeded and cannot be modified or deleted through tenant APIs;
- protected built-in roles carry security-state permissions: `org.content_admin`, `book.owner`, and `book.sharing_manager`;
- v1 custom roles may compose only registered enabled permissions whose delegation class is `ordinary`;
- a role's effective delegation class is the most sensitive `delegation_class` in its permission composition;
- roles referenced by active bindings should be disabled rather than deleted, or migrated in one controlled workflow;
- changing a role's permission composition changes all active bindings that reference it immediately, so mutations require direct organization role-management authority, optimistic `version` matching, and an audit event;
- `assignable_resource_type` prevents assigning a book role to an incompatible resource type.

### 6.3 `content_policy_bindings`

Drizzle sketch:

```ts
const BOOK_OWNER_ROLE_ID = "system:book.owner";

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
    uniqueIndex("content_policy_bindings_single_book_owner_idx")
      .on(table.orgId, table.resourceType, table.resourceId)
      .where(
        sql`${table.resourceType} = 'book' AND ${table.roleId} = ${BOOK_OWNER_ROLE_ID}`,
      ),
  ],
);
```

Rules:

- `principal_type` is `user`, `team`, or `service_account`.
- `role_id` references an enabled local content role compatible with `resource_type`.
- `org_id` must match the resource's org.
- `resource_type = "org"` is permitted only for controlled organization administration/capability workflows; no wildcard or platform-global resource type is permitted.
- protected built-in role IDs are deterministic, including `system:book.owner`, so persistence constraints can identify sensitive rows.
- `book.owner` bindings target a direct user only, never expire, and are created/replaced through book creation or ownership-transfer workflows, not generic binding create.
- the partial unique owner index enforces at most one active owner binding per book; creation/transfer workflows ensure that a book never commits without one owner.
- roles with a derived delegation class other than `ordinary` may target a direct user only; v1 rejects team and service-account assignment of those roles.
- for `principal_type = "user"`, `principal_id` stores `id.sub` without a foreign key to local `users`; an ordinary invitation may exist before the target user first authenticates to `content-api`.
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
- generic denial APIs accept only `ordinary` permissions in v1; ownership-transfer and organization-administrator recovery cannot be disabled through a book sharing denial;
- a book-scoped denial must not target that book's direct owner or an applicable direct organization Content IAM administrator; recovery authority must not be indirectly impaired by a sharing manager;
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
  requestId: text("request_id"),
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
ownership.transferred
org_admin.bootstrap
org_admin.delegated
policy.mutation_denied
```

Audit events are required from day one because sharing, role composition, and negative exceptions are security-sensitive. Successful state mutations and their events must be written atomically. A rejected self-escalation writes no binding and no successful `binding.created` event; it should write a sanitized `policy.mutation_denied` security-audit event containing actor, target resource, requested operation class, and denial reason, without treating the rejected payload as active policy.

### 6.6 Resource Tables

Book-system tables should include org and ownership fields:

```text
books
  id
  org_id
  created_by_user_id
  visibility
  status

chapters
  id
  org_id
  book_id
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

Direct owner fields are not a replacement for Content IAM. They are useful for defaults, audit, filtering, and bootstrapping the single direct-user owner binding. A book may record team attribution separately later, but a team is not the v1 IAM owner.

### 6.7 Local User Projection

`content-api` still needs local user/profile data for authorship and presentation. The migration decision in [docs/006_migrate-auther-to-id.md](docs/006_migrate-auther-to-id.md) is authoritative here:

- set `users.id = id.sub`;
- remove the extra `better_auth_user_id` identity-mapping column;
- store Content IAM `principal_id` for `user` as the same `sub`/`users.id` value.

This makes authorship foreign keys, actor identity, and user policy bindings use one stable identity key, without making a local profile row a prerequisite for sharing. `content_policy_bindings.principal_id` must not foreign-key to `users.id`: an invited external user may receive an ordinary binding before first login. Create or require a local `users` row only when an operation needs content-owned authorship or profile state.

## 7. Content Policy API Shape

### 7.1 Actor Shape

```ts
export type ContentActor =
  | {
      type: "user";
      subject: string;
      organizationId: string | null;
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

No actor is global admin by default. Regular administrative behavior comes from a direct-user binding on a concrete `org` or `book` resource. Any operational recovery/bootstrap path must be separate, narrowly exposed, and audited; it is not an inheritable global policy binding.

For a direct-share user token, `organizationId` is `null`, `teamIds` must be empty, and scopes are restricted to `content:read` and/or `content:write`; `content:share` is invalid in this context. Such an actor may use a direct ordinary user binding after the resource is loaded, including allowed ordinary work in an already shared subtree, but it cannot administer policy, create an organization-root book, or use organization/team-derived authority.

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

### 7.5 Management Use-Case Contracts

`ContentPolicy.can(...)` evaluates application operations. Security-state mutations need a separate administration policy because they must validate delegation, target identity, and pre-mutation authority:

```ts
export interface ContentAdministrationPolicy {
  authorizeBindingCreate(params: {
    actor: ContentActor;
    resource: ContentResourceRef;
    proposedRole: ContentRole;
    principal: PrincipalRef;
  }): Promise<void>;

  authorizeBindingRevoke(params: {
    actor: ContentActor;
    resource: ContentResourceRef;
    existingBinding: PolicyBinding;
  }): Promise<void>;

  authorizeDenialMutation(params: {
    actor: ContentActor;
    resource: ContentResourceRef;
    permission: ContentPermissionKey;
    principal: PrincipalRef;
  }): Promise<void>;

  authorizeOwnershipTransfer(params: {
    actor: ContentActor;
    book: ContentResourceRef;
    currentOwnerUserId: string;
    nextOwnerUserId: string;
  }): Promise<void>;

  authorizeRoleCompositionMutation(params: {
    actor: ContentActor;
    organization: ContentResourceRef;
    role: ContentRole;
    nextPermissions: readonly ContentPermissionKey[];
  }): Promise<void>;
}
```

Application use cases:

```text
CreatePolicyBindingUseCase
RevokePolicyBindingUseCase
ListPolicyBindingsUseCase
CreatePolicyDenialUseCase
RevokePolicyDenialUseCase
ListPolicyDenialsUseCase
ListPolicyEventsUseCase
TransferBookOwnershipUseCase
CreateContentRoleUseCase
ReplaceContentRolePermissionsUseCase
DisableContentRoleUseCase
BootstrapOrganizationContentAdminUseCase
DelegateOrganizationContentAdminUseCase
```

Each mutation use case:

1. loads the path-addressed resource and ancestry;
2. authorizes through existing policy state;
3. validates delegation class and target principal;
4. writes the mutation and audit event in one D1 workflow operation.

Route handlers continue to validate input, obtain the actor, call exactly one use case, and present output. They must not contain permission logic or call `id` directly.

### 7.6 HTTP API Contract

Content IAM is not an `id` plugin and is not a network policy-decision service. It is a `content-api` domain/application/http surface using the existing Hono OpenAPI pattern. The public management API is resource-scoped.

Normal product routes apply the same local policy boundary. A direct-share actor with `content:write` may create or update chapters, sections, comments, inline comments, and attached media inside an already directly shared book subtree only when its direct ordinary role includes the corresponding permission. Creating a new top-level book under an organization requires workspace context and local `org.create_book`. Every binding, denial, ownership, or role-administration route requires workspace context and `content:share`; a direct-share token can never call those routes successfully.

Required v1 book-level routes:

| Method | Path | Coarse scope | Local authorization | Purpose |
|---|---|---|---|---|
| `GET` | `/books/{bookId}/policy-bindings?view=direct|effective` | `content:share` | `book.manage_bindings` | List direct policy rows by default; `effective` additionally identifies inherited binding sources for administration UI. |
| `POST` | `/books/{bookId}/policy-bindings` | `content:share` | Delegation rules over pre-state | Grant an ordinary role, or direct-user sharing-manager authority when allowed. |
| `DELETE` | `/books/{bookId}/policy-bindings/{bindingId}` | `content:share` | Delegation rules over pre-state | Revoke a binding on the addressed book only. |
| `GET` | `/books/{bookId}/policy-denials` | `content:share` | `book.manage_bindings` | List direct negative exceptions for the book subtree. |
| `POST` | `/books/{bookId}/policy-denials` | `content:share` | `book.manage_bindings` | Create an ordinary-permission negative exception. |
| `DELETE` | `/books/{bookId}/policy-denials/{denialId}` | `content:share` | `book.manage_bindings` | Revoke a negative exception. |
| `POST` | `/books/{bookId}/ownership-transfer` | `content:share` | `book.transfer_ownership` from direct owner/org admin | Atomically replace the direct owner. |
| `GET` | `/books/{bookId}/policy-events` | `content:share` | `book.manage_bindings` | View audit events restricted to this book subtree. |

Chapter/section/media policy routes follow the same contract when that narrower sharing surface is implemented:

```text
GET/POST/DELETE /chapters/{chapterId}/policy-bindings[/{bindingId}]
GET/POST/DELETE /chapters/{chapterId}/policy-denials[/{denialId}]
GET/POST/DELETE /media/{mediaId}/policy-bindings[/{bindingId}]
```

They must load ancestry and require authority inherited from the parent book or a stronger organization binding. They do not permit an actor authorized on one chapter to mutate a sibling or its book.

Organization administration routes:

| Method | Path | Coarse scope | Local/administrative authorization | Purpose |
|---|---|---|---|---|
| `POST` | `/organizations/{orgId}/content-iam/bootstrap` | `content:share` | Direct user passes live `id` organization-owner/admin verification; allowed only before this organization's bootstrap reservation is committed | Create the first direct-user `org.content_admin` binding. |
| `GET` | `/organizations/{orgId}/policy-bindings?view=direct` | `content:share` | direct `org.manage_bindings` | List organization-scoped policy rows. |
| `POST` | `/organizations/{orgId}/policy-bindings` | `content:share` | direct `org.manage_bindings` | Assign an ordinary organization-scoped content role such as `org.author`; admin role uses the dedicated endpoint. |
| `DELETE` | `/organizations/{orgId}/policy-bindings/{bindingId}` | `content:share` | direct `org.manage_bindings` | Revoke an ordinary organization-scoped content role. |
| `GET/POST/DELETE` | `/organizations/{orgId}/policy-denials[/{denialId}]` | `content:share` | direct `org.manage_bindings` | Manage ordinary permission exceptions inherited within the organization. |
| `GET` | `/organizations/{orgId}/content-roles` | `content:share` | direct `org.manage_roles` | List built-in and organization-defined roles. |
| `POST` | `/organizations/{orgId}/content-roles` | `content:share` | direct `org.manage_roles` | Create an ordinary organization-defined role. |
| `PUT` | `/organizations/{orgId}/content-roles/{roleId}/permissions` | `content:share` | direct `org.manage_roles` plus expected version | Replace ordinary role composition; sensitive permission keys are rejected. |
| `DELETE` | `/organizations/{orgId}/content-roles/{roleId}` | `content:share` | direct `org.manage_roles` | Disable an unused/migrated custom role; do not silently delete active meaning. |
| `POST` | `/organizations/{orgId}/content-admins` | `content:share` | existing direct `org.content_admin` | Delegate organization Content IAM administration to a direct user. |
| `DELETE` | `/organizations/{orgId}/content-admins/{bindingId}` | `content:share` | existing direct `org.content_admin` with last-admin invariant | Revoke organization Content IAM administration. |

No v1 route exposes:

```text
POST /policy-bindings
POST /global/policy-bindings
principal = * or resource = *
```

The resource identity comes from the route path and loaded row, never from a caller-supplied arbitrary `org_id`/`resource_id` pair.

Request contracts:

```ts
type CreatePolicyBindingInput = {
  principal: {
    type: "user" | "team" | "service_account";
    id: string;
  };
  roleId: string;
  expiresAt?: string | null;
  reason?: string | null;
};

type CreatePolicyDenialInput = {
  principal: {
    type: "user" | "team" | "service_account";
    id: string;
  };
  permission: ContentPermissionKey;
  appliesToDescendants: boolean;
  expiresAt?: string | null;
  reason: string;
};

type TransferBookOwnershipInput = {
  nextOwnerUserId: string;
  expectedCurrentOwnerUserId: string;
  reason: string;
};

type CreateContentRoleInput = {
  key: string;
  name: string;
  assignableResourceType: "book" | "chapter" | "section" | "media";
  permissions: readonly ContentPermissionKey[];
};

type ReplaceContentRolePermissionsInput = {
  expectedVersion: number;
  permissions: readonly ContentPermissionKey[];
  reason: string;
};
```

Common response contracts:

```ts
type PolicyBindingResponse = {
  id: string;
  orgId: string;
  principal: PrincipalRef;
  roleId: string;
  resource: { type: string; id: string };
  expiresAt: string | null;
  createdBy: PrincipalRef;
  createdAt: string;
};

type PolicyMutationResponse<T> = {
  data: T;
  auditEventId: string;
};
```

Schemas belong under `src/http/schemas/content-iam.schema.ts`, presenters under `src/http/presenters/content-iam.presenter.ts`, and routes under resource-specific route modules or `src/http/routes/content-iam.routes.ts` when the module remains thin and resource-scoped.

### 7.7 Mutation Authorization Algorithm

`content:share` is only the OAuth capability gate for attempting Content IAM mutations. It never authorizes a concrete binding, denial, role change, or ownership transfer.

Binding-create flow:

```text
1. Authenticate token; require audience, org_id, and content:share.
2. Load the resource from the path and derive its complete ancestry.
3. Reject when token org_id differs from resource org_id.
4. Load proposed role and its enabled permissions; compute its delegation class.
5. Authorize this mutation using policy state that exists before the mutation:
   - ordinary role on a book/descendant: require book.manage_bindings on target ancestry;
   - ordinary role on an org resource: require direct-user org.manage_bindings on that org;
   - protected policy_management role: require direct-user book.owner or direct org.content_admin;
   - ownership_transfer role: reject; use ownership-transfer workflow;
   - organization_admin role: reject; use organization-admin workflow.
6. Enforce target-principal restrictions for the delegation class.
7. Validate target principal against id at write time.
8. Atomically insert binding and binding.created event, or make no active-state change.
```

The proposed binding is never part of step 5. The same pre-state rule applies to revoke, denial, ownership-transfer, organization-admin delegation, and role-permission composition changes. A role update cannot give the caller the permission needed to authorize that same update.

Role composition additionally fails closed:

```text
organization-defined role + any non-ordinary permission
  -> reject

protected built-in owner/sharing-manager/org-admin role mutation
  -> reject through tenant API
```

This prevents a previously harmless role already bound to a team or service account from later becoming a policy-management role.

Required self-escalation behavior:

```text
Given:
  user A knows book_1 ID
  user A has token scope content:share
  user A has no existing book.manage_bindings/book.owner/org.content_admin authority

When:
  user A POSTs a binding granting user A book.owner or book.sharing_manager

Then:
  return 403
  write no binding
  write no binding.created success event
  record a sanitized policy.mutation_denied security audit event
```

Ownership-transfer flow:

```text
1. Require content:share and load book ancestry.
2. Load the existing single direct-user owner binding.
3. Require direct existing book.transfer_ownership authority from that owner or a direct org content administrator.
4. Validate the next owner is a current user in the resource organization.
5. Check expectedCurrentOwnerUserId to prevent stale competing transfers.
6. In one workflow transaction, revoke/replace old owner binding, insert new owner binding, and write ownership.transferred.
```

### 7.8 Principal Validation Against `id`

Ordinary permission evaluation trusts signed actor claims plus local binding state. Policy writes are different: they create durable references to external principals and are low-volume enough for authoritative validation.

Required mutation-time port:

```ts
export interface ContentPrincipalDirectory {
  validateUser(params: {
    userId: string;
  }): Promise<void>;

  validateUserInOrganization(params: {
    userId: string;
    orgId: string;
  }): Promise<void>;

  validateTeamInOrganization(params: {
    teamId: string;
    orgId: string;
  }): Promise<void>;

  validateServiceAccountForOrganization(params: {
    clientId: string;
    orgId: string;
    resource: string; // Public OAuth resource indicator / access-token audience.
  }): Promise<void>;

  validateOrganizationAdministrator(params: {
    userId: string;
    orgId: string;
  }): Promise<void>;
}
```

Rules:

- a user target is stored using `id` `sub`, identical to `users.id`;
- an ordinary direct-user reader/editor/reviewer binding may target any verified `id` user, including a user who is not an organization member;
- a user target for `book.owner`, `book.sharing_manager`, or `org.content_admin` must be validated as a current member of the resource organization;
- a team target must exist in `id` and have `organizationId` equal to the resource `org_id`;
- a service-account target must be an eligible client for that organization and the public OAuth `resource`/JWT audience of the Content API; `content-api` does not pass an internal `id.resourceServerId`;
- `id` resolves that public resource audience to its internal resource-server row and verifies the enabled client/organization/resource grant;
- the bootstrap workflow calls `validateOrganizationAdministrator` for a live generic Better Auth organization-owner/admin fact only to establish the first local `org.content_admin`; any later recovery workflow is separately controlled and not exposed by the current API; normal policy decisions do not depend on the `id` organization role;
- role lookup and assignability stay local to `content-api`;
- validation is performed when creating/delegating durable policy state, not inside normal `ContentPolicy.can(...)` evaluation;
- a local projection may be introduced for bulk administration only after its refresh/revocation SLA is designed.

This creates one required `id` integration before implementation: an authenticated verification contract for users, teams, and org-scoped clients used by Content IAM write flows. `content-api` calls it using a dedicated integration M2M token whose audience is the `id` principal-validation API and whose narrow scope is `identity:principals:validate`. The `resource` in `validateServiceAccountForOrganization` is separate request data identifying the Content API audience whose target client eligibility is being checked; it is not the audience of the validation caller token. Exact-ID validation is sufficient in v1; no principal enumeration API is needed.

### 7.9 Audit, Idempotency, And Concurrency

Mutation invariants:

- successful binding, denial, role-composition, administrator-delegation, and ownership-transfer changes write their append-only `content_policy_events` entry atomically with state;
- denied self-escalation and prohibited delegation attempts write only a sanitized `policy.mutation_denied` audit event, not an active binding/denial or a success event;
- audit reads are scoped to an organization or resource subtree and require policy-management authority;
- event snapshots must not store bearer tokens or unbounded external identity payloads.
- rejected-mutation events require route rate limiting and a retention policy so an attacker cannot create unbounded audit storage through repeated denied requests.

Write contract:

- create-binding, create-denial, ownership-transfer, and administrator-delegation routes require `Idempotency-Key`;
- repeated identical idempotent requests return the originally committed result; reuse with a different input returns `409`;
- binding/denial uniqueness constraints reject duplicate active state;
- role-permission replacement uses `expectedVersion`; a stale mutation returns `409` rather than overwriting a concurrent administrator change;
- ownership transfer requires `expectedCurrentOwnerUserId`; the transfer fails if ownership changed before commit;
- revoking the final direct organization Content IAM administrator must be rejected unless an atomic replacement is part of the workflow.

## 8. Detailed Product Coverage

### 8.1 Books

Book policy examples:

```text
book.create:
  scope includes content:write
  AND actor has org.create_book on org

book.read:
  public + published
  OR actor has book.reader/editor/author/owner on book
  OR actor has an applicable role inherited from its concrete org resource

book.update:
  scope includes content:write
  AND an applicable role binding includes book.update
  AND no applicable book.update denial exists

book.manage_bindings:
  scope includes content:share
  AND existing pre-mutation authority includes book.manage_bindings
  AND proposed mutation is allowed by delegation-class rules
```

On book create:

- require `org.create_book` on the concrete organization, except for an explicit initial product bootstrap path;
- require workspace user or qualified M2M organization context; a direct-share user token cannot create a new organization-root book even when it has `content:write`;
- when a user creates the book, create its single direct-user owner binding for that user in the same D1 batch/workflow;
- when an approved service-account import creates the book, require a validated `ownerUserId` and create the direct-user owner binding for that user; do not make the service account owner;
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

Narrow resource-level sharing is intentional:

- a book-level editor binding is inherited by its chapters/sections/media where the role includes those permissions;
- a direct-share user with `content:write` and such a direct ordinary binding may perform the corresponding ordinary descendant create/update operations in that existing shared subtree;
- a chapter-level reviewer or reader binding can share only that chapter subtree;
- a chapter-level binding cannot grant access to sibling chapters or mutate the parent book;
- an ancestor denial applying to descendants remains authoritative over a narrower allow in v1.

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
2. Finalize the `id` mutation-time principal verification contract and the M2M security-state mutation restriction.
3. Add Content IAM permission registry, role composition, binding, denial, audit persistence, and administration policy.
4. Add resource-scoped policy-management routes and organization/bootstrap workflows.
5. Replace `relationships` usage for new book resources.
6. Remove `grant_mirror` and `deferred_grants` once no routes depend on them.
7. Build book/chapter/section resources on top of Content IAM.
8. Add list filtering and batch authorization before exposing large book lists.

Do not implement a network policy API first. Keep `ContentPolicy` inside `content-api`.

This is also not an `id` plugin. In `content-api`, it follows the existing clean-architecture module shape:

```text
src/domain/iam/
  content-permission.ts
  content-role.entity.ts
  policy-binding.entity.ts
  policy-denial.entity.ts
  policy-event.entity.ts
  content-policy.ts
  content-administration.policy.ts
  *.repository.ts
  content-principal-directory.ts

src/application/content-iam/
  create-policy-binding.usecase.ts
  revoke-policy-binding.usecase.ts
  create-policy-denial.usecase.ts
  revoke-policy-denial.usecase.ts
  transfer-book-ownership.usecase.ts
  create-content-role.usecase.ts
  replace-content-role-permissions.usecase.ts
  bootstrap-organization-content-admin.usecase.ts

src/http/
  schemas/content-iam.schema.ts
  presenters/content-iam.presenter.ts
  routes/content-iam.routes.ts

src/infrastructure/
  repositories/drizzle-policy-*.repository.ts
  repositories/drizzle-content-iam-*.workflow.ts
  identity/id-content-principal-directory.ts
```

Authorization belongs in the domain policies and application use cases. HTTP routes remain OpenAPI adapters, infrastructure repositories persist/query data, and the `id` principal-directory adapter is invoked only from IAM mutation use cases.

## 10. Migration And Rollout

Because there is no production data yet, prefer schema cleanup over compatibility layers:

- remove Auther mirror concepts when Content IAM replaces them;
- create fresh migrations for Content IAM tables;
- update docs before data import;
- avoid dual-writing old relationships and new bindings unless needed for an incremental PR.

Rollout order:

1. `id` supports teams, `team_ids`, direct-share user tokens without team/org authority, coarse resource-server-bound scopes, uniform 15-minute user tokens, M2M organization grants, and mutation-time principal verification.
2. `content-api` actor parses user teams and service-account clients, with `users.id = id.sub`.
3. `content-api` seeds supported permissions, delegation classes, and built-in role definitions.
4. `content-api` adds bindings, denials, events, resource-scoped administration policy, and mutation workflows.
5. a controlled organization bootstrap creates at least one direct-user `org.content_admin` where organization-level product administration is needed.
6. new book resources create single direct-user owner bindings atomically.
7. resource-scoped policy APIs replace the old authz administration routes.
8. old `relationships`, `grant_mirror`, and `deferred_grants` are deleted or deprecated.

## 11. Edge Cases And Failure Modes

| Scenario | Expected behavior |
|---|---|
| User token has old `team_ids` after team removal | Ordinary team-derived access may continue for at most the 15-minute user-token lifetime. New/refresh tokens omit removed team. Sensitive mutations do not use team-derived authority in v1. |
| Binding removed while access token remains valid | Deny on next request because bindings are local and checked at request time. |
| Role disabled while bindings reference it | Treat its bindings as inactive; retain audit history and migrate/re-enable deliberately. |
| Permission registry row is disabled while a role references it | Treat that permission as unavailable and fail closed. |
| Binding references team from another org | Reject on create; ignore/deny if corrupted. |
| M2M token lacks `org_id` for org resource | Reject with `403`. |
| Service account is granted a policy-management/owner/admin role | Reject the binding mutation in v1 even when the client is valid. |
| Team is granted a policy-management/owner/admin role | Reject the binding mutation in v1; teams may hold ordinary collaborator roles only. |
| User holds `content:share` and self-grants `book.owner` without existing authority | Return `403`, write no binding or success event, and record `policy.mutation_denied`. |
| Book sharing manager tries to grant `book.owner` | Reject; ownership is changed only through ownership-transfer workflow. |
| Book sharing manager tries to deny the owner's editing/read permissions | Reject; ordinary denials cannot target the direct owner or applicable organization administrator. |
| Book owner tries to write an org binding or another book's binding | Reject; the owner authority is limited to that book subtree. |
| Org content admin tries to act across a different org | Reject on resource/token `org_id` mismatch; no global binding exists. |
| Target team/user/client cannot be verified with `id` during policy write | Fail closed; do not persist the binding/denial/delegation. |
| External direct user has ordinary binding on a shared private book and a token without `org_id` | Evaluate only the direct `user:sub` binding; do not apply team/org authority or permit policy mutation. |
| Direct-share user has `content:write` and an ordinary role permitting descendant creation in an already shared book | Permit only the corresponding ordinary descendant operation; do not permit top-level book creation or policy mutation. |
| Direct-share token carries `content:share` | Reject; direct-share issuance and use are read/write-only. |
| Token contains an `org_id` different from the resource org | Reject; do not downgrade a mismatched workspace token into direct-share access. |
| Existing last org content admin is revoked | Reject unless the same atomic workflow installs a replacement admin. |
| Two ownership transfers race | Require expected current owner; one commits and the stale request returns `409`. |
| Two role-composition writes race | Require role version; stale replacement returns `409`. |
| Org admin attempts to add `book.manage_bindings` to a team-held custom role | Reject; custom roles are ordinary-only and sensitive roles are protected built-ins. |
| Attacker repeats denied self-grant requests | Continue returning `403`; rate-limit mutation routes and retain enough sanitized denial events for security review without unbounded storage growth. |
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
- [ ] Configure all user access tokens with a 15-minute lifetime and document the maximum stale `team_ids` window.
- [ ] Refine the user-token contract for direct external sharing: explicit direct-share issuance contains `sub`, no `org_id`, `team_ids = []`, and only `content:read`/`content:write`; it may use direct ordinary bindings without requiring organization membership, including locally permitted descendant work inside an already-shared subtree.
- [ ] Preserve direct-share context across refresh/new issuance without emitting an internal consent/reference marker as token `org_id`.
- [ ] Ensure M2M tokens expose stable `azp` or `client_id`.
- [ ] Configure coarse `content:read`, `content:write`, and `content:share` scopes as resource-server-bound scopes in `id` through `oauthResourceScope`.
- [ ] Define `team_ids` cap/overflow behavior in `id`: fail token issuance for the active org rather than truncating.
- [ ] Require `org_id` on org-scoped M2M access tokens, backed by `oauthClientOrganizationGrant`.
- [ ] Define the authenticated principal-verification contract used only on Content IAM writes for user/team/client targets: the caller uses an `id` validation audience with `identity:principals:validate`, and service-account target validation takes the public Content API OAuth resource audience.
- [ ] Decide M2M lifetime/revocation behavior before permitting any future M2M security-state mutation.

Acceptance criteria:

- `content-api` can build user/team/service-account principals without querying `id`.
- Content IAM mutation use cases can validate durable target principals against `id`.
- User-token stale team membership is bounded to 15 minutes; v1 sensitive mutation authority is direct-user-only.
- External direct-user sharing does not require enrolling a reader/collaborator into the book owner's organization.
- Direct-share tokens cannot carry `content:share`, create organization-root books, or mutate Content IAM state.

Tests:

- `id` token tests for `team_ids`.
- `id` token expiry and refresh-after-team-removal tests.
- `id` tests that direct-share refresh preserves direct-share claims and never emits its internal context marker as `org_id`.
- `content-api` auth tests for parsing token claims.
- `content-api` direct-share user tests for ordinary read/write and descendant creation through direct bindings, denied `content:share`, denied top-level book creation, and denied team/admin authority without `org_id`.

### IAM-B. Add Content IAM Domain Model

Scope:

- `src/domain/iam/`
- `src/domain/auth/actor.ts`

Tasks:

- [ ] Add code-supported `ContentPermissionKey` constants.
- [ ] Add code-supported delegation-class metadata for permissions.
- [ ] Add `ContentPermission`, `ContentRole`, `PolicyBinding`, `PolicyDenial`, and `PolicyEvent` entities.
- [ ] Add `ContentAdministrationPolicy` and `ContentPrincipalDirectory` interfaces.
- [ ] Encode direct-user-only ownership/admin and delegation restrictions.
- [ ] Seed protected sensitive built-in roles and enforce ordinary-only custom role composition.
- [ ] Add repository interfaces.

Acceptance criteria:

- Permission keys checked by application code are explicit and testable.
- Role composition and deny exceptions are owned by `content-api`, not `id`.
- No CEL/arbitrary condition engine is part of the first implementation.
- No v1 role assignment can place security-state mutation authority on a team or service account.
- No custom role mutation can create sensitive security-state authority.

Tests:

- unit tests for supported permission-key validation.
- unit tests for delegation-class derivation and restricted-role assignment.
- unit tests rejecting sensitive permission composition in custom roles.
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
- [ ] Add role optimistic version storage and event request correlation.
- [ ] Add repositories and mappers.
- [ ] Use `CrudAdapter` for common writes.
- [ ] Use workflow repositories for atomic resource + owner binding creation, binding/denial mutation with event, and ownership transfer with event.

Acceptance criteria:

- Permission seeds and built-in roles can be installed deterministically.
- Role-composition, binding, and denial changes are persisted and audited.
- Unique constraints prevent duplicate active bindings.
- Unique constraints prevent duplicate active denials.
- A deterministic-role partial unique index plus workflows enforce one accountable, non-expiring direct-user owner per book.

Tests:

- repository tests through Vitest worker pool.
- second direct `system:book.owner` binding for one book fails unless ownership-transfer workflow replaces the original atomically.

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
- [ ] Keep first implementation uncached across policy calls; add request-local memoization later only after measured repeated reads justify it.

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
- direct user denial overrides team role permission.
- denial overrides permission received from multiple teams.
- inherited parent denial overrides descendant allow.
- expired denial no longer overrides an allow.

### IAM-E. Add Resource-Scoped Management APIs

Scope:

- `src/domain/iam/content-administration.policy.ts`
- `src/domain/iam/content-principal-directory.ts`
- `src/application/content-iam/`
- `src/http/routes/content-iam.routes.ts`
- `src/http/schemas/content-iam.schema.ts`
- `src/http/presenters/content-iam.presenter.ts`
- `src/infrastructure/identity/id-content-principal-directory.ts`
- `src/infrastructure/repositories/drizzle-content-iam-*.workflow.ts`
- `src/composition/create-request-container.ts`

Tasks:

- [ ] Add resource-scoped binding and denial list/create/revoke operations for books, with descendant resource routes added only as their resource models land.
- [ ] Add dedicated ownership-transfer operation; reject `book.owner` in generic binding creation.
- [ ] Add organization role-composition and direct-user content-admin delegation workflows.
- [ ] Add controlled organization Content IAM admin bootstrap/recovery operation.
- [ ] Enforce pre-mutation authorization and delegation-class restrictions.
- [ ] Reject tenant mutation of protected built-in roles and reject non-ordinary custom role composition.
- [ ] Reject denials targeting the current book owner or applicable organization Content IAM administrator.
- [ ] Use `ContentPrincipalDirectory` for write-time user/team/client validation only.
- [ ] Require idempotency keys for security-state create/transfer/delegation requests.
- [ ] Record atomic success events and sanitized rejected-escalation audit events.
- [ ] Define rate limiting and retention for rejected policy-mutation audit events.

Acceptance criteria:

- There is no global/wildcard policy-binding endpoint.
- Book owner authority cannot affect another book or its organization policy.
- `content:share` without an existing local management binding cannot create access.
- Team and service-account principals cannot receive v1 policy-management, ownership-transfer, or organization-admin authority.
- A custom role already held by collaborators cannot be upgraded into a sensitive role.
- Role and ownership concurrent writes fail closed with `409` on stale expected state.

Tests:

- self-grant attempt with only `content:share` returns `403`, creates no binding/success event, and writes a rejected-mutation audit event.
- book owner grants/revokes an ordinary team editor binding on owned book.
- book owner cannot grant owner or organization admin through binding endpoint.
- sharing manager cannot delegate management or transfer ownership.
- sharing manager cannot deny the book owner's ordinary content permissions.
- org content admin can operate only inside its organization.
- target team from another organization is rejected after `id` validation.
- M2M policy-management binding is rejected.
- role-composition request adding `book.manage_bindings` to a custom/team-held role is rejected.
- repeated rejected mutation attempts are rate-limited without allowing a mutation.

### IAM-F. Replace Relationship/Grant Mirror Usage

Scope:

- removed `src/domain/authz/relationship*`
- removed `src/application/relationships/*`
- removed `src/application/grant-mirror/*`
- removed `src/application/deferred-grants/*`
- removed routes and schemas for authz admin resources
- moved still-current actor/scope helpers from `src/domain/authz/*` to `src/domain/auth/*`

Tasks:

- [x] Stop using `relationships` for new content ownership.
- [x] Remove or deprecate `grant_mirror` and `deferred_grants`.
- [x] Remove old unscoped authz-admin routes once resource-scoped Content IAM management routes replace them.
- [x] Update README implemented scope.

Acceptance criteria:

- Auther mirror concepts no longer define product authorization.

Tests:

- OpenAPI excludes `/grant-mirror`, `/deferred-grants`, and `/relationships`.
- Direct requests to those legacy routes return `404`.
- Post, category, and media authorization uses row ownership without seeded relationship rows.
- Idempotent post/category/media creation writes only the product row plus idempotency row.

- `pnpm lint`
- `pnpm check:dup`
- `pnpm typecheck`
- `pnpm test`

### IAM-G. Add Book/Chapter Resource Model

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
- [ ] Require `org.create_book` where product bootstrap is complete.
- [ ] Create one direct-user owner binding on book create; require an explicit validated owner user for service-account imports.
- [ ] Use `ContentPolicy` for update/delete/share/read-private operations.

Acceptance criteria:

- Book collaboration can be expressed with team/user/service-account bindings.

Tests:

- book owner can manage bindings.
- chapter-specific binding affects only its descendant subtree.
- editor can update book/chapter.
- reviewer can create inline comment but not update chapter.
- reader can read but not update.

### IAM-H. Add Tests And Verification

Scope:

- `tests/api.test.ts`
- new focused tests for IAM repositories and policies

Tasks:

- [ ] Add policy evaluator tests.
- [ ] Add route integration tests for book/chapter authorization.
- [ ] Add list filtering tests that subtract denied resources from allowed resources.
- [ ] Add role-composition management tests.
- [ ] Add denial and audit event tests.
- [ ] Add ownership-transfer/idempotency/concurrency tests.
- [ ] Add restricted team/service-account administration tests.
- [ ] Add tests proving no resource-scoped route crosses book or organization boundaries.

Acceptance criteria:

- `pnpm check` passes.
- `pnpm advise` is clean or suppressions are justified.

Tests:

- `pnpm check`
- `pnpm advise`

## 13. Future Backlog

- Custom role and denial management UI over the first-batch Content IAM APIs.
- Policy simulation UI for content resources.
- Optional team-derived sharing-management authority only after accepting the 15-minute stale-membership SLA or defining a live membership contract.
- Optional M2M security-state mutation only after defining client revocation/lifetime requirements.
- Group/team merge operation.
- Group budgets/quotas and usage attribution.
- Share links/access passes.
- Optional token introspection for high-risk admin paths.
- Policy event streaming for audit exports.
- Optional condition language such as CEL only after concrete conditional-policy requirements and list-filtering behavior are designed.

## 14. Definition Of Done

- Content IAM tables and repositories exist.
- Code-supported permission keys and their delegation-class registry seed exist with tests.
- DB-backed roles and role-permission mappings exist.
- DB-backed permission denials exist and override applicable allows.
- `ContentPolicy.can` and `canMany` exist.
- `ContentAdministrationPolicy` exists and authorizes policy mutations from pre-mutation state only.
- User/team/service-account principals are supported.
- Local users and user policy principals use `users.id = id.sub`.
- Direct external user sharing works through ordinary direct bindings without making every reader/collaborator an organization member.
- Direct-share tokens may carry read/write only and may perform locally authorized ordinary descendant work inside existing shared subtrees; they cannot carry `content:share`, create organization-root books, or change Content IAM state.
- Book owner/editor/reviewer/reader behavior is expressible through resource-level bindings.
- A book has one direct-user owner and ownership transfer is a dedicated audited workflow.
- Resource-scoped binding/denial/role-management routes are documented with OpenAPI schemas and implemented through use cases.
- No platform-global/wildcard policy-binding endpoint exists.
- Team and service-account principals cannot receive sensitive policy-management/ownership/admin roles in v1.
- Sensitive administrator/owner/sharing-manager roles are protected built-ins; custom roles remain ordinary-only in v1.
- `content:share` only permits policy mutation attempts; it never replaces local management authority.
- Target principal validation against `id` occurs on durable policy writes only, through the dedicated validation audience/scope; service-account target eligibility is qualified by the public Content API OAuth resource audience.
- Resource ancestry is passed to policy checks.
- Role composition, binding, denial, ownership, organization-admin, and denied-escalation actions write appropriate audit events.
- Self-grant escalation returns `403`, writes no active policy or success event, and is security-audited.
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
    coarse resource-server-bound scopes: content:read, content:write, content:share
    workspace user claims: sub, org_id, team_ids
    direct-share user claims: sub, no org_id, team_ids = [], content:read/write only
    M2M claims: azp/client_id, org_id
    15-minute user token / stale-team upper bound
    write-time principal verification API for durable policy mutation,
      called with dedicated validation audience/scope and public target resource audience

content-api
  product authorization:
    implemented permission keys in code and local registry
    delegation classes for ordinary vs security-state permissions
    content_roles and content_role_permissions
    resource-scoped content_policy_bindings
    content_policy_denials
    content_policy_events
    bounded resource hierarchy: org -> book -> descendants
    ContentPolicy.can(...)
    ContentAdministrationPolicy for pre-state-authorized mutations
    ownership transfer and org-admin bootstrap/delegation workflows
```

Regular sharing happens at a concrete content resource. A book owner governs that book subtree; a direct-user organization Content IAM administrator governs only that organization; no v1 actor receives platform-global binding authority. This gives the book ecosystem a serious authorization foundation without turning `id` into a custom content policy service.

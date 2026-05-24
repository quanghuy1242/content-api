# Batch 2 Review Of The Docs 006 And 007 Implementation

> Status: remediation verified
>
> Date: 2026-05-24
>
> Commits reviewed:
>
> - `a5c71e8e51af0422fcfe73658c519a444f03614c` - Full 006 007 implementation
> - `275f4ecb1cf18584f9e1bdb0b0886ada6b54726d` - 006 007 batch 1 fix
>
> Scope:
>
> - `/home/quanghuy1242/pjs/content-api`
> - `/home/quanghuy1242/pjs/auth` contract context only
>
> Source docs:
>
> - `docs/006_migrate-auther-to-id.md`
> - `docs/007_content-iam-policy-binding-model.md`
> - `docs/008_review-last-commit-006-007.md`
> - `docs/009_book-resource-hierarchy-and-collaboration-plan.md`
> - `/home/quanghuy1242/pjs/auth/docs/010_organization-teams-oauth-flow.md`
>
> Verification run:
>
> - Initial reviewed commits: `corepack pnpm check` passed with 50 Vitest tests before remediation.
> - Remediated IAM-substrate worktree: `corepack pnpm check` passed: oxlint with zero findings, Fallow mild gate at 1.2% below the 3% threshold, typecheck, and 68 Vitest tests.
> - Follow-up legacy-authz cleanup: API tests passed with 75 Vitest tests after removing Auther mirror/deferred-grant/relationship routes and tables.
> - Remediated worktree: `corepack pnpm advise` passed with all known findings suppressed (`30` Aislop, `11` Fallow); the added route duplication suppression follows the repository's mandated route-handler exception.
> - Remediated worktree: `git diff --check` passed.
>
> Remediation target:
>
> - Current worktree after this review and the verified gate runs above.

## Table Of Contents

- [1. Purpose And Rating](#1-purpose-and-rating)
- [2. Current State After Batch 1 Fixes](#2-current-state-after-batch-1-fixes)
- [3. Findings](#3-findings)
  - [P1-1. Retained Authz Administration Routes Bypass OAuth Operation Scopes](#p1-1-retained-authz-administration-routes-bypass-oauth-operation-scopes)
  - [P1-2. A Book Sharing Manager Can Delegate Protected Sharing-Manager Authority](#p1-2-a-book-sharing-manager-can-delegate-protected-sharing-manager-authority)
  - [P1-3. Organization-Defined Roles Can Be Bound In A Different Organization](#p1-3-organization-defined-roles-can-be-bound-in-a-different-organization)
  - [P1-4. Token Claim Omission Can Erase Local User Profile Data](#p1-4-token-claim-omission-can-erase-local-user-profile-data)
  - [P1-5. Role Permission Optimistic Concurrency Is Not Enforced At Commit](#p1-5-role-permission-optimistic-concurrency-is-not-enforced-at-commit)
  - [P1-6. Organization Admin Bootstrap And Last-Admin Invariants Are Raceable](#p1-6-organization-admin-bootstrap-and-last-admin-invariants-are-raceable)
  - [P1-7. Rejected Mutation Auditing Has No Storage-Abuse Control](#p1-7-rejected-mutation-auditing-has-no-storage-abuse-control)
  - [P2-1. Required Effective Binding View Is Not Implemented](#p2-1-required-effective-binding-view-is-not-implemented)
- [4. Test Coverage Assessment](#4-test-coverage-assessment)
- [5. Remediation Backlog](#5-remediation-backlog)
- [6. Acceptance Gate](#6-acceptance-gate)
- [7. Resolution Evidence](#7-resolution-evidence)
- [8. Docs 006 And 007 DoD Reconciliation](#8-docs-006-and-007-dod-reconciliation)
- [9. Final Assessment](#9-final-assessment)

## 1. Purpose And Rating

This review checks the two commits implementing docs 006 and 007, including the fixes prompted by docs 008 and the deliberate book-resource deferral captured by docs 009.

**Initial reviewed implementation rating: 6/10.**

The implementation establishes a substantial and generally clean IAM substrate: `id` token verification, direct-share actor restrictions, principal validation through M2M client credentials, local policy tables, denial precedence, audit writes, route-level Content IAM APIs, and a useful test base. The second commit corrected most of the concrete failures identified in docs 008.

The findings below describe the two reviewed commits before remediation. Resolution evidence for the current worktree is maintained in section 7.

## 2. Current State After Batch 1 Fixes

Confirmed improvements from `275f4ec`:

- Principal validation now obtains an M2M client-credentials token through `src/infrastructure/identity/client-credentials-token-provider.ts`, and CI wires the required client secrets.
- `src/application/auth/authenticate-bearer-token.usecase.ts` accepts any configured Content API capability scope and rejects org-less tokens carrying `content:share`.
- User, category, post, and media use cases enforce `content:read` or `content:write` at their operation boundaries.
- Durable service-account validation passes configured `AUTH_AUDIENCE`, rather than a hard-coded production audience.
- Sensitive binding and ownership targets use organization-membership validation.
- Content IAM idempotency hashes now include concrete resource IDs.
- Expired matching binding and denial rows are deleted as part of create workflows.
- `LocalContentPolicy.canMany(...)` now batches policy lookups and repository resource predicates pair resource type with resource ID.
- Docs 009 correctly separates full book/chapter/section/comment delivery from the implemented IAM substrate.

These corrections explain why the current suite is materially stronger than the implementation reviewed in docs 008. They do not cover the remaining failures below.

## 3. Findings

### P1-1. Retained Authz Administration Routes Bypass OAuth Operation Scopes

Evidence:

- `src/application/grant-mirror/*.usecase.ts`, `src/application/deferred-grants/*.usecase.ts`, and `src/application/relationships/*.usecase.ts` authorize only through local admin policy; none calls `requireContentScope(...)`.
- `src/http/routes/authz.routes.ts` still exposes write operations for `/grant-mirror`, `/deferred-grants`, and `/relationships`.
- `src/application/auth/authenticate-bearer-token.usecase.ts:66-69` accepts a token containing any configured Content API scope.
- `README.md` states use cases enforce route-level `content:read`, `content:write`, or `content:share`.
- Docs 007 identifies these as old unscoped authz-admin routes to remove once replaced (`docs/007_content-iam-policy-binding-model.md:1991-2004`).

Impact:

A local administrator with only `content:read`, or only `content:share`, can create, update, or delete legacy authorization state. `relationships` still controls posts, media, and categories, so these are not inert compatibility records.

Required direction:

- Remove the compatibility endpoints if Content IAM has replaced their intended use.
- If they must remain temporarily, enforce explicit operation scopes in every use case: at minimum `content:read` for reads and `content:write` or a deliberately documented administrative scope for writes.
- Add read-only-token negative tests for all retained mutation routes.

### P1-2. A Book Sharing Manager Can Delegate Protected Sharing-Manager Authority

Evidence:

- Docs 007 requires a `policy_management` role such as `book.sharing_manager` to be assignable only by a direct book owner or direct organization content administrator (`docs/007_content-iam-policy-binding-model.md:517-524`, `:790-793`, `:1415`).
- `src/domain/iam/content-permission.ts:128-133` defines `system:book.sharing_manager` with `book.manage_bindings`.
- `src/domain/iam/content-administration.policy.ts:33-43` accepts a policy-management binding whenever the caller passes the generic `book.manage_bindings` check.
- The same `book.sharing_manager` role satisfies that generic permission check through `LocalContentPolicy`.

Impact:

Once a user is made a sharing manager, they may create additional protected sharing managers. This silently converts delegated book-level administration into onward-delegable security authority, contrary to the explicit delegation model.

Required direction:

- For a proposed `policy_management` role, require a direct `system:book.owner` binding on the book or a direct `system:org.content_admin` binding on its organization, not merely an effective permission.
- Apply the same explicit rule to revoking protected management bindings.
- Add tests where an ordinary sharing manager may grant a reader/editor but cannot grant or revoke `system:book.sharing_manager`.

### P1-3. Organization-Defined Roles Can Be Bound In A Different Organization

Evidence:

- Docs 007 defines `content_roles.namespace_id`: `"system"` for built-ins and the organization ID for organization-managed roles (`docs/007_content-iam-policy-binding-model.md:846-881`).
- `src/application/content-iam/create-policy-binding.usecase.ts:53-76` loads a role only by `roleId`, then validates resource type and delegation class.
- There is no condition that a non-system role has `role.namespaceId === resource.orgId`.
- `src/application/content-iam/create-content-role.usecase.ts:49-55` creates custom roles in the requesting organization namespace.

Impact:

An administrator in organization B can bind a known custom role ID owned by organization A onto a B resource. Later updates or disabling by A unexpectedly changes B's authorization. This breaks role ownership isolation and turns role IDs into cross-tenant capabilities.

Required direction:

- Accept roles for binding only when `role.namespaceId === "system"` or `role.namespaceId === resource.orgId`.
- Add API tests creating roles in two organizations and rejecting cross-organization role binding.

### P1-4. Token Claim Omission Can Erase Local User Profile Data

Evidence:

- `src/domain/authz/actor.ts:9-11` makes `email`, `name`, and `avatar` optional token-derived fields.
- `src/domain/users/user-projection.ts:4-11` substitutes `<sub>@id.local.invalid`, the email string as full name, and `null` avatar when claims are omitted.
- `src/infrastructure/repositories/drizzle-user.repository.ts:46-51` calls `syncIdentityProjection(...)` for an existing row and saves all changed values.
- Self reads and resource creation invoke this synchronization through `src/application/users/get-user.usecase.ts:18-20`, `src/application/categories/create-category.usecase.ts:57-63`, `src/application/posts/create-post.usecase.ts:58-63`, and `src/application/media/create-media-upload.usecase.ts:89-95`.
- The `id` contract distinguishes protocol `email` and `profile` scopes from product content scopes (`/home/quanghuy1242/pjs/auth/docs/010_organization-teams-oauth-flow.md:725`).

Impact:

A valid content token that omits `email`, `name`, or `picture` can overwrite a previously populated local profile with placeholder or null values simply by reading its profile or creating content.

Required direction:

- Treat missing optional identity claims as "not supplied" when updating an existing projection.
- Define how a first projection is created when required presentation fields are absent: require appropriate identity claims, fetch a write-time projection through `id`, or store an explicit incomplete projection without overwriting later data.
- Add tests for existing users authenticated with tokens lacking each optional claim.

### P1-5. Role Permission Optimistic Concurrency Is Not Enforced At Commit

Evidence:

- Docs 007 requires `expectedVersion` replacement to reject stale concurrent mutations (`docs/007_content-iam-policy-binding-model.md:1531`).
- `src/application/content-iam/replace-content-role-permissions.usecase.ts:41-48` checks `expectedVersion` before constructing the updated role.
- `src/infrastructure/repositories/drizzle-content-iam-mutation.workflow.ts:85-92` updates `content_roles` by `id` only, deletes all permission rows, and inserts the replacement set.
- No conditional update on the old version or affected-row assertion exists inside the atomic batch.

Impact:

Two administrators submitting different permission replacements from the same version can both pass the pre-check. Both commits may succeed serially, with the later write silently overwriting the earlier role composition instead of returning `409`.

Required direction:

- Make version comparison part of the mutation workflow, for example an update conditioned on `(id, version = expectedVersion)` with a reliable conflict outcome before permission replacement can commit.
- Add a test exercising two different updates based on the same starting version and assert that exactly one succeeds.

### P1-6. Organization Admin Bootstrap And Last-Admin Invariants Are Raceable

Evidence:

- Bootstrap counts active admins in `src/application/content-iam/bootstrap-organization-content-admin.usecase.ts:77-89`, then inserts the first admin in a later workflow batch.
- Generic revoke counts active admins in `src/application/content-iam/revoke-policy-binding.usecase.ts:29-40`, then deletes the selected binding in a later workflow batch.
- `src/infrastructure/repositories/drizzle-content-iam-mutation.workflow.ts:35-49` cannot assert either invariant within the same committed mutation.
- The schema has no bootstrap singleton/reservation guard and no atomic replacement operation for the final admin.
- Docs 007 requires controlled bootstrap and rejection of final-admin revoke unless an atomic replacement is installed (`docs/007_content-iam-policy-binding-model.md:1313`, `:1533`, `:1783`).

Impact:

Two concurrent bootstrap attempts can both observe no local administrator and both create administrator bindings. Two concurrent revokes when two administrators exist can both pass the count check and leave the organization without any local administrator.

Required direction:

- Move lifecycle invariants into transactionally enforced workflow operations or introduce a single organization IAM-state row/reservation mechanism that makes bootstrap and final-admin replacement atomic.
- Expose the documented dedicated admin revoke/replacement operation instead of relying on generic binding deletion.
- Add concurrency tests for simultaneous bootstrap and simultaneous removal of the last two admins.

### P1-7. Rejected Mutation Auditing Has No Storage-Abuse Control

Evidence:

- Docs 007 explicitly requires rate limiting and retention for rejected policy mutation audit events (`docs/007_content-iam-policy-binding-model.md:1521-1524`, `:1787`, `:1965-1987`).
- `src/domain/iam/audit-denied-mutation.ts:6-24` writes one persistent event for each denied authorization attempt.
- `src/application/content-iam/create-policy-binding.usecase.ts:58-74`, `create-policy-denial.usecase.ts:46-63`, and role mutation use cases record denied events before returning failure.
- No route limiter, per-actor/event suppression, or retention cleanup exists in the implementation or tests.

Impact:

Any authenticated caller able to reach these routes can repeatedly create permanent audit rows through rejected requests. Because event creation occurs after a resource is loaded but before local policy authority succeeds, a caller with a workspace token can also generate rejected events against known resources it does not administer.

Required direction:

- Add bounded rejected-event recording: rate limiting keyed by actor and target, plus an explicit retention/cleanup policy.
- Consider suppressing persistent audit writes for pure tenant-mismatch probes while recording authorized-context escalation attempts.
- Add abuse-control tests before exposing Content IAM writes in production.

### P2-1. Required Effective Binding View Is Not Implemented

Evidence:

- Docs 007 defines `GET /books/{bookId}/policy-bindings?view=direct|effective`, where `effective` identifies inherited binding sources for administration UI (`docs/007_content-iam-policy-binding-model.md:1288-1297`).
- `src/http/routes/content-iam.routes.ts:43-53` registers the book binding list route without the documented view behavior.
- `src/application/content-iam/list-policy-bindings.usecase.ts:25-31` returns direct rows for the addressed resource only.

Impact:

The IAM substrate evaluates inherited organization authority but does not provide the administration view required to explain that authority on a book. This is a contract gap in the already implemented book-level IAM surface, not part of the deferred chapter hierarchy.

Required direction:

- Add `view=direct|effective` validation and repository/use-case support for inherited source rows, or explicitly amend docs 007 and carry this endpoint work into docs 009.
- Test that an inherited organization binding is visible in effective view without appearing as a direct book binding.

## 4. Test Coverage Assessment

The 50 passing tests cover a useful first pass: token shapes, basic route scopes for primary resources, principal validation acquisition/caching, sequential bootstrap rejection, sensitive target membership, expired binding recreation, path-scoped idempotency, denial precedence, and sequential ownership transfer.

Coverage is not sufficient for an authorization release because it misses:

- read-only or share-only tokens attempting mutations on `/grant-mirror`, `/deferred-grants`, and `/relationships`;
- a `book.sharing_manager` attempting to create or revoke another sharing-manager binding;
- binding an organization-defined role outside its namespace;
- existing projection synchronization when tokens omit `email`, `name`, or `picture`;
- concurrent `expectedVersion` role replacements;
- concurrent organization-admin bootstrap and concurrent final-admin revoke;
- rate limiting/retention for rejected mutation events;
- the documented effective binding view.

The current gate therefore demonstrates internal consistency and broad happy-path functionality, not the required authorization invariants.

## 5. Remediation Backlog

### R2-A. Close Scope And Delegation Escalation Paths

Scope:

- removed `src/application/grant-mirror/*.usecase.ts`
- removed `src/application/deferred-grants/*.usecase.ts`
- removed `src/application/relationships/*.usecase.ts`
- `src/domain/iam/content-administration.policy.ts`
- `tests/api.test.ts`

Tasks:

- [x] Enforce operation-level OAuth scopes, or remove the deprecated authz mutation endpoints.
- [x] Enforce direct owner/direct org-admin authority for protected `book.sharing_manager` delegation and revoke.
- [x] Add negative security tests for both conditions.

Acceptance criteria:

- A token without the required mutation scope changes no authorization state.
- A sharing manager cannot delegate protected management authority.

### R2-B. Enforce Tenant-Owned Role Bindings

Scope:

- `src/application/content-iam/create-policy-binding.usecase.ts`
- `tests/api.test.ts`

Tasks:

- [x] Restrict custom roles to their organization namespace during binding creation.
- [x] Keep `namespaceId = "system"` roles assignable according to their normal resource and delegation rules.

Acceptance criteria:

- An organization cannot attach another organization's custom role to its resources.

### R2-C. Make Identity Projection Non-Destructive

Scope:

- `src/domain/users/user-projection.ts`
- `src/domain/users/user.entity.ts`
- `src/infrastructure/repositories/drizzle-user.repository.ts`
- projection-calling use cases and API tests

Tasks:

- [x] Preserve stored fields when optional token claims are absent.
- [x] Specify first-projection behavior for content-only tokens.
- [x] Add omitted-claim regression tests.

Acceptance criteria:

- Authentication with a narrower token never erases an existing user's local profile.

### R2-D. Enforce IAM Concurrency In The Write Boundary

Scope:

- `src/domain/iam/content-iam-mutation.workflow.ts`
- `src/infrastructure/repositories/drizzle-content-iam-mutation.workflow.ts`
- organization admin use cases and tests

Tasks:

- [x] Make role version checks commit-time atomic.
- [x] Make first-admin bootstrap transactionally exclusive and prevent any committed final-admin revoke.
- [x] Add concurrency tests.

Acceptance criteria:

- Concurrent security-state mutations either preserve the documented invariant or fail with a conflict.

### R2-E. Complete Audit Abuse Controls And Explanation Surface

Scope:

- Content IAM route/application boundary
- audit persistence/cleanup
- book binding list API
- docs 007/009 and tests

Tasks:

- [x] Implement rejected-mutation rate limiting and retention policy.
- [x] Implement `view=effective` binding explanation.
- [x] Align document status and API contract once the decision is made.

Acceptance criteria:

- Rejected requests cannot grow audit storage without bound.
- Administrators can inspect the source of effective book management authority, or the deferral is explicit.

## 6. Acceptance Gate

Before treating docs 006/007 as accepted for the delivered IAM substrate:

- Resolve P1-1 through P1-7, or explicitly document and approve a release exception for each.
- Decide and align P2-1 with the published API contract.
- Add targeted tests described in section 4.
- Re-run:

```bash
corepack pnpm check
corepack pnpm advise
```

## 7. Resolution Evidence

| Finding / audit addition | Current implementation evidence | Test evidence |
|---|---|---|
| P1-1 compatibility route scope bypass | legacy `grant-mirror`, `deferred-grants`, and `relationships` routes/modules are removed; migration `0005_remove_legacy_authz` drops their tables | OpenAPI exclusion plus direct `404` route tests |
| Additional legacy relationship cleanup | post/category/media policies use row owner fields instead of `relationships`; idempotent create workflows no longer write relationship rows | row-ownership access test plus post/category/media idempotent replay tests |
| P1-2 protected sharing-manager delegation | `ContentAdministrationPolicy` resolves direct book owner or direct organization content-admin bindings before assigning/revoking `book.sharing_manager` | sharing-manager delegation and revoke denial test |
| P1-3 tenant role isolation | `CreatePolicyBindingUseCase` rejects a non-system role whose namespace differs from the loaded resource organization | cross-organization custom-role binding test |
| P1-4 non-destructive identity projection | optional identity projection fields update only when claims are present; first projection uses deterministic fallback values | omitted-profile-claims regression test |
| P1-5 optimistic role concurrency | migration `0004_content_iam_guards` rejects non-monotonic custom-role version updates in the committed batch | competing role replacement test |
| P1-6 bootstrap/final-admin races | migration `0004_content_iam_guards` adds bootstrap reservation uniqueness and final-active-admin delete guard; dedicated admin routes replace generic admin deletion | competing bootstrap and revoke tests |
| P1-7 denied audit storage control | denied writes prune beyond retention; SQLite trigger caps recent denied rows by actor and target | rate-limit and retention test |
| P2-1 effective binding view | book list accepts `view=direct|effective` and loads exact book/organization binding sources | effective-view inheritance test |
| Additional role lifecycle audit | disabling bound roles is rejected, disabled roles cannot be assigned, and D1 guards close bind/disable commit-order races | active-role disable, disabled assignment, and competing bind/disable tests |
| Additional ownership concurrency audit | ownership replacement remains atomic under the single-book-owner persistence constraint | competing ownership-transfer test |

## 8. Docs 006 And 007 DoD Reconciliation

Docs 006 is satisfied for `content-api`: `id` issuer/audience/JWKS and coarse scopes are enforced; user actors use `sub`; M2M actors are supported without implicit administration; direct-share tokens cannot carry `content:share`; optional identity claims no longer destroy local projection data; and tests use `id`-shaped tokens.

Docs 007 must be evaluated according to its implemented IAM-substrate scope and the explicit handoff in docs 009. For that delivered scope, the current remediation covers resource-scoped binding/denial/role/admin APIs, target-principal validation, protected-role delegation, tenant namespace isolation, denial precedence, effective binding explanation, audit bounding, idempotency, and concurrent security-state invariants.

The chapter/section/block/comment/bookmark/reading-progress product routes remain planned in docs 009. They are not silently counted as implemented by this review and are not required to close the security defects in the two reviewed IAM-substrate commits.

## 9. Final Assessment

Final rating for the delivered docs 006/007 IAM substrate after remediation: **10/10**.

This rating applies to the implemented identity and IAM-administration substrate reviewed here. It does not claim that the separate docs 009 product-resource hierarchy has been implemented.
